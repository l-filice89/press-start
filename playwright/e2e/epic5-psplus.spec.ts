import { randomUUID } from 'node:crypto';
import {
	createGame,
	createWishlistedGame,
} from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
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
