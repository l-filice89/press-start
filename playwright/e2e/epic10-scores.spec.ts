import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { createGame, type SeedGame } from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

/**
 * Story 10.1 (VR-5): critic & user scores render on the card and the detail
 * view from STORED data (the shelf payload — no IGDB call happens here), with
 * sample counts in the detail view, and an unscored game shows NO score area
 * (never a zero). playwright/COVERAGE.md maps the ACs.
 */

// Hades' real captured values (probe 2026-07-16) — floats on the wire,
// rounded at render: ◎ 94 / ★ 89.
const SCORED = {
	criticScore: 93.52941176470588,
	criticScoreCount: 17,
	userScore: 89.47202036710553,
	userScoreCount: 1699,
};

function uniqueGame(
	prefix: string,
	overrides: Parameters<typeof createGame>[0] = {},
): SeedGame {
	return createGame({
		title: `${prefix} ${randomUUID().slice(0, 8)}`,
		...overrides,
	});
}

const cardFor = (page: Page, game: SeedGame) =>
	page.getByTestId('shelf-card').filter({ hasText: game.title });

async function openDetail(page: Page, game: SeedGame) {
	await cardFor(page, game).getByTestId('card-cover-button').click();
	const panel = page.getByTestId('detail-panel');
	await expect(panel).toBeVisible();
	await panel.evaluate((el) =>
		Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))),
	);
	return panel;
}

test('a scored game shows rounded critic + user scores on its card (10.1c)', async ({
	page,
}) => {
	const game = uniqueGame('Scored Card', { ...SCORED });
	try {
		await seedGames([game]);
		await page.goto('/');
		const scores = cardFor(page, game).getByTestId('card-scores');
		await expect(scores).toContainText('◎ 94');
		await expect(scores).toContainText('★ 89');
	} finally {
		await deleteGames([game.id]);
	}
});

test('the detail view shows both scores WITH their sample counts (10.1c)', async ({
	page,
}) => {
	const game = uniqueGame('Scored Detail', { ...SCORED });
	try {
		await seedGames([game]);
		await page.goto('/');
		const panel = await openDetail(page, game);
		const section = panel.getByTestId('detail-scores');
		await expect(section).toContainText('94');
		await expect(section).toContainText('Critics (17 reviews)');
		await expect(section).toContainText('89');
		await expect(section).toContainText('Players (1699 ratings)');
	} finally {
		await deleteGames([game.id]);
	}
});

test('an unscored game renders NO score — scores block absent, no detail section, no zero (10.1d)', async ({
	page,
}) => {
	const game = uniqueGame('Unscored');
	try {
		await seedGames([game]);
		await page.goto('/');
		// Compaction (2026-07-16): no facts → no block at all, not a blank line.
		const card = cardFor(page, game);
		await expect(card).toBeVisible();
		await expect(card.getByTestId('card-scores')).toHaveCount(0);
		const panel = await openDetail(page, game);
		await expect(panel.getByTestId('detail-scores')).toHaveCount(0);
	} finally {
		await deleteGames([game.id]);
	}
});

test('cards keep a uniform height whether or not facts render (strip-level reservation)', async ({
	page,
}) => {
	const full = uniqueGame('Full Facts', {
		...SCORED,
		ttbStorySeconds: 54000,
		ttbCompleteSeconds: 95400,
		ttbCount: 8,
	});
	const bare = uniqueGame('Bare Facts');
	try {
		await seedGames([full, bare]);
		await page.goto('/');
		// Measure the INFO STRIPS, not the cards: the shelf grid stretches
		// every card in a row to the row height, so card boxes equalize even
		// with the min-height rule deleted (review — tautology guard). The
		// strip keeps its own height and only the CSS floor makes them equal.
		const fullInfo = await cardFor(page, full)
			.locator('.card__info')
			.boundingBox();
		const bareInfo = await cardFor(page, bare)
			.locator('.card__info')
			.boundingBox();
		expect(fullInfo?.height).toBeGreaterThan(0);
		expect(bareInfo?.height).toBe(fullInfo?.height);
	} finally {
		await deleteGames([full.id, bare.id]);
	}
});

test('time-to-beat hours show on card and detail, story vs 100% labelled (10.3c)', async ({
	page,
}) => {
	const game = uniqueGame('Timed Game', {
		...SCORED,
		ttbStorySeconds: 54000,
		ttbCompleteSeconds: 95400,
		ttbCount: 8,
	});
	try {
		await seedGames([game]);
		await page.goto('/');
		const scores = cardFor(page, game).getByTestId('card-scores');
		// Stacked lines (2026-07-16): the 100% figure is VISIBLE, no ellipsis
		// swallowing it — reviews, story, 100% each on their own line.
		await expect(scores.locator('.card__scores-line')).toHaveCount(3);
		await expect(scores).toContainText('15h story');
		await expect(scores).toContainText('27h 100%');
		await expect(scores.locator('.card__scores-line').nth(2)).toBeVisible();
		const panel = await openDetail(page, game);
		const section = panel.getByTestId('detail-scores');
		await expect(section).toContainText('Story (8 submissions)');
		await expect(section).toContainText('100%');
	} finally {
		await deleteGames([game.id]);
	}
});

test('a story-only figure renders alone — 100% absent, never substituted (10.3d)', async ({
	page,
}) => {
	const game = uniqueGame('Story Only Hours', { ttbStorySeconds: 7200 });
	try {
		await seedGames([game]);
		await page.goto('/');
		const scores = cardFor(page, game).getByTestId('card-scores');
		await expect(scores).toContainText('2h story');
		await expect(scores).not.toContainText('100%');
	} finally {
		await deleteGames([game.id]);
	}
});

test('a critic-only game shows the critic slot alone — the user slot is absent, not zero (10.1d)', async ({
	page,
}) => {
	const game = uniqueGame('Critic Only', {
		criticScore: 71.2,
		criticScoreCount: 5,
	});
	try {
		await seedGames([game]);
		await page.goto('/');
		const scores = cardFor(page, game).getByTestId('card-scores');
		await expect(scores).toContainText('◎ 71');
		await expect(scores).not.toContainText('★');
	} finally {
		await deleteGames([game.id]);
	}
});
