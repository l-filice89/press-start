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
 * Stories 3.2/3.5 (FR-4/20/21/22 as amended 2026-07-10, UX-DR9): flag pills +
 * state-reveal pills — reveals are an EXCLUSIVE view (they replace the State
 * group; the two are mutually exclusive) — and the two deferred Epic 2 bugs
 * reveal pills make reachable (null-status UNDO, detail-panel false-close).
 * Seeds are run-unique; assertions target seeded titles, never global counts
 * (parallel workers share the e2e DB).
 */

const cardFor = (page: Page, game: SeedGame) =>
	page.getByTestId('shelf-card').filter({ hasText: game.title });

test('a reveal pill is an exclusive view: only the hidden state(s) show, states clear (FR-4/21 amended)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const dropped = createGame({
		title: `Reveal Dropped ${run}`,
		tracking: { playStatus: 'Dropped' },
	});
	const completed = createGame({
		title: `Reveal Done ${run}`,
		tracking: { playStatus: null, completedOn: '2026-01-01' },
	});
	const playing = createGame({
		title: `Reveal Live ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([dropped, completed, playing]);
		await page.goto('/');
		await loadAllPages(page);
		// Hidden by default; the live game shows.
		await expect(cardFor(page, playing)).toBeVisible();
		await expect(cardFor(page, dropped)).toHaveCount(0);

		// Start from an explicit state selection — the reveal must clear it.
		await page.getByTestId('filter-state').click();
		await page.getByRole('menuitemcheckbox', { name: 'Playing' }).click();
		await page.keyboard.press('Escape');

		const pill = page.getByTestId('filter-reveal-dropped');
		// Shape encodes behavior: the reveal pill is the dashed modifier.
		await expect(pill).toHaveClass(/filter-row__pill--reveal/);
		await expect(pill).toHaveAttribute('aria-pressed', 'false');

		await pill.click();
		await expect(pill).toHaveAttribute('aria-pressed', 'true');
		await expect(pill).toHaveAttribute('data-active', 'true');
		// The State group was replaced entirely: selection cleared, trigger plain.
		await expect(page.getByTestId('filter-state')).toHaveAccessibleName(
			'State',
		);
		await loadAllPages(page);
		// EXCLUSIVE: only the revealed hidden state — the live game is gone.
		await expect(cardFor(page, dropped)).toBeVisible();
		await expect(cardFor(page, playing)).toHaveCount(0);

		// A second reveal ORs with the first (Completed + Dropped = either).
		await page.getByTestId('filter-reveal-story-completed').click();
		await loadAllPages(page);
		await expect(cardFor(page, dropped)).toBeVisible();
		await expect(cardFor(page, completed)).toBeVisible();
		await expect(cardFor(page, playing)).toHaveCount(0);

		// Mutual exclusion, other direction: a state pick leaves the reveal view.
		await page.getByTestId('filter-state').click();
		await page.getByRole('menuitemcheckbox', { name: 'Playing' }).click();
		await page.keyboard.press('Escape');
		await expect(pill).toHaveAttribute('aria-pressed', 'false');
		await expect(
			page.getByTestId('filter-reveal-story-completed'),
		).toHaveAttribute('aria-pressed', 'false');
		await loadAllPages(page);
		await expect(cardFor(page, playing)).toBeVisible();
		await expect(cardFor(page, dropped)).toHaveCount(0);
	} finally {
		await deleteGames([dropped.id, completed.id, playing.id]);
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

test('flag selections AND with an exclusive reveal view (FR-20 amended)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const ownedDropped = createGame({
		title: `RevealAnd Owned ${run}`,
		tracking: { playStatus: 'Dropped' },
	});
	const wishDropped = createWishlistedGame({
		title: `RevealAnd Wish ${run}`,
		tracking: { playStatus: 'Dropped' },
	});
	try {
		await seedGames([ownedDropped, wishDropped]);
		await page.goto('/');
		await page.getByTestId('filter-reveal-dropped').click();
		await loadAllPages(page);
		await expect(cardFor(page, ownedDropped)).toBeVisible();
		await expect(cardFor(page, wishDropped)).toBeVisible();

		// The flag narrows the reveal view — it does not leave it.
		await page.getByTestId('filter-flag-wishlisted').click();
		await loadAllPages(page);
		await expect(cardFor(page, wishDropped)).toBeVisible();
		await expect(cardFor(page, ownedDropped)).toHaveCount(0);
		await expect(page.getByTestId('filter-reveal-dropped')).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	} finally {
		await deleteGames([ownedDropped.id, wishDropped.id]);
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
// milestone write on an already-hidden game must not fire the auto-close —
// and with the panel state hoisted to the grid (Story 3.4), the panel also
// survives the write's refetch, so this asserts stays-open DIRECTLY.
test('detail panel on a revealed hidden game stays open through a milestone write', async ({
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

		// Direct stays-open asserts (Story 3.4, AC4 + 3.2 AC-6): the panel
		// outlived the refetch, visibility never changed (hidden before and
		// after), and the milestone reads back logged.
		await expect(panel).toBeVisible();
		await expect(
			panel.getByRole('button', { name: /Story completed/ }),
		).toHaveAttribute('aria-disabled', 'true');
		// The card behind it is still on the revealed shelf as Dropped — the
		// milestone write didn't flip its state.
		await expect(cardFor(page, dropped)).toHaveAttribute(
			'aria-label',
			`${dropped.title} — Dropped`,
		);
	} finally {
		await deleteGames([dropped.id]);
	}
});
