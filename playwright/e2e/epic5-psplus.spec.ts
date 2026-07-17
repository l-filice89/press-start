import { randomUUID } from 'node:crypto';
import {
	createGame,
	createWishlistedGame,
} from '../support/factories/game-factory';
import {
	deleteGames,
	seedGames,
	seedRegionFreshness,
} from '../support/helpers/d1';
import { loadAllPages } from '../support/helpers/shelf';
import { expect, test } from '../support/merged-fixtures';

/**
 * Story 5.1 (FR-38/FR-14, AR-8): stored PS+ Extra catalog membership drives
 * the card flag and the Playable-now derived state. The check itself (button
 * → live catalog fetch → flag writes) needs a PSN response the e2e Worker
 * cannot stub — those flows are pinned at integration/jsdom tiers (see
 * COVERAGE.md); here we drive what the STORED flag does to the shelf.
 */

test('a flagged non-owned released game is Playable now; owned games hide the flag; unreleased ones stay out (5.1d/5.1e)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const inCatalog = createWishlistedGame({
		title: `Catalog Playable ${run}`,
		psPlusExtra: true,
		releaseDate: '2020-01-01',
		tracking: { playStatus: 'Not started' },
	});
	const ownedFlagged = createGame({
		title: `Catalog Owned ${run}`,
		psPlusExtra: true,
		releaseDate: '2020-01-01',
		tracking: { owned: true, playStatus: 'Playing' },
	});
	const unreleased = createWishlistedGame({
		title: `Catalog Future ${run}`,
		psPlusExtra: true,
		releaseDate: '2094-01-01',
		tracking: { playStatus: 'Not started' },
	});

	try {
		await seedGames([inCatalog, ownedFlagged, unreleased]);
		await page.goto('/');
		await loadAllPages(page);

		// FR-38: the catalog flag renders on the non-owned card only — the
		// moment a game is owned the flag is ignored and hidden.
		const flaggedCard = page
			.getByTestId('shelf-card')
			.filter({ hasText: inCatalog.title });
		await expect(
			flaggedCard.getByText('In the PlayStation Plus Extra catalog'),
		).toBeAttached();
		const ownedCard = page
			.getByTestId('shelf-card')
			.filter({ hasText: ownedFlagged.title });
		await expect(
			ownedCard.getByText('In the PlayStation Plus Extra catalog'),
		).toHaveCount(0);

		// FR-14/AR-8: catalog membership lights Playable now for released
		// non-owned games; an unreleased catalog game stays out.
		await page.getByTestId('filter-flag-playableNow').click();
		await loadAllPages(page);
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: inCatalog.title }),
		).toBeVisible();
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: ownedFlagged.title }),
		).toBeVisible();
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: unreleased.title }),
		).toHaveCount(0);
	} finally {
		await deleteGames([inCatalog.id, ownedFlagged.id, unreleased.id]);
	}
});

// The failed-refresh banner died with Story 8.4 (AD-31: refresh failures are
// passive — logs + as-of staleness; users have no action to take).

test('the header shows "PS+ CATALOG AS OF {date}" after a refresh (5.3)', async ({
	page,
}) => {
	try {
		// Story 8.4: freshness is the region ledger's last_success.
		await seedRegionFreshness('2026-07-11');
		await page.goto('/');
		const readout = page.getByTestId('readout');
		await expect(readout).toContainText('PS+ CATALOG AS OF');
		// Rendered in the viewer's locale (2026-07-11 fix), so assert the date
		// parts, not the raw ISO — the exact format is locale-dependent and
		// pinned at the jsdom tier (Header.test.tsx).
		await expect(readout).toContainText('2026');
		await expect(readout).toContainText('11');
		await expect(readout).not.toContainText('2026-07-11');
	} finally {
		// Restore the guard-dormant baseline (fresh last_success), not a bare
		// delete — an absent ledger row re-arms the stale-snapshot guard for
		// every later spec's shelf GET.
		await seedRegionFreshness(new Date().toISOString().slice(0, 10));
	}
});

test('the PS+ filter pill shows for a subscriber and narrows the shelf to unowned in-catalog games', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	// Badge set: in the catalog, not owned, released → the pill should match it.
	const playViaSub = createWishlistedGame({
		title: `Sub Playable ${run}`,
		psPlusExtra: true,
		releaseDate: '2020-01-01',
		tracking: { playStatus: 'Not started' },
	});
	// Owned in-catalog → badge hidden, so the pill must exclude it.
	const ownedInCatalog = createGame({
		title: `Sub Owned ${run}`,
		psPlusExtra: true,
		releaseDate: '2020-01-01',
		tracking: { owned: true, playStatus: 'Playing' },
	});
	// Not in the catalog → never in the PS+ pill's set.
	const notInCatalog = createWishlistedGame({
		title: `Not Sub ${run}`,
		psPlusExtra: false,
		tracking: { playStatus: 'Not started' },
	});

	try {
		await seedGames([playViaSub, ownedInCatalog, notInCatalog]);
		await page.goto('/');
		await loadAllPages(page);

		// The pill renders because the library holds an unowned in-catalog game
		// (the "has PS+" proxy); it also carries the "PS+" visible label.
		const pill = page.getByTestId('filter-flag-psPlusExtra');
		await expect(pill).toBeVisible();
		await expect(pill).toHaveText('PS+');

		await pill.click();
		await loadAllPages(page);

		// Only the unowned in-catalog game survives — owned-in-catalog and
		// not-in-catalog both drop.
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: playViaSub.title }),
		).toBeVisible();
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: ownedInCatalog.title }),
		).toHaveCount(0);
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: notInCatalog.title }),
		).toHaveCount(0);
	} finally {
		await deleteGames([playViaSub.id, ownedInCatalog.id, notInCatalog.id]);
	}
});
