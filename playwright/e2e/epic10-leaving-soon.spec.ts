import { randomUUID } from 'node:crypto';
import { createGame, type SeedGame } from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
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

test('an un-owned leaving game warns with the date, ALONGSIDE the PS+ pill (10.4b)', async ({
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
		await expect(card.getByText('PS+', { exact: true })).toBeVisible();
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
