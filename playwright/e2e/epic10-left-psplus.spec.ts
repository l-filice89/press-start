import { randomUUID } from 'node:crypto';
import { createGame, type SeedGame } from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

/**
 * Story 10.2 (VR-6): the "LEFT PS+" warning renders on the shelf for a
 * tracked, un-owned game that departed the PS+ Extra catalog — and never for
 * an owned one (FR-38). Rendering is from STORED data (`ps_plus_left_on`);
 * the stamping write path is pinned in integration
 * `psplus-departure.test.ts`. playwright/COVERAGE.md maps the ACs.
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

test('an un-owned departed game shows the amber LEFT PS+ warning, distinct from the PS+ pill (10.2b/c)', async ({
	page,
}) => {
	const departed = uniqueGame('Left Warn', {
		psPlusExtra: false,
		psPlusLeftOn: '2026-07-01',
		tracking: { owned: false, wishlistedOn: '2026-01-01' },
	});
	try {
		await seedGames([departed]);
		await page.goto('/');
		const card = page
			.getByTestId('shelf-card')
			.filter({ hasText: departed.title });
		const flag = card.getByTestId('card-flag-ps-left');
		await expect(flag).toBeVisible();
		await expect(flag).toHaveText(/LEFT PS\+/);
		// Distinct from the steady-state pill: that one isn't rendered at all.
		await expect(card.getByText('PS+', { exact: true })).toHaveCount(0);
	} finally {
		await deleteGames([departed.id]);
	}
});

test('an OWNED departed game shows no warning (10.2e)', async ({ page }) => {
	const ownedDeparted = uniqueGame('Left Owned', {
		psPlusExtra: false,
		psPlusLeftOn: '2026-07-01',
		tracking: { owned: true },
	});
	try {
		await seedGames([ownedDeparted]);
		await page.goto('/');
		const card = page
			.getByTestId('shelf-card')
			.filter({ hasText: ownedDeparted.title });
		await expect(card).toBeVisible();
		await expect(card.getByTestId('card-flag-ps-left')).toHaveCount(0);
	} finally {
		await deleteGames([ownedDeparted.id]);
	}
});
