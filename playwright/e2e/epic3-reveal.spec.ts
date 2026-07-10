import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
	createGame,
	createWishlistedGame,
	type SeedGame,
} from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
import { loadAllPages } from '../support/helpers/shelf';
import { expect, test } from '../support/merged-fixtures';

/**
 * Story 3.2 (FR-4/20/21/22, UX-DR9): flag pills + state-reveal pills, and the
 * two deferred Epic 2 bugs reveal pills make reachable (null-status UNDO,
 * detail-panel false-close). Seeds are run-unique; assertions target seeded
 * titles, never global counts (parallel workers share the e2e DB).
 */

const cardFor = (page: Page, game: SeedGame) =>
	page.getByTestId('shelf-card').filter({ hasText: game.title });

test('a reveal pill ORs its hidden state into the shelf: dashed, glows when active (FR-21/22, UX-DR9)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const dropped = createGame({
		title: `Reveal Dropped ${run}`,
		tracking: { playStatus: 'Dropped' },
	});
	try {
		await seedGames([dropped]);
		await page.goto('/');
		await loadAllPages(page);
		// Hidden by default.
		await expect(cardFor(page, dropped)).toHaveCount(0);

		const pill = page.getByTestId('filter-reveal-dropped');
		// Shape encodes behavior: the reveal pill is the dashed modifier.
		await expect(pill).toHaveClass(/filter-row__pill--reveal/);
		await expect(pill).toHaveAttribute('aria-pressed', 'false');

		await pill.click();
		await expect(pill).toHaveAttribute('aria-pressed', 'true');
		await expect(pill).toHaveAttribute('data-active', 'true');
		await loadAllPages(page);
		await expect(cardFor(page, dropped)).toBeVisible();

		// Toggling off restores the default set.
		await pill.click();
		await loadAllPages(page);
		await expect(cardFor(page, dropped)).toHaveCount(0);
	} finally {
		await deleteGames([dropped.id]);
	}
});

test('flag pills are their own AND groups: Wishlisted narrows out owned games (FR-20)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const owned = createGame({
		title: `Flag Owned ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	const wishlisted = createWishlistedGame({
		title: `Flag Wish ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([owned, wishlisted]);
		await page.goto('/');
		await expect(cardFor(page, owned)).toBeVisible();

		const pill = page.getByTestId('filter-flag-wishlisted');
		await expect(pill).toHaveClass(/filter-row__pill--flag/);
		await pill.click();
		await expect(pill).toHaveAttribute('aria-pressed', 'true');
		await loadAllPages(page);
		await expect(cardFor(page, wishlisted)).toBeVisible();
		await expect(cardFor(page, owned)).toHaveCount(0);

		// AND against the state group: adding State=Paused empties both out.
		await page.getByTestId('filter-state').click();
		await page.getByRole('menuitemcheckbox', { name: 'Paused' }).click();
		await page.keyboard.press('Escape');
		await loadAllPages(page);
		await expect(cardFor(page, wishlisted)).toHaveCount(0);
	} finally {
		await deleteGames([owned.id, wishlisted.id]);
	}
});

// HAZARD (FR-2/FR-3, deferred-work: 2.1 null-status UNDO): a revealed
// milestone-only card has a null play status. Dropping it must offer UNDO,
// and the undo restores the cleared status through the invariant write path.
test('UNDO after dropping a revealed milestone-only card restores the null status', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const milestoneOnly = createGame({
		title: `Null Undo ${run}`,
		tracking: { playStatus: null, completedOn: '2026-01-01' },
	});
	try {
		await seedGames([milestoneOnly]);
		await page.goto('/');
		await page.getByTestId('filter-reveal-story-completed').click();
		await loadAllPages(page);
		const card = cardFor(page, milestoneOnly);
		await expect(card).toHaveAttribute(
			'aria-label',
			`${milestoneOnly.title} — Story completed`,
		);

		// Drop it from the status menu; the reveal for Dropped is off, so the
		// card leaves the visible set after the refetch.
		await card.getByTestId('status-pill-button').click();
		await page
			.getByTestId('status-menu')
			.getByRole('menuitemradio', { name: 'Dropped' })
			.click();
		const toast = page.getByTestId('toast');
		await expect(
			toast.getByText(`${milestoneOnly.title} — Dropped`),
		).toBeVisible();
		await toast.hover(); // pause the toast timer
		await expect(card).toHaveCount(0);

		// UNDO restores play_status = null → effective state Story completed,
		// so the card returns under the active reveal.
		await toast
			.getByRole('button', { name: 'Undo', exact: true })
			.evaluate((el) => (el as HTMLElement).click());
		await loadAllPages(page);
		await expect(cardFor(page, milestoneOnly)).toHaveAttribute(
			'aria-label',
			`${milestoneOnly.title} — Story completed`,
		);
	} finally {
		await deleteGames([milestoneOnly.id]);
	}
});

// HAZARD (FR-4/FR-17, deferred-work: platinum-only auto-hide false-close): a
// milestone write on an already-hidden game must not fire the auto-close.
// The stays-open transition itself is jsdom-pinned (DetailPanel.test.tsx) —
// per the suite convention (epic2-detail.spec.ts NOTE), a post-write
// panel-visibility assert is unreliable until Story 3.4 hoists panel state
// out of the Card, so this test asserts the flow through a reopen instead.
// Story 3.4 converts it to a direct stays-open assert.
test('milestone write on a revealed hidden game succeeds; panel reopens with it logged', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const dropped = createGame({
		title: `Panel Hidden ${run}`,
		tracking: { playStatus: 'Dropped' },
	});
	try {
		await seedGames([dropped]);
		await page.goto('/');
		await page.getByTestId('filter-reveal-dropped').click();
		await loadAllPages(page);
		const card = cardFor(page, dropped);
		await expect(card).toBeVisible();
		// A background refetch can re-chunk the grid and remount the card —
		// retry the open if the first click lands on a remounting node.
		const panel = page.getByRole('dialog', { name: dropped.title });
		await expect(async () => {
			if (!(await panel.isVisible())) {
				await card
					.getByRole('button', { name: `Open details — ${dropped.title}` })
					.click({ timeout: 5_000 });
			}
			await expect(panel).toBeVisible({ timeout: 2_000 });
		}).toPass({ timeout: 20_000 });

		// Log Story completed: state stays Dropped (hidden before and after) and
		// the 2.3d-style flow is finally reachable via the reveal pill.
		await panel.getByRole('button', { name: /Story completed/ }).click();
		await page
			.getByRole('dialog', { name: /This is permanent/ })
			.getByRole('button', { name: 'Confirm' })
			.click();
		await expect(page.getByTestId('toast').first()).toContainText(
			`${dropped.title} — Story completed`,
		);

		// Reopen-based assert (post-write, remount-safe): the card is still on
		// the revealed shelf as Dropped, and the milestone stuck.
		await loadAllPages(page);
		await expect(cardFor(page, dropped)).toHaveAttribute(
			'aria-label',
			`${dropped.title} — Dropped`,
		);
		await expect(async () => {
			if (!(await panel.isVisible())) {
				await cardFor(page, dropped)
					.getByRole('button', { name: `Open details — ${dropped.title}` })
					.click({ timeout: 5_000 });
			}
			await expect(panel).toBeVisible({ timeout: 2_000 });
		}).toPass({ timeout: 20_000 });
		await expect(
			panel.getByRole('button', { name: /Story completed/ }),
		).toHaveAttribute('aria-disabled', 'true');
	} finally {
		await deleteGames([dropped.id]);
	}
});
