import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveRegionProvider } from '../components/LiveRegion';
import { ToastHost } from '../components/Toast';
import { genreLabel } from './api';
import { Catalog } from './Catalog';

/**
 * The catalog's empty causes (Story 7.2, NFR-4 — never a blank grid). NO REGION
 * is pinned HERE rather than e2e: `wrangler.jsonc`'s `env.e2e` sets
 * `PSN_REGION`, and `getPsnRegion` falls back to it (and persists it), so an
 * unset region is unreachable in that environment by construction.
 */

type Game = {
	productId: string;
	name: string;
	coverUrl: string | null;
	storeUrl: string | null;
	inLibrary: boolean;
	owned: boolean;
	gameId: string | null;
	leavingOn: string | null;
};

type Page = {
	region: string | null;
	total: number;
	snapshotTotal: number;
	nextCursor: number | null;
	generation: string | null;
	games: Game[];
};

const game = (name: string, over: Partial<Game> = {}): Game => ({
	productId: `p-${name}`,
	name,
	coverUrl: null,
	storeUrl: null,
	inLibrary: false,
	owned: false,
	gameId: null,
	leavingOn: null,
	...over,
});

const page = (over: Partial<Page> = {}): Page => ({
	region: 'it-it',
	total: 0,
	snapshotTotal: 0,
	nextCursor: null,
	generation: 'gen-1',
	games: [],
	...over,
});

function mockCatalog(body: Page) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => ({
			ok: true,
			status: 200,
			json: async () =>
				url.includes('/genres') ? { genres: [] } : (body as unknown),
		})),
	);
}

function renderCatalog(initialEntry = '/catalog') {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<LiveRegionProvider>
				<ToastHost>
					<MemoryRouter initialEntries={[initialEntry]}>
						<Catalog onOpenSettings={() => {}} />
					</MemoryRouter>
				</ToastHost>
			</LiveRegionProvider>
		</QueryClientProvider>,
	);
}

afterEach(() => vi.unstubAllGlobals());

describe('Catalog empty states', () => {
	it('NO REGION — the catalog is per-region, so it points into Settings', async () => {
		mockCatalog(page({ region: null, generation: null }));
		renderCatalog();
		expect(await screen.findByText('NO REGION')).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Open Settings' }),
		).toBeInTheDocument();
		expect(screen.queryByTestId('catalog-grid')).not.toBeInTheDocument();
	});

	it('EMPTY CATALOG — a region, but nothing fetched yet: run the check right here', async () => {
		mockCatalog(page({ generation: null }));
		renderCatalog();
		expect(await screen.findByText('EMPTY CATALOG')).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Check PS+ Extra' }),
		).toBeInTheDocument();
	});

	it('a filtered miss is NO MATCH, not EMPTY CATALOG (the snapshot is fine)', async () => {
		mockCatalog(page({ snapshotTotal: 490 }));
		renderCatalog('/catalog?q=zzz');
		expect(await screen.findByText('NO MATCH')).toBeInTheDocument();
		expect(screen.queryByText('EMPTY CATALOG')).not.toBeInTheDocument();
	});
});

describe('Catalog filters', () => {
	// HAZARD (review, M8): the query key holds the genre keys, so a chip click used
	// to flip the query to PENDING — the grid AND the filter row were replaced by
	// the skeleton, the chip the user just pressed vanished under their cursor, and
	// keyboard focus fell to <body>. The previous page stays on screen instead.
	it('a genre click keeps the grid and the pressed chip on screen (focus never drops)', async () => {
		const user = userEvent.setup();
		let resolveSecond: (() => void) | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.includes('/genres')) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							genres: [{ key: 'HORROR', count: 1 }],
						}),
					};
				}
				const body = url.includes('genre=HORROR')
					? page({
							total: 1,
							snapshotTotal: 2,
							games: [game('Crow Country')],
						})
					: page({
							total: 2,
							snapshotTotal: 2,
							games: [game('Apex Arena'), game('Crow Country')],
						});
				// The filtered page stays IN FLIGHT while we assert.
				if (url.includes('genre=HORROR')) {
					await new Promise<void>((resolve) => {
						resolveSecond = resolve;
					});
				}
				return { ok: true, status: 200, json: async () => body as unknown };
			}),
		);
		renderCatalog();
		await screen.findByTestId('catalog-grid');

		const chip = screen.getByRole('button', { name: /^Horror/ });
		chip.focus();
		await user.click(chip);

		// Mid-flight: the grid is still rendered, the chip is still there and PRESSED,
		// and it still holds focus. (A skeleton here means the fix regressed.)
		expect(screen.getByTestId('catalog-grid')).toBeInTheDocument();
		expect(screen.queryByTestId('skeleton-grid')).not.toBeInTheDocument();
		const pressed = screen.getByRole('button', { name: /^Horror/ });
		expect(pressed).toHaveAttribute('aria-pressed', 'true');
		expect(pressed).toHaveFocus();

		resolveSecond?.();
		await waitFor(() =>
			expect(screen.getAllByTestId('catalog-card')).toHaveLength(1),
		);
	});

	// HAZARD (review, M9): a deep link with a genre whose vocabulary failed to load
	// rendered NO chip and NO clear control — a filtered grid with no way out but
	// editing the URL. The selected key is always visible and always switchable off,
	// and a failed vocabulary SAYS so instead of looking like "no genres here".
	it('a deep-linked genre stays escapable when the genres query fails', async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.includes('/genres'))
					return { ok: false, status: 500, json: async () => ({}) };
				return {
					ok: true,
					status: 200,
					json: async () =>
						page({
							total: 1,
							snapshotTotal: 490,
							games: [game('Crow Country')],
						}) as unknown,
				};
			}),
		);
		renderCatalog('/catalog?genre=HORROR');
		await screen.findByTestId('catalog-grid');

		const filters = await screen.findByTestId('catalog-filters');
		expect(within(filters).getByRole('alert')).toHaveTextContent(
			'genre filters couldn’t load',
		);
		// The live filter has a chip…
		expect(
			within(filters).getByRole('button', { name: 'Horror' }),
		).toHaveAttribute('aria-pressed', 'true');
		// …and the way out is right there.
		await user.click(
			within(filters).getByRole('button', { name: 'Clear genres' }),
		);
		await waitFor(() =>
			expect(
				screen.queryByRole('button', { name: 'Clear genres' }),
			).not.toBeInTheDocument(),
		);
	});

	// The result count is announced on every filter/search change (review, L4) —
	// the shelf does it, and a chip press is silent to a screen reader without it.
	it('announces the result count to the live region on a filter change', async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.includes('/genres')) {
					return {
						ok: true,
						status: 200,
						json: async () => ({ genres: [{ key: 'HORROR', count: 1 }] }),
					};
				}
				const body = url.includes('genre=HORROR')
					? page({ total: 1, snapshotTotal: 2, games: [game('Crow Country')] })
					: page({
							total: 2,
							snapshotTotal: 2,
							games: [game('Apex Arena'), game('Crow Country')],
						});
				return { ok: true, status: 200, json: async () => body as unknown };
			}),
		);
		renderCatalog();
		await screen.findByTestId('catalog-grid');

		await user.click(screen.getByRole('button', { name: /^Horror/ }));
		await waitFor(() =>
			expect(screen.getByTestId('live-region')).toHaveTextContent(
				'1 catalog game match the current filters.',
			),
		);
	});
});

/**
 * HAZARD (review, M3): paging is an OFFSET, and the snapshot moves — this
 * destination runs Check PS+ Extra itself and the cron fires several times a
 * month. A page cut from a NEWER generation means every boundary shifted: the
 * grid must restart its paging on the new snapshot, not splice the two together
 * (one row served twice, one row never shown).
 */
describe('Catalog paging across a snapshot refresh', () => {
	it('restarts paging when a later page comes from a new generation', async () => {
		const user = userEvent.setup();
		const cursors: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.includes('/genres'))
					return { ok: true, status: 200, json: async () => ({ genres: [] }) };
				cursors.push(url);
				const second = url.includes('cursor=');
				const body = second
					? // The refresh landed between the two requests.
						page({
							total: 2,
							snapshotTotal: 2,
							generation: 'gen-2',
							nextCursor: null,
							games: [game('Torn Page')],
						})
					: page({
							total: 2,
							snapshotTotal: 2,
							generation: cursors.length > 2 ? 'gen-2' : 'gen-1',
							nextCursor: 1,
							games: [game('Apex Arena')],
						});
				return { ok: true, status: 200, json: async () => body as unknown };
			}),
		);
		renderCatalog();
		await screen.findByTestId('catalog-grid');

		await user.click(screen.getByTestId('catalog-more'));

		// The torn page is NOT spliced under page 1 — the query re-keys on the new
		// generation and pages the new snapshot from the top.
		await waitFor(() => {
			const cards = screen.getAllByTestId('catalog-card');
			expect(cards).toHaveLength(1);
			expect(cards[0]).toHaveTextContent('Apex Arena');
		});
		// …and the refetch went back to the FIRST page (no cursor).
		expect(cursors.filter((url) => !url.includes('cursor=')).length).toBe(2);
	});
});

describe('genreLabel', () => {
	// The KEY is what we store and filter on (AD-26); the label is display only.
	it('renders a facet key as a label without ever becoming the filter value', () => {
		expect(genreLabel('ACTION')).toBe('Action');
		expect(genreLabel('ROLE_PLAYING_GAMES')).toBe('Role Playing Games');
		expect(genreLabel('MUSIC/RHYTHM')).toBe('Music / Rhythm');
	});
});

describe('Catalog leaving flag (Story 10.4 follow-on)', () => {
	it('a tracked, un-owned product with a future date carries the LEAVING flag', async () => {
		mockCatalog(
			page({
				total: 2,
				snapshotTotal: 2,
				games: [
					game('Leaving Tracked', {
						inLibrary: true,
						gameId: 'g1',
						leavingOn: '2099-07-21',
					}),
					game('Plain Product'),
				],
			}),
		);
		renderCatalog();
		const flag = await screen.findByTestId('catalog-flag-leaving');
		expect(flag).toHaveTextContent('LEAVING 21 JUL');
		expect(flag).toHaveTextContent(
			'Leaving the PlayStation Plus Extra catalog on 2099-07-21',
		);
		// (The untracked-products-answer-null guarantee is server-side — pinned
		// in integration psplus-browse.test.ts, not here.)
	});

	it('an OWNED product never warns (FR-38), a PAST date is suppressed', async () => {
		mockCatalog(
			page({
				total: 2,
				snapshotTotal: 2,
				games: [
					game('Leaving Owned', {
						inLibrary: true,
						owned: true,
						gameId: 'g1',
						leavingOn: '2099-07-21',
					}),
					game('Left Already', {
						inLibrary: true,
						gameId: 'g2',
						leavingOn: '2020-01-05',
					}),
				],
			}),
		);
		renderCatalog();
		await screen.findAllByTestId('catalog-card');
		expect(
			screen.queryByTestId('catalog-flag-leaving'),
		).not.toBeInTheDocument();
	});
});
