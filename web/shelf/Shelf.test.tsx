import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShelfGame } from './api';
import { chunkIntoRows, countColumns, Shelf } from './Shelf';
import { resetInFlightWrites } from './useTrackingMutations';

function card(
	id: string,
	title: string,
	over: Partial<ShelfGame> = {},
): ShelfGame {
	return {
		id,
		title,
		coverUrl: null,
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
		releaseDate: null,
		genres: [],
		...over,
	};
}

function mockFetch(games: ShelfGame[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ games }),
		})),
	);
}

function renderShelf() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<Shelf />
		</QueryClientProvider>,
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	resetInFlightWrites();
});

describe('Shelf', () => {
	it('shows cover-shaped skeletons while the shelf query is pending', () => {
		mockFetch([]);
		renderShelf();
		expect(screen.getByTestId('skeleton-grid')).toBeInTheDocument();
	});

	it('shows the INSERT GAMES empty state for an empty library', async () => {
		mockFetch([]);
		renderShelf();
		expect(await screen.findByText('INSERT GAMES')).toBeInTheDocument();
	});

	it('renders a card per game, preserving server order', async () => {
		mockFetch([
			card('a', 'Apex', { effectiveState: 'Playing' }),
			card('b', 'Bolt'),
		]);
		renderShelf();
		const cards = await screen.findAllByTestId('shelf-card');
		expect(cards).toHaveLength(2);
		expect(cards[0]).toHaveTextContent('Apex');
		expect(cards[1]).toHaveTextContent('Bolt');
	});

	it('is a focusable grid with arrow traversal in reading order', async () => {
		const user = userEvent.setup();
		mockFetch([card('a', 'Apex'), card('b', 'Bolt'), card('c', 'Cyan')]);
		renderShelf();
		const cards = await screen.findAllByTestId('shelf-card');

		cards[0].focus();
		expect(cards[0]).toHaveFocus();
		await user.keyboard('{ArrowRight}');
		expect(cards[1]).toHaveFocus();
		await user.keyboard('{End}');
		expect(cards[2]).toHaveFocus();
		await user.keyboard('{Home}');
		expect(cards[0]).toHaveFocus();
	});

	it('cycles Tab between pill, cover, and owned toggle inside a cell, Escape returns to it (Stories 2.3/2.4)', async () => {
		const user = userEvent.setup();
		mockFetch([card('a', 'Apex'), card('b', 'Bolt')]);
		renderShelf();
		const cards = await screen.findAllByTestId('shelf-card');

		// Enter on the cell still lands on the pill first (2.1 contract).
		cards[0].focus();
		await user.keyboard('{Enter}');
		const pill = within(cards[0]).getByTestId('status-pill-button');
		expect(pill).toHaveFocus();

		// Tab cycles through the cell's three widgets without leaving it.
		const cover = within(cards[0]).getByTestId('card-cover-button');
		const ownedToggle = within(cards[0]).getByTestId('card-owned-toggle');
		await user.tab();
		expect(cover).toHaveFocus();
		await user.tab();
		expect(ownedToggle).toHaveFocus();
		await user.tab();
		expect(pill).toHaveFocus();
		await user.tab({ shift: true });
		expect(ownedToggle).toHaveFocus();

		// Escape from a widget hands focus back to the owning gridcell.
		await user.keyboard('{Escape}');
		expect(cards[0]).toHaveFocus();
	});

	it('nests gridcells in role="row" groups under one role="grid" (not a flat 1×N row)', async () => {
		mockFetch([card('a', 'Apex'), card('b', 'Bolt'), card('c', 'Cyan')]);
		renderShelf();
		const grid = await screen.findByRole('grid');
		// jsdom has no layout engine / ResizeObserver, so columnCount falls back
		// to 1 → one gridcell per row (an N×1 grid, never a single 1×N row).
		const rows = within(grid).getAllByRole('row');
		expect(rows).toHaveLength(3);
		for (const row of rows) {
			expect(within(row).getAllByRole('gridcell')).toHaveLength(1);
		}
	});

	it('filters to exactly the selected states and restores the default set on deselect (Story 3.1)', async () => {
		const user = userEvent.setup();
		mockFetch([
			card('a', 'Apex', { effectiveState: 'Playing', playStatus: 'Playing' }),
			card('b', 'Bolt', { effectiveState: 'Paused', playStatus: 'Paused' }),
			card('c', 'Cyan'),
		]);
		renderShelf();
		await screen.findAllByTestId('shelf-card');

		await user.click(screen.getByRole('button', { name: 'State' }));
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Playing' }));

		let cards = screen.getAllByTestId('shelf-card');
		expect(cards).toHaveLength(1);
		expect(cards[0]).toHaveTextContent('Apex');

		// Second pick ORs within the group, preserving server order.
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Paused' }));
		cards = screen.getAllByTestId('shelf-card');
		expect(cards.map((c) => c.textContent)).toEqual([
			expect.stringContaining('Apex'),
			expect.stringContaining('Bolt'),
		]);

		// Deselecting everything restores the default visible set.
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Playing' }));
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Paused' }));
		expect(screen.getAllByTestId('shelf-card')).toHaveLength(3);
	});

	it('NO MATCH offers Clear filters, which restores the default set (Story 3.3)', async () => {
		const user = userEvent.setup();
		mockFetch([card('a', 'Apex', { effectiveState: 'Playing' })]);
		renderShelf();
		await screen.findAllByTestId('shelf-card');

		await user.click(screen.getByRole('button', { name: 'State' }));
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Paused' }));
		await user.keyboard('{Escape}');
		expect(screen.getByText('NO MATCH')).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Clear filters' }));
		expect(screen.getAllByTestId('shelf-card')).toHaveLength(1);
		expect(screen.queryByTestId('filter-summary')).not.toBeInTheDocument();
	});

	it('an all-hidden library with no filter shows INSERT GAMES, not NO MATCH', async () => {
		// The payload now includes hidden games — an all-finished library is an
		// empty backlog (insert-games), not a failed filter (no-match).
		mockFetch([
			card('a', 'Done', {
				playStatus: null,
				effectiveState: 'Story completed',
			}),
			card('b', 'Gone', { playStatus: 'Dropped', effectiveState: 'Dropped' }),
		]);
		renderShelf();
		expect(await screen.findByText('INSERT GAMES')).toBeInTheDocument();
		expect(screen.queryByText('NO MATCH')).not.toBeInTheDocument();
	});

	it('shows NO MATCH (never a blank shelf) when filters match nothing', async () => {
		const user = userEvent.setup();
		mockFetch([card('a', 'Apex', { effectiveState: 'Playing' })]);
		renderShelf();
		await screen.findAllByTestId('shelf-card');

		await user.click(screen.getByRole('button', { name: 'State' }));
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Paused' }));

		expect(screen.queryAllByTestId('shelf-card')).toHaveLength(0);
		expect(screen.getByText('NO MATCH')).toBeInTheDocument();
	});

	// HAZARD (Story 3.5, FR-4/FR-21 amended): a reveal pill is an EXCLUSIVE
	// view — it replaces the State group (the selection clears), shows only the
	// revealed hidden state, and a new state selection leaves the reveal view.
	it('a reveal pill shows only revealed games and clears the state selection (Story 3.5)', async () => {
		const user = userEvent.setup();
		mockFetch([
			card('a', 'Apex', { effectiveState: 'Playing', playStatus: 'Playing' }),
			card('b', 'Bolt', { effectiveState: 'Paused', playStatus: 'Paused' }),
			card('c', 'Cyan', { playStatus: 'Dropped', effectiveState: 'Dropped' }),
		]);
		renderShelf();
		await screen.findAllByTestId('shelf-card');

		await user.click(screen.getByRole('button', { name: 'State' }));
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Playing' }));
		await user.keyboard('{Escape}');
		expect(screen.getAllByTestId('shelf-card')).toHaveLength(1);

		await user.click(
			screen.getByRole('button', { name: 'Show only Dropped games' }),
		);
		const cards = screen.getAllByTestId('shelf-card');
		expect(cards).toHaveLength(1);
		expect(cards[0]).toHaveTextContent('Cyan');
		// The state selection cleared — trigger back to its plain name.
		expect(screen.getByRole('button', { name: 'State' })).toBeInTheDocument();

		// And the other direction: a state pick leaves the reveal view.
		await user.click(screen.getByRole('button', { name: 'State' }));
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Paused' }));
		expect(screen.getAllByTestId('shelf-card')[0]).toHaveTextContent('Bolt');
		expect(
			screen.getByRole('button', { name: 'Show only Dropped games' }),
		).toHaveAttribute('aria-pressed', 'false');
	});

	// HAZARD (Story 3.5; deferred from 3.4): when the LAST visible card leaves
	// the shelf, ShelfGrid unmounts entirely — focus must land on the empty
	// state's deliberate target (Clear filters), never fall to <body>.
	it('hands focus to the empty state when the last visible card leaves the shelf', async () => {
		const user = userEvent.setup();
		const a = card('a', 'Apex', {
			effectiveState: 'Playing',
			playStatus: 'Playing',
		});
		const b = card('b', 'Bolt', {
			effectiveState: 'Paused',
			playStatus: 'Paused',
		});
		let games = [a, b];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				if (init?.method === 'PATCH') {
					games = [
						{ ...a, playStatus: 'Dropped', effectiveState: 'Dropped' },
						b,
					];
					return {
						ok: true,
						status: 200,
						json: async () => ({ effectiveState: 'Dropped' }),
					};
				}
				return { ok: true, status: 200, json: async () => ({ games }) };
			}),
		);
		renderShelf();
		await screen.findAllByTestId('shelf-card');

		// Narrow to Playing only — Apex is now the last visible card.
		await user.click(screen.getByRole('button', { name: 'State' }));
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Playing' }));
		await user.keyboard('{Escape}');
		const cards = screen.getAllByTestId('shelf-card');
		expect(cards).toHaveLength(1);

		// Drop it from the card's status menu (focus is inside the grid).
		cards[0].focus();
		await user.keyboard('{Enter}');
		await user.keyboard('{Enter}');
		await user.click(screen.getByRole('menuitemradio', { name: 'Dropped' }));

		await screen.findByText('NO MATCH');
		expect(screen.getByRole('button', { name: 'Clear filters' })).toHaveFocus();

		// Reverse handoff: activating Clear filters unmounts the empty state
		// under the focused button — focus lands back on the grid, never <body>.
		await user.click(screen.getByRole('button', { name: 'Clear filters' }));
		await screen.findAllByTestId('shelf-card');
		expect(screen.getByTestId('shelf-grid')).toHaveFocus();
	});

	it('toggling the last reveal pill off restores the default set', async () => {
		const user = userEvent.setup();
		mockFetch([
			card('a', 'Apex', { effectiveState: 'Playing', playStatus: 'Playing' }),
			card('c', 'Cyan', { playStatus: 'Dropped', effectiveState: 'Dropped' }),
		]);
		renderShelf();
		await screen.findAllByTestId('shelf-card');

		const pill = screen.getByRole('button', {
			name: 'Show only Dropped games',
		});
		await user.click(pill);
		expect(screen.getAllByTestId('shelf-card')[0]).toHaveTextContent('Cyan');
		await user.click(pill);
		const cards = screen.getAllByTestId('shelf-card');
		expect(cards).toHaveLength(1);
		expect(cards[0]).toHaveTextContent('Apex');
	});

	// The actionless variant (all-hidden library, no filter → INSERT GAMES has
	// no Clear filters): the handoff falls back to the focusable headline.
	it('hands focus to the empty-state headline when no action button is rendered', async () => {
		const user = userEvent.setup();
		const a = card('a', 'Apex', {
			effectiveState: 'Playing',
			playStatus: 'Playing',
		});
		let games = [a];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				if (init?.method === 'PATCH') {
					games = [{ ...a, playStatus: 'Dropped', effectiveState: 'Dropped' }];
					return {
						ok: true,
						status: 200,
						json: async () => ({ effectiveState: 'Dropped' }),
					};
				}
				return { ok: true, status: 200, json: async () => ({ games }) };
			}),
		);
		renderShelf();
		const cards = await screen.findAllByTestId('shelf-card');

		// No filter active: dropping the only live game leaves an all-hidden
		// library → insert-games variant, which renders no action buttons.
		cards[0].focus();
		await user.keyboard('{Enter}');
		await user.keyboard('{Enter}');
		await user.click(screen.getByRole('menuitemradio', { name: 'Dropped' }));

		const headline = await screen.findByText('INSERT GAMES');
		expect(headline).toHaveFocus();
	});

	// HAZARD (Story 3.4, AC3 + AC1): when the focused card unmounts — leaving
	// the visible set after a write, or moving across row parents on a
	// re-chunk — focus must land on a deliberate neighbor, never <body>.
	it('lands focus on a neighbor card when the focused card leaves the shelf after a write', async () => {
		const user = userEvent.setup();
		const a = card('a', 'Apex', {
			effectiveState: 'Playing',
			playStatus: 'Playing',
		});
		const b = card('b', 'Bolt', {
			effectiveState: 'Playing',
			playStatus: 'Playing',
		});
		const c = card('c', 'Cyan', {
			effectiveState: 'Playing',
			playStatus: 'Playing',
		});
		let games = [a, b, c];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				if (init?.method === 'PATCH') {
					games = [a, c];
					return {
						ok: true,
						status: 200,
						json: async () => ({ effectiveState: 'Dropped' }),
					};
				}
				return { ok: true, status: 200, json: async () => ({ games }) };
			}),
		);
		renderShelf();
		const cards = await screen.findAllByTestId('shelf-card');

		// Reach Bolt the roving way (ArrowRight updates the roving index — a
		// direct .focus() wouldn't, and the restore lands on the roving index).
		cards[0].focus();
		await user.keyboard('{ArrowRight}');
		expect(cards[1]).toHaveFocus();
		await user.keyboard('{Enter}'); // widget mode → status pill
		await user.keyboard('{Enter}'); // open the status menu
		await user.click(screen.getByRole('menuitemradio', { name: 'Dropped' }));

		// The refetch removes Bolt; every remaining card shifts row parents
		// (cols=1 in jsdom), remounting them all — the restore must still land
		// on the card at the clamped index, not <body>.
		await waitFor(() =>
			expect(screen.getAllByTestId('shelf-card')).toHaveLength(2),
		);
		const remaining = screen.getAllByTestId('shelf-card');
		expect(remaining[1]).toHaveFocus();
		expect(remaining[1]).toHaveTextContent('Cyan');
	});

	// HAZARD (Story 3.4, AC4): the open panel's state lives in the grid, not
	// the Card — a refetch that reorders/re-chunks the rows (remounting every
	// Card in jsdom's one-column layout) must not close it.
	it('keeps the detail panel open across a refetch that re-chunks the grid', async () => {
		const user = userEvent.setup();
		const a = card('a', 'Apex', {
			effectiveState: 'Playing',
			playStatus: 'Playing',
		});
		const b = card('b', 'Bolt', {
			effectiveState: 'Playing',
			playStatus: 'Playing',
		});
		let games = [a, b];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				if (init?.method === 'PATCH') {
					// The write reorders the shelf — Bolt moves to another row parent.
					games = [b, a];
					return {
						ok: true,
						status: 200,
						json: async () => ({ effectiveState: 'Paused' }),
					};
				}
				if (url.includes('/genres')) {
					return { ok: true, status: 200, json: async () => ({ genres: [] }) };
				}
				return { ok: true, status: 200, json: async () => ({ games }) };
			}),
		);
		renderShelf();
		await screen.findAllByTestId('shelf-card');

		await user.click(
			screen.getByRole('button', { name: 'Open details — Bolt' }),
		);
		const panel = screen.getByRole('dialog', { name: 'Bolt' });
		expect(panel).toBeVisible();

		// Write from inside the panel; the refetch reorders the grid.
		await user.click(within(panel).getByRole('radio', { name: 'Paused' }));
		await waitFor(() =>
			expect(screen.getAllByTestId('shelf-card')[0]).toHaveTextContent('Bolt'),
		);
		// The panel survived the re-chunk.
		expect(screen.getByRole('dialog', { name: 'Bolt' })).toBeVisible();
	});

	// HAZARD (Story 3.6, AC3): menu open-state lives in ShelfGrid — a refetch
	// that reorders/re-chunks the rows (remounting every Card in jsdom's
	// one-column layout) must not kill an open status menu. The refetch is
	// driven by direct invalidation (a background actor — Epic 4 sync): an
	// outside CLICK is supposed to close the menu, so a pointer-driven write
	// can't exercise this.
	it('keeps the status menu open across a refetch that re-chunks the grid', async () => {
		const user = userEvent.setup();
		const a = card('a', 'Apex', {
			effectiveState: 'Playing',
			playStatus: 'Playing',
		});
		const b = card('b', 'Bolt', {
			effectiveState: 'Playing',
			playStatus: 'Playing',
		});
		let games = [a, b];
		mockFetch(games);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<Shelf />
			</QueryClientProvider>,
		);
		const cards = await screen.findAllByTestId('shelf-card');

		// Open Bolt's status menu the keyboard way.
		cards[1].focus();
		await user.keyboard('{Enter}');
		await user.keyboard('{Enter}');
		expect(screen.getByTestId('status-menu')).toBeVisible();

		// Background refetch reorders the shelf — every Card remounts.
		games = [b, a];
		mockFetch(games);
		await client.invalidateQueries({ queryKey: ['shelf'] });
		await waitFor(() =>
			expect(screen.getAllByTestId('shelf-card')[0]).toHaveTextContent('Bolt'),
		);
		// The menu survived the remount (grid-owned open-state) — and it is
		// still BOLT's menu, not whatever card sits at the old index.
		const menu = screen.getByTestId('status-menu');
		expect(menu).toBeVisible();
		expect(menu).toHaveAccessibleName('Play status for Bolt');
	});

	// Stale-id cleanup: the open-menu game leaving the rendered set must clear
	// the grid-owned id — a later reappearance must NOT re-open the menu.
	it('does not resurrect a status menu when its game leaves and reappears', async () => {
		const user = userEvent.setup();
		const a = card('a', 'Apex', {
			effectiveState: 'Playing',
			playStatus: 'Playing',
		});
		const b = card('b', 'Bolt', {
			effectiveState: 'Playing',
			playStatus: 'Playing',
		});
		let games = [a, b];
		mockFetch(games);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<Shelf />
			</QueryClientProvider>,
		);
		const cards = await screen.findAllByTestId('shelf-card');

		cards[1].focus();
		await user.keyboard('{Enter}');
		await user.keyboard('{Enter}');
		expect(screen.getByTestId('status-menu')).toBeVisible();

		// Bolt leaves the visible set (background actor)…
		games = [a];
		mockFetch(games);
		await client.invalidateQueries({ queryKey: ['shelf'] });
		await waitFor(() =>
			expect(screen.getAllByTestId('shelf-card')).toHaveLength(1),
		);
		// …and returns: no uninvited menu.
		games = [a, b];
		mockFetch(games);
		await client.invalidateQueries({ queryKey: ['shelf'] });
		await waitFor(() =>
			expect(screen.getAllByTestId('shelf-card')).toHaveLength(2),
		);
		expect(screen.queryByTestId('status-menu')).not.toBeInTheDocument();
	});

	it('shows an alert if the shelf fails to load', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
		);
		renderShelf();
		expect(await screen.findByRole('alert')).toBeInTheDocument();
	});
});

describe('countColumns', () => {
	it('counts resolved track sizes', () => {
		expect(countColumns('150px 150px 150px')).toBe(3);
	});

	it('falls back to 1 for unresolved templates (jsdom / none)', () => {
		expect(countColumns('repeat(auto-fill, minmax(150px, 1fr))')).toBe(1);
		expect(countColumns('none')).toBe(1);
		expect(countColumns('')).toBe(1);
	});
});

describe('chunkIntoRows', () => {
	it('partitions items into contiguous reading-order rows', () => {
		expect(chunkIntoRows([0, 1, 2, 3, 4], 2)).toEqual([[0, 1], [2, 3], [4]]);
	});

	it('treats a column count below 1 as one item per row', () => {
		expect(chunkIntoRows([0, 1, 2], 0)).toEqual([[0], [1], [2]]);
	});

	it('returns no rows for an empty list', () => {
		expect(chunkIntoRows([], 3)).toEqual([]);
	});
});
