import { createGame } from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

test('Stats navigation, year switching, direct load, and phone width', async ({
	page,
}) => {
	const currentYear = new Date().getFullYear();
	const games = [
		createGame({
			title: 'Stats Current Round',
			tracking: { boughtOn: `${currentYear}-03-02`, playStatus: 'Not started' },
		}),
		createGame({
			title: 'Stats Historic Round',
			tracking: { completedOn: '2024-06-04', playStatus: null },
		}),
	];
	try {
		await seedGames(games);
		await page.goto('/');
		await page.getByRole('link', { name: 'STATS' }).click();

		await expect(page).toHaveURL(/\/stats$/);
		await expect(page.getByRole('link', { name: 'STATS' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(
			page.getByRole('heading', { name: 'CABINET SCORE' }),
		).toBeVisible();
		await expect(page.getByRole('searchbox')).toHaveCount(0);
		await expect(page.getByLabel('CURRENT ROUND')).toHaveValue(
			String(currentYear),
		);

		await page.getByLabel('CURRENT ROUND').selectOption('2024');
		await expect(
			page.locator('.stats-year-score--completedOn strong'),
		).toHaveText('1');
		await page.goto('/stats');
		await expect(
			page.getByRole('heading', { name: 'CABINET SCORE' }),
		).toBeVisible();
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(page.getByRole('link', { name: 'STATS' })).toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});
