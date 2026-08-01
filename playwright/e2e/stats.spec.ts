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
		const desktopTitleBox = await page
			.getByRole('heading', { name: 'CABINET SCORE' })
			.boundingBox();
		const desktopSelectorBox = await page
			.getByLabel('CURRENT ROUND')
			.boundingBox();
		const desktopRecapBox = await page
			.getByRole('region', { name: 'All-time scores' })
			.boundingBox();
		expect(desktopTitleBox).not.toBeNull();
		expect(desktopSelectorBox).not.toBeNull();
		expect(desktopRecapBox).not.toBeNull();
		expect(desktopSelectorBox?.x).toBeGreaterThan(
			(desktopTitleBox?.x ?? 0) + (desktopTitleBox?.width ?? 0),
		);
		expect(desktopRecapBox?.y).toBeGreaterThan(
			(desktopTitleBox?.y ?? 0) + (desktopTitleBox?.height ?? 0),
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
		const recapBox = await page
			.getByRole('region', { name: 'All-time scores' })
			.boundingBox();
		const selectorBox = await page.getByLabel('CURRENT ROUND').boundingBox();
		const roundBox = await page.locator('.stats-round').boundingBox();
		expect(recapBox).not.toBeNull();
		expect(selectorBox).not.toBeNull();
		expect(roundBox).not.toBeNull();
		expect(recapBox?.y).toBeLessThan(selectorBox?.y ?? 0);
		expect(selectorBox?.y).toBeLessThan(roundBox?.y ?? 0);
		await expect(page.getByRole('button', { name: 'Chores' })).toHaveCount(0);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});
