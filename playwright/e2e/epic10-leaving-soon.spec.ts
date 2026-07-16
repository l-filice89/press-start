import { randomUUID } from 'node:crypto';
import { createGame, type SeedGame } from '../support/factories/game-factory';
import {
	deleteCatalog,
	deleteGames,
	seedCatalog,
	seedGames,
} from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

/**
 * Story 10.4 (VR-6 rework): the "LEAVING {date}" warning renders on the shelf
 * for a tracked, un-owned game with a departure date — BESIDE the PS+ pill
 * (the game is still in the catalog; that is the point) — and never for an
 * owned one (FR-38). It REPLACED 10.2's post-departure LEFT PS+ pill.
 * Rendering is from STORED data (`ps_plus_leaving_on`); the sweep's write path
 * is pinned in integration `psplus-leaving.test.ts`. COVERAGE.md maps the ACs.
 */

function uniqueGame(
	prefix: string,
	overrides: Parameters<typeof createGame>[0] = {},
): SeedGame {
	return createGame({
		title: `${prefix} ${randomUUID().slice(0, 8)}`,
		...overrides,
	});
}

test('an un-owned leaving game warns with the date on its own row, PS+ pill still shown (10.4b)', async ({
	page,
}) => {
	const leaving = uniqueGame('Leaving Warn', {
		psPlusExtra: true,
		psPlusLeavingOn: '2099-07-21',
		tracking: { owned: false, wishlistedOn: '2026-01-01' },
	});
	try {
		await seedGames([leaving]);
		await page.goto('/');
		const card = page
			.getByTestId('shelf-card')
			.filter({ hasText: leaving.title });
		const flag = card.getByTestId('card-flag-leaving');
		await expect(flag).toBeVisible();
		await expect(flag).toHaveText(/LEAVING 21 JUL/);
		// Still in the catalog: the steady-state pill renders TOO.
		const psPlus = card.getByText('PS+', { exact: true });
		await expect(psPlus).toBeVisible();
		// Geometry pins (review, the two motivating bugs): the warning sits on
		// its OWN row below the PS+ pill, and never under the owned toggle.
		const flagBox = await flag.boundingBox();
		const psPlusBox = await psPlus.boundingBox();
		const toggleBox = await card.getByTestId('card-owned-toggle').boundingBox();
		expect(flagBox && psPlusBox && toggleBox).toBeTruthy();
		if (flagBox && psPlusBox && toggleBox) {
			expect(flagBox.y).toBeGreaterThanOrEqual(psPlusBox.y + psPlusBox.height);
			const overlapsToggle =
				flagBox.x < toggleBox.x + toggleBox.width &&
				toggleBox.x < flagBox.x + flagBox.width &&
				flagBox.y < toggleBox.y + toggleBox.height &&
				toggleBox.y < flagBox.y + flagBox.height;
			expect(overlapsToggle).toBe(false);
		}
		// The retired LEFT PS+ pill is gone from the DOM entirely.
		await expect(card.getByTestId('card-flag-ps-left')).toHaveCount(0);
	} finally {
		await deleteGames([leaving.id]);
	}
});

test('an OWNED leaving game shows no warning (10.4d, FR-38)', async ({
	page,
}) => {
	const ownedLeaving = uniqueGame('Leaving Owned', {
		psPlusExtra: true,
		psPlusLeavingOn: '2099-07-21',
		tracking: { owned: true },
	});
	try {
		await seedGames([ownedLeaving]);
		await page.goto('/');
		const card = page
			.getByTestId('shelf-card')
			.filter({ hasText: ownedLeaving.title });
		await expect(card).toBeVisible();
		await expect(card.getByTestId('card-flag-leaving')).toHaveCount(0);
	} finally {
		await deleteGames([ownedLeaving.id]);
	}
});

test('the detail panel shows the full departure date (10.4 follow-on)', async ({
	page,
}) => {
	const leaving = uniqueGame('Leaving Detail', {
		psPlusExtra: true,
		psPlusLeavingOn: '2099-07-21',
		tracking: { owned: false, wishlistedOn: '2026-01-01' },
	});
	try {
		await seedGames([leaving]);
		await page.goto('/');
		await page
			.getByTestId('shelf-card')
			.filter({ hasText: leaving.title })
			.getByTestId('card-cover-button')
			.click();
		await expect(page.getByTestId('detail-leaving')).toHaveText(
			'Leaving PS+ Extra on 2099-07-21',
		);
	} finally {
		await deleteGames([leaving.id]);
	}
});

test('the shelf "Leaving soon" pill filters to exactly the warned games (10.4 follow-on)', async ({
	page,
}) => {
	const leaving = uniqueGame('Leaving Filtered', {
		psPlusExtra: true,
		psPlusLeavingOn: '2099-07-21',
		tracking: { owned: false, wishlistedOn: '2026-01-01' },
	});
	const staying = uniqueGame('Staying Filtered', {
		psPlusExtra: true,
		tracking: { owned: false, wishlistedOn: '2026-01-01' },
	});
	try {
		await seedGames([leaving, staying]);
		await page.goto('/');
		await page.getByTestId('filter-flag-leavingSoon').click();
		const cards = page.getByTestId('shelf-card');
		await expect(cards.filter({ hasText: leaving.title })).toBeVisible();
		await expect(cards.filter({ hasText: staying.title })).toHaveCount(0);
		await expect(page.getByTestId('filter-summary')).toContainText(
			'Leaving soon',
		);
	} finally {
		await deleteGames([leaving.id, staying.id]);
	}
});

test('the catalog card of a tracked leaving game carries the LEAVING flag (10.4 follow-on)', async ({
	page,
}) => {
	const id = randomUUID().slice(0, 8);
	const title = `Catalog Vanisher ${id}`;
	const productId = `p-vanish-${id}`;
	// Tracked, un-owned, future-dated game whose normalized title matches the
	// catalog product — the browse join carries the date to the card.
	const tracked = createGame({
		title,
		psPlusExtra: true,
		psPlusLeavingOn: '2099-07-21',
		tracking: { owned: false, wishlistedOn: '2026-01-01' },
	});
	try {
		await seedGames([tracked]);
		await seedCatalog([{ productId, name: title, genres: [] }]);
		await page.goto('/catalog');
		const card = page.getByTestId('catalog-card').filter({ hasText: title });
		const flag = card.getByTestId('catalog-flag-leaving');
		await expect(flag).toHaveText(/LEAVING 21 JUL/);
	} finally {
		await deleteCatalog([productId]);
		await deleteGames([tracked.id]);
	}
});
