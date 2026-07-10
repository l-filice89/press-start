import { createGame } from '../support/factories/game-factory';
import { deleteGame, seedGame } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

/**
 * Framework smoke: proves the whole e2e stack — real Worker + isolated e2e
 * D1, pre-authenticated magic-link session (global-setup), direct D1
 * seeding, and the playwright-utils fixtures.
 */

test('API is healthy', async ({ apiRequest }) => {
	const { status, body } = await apiRequest<{ status: string }>({
		method: 'GET',
		path: '/api/health',
	});
	expect(status).toBe(200);
	expect(body.status).toBe('ok');
});

test('the shelf loads for the authenticated user', async ({ page }) => {
	await page.goto('/');
	// Signed-in shell, not the login splash: the header wordmark is compact
	// and the login form is absent.
	await expect(page.getByText('PRESS START')).toBeVisible();
	await expect(page.getByRole('textbox', { name: /email/i })).toHaveCount(0);
});

test('a seeded game appears on the shelf', async ({ page }) => {
	const game = createGame();
	await seedGame(game);
	try {
		await page.goto('/');
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: game.title }),
		).toBeVisible();
	} finally {
		await deleteGame(game.id);
	}
});
