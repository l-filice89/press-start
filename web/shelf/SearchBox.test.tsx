import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchBox } from './SearchBox';

/**
 * Story 7.2 rewrite (AD-25). These assertions used to be about two window
 * CustomEvents (`SHELF_SEARCH` / `SEED_SEARCH`) — the Epic 6 mount-race source,
 * now DELETED. The behavior they protected is unchanged and is protected here in
 * its ROUTED form: the term is `?q=` on the ACTIVE destination, a consumer that
 * mounts later still reads it (a URL retains it; a fire-and-forget event does
 * not), and the `＋ Add` bar is SHELF-only.
 */

// SearchBox itself makes NO fetch (the shelf/catalog grid is the one result
// surface). The only network call is the add dialog's IGDB preview, which
// degrades to the name-only path here.
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

/** Reads the live URL out of the router — the term's one home now. */
function LocationProbe() {
	const location = useLocation();
	return (
		<span data-testid="location">{`${location.pathname}${location.search}`}</span>
	);
}

const url = () => screen.getByTestId('location').textContent;

function renderSearch(initialEntry = '/') {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[initialEntry]}>
				<SearchBox />
				<LocationProbe />
			</MemoryRouter>
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

	// The routed replacement for SHELF_SEARCH_EVENT: the settled term lands in
	// `?q=`, where a destination that mounts LATER still reads it. That is the
	// mount-race fix, so this is the suite's load-bearing assertion.
	it('writes the settled term to ?q= on the active destination, and clears it', async () => {
		const user = userEvent.setup();
		mockPreview();
		renderSearch();

		await user.type(
			screen.getByRole('searchbox', { name: 'Search your library' }),
			'apex',
		);
		await waitFor(() => expect(url()).toBe('/?q=apex'));

		await user.clear(
			screen.getByRole('searchbox', { name: 'Search your library' }),
		);
		await waitFor(() => expect(url()).toBe('/'));
	});

	// The catalog is a DIFFERENT destination fed by the SAME box: its term is its
	// own `?q=`, and the label says what is being searched.
	it('searches the catalog when the catalog is the active destination', async () => {
		const user = userEvent.setup();
		mockPreview();
		renderSearch('/catalog');

		await user.type(
			screen.getByRole('searchbox', { name: 'Search the catalog' }),
			'hal',
		);
		await waitFor(() => expect(url()).toBe('/catalog?q=hal'));
	});

	// HAZARD (review, H2): `?q=` holds the TRIMMED term, so re-seeding the input
	// from the URL unconditionally DELETES the trailing space out from under the
	// caret the moment the debounce lands — and the next keystroke reads "FinalF".
	// The field re-seeds only when the URL actually says something else.
	it('does not eat the trailing space when the debounced term lands', async () => {
		const user = userEvent.setup();
		mockPreview();
		renderSearch();

		const input = screen.getByRole('searchbox', {
			name: 'Search your library',
		});
		await user.type(input, 'Final ');
		// The settled write trims — the INPUT must not be trimmed with it.
		await waitFor(() => expect(url()).toBe('/?q=Final'));
		expect(input).toHaveValue('Final ');

		await user.type(input, 'F');
		expect(input).toHaveValue('Final F');
	});

	it('seeds the field from ?q= in the URL (the routed jump-to-problem)', () => {
		mockPreview();
		renderSearch('/?q=Doppelganger');
		expect(
			screen.getByRole('searchbox', { name: 'Search your library' }),
		).toHaveValue('Doppelganger');
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

	// You cannot conjure a game into Sony's catalog by typing it: on the Catalog
	// a miss is NO MATCH, never an Add row (AD-25 / EXPERIENCE.md).
	it('never shows the ＋ Add bar on the catalog destination', async () => {
		const user = userEvent.setup();
		mockPreview();
		renderSearch('/catalog');

		await user.type(
			screen.getByRole('searchbox', { name: 'Search the catalog' }),
			'Final Fantasy',
		);
		await waitFor(() => expect(url()).toBe('/catalog?q=Final+Fantasy'));
		expect(screen.queryByTestId('search-add-option')).not.toBeInTheDocument();
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
});
