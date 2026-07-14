import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../components/Toast';
import { AddGameDialog } from './AddGameDialog';
import * as api from './api';

vi.mock('./api', () => ({
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
};
const RIGHT = {
	igdbId: '99',
	name: "Marvel's Spider-Man 2",
	coverUrl: 'https://img/marvel.jpg',
	releaseDate: '2023-10-20',
	genres: ['Adventure', 'Shooter'],
};

function renderDialog() {
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
					<AddGameDialog title="Spider-Man 2" onClose={onClose} />
				</ToastHost>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	return { onClose };
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
