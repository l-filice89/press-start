import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InitialEntry } from 'react-router';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveRegionProvider } from '../components/LiveRegion';
import type { DetailNavState } from '../shelf/detail-navigation';
import { AppShell } from './AppShell';

/**
 * The shell's `<Routes>` block — the thing that decides WHICH DESTINATION renders
 * behind an open detail.
 *
 * It went untested through Story 7.2, and that is exactly where the catalog-add
 * bug lived: `/game/:id` hardcoded the shelf as the element behind the overlay,
 * so adding a game from the catalog tore the catalog down, flashed the shelf in,
 * and Close snapped back to a destination the user had never left.
 *
 * These drive the seam directly (a history entry carrying a background, which is
 * what `toDetail` writes) rather than through the whole add flow — the add flow
 * itself is pinned end-to-end in `playwright/e2e/epic7-catalog.spec.ts`.
 */

const GAME = {
	id: 'a',
	title: 'Apex',
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

/** Every read the shell's destinations make: settings, shelf, catalog, by-id. */
function mockApi() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			const json = (body: unknown) => ({
				ok: true,
				status: 200,
				json: async () => body,
			});
			if (url.includes('/api/ps-plus-catalog/genres'))
				return json({ genres: [] });
			if (url.includes('/api/ps-plus-catalog'))
				return json({
					region: 'us',
					total: 1,
					snapshotTotal: 1,
					nextCursor: null,
					generation: 'g1',
					games: [
						{
							productId: 'p1',
							name: 'Crow Country',
							coverUrl: null,
							storeUrl: null,
							inLibrary: false,
							owned: false,
							gameId: null,
						},
					],
				});
			if (/\/api\/games\/[^/?]+$/.test(url)) return json({ game: GAME });
			if (url.includes('/api/settings')) return json({});
			return json({ games: [GAME] });
		}),
	);
}

function LocationProbe() {
	const location = useLocation();
	return <span data-testid="location">{location.pathname}</span>;
}

function renderShell(entries: InitialEntry[], index = entries.length - 1) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<LiveRegionProvider>
				<MemoryRouter initialEntries={entries} initialIndex={index}>
					<AppShell email="a@b.co" onSignOut={() => {}} />
					<LocationProbe />
				</MemoryRouter>
			</LiveRegionProvider>
		</QueryClientProvider>,
	);
}

/** The history entry an in-app opener pushes — exactly what `toDetail` writes. */
function detailOver(pathname: string): InitialEntry {
	return {
		pathname: '/game/a',
		state: {
			fromApp: true,
			background: {
				pathname,
				search: '',
				hash: '',
				state: null,
				key: 'bg',
			},
		} satisfies DetailNavState,
	};
}

afterEach(() => vi.unstubAllGlobals());

describe('AppShell destinations', () => {
	it('renders the CATALOG behind a detail opened from the catalog — never the shelf', async () => {
		mockApi();
		renderShell(['/catalog', detailOver('/catalog')]);

		expect(await screen.findByRole('dialog', { name: 'Apex' })).toBeVisible();
		// The bug, pinned: the destination behind the overlay is the one you were
		// on. A mounted shelf here is the visible flash — and the lost scroll.
		expect(await screen.findByTestId('catalog-grid')).toBeInTheDocument();
		expect(screen.queryByTestId('shelf-grid')).not.toBeInTheDocument();
	});

	it('Close on that detail lands back on the catalog', async () => {
		const user = userEvent.setup();
		mockApi();
		renderShell(['/catalog', detailOver('/catalog')]);

		const panel = await screen.findByRole('dialog', { name: 'Apex' });
		await user.click(
			within(panel).getByRole('button', { name: 'Close details' }),
		);

		await waitFor(() =>
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
		);
		expect(screen.getByTestId('location')).toHaveTextContent('/catalog');
		expect(screen.queryByTestId('shelf-grid')).not.toBeInTheDocument();
	});

	it('the header toggle follows the destination BEHIND the detail', async () => {
		mockApi();
		renderShell(['/catalog', detailOver('/catalog')]);
		await screen.findByRole('dialog', { name: 'Apex' });

		expect(screen.getByRole('link', { name: 'CATALOG' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		expect(screen.getByRole('link', { name: 'SHELF' })).not.toHaveAttribute(
			'aria-current',
		);
		// …and the one box searches the destination you are actually looking at.
		expect(
			screen.getByRole('searchbox', { name: 'Search the catalog' }),
		).toBeInTheDocument();
	});

	// The COLD case is the one that silently regresses (review, H3): a pasted link
	// or a reload has NO background, so the shelf renders behind the detail and
	// Close goes to `/` — never a history step out of the app.
	it('a cold /game/:id with no background still renders the shelf, and Close goes to the shelf', async () => {
		const user = userEvent.setup();
		mockApi();
		renderShell(['/game/a']);

		const panel = await screen.findByRole('dialog', { name: 'Apex' });
		expect(await screen.findByTestId('shelf-grid')).toBeInTheDocument();
		expect(screen.queryByTestId('catalog-grid')).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'SHELF' })).toHaveAttribute(
			'aria-current',
			'page',
		);

		await user.click(
			within(panel).getByRole('button', { name: 'Close details' }),
		);
		await waitFor(() =>
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
		);
		expect(screen.getByTestId('location')).toHaveTextContent('/');
	});

	it('an unknown URL is still the not-found destination', async () => {
		mockApi();
		renderShell(['/catlog']);
		expect(await screen.findByText('PAGE NOT FOUND')).toBeInTheDocument();
		expect(screen.queryByTestId('shelf-grid')).not.toBeInTheDocument();
	});
});
