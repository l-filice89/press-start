import { randomUUID } from 'node:crypto';
import { createGame } from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
import { loadAllPages } from '../support/helpers/shelf';
import { expect, test } from '../support/merged-fixtures';

/**
 * Story 3.3 (FR-20, UX-DR18/23/26): live filter summary sentence, NO MATCH
 * recovery, and the phone filter sheet. Seeds are run-unique; assertions
 * target seeded titles (parallel workers share the e2e DB).
 */

const PHONE = { width: 375, height: 667 };
const DESKTOP = { width: 1280, height: 800 };

test('desktop shows the inline row with a live summary of literal or/and words (UX-DR23)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const playing = createGame({
		title: `Summary Game ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([playing]);
		await page.setViewportSize(DESKTOP);
		await page.goto('/');
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: playing.title }),
		).toBeVisible();
		// Desktop: full row inline, no Filters button.
		await expect(page.getByTestId('filter-sheet-trigger')).toBeHidden();
		await expect(page.getByTestId('filter-summary')).toHaveCount(0);

		await page.getByTestId('filter-state').click();
		await page.getByRole('menuitemcheckbox', { name: 'Playing' }).click();
		await page.getByRole('menuitemcheckbox', { name: 'Paused' }).click();
		await page.keyboard.press('Escape');
		await page.getByTestId('filter-flag-owned').click();

		const summary = page.getByTestId('filter-summary');
		await expect(summary).toHaveText(
			'Showing Playing or Paused, and Owned games.',
		);
		// Connector words carry their tint classes — color redundant to the words.
		await expect(summary.locator('.filter-summary__or')).toHaveText('or');
		await expect(summary.locator('.filter-summary__and')).toHaveText('and');
	} finally {
		await deleteGames([playing.id]);
	}
});

test('NO MATCH offers Clear filters and it restores the default set (UX-DR18)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const playing = createGame({
		title: `Clear Filters ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([playing]);
		await page.setViewportSize(DESKTOP);
		await page.goto('/');
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: playing.title }),
		).toBeVisible();

		// Owned AND Wishlisted is contradictory (wishlisted = not owned) —
		// zero matches deterministically, whatever parallel workers seed.
		await page.getByTestId('filter-flag-wishlisted').click();
		await page.getByTestId('filter-flag-owned').click();
		const empty = page.getByTestId('empty-state');
		await expect(empty).toContainText('NO MATCH');

		await empty.getByRole('button', { name: 'Clear filters' }).click();
		await loadAllPages(page);
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: playing.title }),
		).toBeVisible();
		await expect(page.getByTestId('filter-summary')).toHaveCount(0);
	} finally {
		await deleteGames([playing.id]);
	}
});

test('phone: Filters button + badge opens the grouped sheet; Show N games applies (UX-DR26)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const playing = createGame({
		title: `Sheet Playing ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	const paused = createGame({
		title: `Sheet Paused ${run}`,
		tracking: { playStatus: 'Paused' },
	});
	try {
		await seedGames([playing, paused]);
		await page.setViewportSize(PHONE);
		await page.goto('/');
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: playing.title }),
		).toBeVisible();
		// Phone: the inline row is gone; one Filters button remains.
		await expect(page.getByTestId('filter-state')).toBeHidden();
		const trigger = page.getByTestId('filter-sheet-trigger');
		await expect(trigger).toBeVisible();

		await trigger.click();
		const sheet = page.getByRole('dialog', { name: 'Filters' });
		await expect(sheet).toBeVisible();
		// Groups are labeled with their logic.
		await expect(sheet).toContainText('State — any of (or)');
		await expect(sheet).toContainText('Flags — all of (and)');

		await sheet.getByRole('button', { name: 'Playing', exact: true }).click();
		await sheet.getByRole('button', { name: /^Show \d+ games?$/ }).click();
		await expect(sheet).toBeHidden();

		// Badge reflects the active count; the shelf is filtered.
		await expect(trigger).toHaveAccessibleName('Filters — 1 active');
		await loadAllPages(page);
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: playing.title }),
		).toBeVisible();
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: paused.title }),
		).toHaveCount(0);
	} finally {
		await deleteGames([playing.id, paused.id]);
	}
});
