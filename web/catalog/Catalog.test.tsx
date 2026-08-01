import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
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

async function openDesktopGenreMenu(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByRole('button', { name: /^Genre/ }));
	return screen.getByRole('menu', { name: 'Genre filters' });
}

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

	it('EMPTY CATALOG — a region, but nothing fetched yet: passive copy, no button (8.4)', async () => {
		mockCatalog(page({ generation: null }));
		renderCatalog();
		expect(await screen.findByText('EMPTY CATALOG')).toBeInTheDocument();
		expect(screen.getByText(/updates automatically/)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Check PS/ })).toBeNull();
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

		const menu = await openDesktopGenreMenu(user);
		const chip = within(menu).getByRole('menuitemcheckbox', {
			name: /^Horror/,
		});
		chip.focus();
		await user.click(chip);

		// Mid-flight: the grid is still rendered, the chip is still there and PRESSED,
		// and it still holds focus. (A skeleton here means the fix regressed.)
		expect(screen.getByTestId('catalog-grid')).toBeInTheDocument();
		expect(screen.queryByTestId('skeleton-grid')).not.toBeInTheDocument();
		const pressed = within(menu).getByRole('menuitemcheckbox', {
			name: /^Horror/,
		});
		expect(pressed).toHaveAttribute('aria-checked', 'true');
		expect(pressed).toHaveFocus();

		resolveSecond?.();
		await waitFor(() =>
			expect(screen.getAllByTestId('catalog-card')).toHaveLength(1),
		);
	});

	// UX sweep 2026-07-16: the facet response now omits zero-count keys, so a
	// selected key can be missing from a NON-empty vocabulary (its count dropped
	// to zero after a snapshot refresh, or a stale deep link). The live filter
	// still needs its own pressed chip — "Clear genres" alone hides WHICH filter
	// is starving the grid.
	it('a selected genre missing from a non-empty vocabulary keeps its own chip', async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => ({
				ok: true,
				status: 200,
				json: async () =>
					url.includes('/genres')
						? { genres: [{ key: 'HORROR', count: 3 }] }
						: (page({
								total: 0,
								snapshotTotal: 490,
								games: [],
							}) as unknown),
			})),
		);
		renderCatalog('/catalog?genre=ARCADE');
		const filters = await screen.findByTestId('catalog-filters');
		const menu = await openDesktopGenreMenu(user);

		// The orphaned selection renders checked, beside the listed vocabulary…
		expect(
			within(menu).getByRole('menuitemcheckbox', {
				name: genreLabel('ARCADE'),
			}),
		).toHaveAttribute('aria-checked', 'true');
		expect(
			within(menu).getByRole('menuitemcheckbox', { name: /^Horror/ }),
		).toHaveAttribute('aria-checked', 'false');
		// …and toggling it off releases the grid.
		await user.click(
			within(menu).getByRole('menuitemcheckbox', {
				name: genreLabel('ARCADE'),
			}),
		);
		expect(
			within(filters).queryByRole('menuitemcheckbox', {
				name: genreLabel('ARCADE'),
			}),
		).not.toBeInTheDocument();
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
		const menu = await openDesktopGenreMenu(user);
		// The live filter has a chip…
		expect(
			within(menu).getByRole('menuitemcheckbox', { name: 'Horror' }),
		).toHaveAttribute('aria-checked', 'true');
		// The phone sheet carries the same failure and orphan-selection escape hatch.
		await user.click(
			screen.getByRole('button', { name: 'Filters — 1 active' }),
		);
		const sheet = screen.getByRole('dialog', { name: 'Filters' });
		expect(within(sheet).getByRole('alert')).toHaveTextContent(
			'genre filters couldn’t load',
		);
		expect(
			within(sheet).getByRole('button', { name: 'Horror' }),
		).toHaveAttribute('aria-pressed', 'true');
		// …and the way out is right there.
		await user.click(
			within(sheet).getByRole('button', { name: 'Clear genres' }),
		);
		await waitFor(() =>
			expect(
				within(sheet).queryByRole('button', { name: 'Clear genres' }),
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

		const menu = await openDesktopGenreMenu(user);
		await user.click(
			within(menu).getByRole('menuitemcheckbox', { name: /^Horror/ }),
		);
		await waitFor(() =>
			expect(screen.getByTestId('live-region')).toHaveTextContent(
				'1 catalog game match the current filters.',
			),
		);
	});

	it('the phone sheet applies live, never claims a stale count, and restores focus on close', async () => {
		const user = userEvent.setup();
		let resolveFiltered: (() => void) | undefined;
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
				const filtered = url.includes('genre=HORROR');
				if (filtered) {
					await new Promise<void>((resolve) => {
						resolveFiltered = resolve;
					});
				}
				return {
					ok: true,
					status: 200,
					json: async () =>
						filtered
							? page({
									total: 1,
									snapshotTotal: 2,
									games: [game('Crow Country')],
								})
							: page({
									total: 2,
									snapshotTotal: 2,
									games: [game('Apex Arena'), game('Crow Country')],
								}),
				};
			}),
		);
		renderCatalog();
		await screen.findByTestId('catalog-grid');

		const trigger = screen.getByRole('button', { name: 'Filters' });
		await user.click(trigger);
		const sheet = screen.getByRole('dialog', { name: 'Filters' });
		expect(sheet).toHaveFocus();
		expect(sheet).toHaveAttribute('aria-modal', 'true');
		expect(document.body.style.overflow).toBe('hidden');

		await user.click(within(sheet).getByRole('button', { name: /^Horror/ }));
		expect(sheet).toBeInTheDocument();
		expect(
			within(sheet).getByRole('button', { name: /^Horror/ }),
		).toHaveAttribute('aria-pressed', 'true');
		const updating = within(sheet).getByRole('button', {
			name: 'Close filters — updating games…',
		});
		expect(updating).toBeEnabled();
		expect(within(sheet).queryByText('Show 2 games')).not.toBeInTheDocument();
		expect(screen.getByTestId('catalog-count')).toHaveTextContent(
			'Updating catalog games…',
		);

		resolveFiltered?.();
		const show = await within(sheet).findByRole('button', {
			name: 'Show 1 game',
		});
		await user.click(show);
		expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
		expect(trigger).toHaveFocus();
		expect(trigger).toHaveAccessibleName('Filters — 1 active');
		expect(document.body.style.overflow).toBe('');
	});

	it('the phone sheet traps focus and Escape returns it to the trigger', async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => ({
				ok: true,
				status: 200,
				json: async () =>
					url.includes('/genres')
						? { genres: [{ key: 'HORROR', count: 1 }] }
						: page({
								total: 1,
								snapshotTotal: 1,
								games: [game('Crow Country')],
							}),
			})),
		);
		renderCatalog();
		await screen.findByTestId('catalog-grid');
		const trigger = screen.getByRole('button', { name: 'Filters' });
		await user.click(trigger);
		const sheet = screen.getByRole('dialog', { name: 'Filters' });

		await user.tab({ shift: true });
		expect(
			within(sheet).getByRole('button', { name: 'Show 1 game' }),
		).toHaveFocus();
		await user.tab();
		expect(
			within(sheet).getByRole('button', { name: /^Horror/ }),
		).toHaveFocus();
		await user.keyboard('{Escape}');
		expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
		expect(trigger).toHaveFocus();
	});

	it('backdrop and desktop breakpoint dismiss the phone sheet and restore scrolling', async () => {
		const user = userEvent.setup();
		let matches = false;
		let mediaListener: (() => void) | undefined;
		vi.stubGlobal(
			'matchMedia',
			vi.fn(() => ({
				get matches() {
					return matches;
				},
				media: '(min-width: 601px)',
				onchange: null,
				addEventListener: (_type: string, listener: () => void) => {
					mediaListener = listener;
				},
				removeEventListener: vi.fn(),
				addListener: vi.fn(),
				removeListener: vi.fn(),
				dispatchEvent: vi.fn(),
			})),
		);
		mockCatalog(
			page({ total: 1, snapshotTotal: 1, games: [game('Crow Country')] }),
		);
		renderCatalog();
		await screen.findByTestId('catalog-grid');
		const trigger = screen.getByRole('button', { name: 'Filters' });

		await user.click(trigger);
		fireEvent.mouseDown(screen.getByTestId('catalog-filter-sheet-backdrop'));
		expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
		expect(document.body.style.overflow).toBe('');

		await user.click(trigger);
		matches = true;
		mediaListener?.();
		await waitFor(() =>
			expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull(),
		);
		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Genre' })).toHaveFocus(),
		);
		expect(document.body.style.overflow).toBe('');
	});

	it('a desktop menu opened during genre loading focuses the first option when it arrives', async () => {
		const user = userEvent.setup();
		let resolveGenres: (() => void) | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.includes('/genres')) {
					await new Promise<void>((resolve) => {
						resolveGenres = resolve;
					});
					return {
						ok: true,
						status: 200,
						json: async () => ({ genres: [{ key: 'HORROR', count: 1 }] }),
					};
				}
				return {
					ok: true,
					status: 200,
					json: async () =>
						page({
							total: 1,
							snapshotTotal: 1,
							games: [game('Crow Country')],
						}),
				};
			}),
		);
		renderCatalog();
		await screen.findByTestId('catalog-grid');
		const menu = await openDesktopGenreMenu(user);
		expect(within(menu).getByText('Loading genres…')).toBeInTheDocument();

		resolveGenres?.();
		const horror = await within(menu).findByRole('menuitemcheckbox', {
			name: /^Horror/,
		});
		await waitFor(() => expect(horror).toHaveFocus());
	});

	it('duplicate URL values render as one effective filter and one active count', async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => ({
				ok: true,
				status: 200,
				json: async () =>
					url.includes('/genres')
						? { genres: [{ key: 'HORROR', count: 1 }] }
						: page({
								total: 1,
								snapshotTotal: 1,
								games: [game('Crow Country')],
							}),
			})),
		);
		renderCatalog('/catalog?genre=HORROR&genre=HORROR');
		await screen.findByTestId('catalog-grid');
		expect(
			screen.getByRole('button', { name: 'Filters — 1 active' }),
		).toBeInTheDocument();
		const menu = await openDesktopGenreMenu(user);
		expect(
			within(menu).getAllByRole('menuitemcheckbox', { name: /^Horror/ }),
		).toHaveLength(1);
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
