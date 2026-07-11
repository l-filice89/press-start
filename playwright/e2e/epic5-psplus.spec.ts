import { randomUUID } from 'node:crypto';
import {
	createGame,
	createWishlistedGame,
} from '../support/factories/game-factory';
import {
	deleteGames,
	deleteSetting,
	seedGames,
	seedSetting,
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

test('a failed monthly refresh surfaces the failed-refresh attention banner (5.2c)', async ({
	page,
}) => {
	try {
		// The cron persists this flag on a failed scheduled refresh (Story 5.2).
		await seedSetting('psplus_refresh_failed', 'failed');
		await page.goto('/');
		await expect(
			page.getByTestId('attention-banner-failed-refresh'),
		).toBeVisible();
		await expect(
			page.getByTestId('attention-banner-failed-refresh'),
		).toContainText('PS+ Extra');
	} finally {
		// Restore the deterministic baseline (auth-journey asserts it exact).
		await deleteSetting('psplus_refresh_failed');
	}
});

test('the header shows "PS+ CATALOG AS OF {date}" after a refresh (5.3)', async ({
	page,
}) => {
	try {
		// Story 5.3 stamps this on a successful check; seed it to drive the readout.
		await seedSetting('psplus_refreshed_at', '2026-07-11');
		await page.goto('/');
		await expect(page.getByTestId('readout')).toContainText(
			'PS+ CATALOG AS OF 2026-07-11',
		);
	} finally {
		await deleteSetting('psplus_refreshed_at');
	}
});
