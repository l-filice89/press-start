import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShelfGame } from './api';
import { chunkIntoRows, countColumns, Shelf } from './Shelf';

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
		psPlusExtra: false,
		hasCompleted: false,
		hasPlatinum: false,
		completedOn: null,
		platinumOn: null,
		startedOn: null,
		boughtOn: null,
		wishlistedOn: null,
		ownershipType: null,
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

	it('cycles Tab between pill and cover inside a cell, Escape returns to it (Story 2.3)', async () => {
		const user = userEvent.setup();
		mockFetch([card('a', 'Apex'), card('b', 'Bolt')]);
		renderShelf();
		const cards = await screen.findAllByTestId('shelf-card');

		// Enter on the cell still lands on the pill first (2.1 contract).
		cards[0].focus();
		await user.keyboard('{Enter}');
		const pill = within(cards[0]).getByTestId('status-pill-button');
		expect(pill).toHaveFocus();

		// Tab cycles between the cell's two widgets without leaving it.
		const cover = within(cards[0]).getByTestId('card-cover-button');
		await user.tab();
		expect(cover).toHaveFocus();
		await user.tab();
		expect(pill).toHaveFocus();
		await user.tab({ shift: true });
		expect(cover).toHaveFocus();

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
