import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShelfGame } from './api';
import { Shelf } from './Shelf';

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
		effectiveState: 'Not started',
		owned: true,
		released: true,
		wishlisted: false,
		psPlusExtra: false,
		hasCompleted: false,
		hasPlatinum: false,
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

	it('shows an alert if the shelf fails to load', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
		);
		renderShelf();
		expect(await screen.findByRole('alert')).toBeInTheDocument();
	});
});
