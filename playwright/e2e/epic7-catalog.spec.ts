import { randomUUID } from 'node:crypto';
import {
	createGame,
	createWishlistedGame,
} from '../support/factories/game-factory';
import {
	deleteCatalog,
	deleteGames,
	deleteSetting,
	type SeedCatalogProduct,
	seedCatalog,
	seedGames,
	seedSetting,
} from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

/**
 * Story 7.2 — the Catalog destination + the router (AD-25/26).
 *
 * The catalog rows are seeded straight into the e2e D1 (setup via data, never
 * the UI): the ingest that fills them needs a live PlayStation response the e2e
 * Worker cannot produce, and it is 7.1's, pinned at the integration tier.
 *
 * NOT here: the NO REGION empty state. `wrangler.jsonc`'s `env.e2e` sets
 * `PSN_REGION`, and `getPsnRegion` falls back to it (and persists it), so an
 * unset region is unreachable in this environment by design — it is covered at
 * the jsdom tier instead (COVERAGE.md).
 */

// SERIAL: the catalog table is a SINGLE shared snapshot (region+tier keyed, not
// user-scoped), so a parallel test seeding rows into it would be visible to the
// EMPTY CATALOG test — which asserts on the table being empty. Games are still
// uuid-unique per test.
test.describe.configure({ mode: 'serial' });

const run = () => randomUUID().slice(0, 8);

/** A–Z fixture: seeded out of order on purpose, so the grid does the sorting. */
function catalogFixture(id: string): SeedCatalogProduct[] {
	return [
		{
			productId: `p-zephyr-${id}`,
			name: `Zephyr Quiet ${id}`,
			genres: ['HORROR'],
		},
		{
			productId: `p-crow-${id}`,
			name: `Crow Country ${id}`,
			genres: ['HORROR', 'ADVENTURE'],
		},
		{
			productId: `p-apex-${id}`,
			name: `Apex Arena ${id}`,
			genres: ['ACTION'],
		},
	];
}

const catalogCards = (page: import('@playwright/test').Page) =>
	page.getByTestId('catalog-card');

test('the header toggle switches destinations, and a live search term does NOT follow you across', async ({
	page,
}) => {
	const id = run();
	const products = catalogFixture(id);
	try {
		await seedCatalog(products);
		await page.goto('/');

		// Search the SHELF: the term lands in this destination's ?q=.
		await page
			.getByRole('searchbox', { name: 'Search your library' })
			.fill('Baseline Alpha');
		await expect(page).toHaveURL(/\?q=Baseline\+Alpha/);

		// Switch to the catalog — URL changes, destination swaps, TERM IS GONE.
		await page.getByRole('link', { name: 'CATALOG' }).click();
		await expect(page).toHaveURL(/\/catalog$/);
		await expect(page.getByRole('link', { name: 'CATALOG' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(
			page.getByRole('searchbox', { name: 'Search the catalog' }),
		).toHaveValue('');
		await expect(catalogCards(page).first()).toBeVisible();

		// And back: the shelf's term did not survive the round trip either.
		await page.getByRole('link', { name: 'SHELF' }).click();
		await expect(page).toHaveURL(/\/$/);
		await expect(
			page.getByRole('searchbox', { name: 'Search your library' }),
		).toHaveValue('');
	} finally {
		await deleteCatalog(products.map((p) => p.productId));
	}
});

test('the catalog is ordered A–Z with no ownership or state tier', async ({
	page,
}) => {
	const id = run();
	const products = catalogFixture(id);
	// An OWNED game whose title sorts LAST: ownership must not hoist it.
	const owned = createGame({ title: `Zephyr Quiet ${id}` });
	try {
		await seedCatalog(products);
		await seedGames([owned]);
		await page.goto('/catalog');
		await expect(catalogCards(page).filter({ hasText: id })).toHaveCount(3);

		const titles = await page.getByTestId('catalog-card-title').allInnerTexts();
		const mine = titles.filter((title) => title.includes(id));
		expect(mine).toEqual([
			`Apex Arena ${id}`,
			`Crow Country ${id}`,
			`Zephyr Quiet ${id}`,
		]);
	} finally {
		await deleteCatalog(products.map((p) => p.productId));
		await deleteGames([owned.id]);
	}
});

test('the genre filter narrows the grid (PS-store facet keys, OR within the group)', async ({
	page,
}) => {
	const id = run();
	const products = catalogFixture(id);
	try {
		await seedCatalog(products);
		await page.goto('/catalog');
		await expect(catalogCards(page).filter({ hasText: id })).toHaveCount(3);

		await page.getByRole('button', { name: /^Horror/ }).click();
		const shown = catalogCards(page).filter({ hasText: id });
		await expect(shown).toHaveCount(2);
		await expect(shown.filter({ hasText: `Apex Arena ${id}` })).toHaveCount(0);
		// The KEY travels in the URL, never the localized label (AD-26).
		await expect(page).toHaveURL(/genre=HORROR/);
	} finally {
		await deleteCatalog(products.map((p) => p.productId));
	}
});

test('the catalog search narrows the grid — and never offers an ＋ Add row', async ({
	page,
}) => {
	const id = run();
	const products = catalogFixture(id);
	try {
		await seedCatalog(products);
		await page.goto('/catalog');

		await page
			.getByRole('searchbox', { name: 'Search the catalog' })
			.fill('crow');
		await expect(page).toHaveURL(/\/catalog\?q=crow/);
		await expect(catalogCards(page)).toHaveCount(1);
		await expect(catalogCards(page).first()).toContainText('Crow Country');
		// You cannot conjure a game into Sony's catalog by typing it.
		await expect(page.getByTestId('search-add-option')).toHaveCount(0);

		// A miss is NO MATCH, never a blank grid.
		await page
			.getByRole('searchbox', { name: 'Search the catalog' })
			.fill('zzz nothing here');
		await expect(page.getByText('NO MATCH')).toBeVisible();
		await expect(page.getByTestId('search-add-option')).toHaveCount(0);
	} finally {
		await deleteCatalog(products.map((p) => p.productId));
	}
});

test('an owned catalog game shows Owned and NO actions; a tracked-unowned one shows In library AND Claim now', async ({
	page,
}) => {
	const id = run();
	const owned = createGame({ title: `Owned Catalog ${id}` });
	const wishlisted = createWishlistedGame({
		title: `Wishlisted Catalog ${id}`,
		tracking: { playStatus: 'Not started' },
	});
	const products: SeedCatalogProduct[] = [
		{ productId: `p-owned-${id}`, name: owned.title },
		{ productId: `p-wish-${id}`, name: wishlisted.title },
		{ productId: `p-new-${id}`, name: `Untracked Catalog ${id}` },
	];
	try {
		await seedGames([owned, wishlisted]);
		await seedCatalog(products);
		await page.goto('/catalog');

		// (c) owned → the silver marker, and the absence of a CTA IS the message.
		const ownedCard = catalogCards(page).filter({ hasText: owned.title });
		await expect(ownedCard.getByTestId('catalog-owned')).toBeVisible();
		await expect(ownedCard.getByTestId('catalog-add')).toHaveCount(0);
		await expect(ownedCard.getByTestId('catalog-claim')).toHaveCount(0);

		// (b) tracked but not owned → In library AND Claim now, still live: it's on
		// the shelf as a wishlist entry, not claimed on the PlayStation account.
		const wishCard = catalogCards(page).filter({ hasText: wishlisted.title });
		await expect(wishCard.getByTestId('catalog-in-library')).toBeVisible();
		await expect(wishCard.getByTestId('catalog-add')).toHaveCount(0);
		const claim = wishCard.getByRole('link', {
			name: `Claim ${wishlisted.title} on the PlayStation Store (opens in a new tab)`,
		});
		await expect(claim).toBeVisible();
		await expect(claim).toHaveAttribute('target', '_blank');

		// (a) not tracked → ＋ Add + Claim now, both named after the game.
		const newCard = catalogCards(page).filter({
			hasText: `Untracked Catalog ${id}`,
		});
		await expect(
			newCard.getByRole('button', {
				name: `Add Untracked Catalog ${id} to library`,
			}),
		).toBeVisible();
		await expect(newCard.getByTestId('catalog-claim')).toBeVisible();

		// A catalog card is NOT a shelf card: no status pill, no owned toggle.
		await expect(page.getByTestId('card-owned-toggle')).toHaveCount(0);
		await expect(page.getByTestId('status-pill-button')).toHaveCount(0);
	} finally {
		await deleteCatalog(products.map((p) => p.productId));
		await deleteGames([owned.id, wishlisted.id]);
	}
});

// THE list-cache regression: a COLD load straight onto /game/:id has no
// ['shelf'] cache at all. It resolves through GET /api/games/:id, or it 404s on
// a game that exists (which is exactly how 7.3's add-then-navigate would break).
test('a /game/:id deep link resolves on a COLD load', async ({ page }) => {
	const game = createGame({
		title: `Deep Link ${run()}`,
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([game]);
		await page.goto(`/game/${game.id}`);
		await expect(page.getByRole('dialog', { name: game.title })).toBeVisible();
	} finally {
		await deleteGames([game.id]);
	}
});

test('an unknown /game/:id is a RESOLVED not-found IN the detail dialog, not a crash', {
	annotation: [{ type: 'skipNetworkMonitoring' }],
}, async ({ page }) => {
	await page.goto('/game/00000000-dead-0000-0000-000000000000');
	// Every state of the route is the OVERLAY (review, H4) — the miss used to
	// render as loose "NO MATCH — no games match the current filters" copy under
	// a live shelf grid, on a URL where no filter exists.
	const dialog = page.getByRole('dialog', { name: 'Game not found' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('GAME NOT FOUND')).toBeVisible();
	await expect(page.getByText('NO MATCH')).toHaveCount(0);
});

// The Close on a cold deep link must never walk OUT of the app (review, H3): the
// `?q=` write is `{replace: true}`, which mints a fresh history key — the old
// "did we open this?" test. One keystroke used to turn Close into `history.back()`.
test('Close on a COLD deep link lands on the shelf, even after a keystroke', async ({
	page,
}) => {
	const game = createGame({
		title: `Cold Close ${run()}`,
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([game]);
		await page.goto(`/game/${game.id}`);
		await expect(page.getByRole('dialog', { name: game.title })).toBeVisible();

		await page
			.getByRole('searchbox', { name: 'Search your library' })
			.fill('cold');
		await expect(page).toHaveURL(/\?q=cold/);

		await page.getByRole('button', { name: 'Close details' }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page).toHaveURL(/localhost:\d+\/$|\/$/);
		await expect(page.getByTestId('shelf-grid')).toBeVisible();
	} finally {
		await deleteGames([game.id]);
	}
});

// An unknown URL is a NOT FOUND destination (review, M10) — never the shelf
// silently rendered at whatever address you mistyped.
test('an unknown URL is a not-found destination, not the shelf', async ({
	page,
}) => {
	await page.goto('/catlog');
	await expect(page.getByText('PAGE NOT FOUND')).toBeVisible();
	await expect(page.getByTestId('shelf-grid')).toHaveCount(0);

	await page.getByRole('button', { name: 'Back to shelf' }).click();
	await expect(page.getByTestId('shelf-grid')).toBeVisible();
});

/**
 * The catalog's empty/needs-refresh causes. Serial: they mutate settings and the
 * whole catalog table, which parallel workers would read underneath each other.
 */
test.describe('catalog empty + stale states', () => {
	test.describe.configure({ mode: 'serial' });

	test('a region with an EMPTY snapshot offers Check PS+ Extra — never a blank grid', async ({
		page,
	}) => {
		await page.goto('/catalog');
		await expect(page.getByText('EMPTY CATALOG')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Check PS+ Extra' }),
		).toBeVisible();
		await expect(page.getByTestId('catalog-grid')).toHaveCount(0);
	});

	test('a FAILED refresh shows the attention banner AND the stale grid (a stale catalog beats no catalog)', async ({
		page,
	}) => {
		const id = run();
		const products = catalogFixture(id);
		try {
			await seedCatalog(products);
			await seedSetting('psplus_refresh_failed', 'failed');
			await page.goto('/catalog');

			await expect(
				page.getByText(/monthly PS\+ Extra catalog refresh/),
			).toBeVisible();
			// The stale grid is still there, and it says so via the banner above it.
			await expect(catalogCards(page).filter({ hasText: id })).toHaveCount(3);
		} finally {
			await deleteCatalog(products.map((p) => p.productId));
			await deleteSetting('psplus_refresh_failed');
		}
	});
});
