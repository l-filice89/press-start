import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../components/Toast';
import { AddGameDialog } from './AddGameDialog';
import * as api from './api';

// importOriginal keeps the pure helpers (candidateScores) real — only the
// network calls are mocked.
vi.mock('./api', async (importOriginal) => ({
	...(await importOriginal<typeof api>()),
	fetchAddPreview: vi.fn(),
	searchIgdb: vi.fn(),
	addGame: vi.fn(),
}));

// The auto-match (PV-1's failure mode: the 2004 movie tie-in wins the exact
// name) and the game the user actually meant.
const AUTO = {
	igdbId: '1',
	name: 'Spider-Man 2',
	coverUrl: 'https://img/tie-in.jpg',
	releaseDate: '2004-06-28',
	genres: ['Platform'],
	criticScore: null,
	criticScoreCount: null,
	userScore: null,
	userScoreCount: null,
};
const RIGHT = {
	igdbId: '99',
	name: "Marvel's Spider-Man 2",
	coverUrl: 'https://img/marvel.jpg',
	releaseDate: '2023-10-20',
	genres: ['Adventure', 'Shooter'],
	criticScore: 88.5,
	criticScoreCount: 40,
	userScore: 92.1,
	userScoreCount: 300,
};

function renderDialog(prefill?: {
	coverUrl?: string | null;
	psnProductId?: string;
}) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onClose = vi.fn();
	// The dialog navigates (a duplicate routes to the existing game's detail —
	// Story 7.2 replaced the OPEN_DETAIL window event with the router), so it
	// needs a router in the tree.
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={['/']}>
				<ToastHost>
					<AddGameDialog
						title="Spider-Man 2"
						onClose={onClose}
						prefill={prefill}
					/>
				</ToastHost>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	return { onClose, client };
}

const rematchButton = () =>
	screen.findByRole('button', { name: 'Not the right game?' });

describe('AddGameDialog — correct the match before saving (Story 6.6 / PV-6)', () => {
	beforeEach(() => {
		vi.mocked(api.fetchAddPreview).mockResolvedValue({
			available: true,
			candidate: AUTO,
		});
		vi.mocked(api.searchIgdb).mockResolvedValue([AUTO, RIGHT]);
		vi.mocked(api.addGame).mockResolvedValue({
			kind: 'created',
			gameId: 'g1',
		});
	});

	it('picking a candidate overwrites the WHOLE draft and saves its igdbId', async () => {
		const user = userEvent.setup();
		renderDialog();

		// Seeded from the (wrong) auto-match.
		await waitFor(() =>
			expect(screen.getByLabelText('Title')).toHaveValue('Spider-Man 2'),
		);

		await user.click(await rematchButton());
		const picker = await screen.findByTestId('add-game-picker');
		// Pick BY NAME, not by list position — an index would silently click the
		// wrong row if the candidate list ever reorders.
		const rightRow = (await within(picker).findAllByRole('listitem')).find(
			(li) => li.textContent?.includes(RIGHT.name),
		);
		await user.click(
			within(rightRow as HTMLElement).getByRole('button', {
				name: 'Use this match',
			}),
		);

		// Picker closes; every field is the picked game's, not a mix of the two.
		await waitFor(() => expect(picker).not.toBeInTheDocument());
		expect(screen.getByLabelText('Title')).toHaveValue("Marvel's Spider-Man 2");
		expect(screen.getByLabelText('Release date')).toHaveValue('2023-10-20');
		expect(screen.getByLabelText('Genres (comma-separated)')).toHaveValue(
			'Adventure, Shooter',
		);
		expect(screen.getByLabelText('Cover URL')).toHaveValue(
			'https://img/marvel.jpg',
		);

		await user.click(screen.getByRole('button', { name: 'Add to wishlist' }));
		await waitFor(() =>
			expect(vi.mocked(api.addGame).mock.calls[0][0]).toMatchObject({
				title: "Marvel's Spider-Man 2",
				igdbId: '99',
				coverUrl: 'https://img/marvel.jpg',
				releaseDate: '2023-10-20',
				genres: ['Adventure', 'Shooter'],
			}),
		);
	});

	it('Escape closes the picker only — the add modal and its draft survive', async () => {
		const user = userEvent.setup();
		const { onClose } = renderDialog();
		await user.click(await rematchButton());
		await screen.findByTestId('add-game-picker');

		await user.keyboard('{Escape}');

		await waitFor(() =>
			expect(screen.queryByTestId('add-game-picker')).not.toBeInTheDocument(),
		);
		expect(screen.getByTestId('add-game-dialog')).toBeInTheDocument();
		expect(onClose).not.toHaveBeenCalled();
	});

	it('closing the picker returns focus to the affordance — not to <body>, which leaks the trap', async () => {
		const user = userEvent.setup();
		renderDialog();
		const affordance = await rematchButton();
		await user.click(affordance);
		await screen.findByTestId('add-game-picker');

		await user.click(screen.getByRole('button', { name: 'Back' }));

		await waitFor(() => expect(affordance).toHaveFocus());
	});

	it('hides the affordance when the games DB is unavailable — never an empty picker', async () => {
		vi.mocked(api.fetchAddPreview).mockResolvedValue({
			available: false,
			candidate: null,
		});
		renderDialog();

		expect(await screen.findByText(/Games DB unavailable/)).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Not the right game?' }),
		).not.toBeInTheDocument();
	});

	it('offers the affordance when the DB is up but auto-matched nothing', async () => {
		vi.mocked(api.fetchAddPreview).mockResolvedValue({
			available: true,
			candidate: null,
		});
		renderDialog();

		expect(await rematchButton()).toBeInTheDocument();
	});
});

/**
 * Story 7.3 review (H1). Opened from the CATALOG, the dialog used to offer "I own
 * this game" — and ticking it wrote owned:true, owned_via:'purchase', bought_on:
 * today for a PS+ EXTRA title: a purchase that never happened, on a date that
 * means nothing. A PS+ title counts as owned ONLY via owned_via:'membership', and
 * ONLY when a sync observes the real entitlement (Story 6.4) — the app cannot see
 * the PS Store tab. The route refuses the pair regardless (integration).
 */
describe('AddGameDialog — a CATALOG add is never an owned add (Story 7.3)', () => {
	beforeEach(() => {
		vi.mocked(api.fetchAddPreview).mockResolvedValue({
			available: true,
			candidate: AUTO,
		});
		vi.mocked(api.addGame).mockResolvedValue({ kind: 'created', gameId: 'g1' });
	});

	it('offers NO owned toggle when opened from a store product, and saves not-owned', async () => {
		const user = userEvent.setup();
		renderDialog({ psnProductId: 'EP-1' });

		await waitFor(() =>
			expect(screen.getByLabelText('Title')).toHaveValue('Spider-Man 2'),
		);
		expect(screen.queryByLabelText('I own this game')).not.toBeInTheDocument();
		// The CTA can therefore only ever name the one honest outcome.
		expect(
			screen.queryByRole('button', { name: 'Add as owned' }),
		).not.toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Add to wishlist' }));
		await waitFor(() =>
			// lastCall: the mock is module-scoped and earlier describes already used it.
			expect(vi.mocked(api.addGame).mock.lastCall?.[0]).toMatchObject({
				owned: false,
				psnProductId: 'EP-1',
			}),
		);
	});

	it('still offers it on the SHELF add (no product id) — that one IS a purchase', async () => {
		renderDialog();
		expect(await screen.findByLabelText('I own this game')).toBeInTheDocument();
	});

	/**
	 * Epic 7 cross-story review (M3). The server anchors the PSN_PRODUCT link on
	 * BOTH outcomes — a catalog game that turns out to be already tracked under a
	 * different title comes back `duplicate`, and it IS now marked — but only the
	 * `created` branch invalidated ['catalog']. So the grid kept its stale page and
	 * the card still read ＋ Add after navigating back.
	 */
	it('a DUPLICATE add from the catalog invalidates the CATALOG grid too', async () => {
		vi.mocked(api.addGame).mockResolvedValue({
			kind: 'duplicate',
			gameId: 'g9',
		});
		const user = userEvent.setup();
		const { client } = renderDialog({ psnProductId: 'EP-DUP-1' });
		const invalidate = vi.spyOn(client, 'invalidateQueries');

		await waitFor(() =>
			expect(screen.getByLabelText('Title')).toHaveValue('Spider-Man 2'),
		);
		await user.click(screen.getByRole('button', { name: 'Add to wishlist' }));

		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith({ queryKey: ['catalog'] }),
		);
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['shelf'] });
	});
});
