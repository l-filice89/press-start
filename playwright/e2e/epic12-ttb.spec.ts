import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { createGame, type SeedGame } from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
import { loadAllPages } from '../support/helpers/shelf';
import { expect, test } from '../support/merged-fixtures';

/**
 * Story 12.1 (VR-9, FR-20): the Time filter group — five half-open TTB hour
 * bands + Unknown, story/100% metric toggle. Seeds are run-unique and deleted
 * in finally; assertions target seeded titles only (parallel workers share
 * the e2e DB). Filter state is per-page client state, so workers can't
 * disturb each other's filtered view.
 */

const PHONE = { width: 375, height: 667 };

const hours = (h: number) => h * 3600;

const cardFor = (page: Page, game: SeedGame) =>
	page.getByTestId('shelf-card').filter({ hasText: game.title });

/** Open the Time dropdown and toggle one band row by its test-id key. */
async function toggleBand(page: Page, key: string): Promise<void> {
	await page.getByTestId('filter-ttb').click();
	await page.getByTestId(`filter-ttb-${key}`).click();
	await page.keyboard.press('Escape');
}

test('a Time band filters the shelf; a game at exactly 50h sits in 25–50h, never 50–75h', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const short = createGame({
		title: `TTB Short ${run}`,
		ttbStorySeconds: hours(10),
		tracking: { playStatus: 'Playing' },
	});
	const boundary = createGame({
		title: `TTB Boundary ${run}`,
		ttbStorySeconds: hours(50),
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([short, boundary]);
		await page.goto('/');
		// The shared parallel-worker DB can push a seeded title past the first
		// progressive page — reveal them all before the precondition assert.
		await loadAllPages(page);
		await expect(cardFor(page, short)).toBeVisible();

		// 25–50h: the boundary game shows (half-open upper edge), the short one leaves.
		await toggleBand(page, '25-50');
		await loadAllPages(page);
		await expect(cardFor(page, boundary)).toBeVisible();
		await expect(cardFor(page, short)).toHaveCount(0);

		// OR within the group: adding ≤25h brings the short game back too.
		await toggleBand(page, 'lte25');
		await loadAllPages(page);
		await expect(cardFor(page, boundary)).toBeVisible();
		await expect(cardFor(page, short)).toBeVisible();

		// Boundary exactness: under 50–75h alone, exactly-50h does NOT match.
		await page.getByTestId('filter-ttb').click();
		await page.getByTestId('filter-ttb-25-50').click();
		await page.getByTestId('filter-ttb-lte25').click();
		await page.getByTestId('filter-ttb-50-75').click();
		await page.keyboard.press('Escape');
		await expect(cardFor(page, boundary)).toHaveCount(0);
	} finally {
		await deleteGames([short.id, boundary.id]);
	}
});

test('the story/100% toggle re-evaluates the selected bands against the chosen metric', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	// Story 10h, 100% 60h: invisible under 50–75h on story, visible on 100%.
	const split = createGame({
		title: `TTB Split ${run}`,
		ttbStorySeconds: hours(10),
		ttbCompleteSeconds: hours(60),
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([split]);
		await page.goto('/');
		await loadAllPages(page);
		await expect(cardFor(page, split)).toBeVisible();

		await toggleBand(page, '50-75');
		await expect(cardFor(page, split)).toHaveCount(0);

		// Flip the metric to 100% inside the Time menu — the band re-aims. The
		// desktop toggle renders as menuitemradio rows in the menu's focus list.
		await page.getByTestId('filter-ttb').click();
		const toggle = page.getByTestId('filter-ttb-metric');
		await toggle.getByRole('menuitemradio', { name: '100% hours' }).click();
		await expect(
			toggle.getByRole('menuitemradio', { name: '100% hours' }),
		).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await loadAllPages(page);
		await expect(cardFor(page, split)).toBeVisible();
	} finally {
		await deleteGames([split.id]);
	}
});

test('a game missing the selected metric matches only Unknown — never a numeric band', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	// Carries ONLY the other metric: story null, 100% ≈ 55h. Owned (factory
	// default), so it survives the Owned AND below.
	const unknownStory = createGame({
		title: `TTB NoStory ${run}`,
		ttbStorySeconds: null,
		ttbCompleteSeconds: 200000,
		tracking: { playStatus: 'Playing' },
	});
	// Matches the same Unknown band but is NOT owned — the AND-across-groups
	// evidence: the Owned flag must drop it from the visible set.
	const unknownUnowned = createGame({
		title: `TTB NoStory Unowned ${run}`,
		ttbStorySeconds: null,
		tracking: { playStatus: 'Playing', owned: false },
	});
	try {
		await seedGames([unknownStory, unknownUnowned]);
		await page.goto('/');
		await loadAllPages(page);
		await expect(cardFor(page, unknownStory)).toBeVisible();
		await expect(cardFor(page, unknownUnowned)).toBeVisible();

		// Story metric (default): its 100% value must NOT leak into 50–75h.
		await toggleBand(page, '50-75');
		await expect(cardFor(page, unknownStory)).toHaveCount(0);

		// Unknown ORs both back in — and the summary narrates with literal words.
		await toggleBand(page, 'unknown');
		await loadAllPages(page);
		await expect(cardFor(page, unknownStory)).toBeVisible();
		await expect(cardFor(page, unknownUnowned)).toBeVisible();

		// AND across groups: the Owned flag joins the Time group and the actual
		// card set narrows — the un-owned Unknown game drops, the owned one stays.
		await page.getByTestId('filter-flag-owned').click();
		await loadAllPages(page);
		await expect(cardFor(page, unknownStory)).toBeVisible();
		await expect(cardFor(page, unknownUnowned)).toHaveCount(0);
		const summary = page.getByTestId('filter-summary');
		await expect(summary).toHaveText(
			'Showing 50–75h or Unknown, and Owned games.',
		);
		await expect(summary.locator('.filter-summary__or')).toHaveText('or');
		await expect(summary.locator('.filter-summary__and')).toHaveText('and');
	} finally {
		await deleteGames([unknownStory.id, unknownUnowned.id]);
	}
});

test('phone: the sheet carries the Time group with its toggle, and bands count in the badge', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const short = createGame({
		title: `TTB Sheet Short ${run}`,
		ttbStorySeconds: hours(5),
		tracking: { playStatus: 'Playing' },
	});
	const long = createGame({
		title: `TTB Sheet Long ${run}`,
		ttbStorySeconds: hours(200),
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([short, long]);
		await page.setViewportSize(PHONE);
		await page.goto('/');
		await loadAllPages(page);
		await expect(cardFor(page, short)).toBeVisible();

		const trigger = page.getByTestId('filter-sheet-trigger');
		await trigger.click();
		const sheet = page.getByRole('dialog', { name: 'Filters' });
		await expect(sheet).toContainText('Time to beat — any of (or)');
		// The metric toggle sits above the band rows, story pressed by default —
		// the sheet is NOT a menu, so its toggle stays plain aria-pressed buttons
		// with explicit "… hours" accessible names.
		await expect(
			sheet.getByTestId('filter-ttb-metric').getByRole('button', {
				name: 'Story hours',
			}),
		).toHaveAttribute('aria-pressed', 'true');

		await sheet.getByRole('button', { name: '≤25h' }).click();
		await sheet.getByRole('button', { name: /^Show \d+ games?$/ }).click();
		await expect(sheet).toBeHidden();

		// The band counts into the trigger badge; the shelf is filtered.
		await expect(trigger).toHaveAccessibleName('Filters — 1 active');
		await loadAllPages(page);
		await expect(cardFor(page, short)).toBeVisible();
		await expect(cardFor(page, long)).toHaveCount(0);
	} finally {
		await deleteGames([short.id, long.id]);
	}
});
