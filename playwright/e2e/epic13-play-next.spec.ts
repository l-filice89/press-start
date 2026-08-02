import { randomUUID } from 'node:crypto';
import { createGame, type SeedGame } from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

// Suggestions rank the whole shared Shelf. Keep this file serial so its own
// high-scoring fixture sets cannot compete with each other across workers.
test.describe.configure({ mode: 'serial' });

function candidates(run: string): SeedGame[] {
	const leavingSoon = new Date(Date.now() + 8 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	return [
		createGame({
			title: `Finish Candidate ${run}`,
			genres: [`Adventure ${run}`],
			ttbStorySeconds: 8 * 3600,
			criticScore: 95,
			criticScoreCount: 50,
			userScore: 94,
			userScoreCount: 100,
			tracking: { playStatus: 'Paused', boughtOn: '2020-01-01' },
		}),
		createGame({
			title: `Up Next Candidate ${run}`,
			genres: [`Strategy ${run}`],
			criticScore: 91,
			criticScoreCount: 42,
			userScore: 92,
			userScoreCount: 100,
			ttbStorySeconds: 9 * 3600,
			tracking: { playStatus: 'Up next', boughtOn: '2020-01-01' },
		}),
		createGame({
			title: `Last Chance Candidate ${run}`,
			genres: [`Action ${run}`],
			psPlusExtra: true,
			psPlusLeavingOn: leavingSoon,
			criticScore: 93,
			criticScoreCount: 50,
			userScore: 90,
			userScoreCount: 100,
			ttbStorySeconds: 7 * 3600,
			tracking: {
				owned: false,
				ownedVia: null,
				playStatus: 'Up next',
				boughtOn: null,
				wishlistedOn: '2023-01-01',
			},
		}),
		createGame({
			title: `Excluded Playing ${run}`,
			criticScore: 100,
			criticScoreCount: 100,
			userScore: 100,
			userScoreCount: 100,
			tracking: { playStatus: 'Playing' },
		}),
		createGame({
			title: `Excluded Future ${run}`,
			releaseDate: '2999-01-01',
			criticScore: 100,
			criticScoreCount: 100,
			tracking: { playStatus: 'Up next' },
		}),
		createGame({
			title: `Excluded Dropped ${run}`,
			tracking: { playStatus: 'Dropped' },
		}),
		createGame({
			title: `Excluded Platinum ${run}`,
			tracking: { platinumOn: '2026-01-01' },
		}),
	];
}

test('Play Next shows three transparent, varied picks and preserves them through details', async ({
	page,
}) => {
	const games = candidates(randomUUID().slice(0, 8));
	try {
		await seedGames(games);
		await page.goto('/play-next');

		await expect(page.getByRole('link', { name: 'PLAY NEXT' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(page.getByRole('searchbox')).toHaveCount(0);
		await expect(
			page.getByRole('heading', { name: 'WHAT NEXT?' }),
		).toBeFocused();
		await expect(page.getByText('SURPRISE ME')).toBeVisible();

		const cards = page.locator('[data-play-next-game-id]');
		await expect(cards).toHaveCount(3);
		await expect(page.getByText(games[0].title)).toBeVisible();
		await expect(page.getByText(games[1].title)).toBeVisible();
		await expect(page.getByText(games[2].title)).toBeVisible();
		await expect(page.getByText(games[3].title)).toHaveCount(0);
		await expect(page.getByText(games[4].title)).toHaveCount(0);
		await expect(page.getByText(games[5].title)).toHaveCount(0);
		await expect(page.getByText(games[6].title)).toHaveCount(0);
		await expect(cards.getByRole('button', { name: 'Play this' })).toHaveCount(
			3,
		);
		await expect(
			cards.getByRole('button', { name: 'Open details' }),
		).toHaveCount(3);
		for (const eligible of games.slice(0, 3)) {
			await expect(page.getByText(eligible.genres[0])).toBeVisible();
		}
		await expect(page.getByText('8h story')).toBeVisible();
		await expect(page.getByText('PS+ EXTRA')).toBeVisible();
		await expect(
			page.getByRole('list', { name: 'Score factors' }).first(),
		).toBeVisible();

		const before = await cards.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute('data-play-next-game-id')),
		);
		const visitBefore = await page
			.locator('[data-play-next-visit]')
			.getAttribute('data-play-next-visit');
		const first = cards.first();
		await first.getByRole('button', { name: 'Open details' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Close details' }).click();
		await expect(dialog).toHaveCount(0);
		await expect(first).toBeFocused();
		const after = await cards.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute('data-play-next-game-id')),
		);
		expect(after).toEqual(before);
		await expect(page.locator('[data-play-next-visit]')).toHaveAttribute(
			'data-play-next-visit',
			visitBefore ?? '',
		);
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});

test('Play this marks the suggestion Playing and returns to Shelf', async ({
	page,
}) => {
	const games = candidates(randomUUID().slice(0, 8));
	try {
		await seedGames(games);
		await page.goto('/play-next');
		const card = page.locator('[data-play-next-game-id]').first();
		const title = (await card.getByRole('heading').textContent()) ?? '';
		await card.getByRole('button', { name: 'Play this' }).click();
		await expect(page).toHaveURL('/');
		await expect(page.getByTestId('toast')).toContainText(`${title} — Playing`);
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});

test('phone stacks compact cards and keeps every action at least 44px high', async ({
	page,
}) => {
	const games = candidates(randomUUID().slice(0, 8));
	try {
		await seedGames(games);
		await page.setViewportSize({ width: 320, height: 667 });
		await page.goto('/play-next');
		const cards = page.locator('[data-play-next-game-id]');
		await expect(cards).toHaveCount(3);
		const boxes = await cards.evaluateAll((nodes) =>
			nodes.map((node) => {
				const rect = node.getBoundingClientRect();
				return { top: rect.top, left: rect.left };
			}),
		);
		expect(boxes[1].top).toBeGreaterThan(boxes[0].top);
		expect(Math.abs(boxes[1].left - boxes[0].left)).toBeLessThan(2);
		for (const button of await cards.getByRole('button').all()) {
			expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
		}
		const navBox = await page
			.getByRole('navigation', { name: 'Destination' })
			.boundingBox();
		expect(navBox?.x ?? 321).toBeGreaterThanOrEqual(0);
		expect((navBox?.x ?? 0) + (navBox?.width ?? 321)).toBeLessThanOrEqual(320);
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});
