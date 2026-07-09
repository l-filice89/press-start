import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShelfGame } from './api';
import { SearchBox } from './SearchBox';

function card(id: string, title: string): ShelfGame {
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
		releaseDate: null,
		genres: [],
	};
}

/** Capture the queried URLs so we can assert the dedicated search endpoint. */
function mockSearch(games: ShelfGame[]) {
	const calls: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			calls.push(url);
			return { ok: true, status: 200, json: async () => ({ games }) };
		}),
	);
	return calls;
}

function renderSearch() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<SearchBox />
		</QueryClientProvider>,
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('SearchBox', () => {
	it('is a combobox that lists whole-library matches on type', async () => {
		const user = userEvent.setup();
		const calls = mockSearch([card('a', 'Apex Legends')]);
		renderSearch();

		const input = screen.getByRole('combobox', { name: 'Search your library' });
		await user.type(input, 'apex');

		expect(await screen.findByRole('option')).toHaveTextContent('Apex Legends');
		// It hit the dedicated search endpoint, not the shelf endpoint.
		expect(calls.some((u) => u.startsWith('/api/shelf/search?q='))).toBe(true);
		expect(input).toHaveAttribute('aria-expanded', 'true');
	});

	it('shows NO MATCH when the whole-library query returns nothing', async () => {
		const user = userEvent.setup();
		mockSearch([]);
		renderSearch();

		await user.type(
			screen.getByRole('combobox', { name: 'Search your library' }),
			'zzz',
		);
		expect(await screen.findByText('NO MATCH')).toBeInTheDocument();
	});

	it('focuses the field on the global "/" shortcut', async () => {
		const user = userEvent.setup();
		mockSearch([]);
		renderSearch();

		const input = screen.getByRole('combobox', { name: 'Search your library' });
		expect(input).not.toHaveFocus();
		await user.keyboard('/');
		expect(input).toHaveFocus();
	});
});
