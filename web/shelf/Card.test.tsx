import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../components/Toast';
import type { ShelfGame } from './api';
import { Card } from './Card';
import { resetInFlightWrites } from './useTrackingMutations';

function game(overrides: Partial<ShelfGame> = {}): ShelfGame {
	return {
		id: 'g1',
		title: 'Bloodborne',
		coverUrl: 'https://cdn.example/bb.jpg',
		storeUrl: null,
		playStatus: 'Not started',
		effectiveState: 'Not started',
		owned: true,
		released: true,
		wishlisted: false,
		playableNow: true,
		psPlusExtra: false,
		hasCompleted: false,
		hasPlatinum: false,
		completedOn: null,
		platinumOn: null,
		startedOn: null,
		boughtOn: null,
		wishlistedOn: null,
		ownershipType: null,
		releaseDate: '2015-03-24',
		genres: ['Action', 'RPG'],
		...overrides,
	};
}

/** The card's status pill and owned toggle are mutation-bearing widgets. */
// Menu open-state is grid-owned (Story 3.6); these tests never open it.
const noMenu = { statusMenuOpen: false, onStatusMenuOpenChange: () => {} };

function Providers({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return (
		<QueryClientProvider client={client}>
			<ToastHost>{children}</ToastHost>
		</QueryClientProvider>
	);
}

function renderCard(g: ShelfGame) {
	return render(<Card game={g} tabIndex={0} {...noMenu} />, {
		wrapper: Providers,
	});
}

describe('Card', () => {
	it('renders cover art, title, state pill, owned indicator, and genres', () => {
		renderCard(game());
		expect(screen.getByTestId('card-cover')).toHaveAttribute(
			'src',
			'https://cdn.example/bb.jpg',
		);
		expect(screen.getByText('Bloodborne')).toBeInTheDocument();
		expect(screen.getByTestId('state-pill')).toHaveTextContent('Not started');
		expect(screen.getByText('OWNED')).toBeInTheDocument();
		expect(screen.getByText('Action · RPG')).toBeInTheDocument();
	});

	it('shows a non-network cover fallback when no cover URL', () => {
		renderCard(game({ coverUrl: null }));
		expect(screen.queryByTestId('card-cover')).not.toBeInTheDocument();
	});

	it('adds the Playing bloom class only for a Playing card', () => {
		const { rerender } = renderCard(game({ effectiveState: 'Playing' }));
		expect(screen.getByTestId('shelf-card')).toHaveClass('card--playing');
		rerender(
			<Card
				game={game({ effectiveState: 'Paused' })}
				tabIndex={0}
				{...noMenu}
			/>,
		);
		expect(screen.getByTestId('shelf-card')).not.toHaveClass('card--playing');
	});

	it('shows the platinum badge over the completed badge when both apply', () => {
		renderCard(
			game({
				hasCompleted: true,
				hasPlatinum: true,
				effectiveState: 'Playing',
			}),
		);
		expect(screen.getByText('Platinum achieved')).toBeInTheDocument();
		expect(screen.getByText('🏆')).toBeInTheDocument();
		expect(screen.queryByText('Story completed')).not.toBeInTheDocument();
	});

	it('shows a milestone badge on a live card (persists regardless of status)', () => {
		renderCard(game({ hasCompleted: true, effectiveState: 'Playing' }));
		expect(screen.getByText('Story completed')).toBeInTheDocument();
		expect(screen.getByText('✓')).toBeInTheDocument();
	});

	it('flags TBA when unreleased with no date, SOON with a future date', () => {
		const { rerender } = renderCard(
			game({ released: false, releaseDate: null }),
		);
		expect(screen.getByText('TBA')).toBeInTheDocument();
		rerender(
			<Card
				game={game({ released: false, releaseDate: '2999-01-01' })}
				tabIndex={0}
				{...noMenu}
			/>,
		);
		expect(screen.getByText('SOON')).toBeInTheDocument();
	});

	it('makes the cover an open-details trigger outside the tab order (Story 2.3)', () => {
		renderCard(game());
		const trigger = screen.getByRole('button', {
			name: 'Open details — Bloodborne',
		});
		expect(trigger).toHaveAttribute('tabindex', '-1');
		// The cover art renders inside the trigger — the whole cover is the target.
		expect(trigger).toContainElement(screen.getByTestId('card-cover'));
	});

	it('shows the PS+ Extra badge only for an unowned in-catalog game', () => {
		renderCard(game({ psPlusExtra: true, owned: false, wishlisted: true }));
		expect(
			screen.getByText('In the PlayStation Plus Extra catalog'),
		).toBeInTheDocument();
	});

	describe('owned toggle (Story 2.4)', () => {
		afterEach(() => {
			resetInFlightWrites();
			vi.unstubAllGlobals();
		});

		// Untyped like DetailPanel.test's stub: `mock.calls` stays assertable
		// without fighting the zero-arg tuple inference.
		function stubFetch(): ReturnType<typeof vi.fn> {
			const fetchMock = vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({ effectiveState: 'Not started' }),
			}));
			vi.stubGlobal('fetch', fetchMock);
			return fetchMock;
		}

		it('renders top-right with an accessible name and pressed state', () => {
			renderCard(game({ owned: true }));
			const toggle = screen.getByRole('button', {
				name: 'Owned — Bloodborne',
			});
			expect(toggle).toHaveAttribute('aria-pressed', 'true');
			// Out of the tab order like the pill/cover: the gridcell is the stop.
			expect(toggle).toHaveAttribute('tabindex', '-1');
		});

		it('reflects the un-owned state', () => {
			renderCard(game({ owned: false }));
			expect(
				screen.getByRole('button', { name: 'Owned — Bloodborne' }),
			).toHaveAttribute('aria-pressed', 'false');
		});

		it('owning PATCHes the ownership route without a confirm', async () => {
			const fetchMock = stubFetch();
			const user = userEvent.setup();
			renderCard(game({ owned: false }));

			await user.click(
				screen.getByRole('button', { name: 'Owned — Bloodborne' }),
			);
			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe('/api/games/g1/ownership');
			expect(init).toMatchObject({ method: 'PATCH' });
			expect(JSON.parse(init.body)).toEqual({ owned: true });
			// Owning is not risky — plain toast, no UNDO.
			expect(await screen.findByTestId('toast')).toHaveTextContent(
				'Bloodborne — owned',
			);
			expect(
				screen.queryByRole('button', { name: 'Undo' }),
			).not.toBeInTheDocument();
		});

		it('un-owning shows an UNDO toast that restores flag and previous type', async () => {
			const fetchMock = stubFetch();
			const user = userEvent.setup();
			renderCard(game({ owned: true, ownershipType: 'digital' }));

			await user.click(
				screen.getByRole('button', { name: 'Owned — Bloodborne' }),
			);
			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
			expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
				owned: false,
			});

			const undo = await screen.findByRole('button', { name: 'Undo' });
			await user.click(undo);
			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
			expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
				owned: true,
				ownershipType: 'digital',
			});
		});

		it('never opens the detail panel', async () => {
			stubFetch();
			const user = userEvent.setup();
			renderCard(game({ owned: false }));

			await user.click(
				screen.getByRole('button', { name: 'Owned — Bloodborne' }),
			);
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		});
	});
});
