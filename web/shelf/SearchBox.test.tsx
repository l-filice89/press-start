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
	};
}

/** Capture the queried URLs so we can assert the dedicated search endpoint. */
function mockSearch(games: ShelfGame[]) {
	const calls: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			calls.push(url);
			// The add dialog's preview call (Story 6.1) rides the same stub.
			if (url.startsWith('/api/games/preview')) {
				return {
					ok: true,
					status: 200,
					json: async () => ({ available: false, candidate: null }),
				};
			}
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

	it('offers ＋ Add when the whole-library query returns nothing (Story 6.1)', async () => {
		const user = userEvent.setup();
		mockSearch([]);
		renderSearch();

		await user.type(
			screen.getByRole('combobox', { name: 'Search your library' }),
			'zzz',
		);
		expect(await screen.findByTestId('search-add-option')).toHaveTextContent(
			'Add “zzz”',
		);
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

	it('picking a match dispatches the open-detail event — never a create (Story 6.1, FR-42)', async () => {
		const user = userEvent.setup();
		mockSearch([card('g-42', 'Apex Legends')]);
		renderSearch();
		const opened: string[] = [];
		const { OPEN_DETAIL_EVENT } = await import('./open-detail');
		const onOpen = (e: Event) => opened.push((e as CustomEvent<string>).detail);
		window.addEventListener(OPEN_DETAIL_EVENT, onOpen);

		await user.type(
			screen.getByRole('combobox', { name: 'Search your library' }),
			'apex',
		);
		const option = await screen.findByRole('option', { name: 'Apex Legends' });
		// mousedown activates (it must beat the input's blur) — pointer covers it.
		await user.pointer({ keys: '[MouseLeft]', target: option });

		expect(opened).toEqual(['g-42']);
		// The listbox closed; nothing was POSTed.
		expect(screen.queryByRole('option')).not.toBeInTheDocument();
		window.removeEventListener(OPEN_DETAIL_EVENT, onOpen);
	});

	it('keyboard ArrowDown+Enter selects the active match', async () => {
		const user = userEvent.setup();
		mockSearch([card('g-1', 'Hades')]);
		renderSearch();
		const opened: string[] = [];
		const { OPEN_DETAIL_EVENT } = await import('./open-detail');
		const onOpen = (e: Event) => opened.push((e as CustomEvent<string>).detail);
		window.addEventListener(OPEN_DETAIL_EVENT, onOpen);

		const input = screen.getByRole('combobox', { name: 'Search your library' });
		await user.type(input, 'hades');
		await screen.findByRole('option', { name: 'Hades' });
		await user.keyboard('{ArrowDown}{Enter}');

		expect(opened).toEqual(['g-1']);
		window.removeEventListener(OPEN_DETAIL_EVENT, onOpen);
	});

	it('no library match → the one option is ＋ Add, which opens the preview dialog (FR-41)', async () => {
		const user = userEvent.setup();
		mockSearch([]);
		renderSearch();

		await user.type(
			screen.getByRole('combobox', { name: 'Search your library' }),
			'Tunic',
		);
		const addRow = await screen.findByTestId('search-add-option');
		expect(addRow).toHaveAttribute('role', 'option');
		expect(addRow).toHaveTextContent('Add “Tunic”');

		await user.pointer({ keys: '[MouseLeft]', target: addRow });
		const dialog = await screen.findByTestId('add-game-dialog');
		expect(dialog).toBeInTheDocument();
		// Pre-filled with the typed name; nothing committed until Save.
		expect(screen.getByLabelText('Title')).toHaveValue('Tunic');
	});

	it('a seed event fills the field, focuses it, and opens the matches (Story 4.3 jump)', async () => {
		mockSearch([card('a', 'Doppelganger')]);
		renderSearch();

		const { seedSearch } = await import('./SearchBox');
		const { act } = await import('@testing-library/react');
		act(() => seedSearch('Doppelganger'));

		const input = screen.getByRole('combobox', { name: 'Search your library' });
		expect(input).toHaveValue('Doppelganger');
		expect(input).toHaveFocus();
		// The debounce is skipped: the query fires and the listbox opens.
		expect(
			await screen.findByRole('option', { name: 'Doppelganger' }),
		).toBeInTheDocument();
	});
});
