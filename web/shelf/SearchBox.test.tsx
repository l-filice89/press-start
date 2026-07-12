import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	currentShelfSearchTerm,
	SEED_SEARCH_EVENT,
	SearchBox,
	SHELF_SEARCH_EVENT,
} from './SearchBox';

// SearchBox itself makes NO fetch now (the suggestion dropdown is gone — the
// shelf grid is the one result surface). The only network call is the add
// dialog's IGDB preview, which degrades to the name-only path here.
function mockPreview() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url.startsWith('/api/games/preview')) {
				return {
					ok: true,
					status: 200,
					json: async () => ({ available: false, candidate: null }),
				};
			}
			return { ok: true, status: 200, json: async () => ({}) };
		}),
	);
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
	it('is a plain searchbox — no combobox/listbox surface', async () => {
		mockPreview();
		renderSearch();
		expect(
			screen.getByRole('searchbox', { name: 'Search your library' }),
		).toBeInTheDocument();
		// The old suggestion dropdown is gone entirely.
		expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
	});

	// Story 6.5 mount-race guard: the shelf may mount AFTER a term was typed, so
	// the last broadcast term is mirrored in module scope (and re-broadcast on
	// the window event) for a fresh shelf to seed from.
	it('broadcasts the settled term and mirrors it in currentShelfSearchTerm', async () => {
		const user = userEvent.setup();
		mockPreview();
		renderSearch();
		const broadcast: string[] = [];
		const onSearch = (e: Event) =>
			broadcast.push((e as CustomEvent<string>).detail);
		window.addEventListener(SHELF_SEARCH_EVENT, onSearch);

		await user.type(
			screen.getByRole('searchbox', { name: 'Search your library' }),
			'apex',
		);
		// The debounce settles → the term broadcasts and the mirror updates.
		await vi.waitFor(() => expect(currentShelfSearchTerm()).toBe('apex'));
		expect(broadcast).toContain('apex');

		await user.clear(
			screen.getByRole('searchbox', { name: 'Search your library' }),
		);
		await vi.waitFor(() => expect(currentShelfSearchTerm()).toBe(''));
		window.removeEventListener(SHELF_SEARCH_EVENT, onSearch);
	});

	it('pins an ＋ Add bar for ANY non-empty term and opens the preview dialog (FR-41, FF fix)', async () => {
		const user = userEvent.setup();
		mockPreview();
		renderSearch();

		const input = screen.getByRole('searchbox', {
			name: 'Search your library',
		});
		// The Add bar appears whether or not a library game matches — SearchBox
		// no longer knows about matches, so it is always reachable (the FF fix).
		await user.type(input, 'Final Fantasy');
		const addBar = await screen.findByTestId('search-add-option');
		expect(addBar).toHaveTextContent('Add “Final Fantasy”');

		await user.click(addBar);
		const dialog = await screen.findByTestId('add-game-dialog');
		expect(dialog).toBeInTheDocument();
		// Seeded with the typed name; nothing committed until Save.
		expect(screen.getByLabelText('Title')).toHaveValue('Final Fantasy');
	});

	it('shows no Add bar for an empty (or whitespace-only) term', async () => {
		const user = userEvent.setup();
		mockPreview();
		renderSearch();
		expect(screen.queryByTestId('search-add-option')).not.toBeInTheDocument();

		// A whitespace-only term trims away → still no Add bar.
		await user.type(
			screen.getByRole('searchbox', { name: 'Search your library' }),
			'   ',
		);
		await new Promise((r) => setTimeout(r, 250));
		expect(screen.queryByTestId('search-add-option')).not.toBeInTheDocument();
	});

	it('focuses the field on the global "/" shortcut', async () => {
		const user = userEvent.setup();
		mockPreview();
		renderSearch();

		const input = screen.getByRole('searchbox', {
			name: 'Search your library',
		});
		expect(input).not.toHaveFocus();
		await user.keyboard('/');
		expect(input).toHaveFocus();
	});

	it('a seed event fills the field, focuses it, and broadcasts the term (Story 4.3 jump)', async () => {
		mockPreview();
		renderSearch();
		const broadcast: string[] = [];
		const onSearch = (e: Event) =>
			broadcast.push((e as CustomEvent<string>).detail);
		window.addEventListener(SHELF_SEARCH_EVENT, onSearch);

		const { act } = await import('@testing-library/react');
		act(() =>
			window.dispatchEvent(
				new CustomEvent(SEED_SEARCH_EVENT, { detail: 'Doppelganger' }),
			),
		);

		const input = screen.getByRole('searchbox', {
			name: 'Search your library',
		});
		expect(input).toHaveValue('Doppelganger');
		expect(input).toHaveFocus();
		// The debounce is skipped: the term broadcasts to the shelf immediately.
		await vi.waitFor(() =>
			expect(currentShelfSearchTerm()).toBe('Doppelganger'),
		);
		expect(broadcast).toContain('Doppelganger');
		window.removeEventListener(SHELF_SEARCH_EVENT, onSearch);
	});
});
