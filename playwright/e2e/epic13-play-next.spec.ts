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
	let releaseWrite: () => void = () => {};
	const writeGate = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	let writeCount = 0;
	try {
		await seedGames(games);
		await page.route('**/api/games/*/play-status', async (route) => {
			writeCount += 1;
			await writeGate;
			await route.continue();
		});
		await page.goto('/play-next');
		const card = page.locator('[data-play-next-game-id]').first();
		const title = (await card.getByRole('heading').textContent()) ?? '';
		const gameId = await card.getAttribute('data-play-next-game-id');
		await card.getByRole('button', { name: 'Play this' }).click();
		await expect(card).toHaveAttribute('aria-busy', 'true');
		await expect(
			card.getByRole('button', { name: 'STARTING…' }),
		).toBeDisabled();
		await expect(
			card.getByRole('button', { name: 'Open details', exact: true }),
		).toBeDisabled();
		await card.getByRole('button', { name: 'STARTING…' }).evaluate((button) => {
			(button as HTMLButtonElement).click();
			(button as HTMLButtonElement).click();
		});
		expect(writeCount).toBe(1);
		await expect(page).toHaveURL('/play-next');

		releaseWrite();
		await expect(page).toHaveURL('/');
		await expect(page.getByTestId('toast')).toContainText(`${title} — Playing`);
		const selected = page.locator(
			`[role="gridcell"][data-game-id="${gameId}"]`,
		);
		await expect(selected).toHaveAccessibleName(`${title} — Playing`);
		await expect(selected).toBeFocused();
		const shelfOrder = await page.getByRole('gridcell').evaluateAll((nodes) =>
			nodes.map((node) => ({
				id: node.getAttribute('data-game-id'),
				label: node.getAttribute('aria-label') ?? '',
			})),
		);
		const selectedIndex = shelfOrder.findIndex(({ id }) => id === gameId);
		expect(selectedIndex).toBeGreaterThanOrEqual(0);
		expect(
			shelfOrder
				.slice(0, selectedIndex)
				.every(({ label }) => label.endsWith('— Playing')),
		).toBe(true);
	} finally {
		releaseWrite();
		await deleteGames(games.map((game) => game.id));
	}
});

test('failed Play this preserves tuned exhausted visit and its next transition', {
	annotation: [{ type: 'skipNetworkMonitoring' }],
}, async ({ page }) => {
	const run = randomUUID().slice(0, 8);
	// Two eligible baseline games plus these three produce one full and one
	// exhausted slate while keeping the fixture deterministic.
	const games = Array.from({ length: 3 }, (_, index) =>
		createGame({
			title: `Failure preserve ${index} ${run}`,
			ttbStorySeconds: (index + 2) * 3600,
			criticScore: 90 - index,
			criticScoreCount: 50,
			tracking: { boughtOn: `202${index}-01-01` },
		}),
	);
	try {
		await seedGames(games);
		await page.goto('/play-next');
		const cards = page.locator('[data-play-next-game-id]');
		const ids = () =>
			cards.evaluateAll((nodes) =>
				nodes.map((node) => node.getAttribute('data-play-next-game-id')),
			);
		const trigger = page.locator('.tune-trigger');
		await trigger.click();
		await page.getByRole('button', { name: 'Quick win' }).click();
		await page.getByRole('button', { name: 'SHOW ME 3' }).click();
		await trigger.click();
		await page.getByRole('button', { name: 'Different' }).click();
		await page.getByRole('button', { name: 'Close Tune the picks' }).click();
		const shuffle = page.getByRole('button', { name: 'SHUFFLE', exact: true });
		await shuffle.click();
		const warning = page.getByText(
			'You’ve seen every other match. Next Shuffle starts a fresh pool.',
			{ exact: true },
		);
		await expect(warning).toBeVisible();
		const before = await ids();
		const visit = await page
			.locator('.play-next')
			.getAttribute('data-play-next-visit');
		const mode = await page.locator('.play-next__mode').textContent();
		const card = cards.first();
		const title = (await card.getByRole('heading').textContent()) ?? '';
		const play = card.getByRole('button', { name: 'Play this' });
		await page.route('**/api/games/*/play-status', async (route) => {
			await route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'forced e2e failure' }),
			});
		});

		await play.click();

		await expect(page).toHaveURL('/play-next');
		await expect(page.getByTestId('toast')).toContainText(
			`Couldn’t update ${title}. Try again.`,
		);
		expect(await ids()).toEqual(before);
		await expect(warning).toBeVisible();
		await expect(page.locator('.play-next__mode')).toHaveText(mode ?? '');
		expect(
			await page.locator('.play-next').getAttribute('data-play-next-visit'),
		).toBe(visit);
		await expect(play).toBeFocused();
		await trigger.click();
		await expect(
			page.getByRole('button', { name: 'Different' }),
		).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: 'Close Tune the picks' }).click();

		await shuffle.click();
		const after = await ids();
		expect(after.length).toBeGreaterThan(0);
		expect(after.every((id) => !before.includes(id))).toBe(true);
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});

test('Shuffle exhausts unseen picks, preserves warning through details, then resets in one click', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	// Two eligible baseline games are always present, yielding five total.
	const games = Array.from({ length: 3 }, (_, index) =>
		createGame({
			title: `Shuffle ${index} ${run}`,
			genres: [`Shuffle Genre ${index} ${run}`],
			criticScore: 90 - index,
			criticScoreCount: 50,
			tracking: { boughtOn: `202${index}-01-01` },
		}),
	);
	try {
		await seedGames(games);
		await page.goto('/play-next');
		const cards = page.locator('[data-play-next-game-id]');
		const ids = () =>
			cards.evaluateAll((nodes) =>
				nodes.map((node) => node.getAttribute('data-play-next-game-id')),
			);
		await expect(cards).toHaveCount(3);
		const initial = await ids();
		const shuffle = page.getByRole('button', { name: 'SHUFFLE', exact: true });
		expect((await shuffle.boundingBox())?.height).toBeGreaterThanOrEqual(44);

		await shuffle.click();

		await expect(cards).toHaveCount(2);
		const exhausted = await ids();
		expect(exhausted.every((id) => !initial.includes(id))).toBe(true);
		const warning = page.getByText(
			'You’ve seen every other match. Next Shuffle starts a fresh pool.',
			{ exact: true },
		);
		await expect(warning).toBeVisible();
		await expect(page.getByTestId('live-region')).toHaveText(
			'2 suggestions ready.',
		);
		await expect(shuffle).toBeFocused();

		await cards
			.first()
			.getByRole('button', { name: /Open details —/ })
			.click();
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Close details' })
			.click();
		await expect(cards).toHaveCount(2);
		expect(await ids()).toEqual(exhausted);
		await expect(warning).toBeVisible();

		await shuffle.click();

		await expect(cards).toHaveCount(3);
		const fresh = await ids();
		expect(fresh.every((id) => !exhausted.includes(id))).toBe(true);
		await expect(warning).toHaveCount(0);
		await expect(shuffle).toBeFocused();

		const visit = await page
			.locator('.play-next')
			.getAttribute('data-play-next-visit');
		await page.getByRole('link', { name: 'SHELF' }).click();
		await page.getByRole('link', { name: 'PLAY NEXT' }).click();
		await expect(warning).toHaveCount(0);
		expect(
			await page.locator('.play-next').getAttribute('data-play-next-visit'),
		).not.toBe(visit);
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});

test('zero unseen picks keep the slate and arm the next one-click reset', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	// Two eligible baseline games plus four seeded games yield two full slates.
	const games = Array.from({ length: 4 }, (_, index) =>
		createGame({
			title: `Zero pool ${index} ${run}`,
			criticScore: 90 - index,
			criticScoreCount: 50,
			tracking: { boughtOn: `202${index}-01-01` },
		}),
	);
	try {
		await seedGames(games);
		await page.goto('/play-next');
		const cards = page.locator('[data-play-next-game-id]');
		const ids = () =>
			cards.evaluateAll((nodes) =>
				nodes.map((node) => node.getAttribute('data-play-next-game-id')),
			);
		const shuffle = page.getByRole('button', {
			name: 'SHUFFLE',
			exact: true,
		});
		const warning = page.getByText(
			'You’ve seen every other match. Next Shuffle starts a fresh pool.',
			{ exact: true },
		);
		await expect(cards).toHaveCount(3);
		const initial = await ids();

		await shuffle.click();
		await expect(cards).toHaveCount(3);
		const second = await ids();
		expect(second.every((id) => !initial.includes(id))).toBe(true);
		await expect(warning).toHaveCount(0);

		await shuffle.click();
		expect(await ids()).toEqual(second);
		await expect(warning).toBeVisible();
		await expect(page.getByTestId('live-region')).toHaveText(
			'0 new suggestions ready. Current picks kept.',
		);
		await expect(shuffle).toBeFocused();

		await shuffle.click();
		const fresh = await ids();
		expect(fresh.every((id) => !second.includes(id))).toBe(true);
		await expect(warning).toHaveCount(0);
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});

test('Shuffle uses applied Tune intent and ignores a dismissed draft', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const quick = Array.from({ length: 12 }, (_, index) =>
		createGame({
			title: `Applied Quick ${index} ${run}`,
			genres: [`Quick ${index} ${run}`],
			ttbStorySeconds: (index + 2) * 3600,
			criticScore: 80 - index,
			criticScoreCount: 40,
			tracking: { boughtOn: `202${index % 6}-01-01` },
		}),
	);
	const long = createGame({
		title: `Dismissed Draft Long ${run}`,
		genres: [`Long ${run}`],
		ttbStorySeconds: 80 * 3600,
		criticScore: 100,
		criticScoreCount: 100,
		tracking: { boughtOn: '2019-01-01' },
	});
	const games = [...quick, long];
	try {
		await seedGames(games);
		await page.goto('/play-next');
		const cards = page.locator('[data-play-next-game-id]');
		const initial = await cards.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute('data-play-next-game-id')),
		);
		const trigger = page.locator('.tune-trigger');
		await trigger.click();
		await page.getByRole('button', { name: 'Quick win' }).click();
		await page.getByRole('button', { name: 'SHOW ME 3' }).click();
		const applied = await cards.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute('data-play-next-game-id')),
		);
		await trigger.click();
		await page.getByRole('button', { name: 'Different' }).click();
		await page.getByRole('button', { name: 'Close Tune the picks' }).click();

		await page.getByRole('button', { name: 'SHUFFLE', exact: true }).click();

		await expect(page.locator('.play-next__mode')).toHaveText('QUICK WIN');
		await expect(cards).toHaveCount(3);
		const shuffled = await cards.evaluateAll((nodes) =>
			nodes.map((node) => ({
				id: node.getAttribute('data-play-next-game-id'),
				title: node.querySelector('h2')?.textContent ?? '',
			})),
		);
		expect(
			shuffled.every(
				({ id }) => !initial.includes(id) && !applied.includes(id),
			),
		).toBe(true);
		expect(
			shuffled.every(({ title }) => title.startsWith('Applied Quick')),
		).toBe(true);
		await trigger.click();
		await expect(
			page.getByRole('button', { name: 'Different' }),
		).toHaveAttribute('aria-pressed', 'true');
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});

test('desktop recommendation cards match the Shelf grid track width and spacing', async ({
	page,
}) => {
	const games = candidates(randomUUID().slice(0, 8));
	try {
		await seedGames(games);
		await page.goto('/play-next');
		const playNextCards = page.locator('[data-play-next-game-id]');
		await expect(playNextCards).toHaveCount(3);
		const playNextBoxes = await playNextCards.evaluateAll((nodes) =>
			nodes.map((node) => {
				const rect = node.getBoundingClientRect();
				return { left: rect.left, right: rect.right, width: rect.width };
			}),
		);
		const playNextGridBox = await page
			.locator('.play-next__grid')
			.boundingBox();
		const playNextGap = await page
			.locator('.play-next__grid')
			.evaluate((grid) => getComputedStyle(grid).columnGap);
		const playNextGapPx = Number.parseFloat(playNextGap);
		expect(
			Math.max(...playNextBoxes.map(({ width }) => width)) -
				Math.min(...playNextBoxes.map(({ width }) => width)),
		).toBeLessThan(1);
		expect(
			(playNextGridBox?.x ?? 0) +
				(playNextGridBox?.width ?? 0) -
				playNextBoxes[2].right,
		).toBeGreaterThanOrEqual(playNextBoxes[0].width + playNextGapPx - 1);
		expect(
			await page.evaluate(
				() =>
					document.documentElement.scrollWidth <=
					document.documentElement.clientWidth,
			),
		).toBe(true);

		await page.getByRole('link', { name: 'SHELF' }).click();
		const shelfCard = page.locator('.shelf__grid .card').first();
		await expect(shelfCard).toBeVisible();
		const shelfCardWidth = (await shelfCard.boundingBox())?.width;
		const shelfGap = await page
			.locator('.shelf__grid')
			.evaluate((grid) => getComputedStyle(grid).columnGap);

		expect(shelfCardWidth).toBeDefined();
		expect(
			Math.abs(playNextBoxes[0].width - (shelfCardWidth ?? 1)),
		).toBeLessThan(1);
		expect(playNextGap).toBe(shelfGap);

		await page.getByRole('link', { name: 'CATALOG' }).click();
		const catalogCard = page.locator('.catalog__grid .catalog-card').first();
		await expect(catalogCard).toBeVisible();
		const catalogCardWidth = (await catalogCard.boundingBox())?.width;
		const catalogGap = await page
			.locator('.catalog__grid')
			.evaluate((grid) => getComputedStyle(grid).columnGap);
		expect(catalogCardWidth).toBeDefined();
		expect(
			Math.abs(playNextBoxes[0].width - (catalogCardWidth ?? 1)),
		).toBeLessThan(1);
		expect(playNextGap).toBe(catalogGap);
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
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/play-next');
		const shuffle = page.getByRole('button', { name: 'SHUFFLE', exact: true });
		const tune = page.locator('.tune-trigger');
		const [shuffleBox, tuneBox] = await Promise.all([
			shuffle.boundingBox(),
			tune.boundingBox(),
		]);
		expect(shuffleBox?.height).toBeGreaterThanOrEqual(44);
		expect(tuneBox?.height).toBeGreaterThanOrEqual(44);
		expect(Math.abs((shuffleBox?.y ?? 0) - (tuneBox?.y ?? 0))).toBeLessThan(2);
		expect(
			(shuffleBox?.x ?? 321) + (shuffleBox?.width ?? 0),
		).toBeLessThanOrEqual(tuneBox?.x ?? 0);
		const transitionMs = await shuffle.evaluate((node) => {
			const duration = getComputedStyle(node).transitionDuration;
			return duration.endsWith('ms')
				? Number.parseFloat(duration)
				: Number.parseFloat(duration) * 1000;
		});
		expect(transitionMs).toBeLessThanOrEqual(0.001);
		const cards = page.locator('[data-play-next-game-id]');
		await expect(cards).toHaveCount(3);
		const boxes = await cards.evaluateAll((nodes) =>
			nodes.map((node) => {
				const rect = node.getBoundingClientRect();
				return { top: rect.top, left: rect.left, width: rect.width };
			}),
		);
		expect(Math.abs(boxes[1].top - boxes[0].top)).toBeLessThan(2);
		expect(boxes[1].left - (boxes[0].left + boxes[0].width)).toBe(12);
		expect(boxes[1].width).toBe(boxes[0].width);
		expect(boxes[2].top).toBeGreaterThan(boxes[0].top);
		expect(boxes[2].left).toBe(boxes[0].left);
		expect(boxes[2].width).toBe(boxes[0].width);
		for (const button of await cards.getByRole('button').all()) {
			expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
		}
		const navBox = await page
			.getByRole('navigation', { name: 'Destination' })
			.boundingBox();
		expect(navBox?.x ?? 321).toBeGreaterThanOrEqual(0);
		expect((navBox?.x ?? 0) + (navBox?.width ?? 321)).toBeLessThanOrEqual(320);
		for (const control of await page.locator('button:visible').all()) {
			const box = await control.boundingBox();
			expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
		}
		expect(
			await page.evaluate(
				() =>
					document.documentElement.scrollWidth <=
					document.documentElement.clientWidth,
			),
		).toBe(true);
		expect(
			await page
				.locator('.play-next__grid')
				.evaluate((grid) => getComputedStyle(grid).display),
		).toBe('grid');
		const playNextGap = await page
			.locator('.play-next__grid')
			.evaluate((grid) => getComputedStyle(grid).columnGap);
		await page.getByRole('link', { name: 'SHELF' }).click();
		await expect(page.locator('.shelf__grid .card').first()).toBeVisible();
		expect(
			await page
				.locator('.shelf__grid')
				.evaluate((grid) => getComputedStyle(grid).columnGap),
		).toBe(playNextGap);
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
		await expect(dialog.getByText(/Confidence/)).toHaveCount(0);
		await expect(dialog.getByRole('button', { name: 'Safe bet' })).toHaveCount(
			0,
		);
		await expect(dialog.getByRole('button', { name: 'Wildcard' })).toHaveCount(
			0,
		);
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
		const [inactiveTriggerBox, inactiveLabelBox] = await Promise.all([
			trigger.boundingBox(),
			trigger.locator('.tune-trigger__label').boundingBox(),
		]);
		if (!inactiveTriggerBox || !inactiveLabelBox) {
			throw new Error('inactive Tune trigger geometry unavailable');
		}
		expect(
			Math.abs(
				inactiveTriggerBox.x +
					inactiveTriggerBox.width / 2 -
					(inactiveLabelBox.x + inactiveLabelBox.width / 2),
			),
		).toBeLessThan(1);
		await trigger.click();
		const dialog = page.getByRole('dialog', { name: 'Tune the picks' });
		await expect(dialog.getByText(/Confidence/)).toHaveCount(0);
		await expect(dialog.getByRole('button', { name: 'Safe bet' })).toHaveCount(
			0,
		);
		await expect(dialog.getByRole('button', { name: 'Wildcard' })).toHaveCount(
			0,
		);
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
		await trigger.click();
		await page.getByRole('button', { name: 'Familiar' }).click();
		await page.getByRole('button', { name: 'SHOW ME 3' }).click();
		const badge = trigger.locator('.tune-trigger__count');
		await expect(trigger).toHaveAccessibleName('Tune the picks — 1 active');
		await expect(badge).toBeVisible();
		const [triggerBox, labelBox, badgeBox, shuffleBox] = await Promise.all([
			trigger.boundingBox(),
			trigger.locator('.tune-trigger__label').boundingBox(),
			badge.boundingBox(),
			page.getByRole('button', { name: 'SHUFFLE', exact: true }).boundingBox(),
		]);
		if (!triggerBox || !labelBox || !badgeBox || !shuffleBox) {
			throw new Error('active Tune command geometry unavailable');
		}
		expect(
			Math.abs(
				triggerBox.x + triggerBox.width / 2 - (labelBox.x + labelBox.width / 2),
			),
		).toBeLessThan(1);
		expect(triggerBox.x).toBe(inactiveTriggerBox.x);
		expect(triggerBox.width).toBe(inactiveTriggerBox.width);
		expect(badgeBox.width).toBeGreaterThan(0);
		expect(badgeBox.height).toBeGreaterThan(0);
		expect(badgeBox.x).toBeGreaterThanOrEqual(shuffleBox.x + shuffleBox.width);
		expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(320);
		expect(badgeBox.x).toBeGreaterThanOrEqual(labelBox.x + labelBox.width);
		expect(
			await page.evaluate(
				() =>
					document.documentElement.scrollWidth <=
					document.documentElement.clientWidth,
			),
		).toBe(true);
		await expect(badge).toHaveText('1');
	} finally {
		await deleteGames(games.map((game) => game.id));
	}
});
