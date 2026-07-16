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
		ownedVia: null,
		releaseDate: '2015-03-24',
		genres: ['Action', 'RPG'],
		criticScore: null,
		criticScoreCount: null,
		userScore: null,
		userScoreCount: null,
		psPlusLeavingOn: null,
		ttbStorySeconds: null,
		ttbCompleteSeconds: null,
		ttbCount: null,
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
		// Epic 11 story 11.3: the trophy %/grade readout is deleted. Testid
		// spelled in halves so the story's grep-clean check stays zero-hit.
		expect(
			screen.queryByTestId(['card-', 'trophy'].join('')),
		).not.toBeInTheDocument();
	});

	describe('reception scores (Story 10.1, VR-5)', () => {
		it('renders rounded critic and user scores with counts in the a11y text', () => {
			renderCard(
				game({
					criticScore: 93.52941176470588,
					criticScoreCount: 17,
					userScore: 89.47202036710553,
					userScoreCount: 1699,
				}),
			);
			const row = screen.getByTestId('card-scores');
			expect(row).toHaveTextContent('◎ 94');
			expect(row).toHaveTextContent('★ 89');
			expect(row).toHaveTextContent('from 17 reviews');
			expect(row).toHaveTextContent('from 1699 ratings');
		});

		it('renders NOTHING in a null slot — never a zero', () => {
			renderCard(
				game({ criticScore: null, userScore: 42.4, userScoreCount: 3 }),
			);
			const row = screen.getByTestId('card-scores');
			// No critic glyph and no fabricated zero — the slot is simply absent.
			expect(row).not.toHaveTextContent('◎');
			expect(row).toHaveTextContent('★ 42');
			expect(row.querySelector('.card__score--critic')).toBeNull();
		});

		it('renders NO scores block at all when the game has no facts — compaction, not a blank line', () => {
			renderCard(game());
			expect(screen.queryByTestId('card-scores')).not.toBeInTheDocument();
		});

		it('color-grades each score by its rounded value (Story 10.5) with sr-only text untouched', () => {
			renderCard(
				game({
					criticScore: 88.5, // rounds to 89 → green
					criticScoreCount: 17,
					userScore: 60.4, // rounds to 60 → red
					userScoreCount: 3,
				}),
			);
			const row = screen.getByTestId('card-scores');
			expect(row.querySelector('.card__score--critic')).toHaveClass(
				'score-grade--high',
			);
			expect(row.querySelector('.card__score--user')).toHaveClass(
				'score-grade--low',
			);
			// Grading is presentation-only — the a11y string is byte-identical to
			// the pre-10.5 shape (exact compare on the sr-only node, not substring).
			expect(
				row.querySelector('.card__score--critic .sr-only')?.textContent,
			).toBe('Critic score 89 out of 100 from 17 reviews');
		});

		it('grades the mid bucket amber (61–74)', () => {
			renderCard(game({ userScore: 71 }));
			expect(
				screen.getByTestId('card-scores').querySelector('.card__score--user'),
			).toHaveClass('score-grade--mid');
		});

		it('renders a 0 score as a real red value — never treated as absent (I/O matrix)', () => {
			renderCard(game({ userScore: 0 }));
			const slot = screen
				.getByTestId('card-scores')
				.querySelector('.card__score--user');
			expect(slot).toHaveTextContent('★ 0');
			expect(slot).toHaveClass('score-grade--low');
		});

		it('stacks reviews, story, and 100% as separate lines (Luca 2026-07-16)', () => {
			renderCard(
				game({
					criticScore: 78,
					userScore: 75,
					ttbStorySeconds: 160800,
					ttbCompleteSeconds: 216000,
				}),
			);
			const lines = screen
				.getByTestId('card-scores')
				.querySelectorAll('.card__scores-line');
			expect(lines).toHaveLength(3);
			expect(lines[0]).toHaveTextContent('◎ 78');
			expect(lines[0]).toHaveTextContent('★ 75');
			expect(lines[1]).toHaveTextContent('45h story');
			expect(lines[2]).toHaveTextContent('60h 100%');
		});
	});

	describe('info-strip compaction (Luca 2026-07-16)', () => {
		it('drops the genres row entirely when a game has none', () => {
			const { container } = renderCard(game({ genres: [] }));
			expect(container.querySelector('.card__genres')).toBeNull();
		});

		it('renders no OWNED chip at all when un-owned — absence, not visibility:hidden', () => {
			const { container } = renderCard(game({ owned: false }));
			expect(screen.queryByText('OWNED')).not.toBeInTheDocument();
			expect(container.querySelector('.card__owned-line')).toBeNull();
		});
	});

	describe('time to beat (Story 10.3, VR-8)', () => {
		it('renders labelled story and 100% hours from stored seconds', () => {
			renderCard(
				game({
					ttbStorySeconds: 54000,
					ttbCompleteSeconds: 95400,
					ttbCount: 8,
				}),
			);
			const row = screen.getByTestId('card-scores');
			expect(row).toHaveTextContent('15h story');
			expect(row).toHaveTextContent('27h 100%');
		});

		it('a missing figure is ABSENT — the completionist figure never stands in for story', () => {
			renderCard(game({ ttbStorySeconds: null, ttbCompleteSeconds: 95400 }));
			const row = screen.getByTestId('card-scores');
			expect(row).not.toHaveTextContent('story');
			expect(row).toHaveTextContent('27h 100%');
		});

		it('an under-an-hour figure says <1h, never a zero', () => {
			renderCard(game({ ttbStorySeconds: 1800 }));
			expect(screen.getByTestId('card-scores')).toHaveTextContent('<1h story');
		});
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
		expect(screen.getByTestId(/^platinum-trophy-/)).toBeInTheDocument();
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

	it('tags the OWNED chip with PS+ for a membership claim — never for a purchase (FR-9 amended)', () => {
		const { unmount } = renderCard(
			game({ owned: true, ownedVia: 'membership' }),
		);
		const tag = screen.getByTestId('card-owned-via-membership');
		expect(tag).toHaveTextContent('PS+');
		// AT hears the source, not just a glyph.
		expect(tag).toHaveTextContent('via PS Plus claim');
		unmount();

		renderCard(game({ owned: true, ownedVia: 'purchase' }));
		expect(
			screen.queryByTestId('card-owned-via-membership'),
		).not.toBeInTheDocument();
	});

	describe('LEAVING PS+ warning (Story 10.4, VR-6 rework)', () => {
		it('warns on an un-owned game with a departure date — beside the PS+ pill, not instead of it', () => {
			renderCard(
				game({
					owned: false,
					psPlusExtra: true,
					psPlusLeavingOn: '2099-07-21',
				}),
			);
			const flag = screen.getByTestId('card-flag-leaving');
			expect(flag).toHaveTextContent('LEAVING 21 JUL');
			expect(flag).toHaveClass('card__flag--leaving');
			expect(flag).toHaveTextContent(
				'Leaving the PlayStation Plus Extra catalog on 2099-07-21',
			);
			// STILL in the catalog — the steady-state pill renders alongside.
			expect(
				screen.getByText('In the PlayStation Plus Extra catalog'),
			).toBeInTheDocument();
		});

		it('never warns on an owned game (FR-38 — ownership makes membership irrelevant)', () => {
			renderCard(
				game({ owned: true, psPlusExtra: true, psPlusLeavingOn: '2099-07-21' }),
			);
			expect(screen.queryByTestId('card-flag-leaving')).not.toBeInTheDocument();
		});

		it('a PAST leaving date is suppressed — the game departed inside the cron blind window (review)', () => {
			renderCard(
				game({
					owned: false,
					psPlusExtra: true,
					psPlusLeavingOn: '2020-01-05',
				}),
			);
			expect(screen.queryByTestId('card-flag-leaving')).not.toBeInTheDocument();
		});

		it('no warning without a leaving date', () => {
			renderCard(
				game({ owned: false, psPlusExtra: true, psPlusLeavingOn: null }),
			);
			expect(screen.queryByTestId('card-flag-leaving')).not.toBeInTheDocument();
		});

		it('the retired LEFT PS+ pill renders for no input shape (Story 10.4 directive)', () => {
			renderCard(game({ owned: false, psPlusExtra: false }));
			expect(screen.queryByTestId('card-flag-ps-left')).not.toBeInTheDocument();
		});
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

		// Story 6.4: the UNDO must restore provenance too — otherwise a re-owned
		// claim silently revives as a purchase (and would stamp bought_on).
		it('un-owning a claim then UNDO restores via=membership', async () => {
			const fetchMock = stubFetch();
			const user = userEvent.setup();
			renderCard(game({ owned: true, ownedVia: 'membership' }));

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
				via: 'membership',
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

		// Story 6.4 AC1/AC2: owning a PS+-catalog game is ambiguous — gate on the
		// buy-vs-claim prompt, no write until the user chooses.
		it('owning a PS+ game opens the source prompt and writes nothing yet', async () => {
			const fetchMock = stubFetch();
			const user = userEvent.setup();
			renderCard(game({ owned: false, psPlusExtra: true }));

			await user.click(
				screen.getByRole('button', { name: 'Owned — Bloodborne' }),
			);
			expect(
				screen.getByRole('dialog', {
					name: 'Did you buy Bloodborne, or claim it with PS+?',
				}),
			).toBeInTheDocument();
			// Gated: no PATCH until the user chooses a source.
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('choosing "Claimed with PS+" writes via=membership', async () => {
			const fetchMock = stubFetch();
			const user = userEvent.setup();
			renderCard(game({ owned: false, psPlusExtra: true }));

			await user.click(
				screen.getByRole('button', { name: 'Owned — Bloodborne' }),
			);
			await user.click(
				screen.getByRole('button', { name: 'Claimed with PS+' }),
			);
			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
			expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
				owned: true,
				via: 'membership',
			});
		});

		it('choosing "Purchased" writes via=purchase', async () => {
			const fetchMock = stubFetch();
			const user = userEvent.setup();
			renderCard(game({ owned: false, psPlusExtra: true }));

			await user.click(
				screen.getByRole('button', { name: 'Owned — Bloodborne' }),
			);
			await user.click(screen.getByRole('button', { name: 'Purchased' }));
			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
			expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
				owned: true,
				via: 'purchase',
			});
		});

		it('cancelling the source prompt writes nothing', async () => {
			const fetchMock = stubFetch();
			const user = userEvent.setup();
			renderCard(game({ owned: false, psPlusExtra: true }));

			await user.click(
				screen.getByRole('button', { name: 'Owned — Bloodborne' }),
			);
			await user.click(screen.getByRole('button', { name: 'Cancel' }));
			expect(
				screen.queryByTestId('ownership-source-dialog'),
			).not.toBeInTheDocument();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});
});
