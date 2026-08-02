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
			cards.getByRole('button', { name: 'Open details', exact: true }),
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
		await first
			.getByRole('button', { name: 'Open details', exact: true })
			.click();
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

test('phone uses compact two-up covers and keeps every action at least 44px high', async ({
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
		expect(Math.abs(boxes[1].top - boxes[0].top)).toBeLessThan(2);
		expect(boxes[1].left).toBeGreaterThan(boxes[0].left);
		expect(boxes[2].top).toBeGreaterThan(boxes[0].top);
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

test('Tune keeps draft separate, applies exact then closest picks, and preserves visit intent through details', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const games = [
		createGame({
			title: `Tune Exact ${run}`,
			genres: [`Tune ${run}`],
			ttbStorySeconds: 8 * 3600,
			tracking: { boughtOn: '2026-07-01' },
		}),
		createGame({
			title: `Tune Long A ${run}`,
			genres: [`Long A ${run}`],
			ttbStorySeconds: 50 * 3600,
			criticScore: 99,
			criticScoreCount: 99,
			tracking: { boughtOn: '2020-01-01' },
		}),
		createGame({
			title: `Tune Long B ${run}`,
			genres: [`Long B ${run}`],
			ttbStorySeconds: 60 * 3600,
			tracking: { boughtOn: '2020-01-01' },
		}),
		createGame({
			title: `Tune Discover ${run}`,
			genres: [`Discover ${run}`],
			ttbStorySeconds: 6 * 3600,
			tracking: {
				owned: false,
				ownedVia: null,
				boughtOn: null,
				wishlistedOn: '2026-07-15',
			},
		}),
	];
	try {
		await seedGames(games);
		await page.goto('/play-next');
		const cards = page.locator('[data-play-next-game-id]');
		await expect(cards).toHaveCount(3);
		await expect(page.getByText(games[3].title)).toHaveCount(0);
		const before = await cards.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute('data-play-next-game-id')),
		);
		const trigger = page.locator('.tune-trigger');
		await trigger.click();
		const dialog = page.getByRole('dialog', { name: 'Tune the picks' });
		await expect(dialog).toBeFocused();
		const desktopBox = await dialog.boundingBox();
		const viewport = page.viewportSize();
		expect(desktopBox?.width ?? viewport?.width ?? 0).toBeLessThan(
			viewport?.width ?? 0,
		);
		expect(
			Math.abs(
				(desktopBox?.x ?? 0) +
					(desktopBox?.width ?? 0) / 2 -
					(viewport?.width ?? 0) / 2,
			),
		).toBeLessThan(3);
		await page.keyboard.press('Shift+Tab');
		await expect(
			dialog.getByRole('button', { name: 'SHOW ME 3' }),
		).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(
			dialog.getByRole('button', { name: 'Close Tune the picks' }),
		).toBeFocused();
		await dialog.getByRole('button', { name: 'Quick win' }).click();
		await dialog.getByRole('checkbox', { name: /Include wishlist/ }).check();
		await expect(dialog.getByText(/Draft changed/)).toBeVisible();
		expect(
			await cards.evaluateAll((nodes) =>
				nodes.map((node) => node.getAttribute('data-play-next-game-id')),
			),
		).toEqual(before);
		await expect(page.getByText('SURPRISE ME')).toBeVisible();

		await dialog.getByRole('button', { name: 'SHOW ME 3' }).click();
		await expect(dialog).toHaveCount(0);
		await expect(trigger).toBeFocused();
		await expect(trigger).toHaveAccessibleName('Tune the picks — 2 active');
		await expect(page.locator('.play-next__mode')).toHaveText(
			'QUICK WIN · INCLUDE WISHLIST',
		);
		await expect(page.getByText(games[3].title)).toBeVisible();
		await expect(page.getByText('DISCOVER', { exact: true })).toBeVisible();
		await expect(page.getByText('CLOSEST MATCH').first()).toBeVisible();
		await expect(page.getByTestId('live-region')).toHaveText(
			'3 suggestions ready.',
		);
		const distances = await cards.evaluateAll((nodes) =>
			nodes.map((node) =>
				Boolean(node.querySelector('.play-next-card__closest')),
			),
		);
		expect(distances.slice(0, 2)).toEqual([false, false]);
		expect(distances[2]).toBe(true);
		const appliedVisit = await page
			.locator('.play-next')
			.getAttribute('data-play-next-visit');
		const appliedIds = await cards.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute('data-play-next-game-id')),
		);
		const appliedMode = await page.locator('.play-next__mode').textContent();

		await trigger.click();
		await page.getByRole('button', { name: 'Different' }).click();
		await page.getByRole('button', { name: 'Close Tune the picks' }).click();
		const first = cards.first();
		await first.getByRole('button', { name: /Open details —/ }).click();
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Close details' })
			.click();
		await expect(first).toBeFocused();
		expect(
			await page.locator('.play-next').getAttribute('data-play-next-visit'),
		).toBe(appliedVisit);
		expect(
			await cards.evaluateAll((nodes) =>
				nodes.map((node) => node.getAttribute('data-play-next-game-id')),
			),
		).toEqual(appliedIds);
		await expect(page.locator('.play-next__mode')).toHaveText(
			appliedMode ?? '',
		);
		await trigger.click();
		await expect(
			page.getByRole('button', { name: 'Different' }),
		).toHaveAttribute('aria-pressed', 'true');
		await expect(trigger).toHaveAccessibleName('Tune the picks — 2 active');
		await page.getByRole('button', { name: 'Close Tune the picks' }).click();
		await page.getByRole('link', { name: 'SHELF' }).click();
		await page.getByRole('link', { name: 'PLAY NEXT' }).click();
		await expect(page.locator('.play-next__mode')).toHaveText('SURPRISE ME');
		await expect(page.locator('.tune-trigger')).toHaveAccessibleName(
			'Tune the picks',
		);
		expect(
			await page.locator('.play-next').getAttribute('data-play-next-visit'),
		).not.toBe(appliedVisit);
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});

test('suggestion ownership diamond reuses the guarded ownership source flow', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const leavingSoon = new Date(Date.now() + 5 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	const target = createGame({
		title: `Ownership Candidate ${run}`,
		genres: [`Ownership ${run}`],
		psPlusExtra: true,
		psPlusLeavingOn: leavingSoon,
		criticScore: 100,
		criticScoreCount: 100,
		ttbStorySeconds: 4 * 3600,
		tracking: {
			owned: false,
			ownedVia: null,
			playStatus: 'Up next',
			boughtOn: null,
			wishlistedOn: '2026-07-01',
		},
	});
	try {
		await seedGames([target]);
		await page.goto('/play-next');
		const card = page.locator(`[data-play-next-game-id="${target.id}"]`);
		await expect(card).toBeVisible();
		const owned = card.getByRole('button', {
			name: `Owned — ${target.title}`,
		});
		await expect(owned).toHaveAttribute('aria-pressed', 'false');
		await owned.click();
		const source = page.getByRole('dialog', {
			name: `Did you buy ${target.title}, or claim it with PS+?`,
		});
		await source.getByRole('button', { name: 'Claimed with PS+' }).click();
		await expect(source).toHaveCount(0);
		await expect(owned).toHaveAttribute('aria-pressed', 'true');
		await expect(card.getByText('OWNED', { exact: true })).toBeVisible();
	} finally {
		await deleteGames([target.id]);
	}
});

test('Tune uses the phone filter sheet disposition with trapped 44px controls', async ({
	page,
}) => {
	const games = candidates(randomUUID().slice(0, 8));
	try {
		await seedGames(games);
		await page.setViewportSize({ width: 320, height: 667 });
		await page.goto('/play-next');
		const trigger = page.locator('.tune-trigger');
		await trigger.click();
		const dialog = page.getByRole('dialog', { name: 'Tune the picks' });
		const dialogBox = await dialog.boundingBox();
		expect(dialogBox?.x).toBe(0);
		expect(dialogBox?.width).toBe(320);
		expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBe(667);
		for (const control of await dialog.getByRole('button').all()) {
			expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
		}
		expect(
			(
				await dialog
					.locator('label')
					.filter({ hasText: 'Include wishlist' })
					.boundingBox()
			)?.height,
		).toBeGreaterThanOrEqual(44);
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(trigger).toBeFocused();
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});
