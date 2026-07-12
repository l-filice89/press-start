import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
	createGame,
	createWishlistedGame,
	type SeedGame,
} from '../support/factories/game-factory';
import { d1Execute, deleteGames, seedGames, sq } from '../support/helpers/d1';
import { loadAllPages } from '../support/helpers/shelf';
import { expect, test } from '../support/merged-fixtures';

/**
 * Epic 2 backfill (story 2.5.3, TR-2): the detail panel in a real browser —
 * portal geometry (~760px desktop / full-screen phone), focus trap, Escape
 * and focus return, lifecycle dates, ownership, genres, the completion
 * invariant's 409 refusal, and reduced-motion entry. playwright/COVERAGE.md
 * maps ACs. Each test seeds its own game and deletes it in finally.
 */

const PHONE = { width: 375, height: 667 };

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
	// The flip/fade entry animates a transform — boundingBox() mid-animation
	// returns the scaled box. Let the entry finish before interacting.
	await panel.evaluate((el) =>
		Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))),
	);
	return panel;
}

test('detail panel opens from the cover: ~760px centered on desktop, full-screen on phone (2.3a)', async ({
	page,
}) => {
	const game = uniqueGame('Panel Geometry');
	try {
		await seedGames([game]);
		await page.goto('/');
		let panel = await openDetail(page, game);
		await expect(
			panel.getByRole('button', { name: 'Close details' }),
		).toBeFocused();
		// "~760px centered": with panel padding the content box resolves a bit
		// narrower — pin "dialog, not full-screen" with sane bounds.
		const desktopBox = await panel.boundingBox();
		expect(desktopBox, 'panel has a bounding box').not.toBeNull();
		expect(desktopBox?.width).toBeGreaterThan(600);
		expect(desktopBox?.width).toBeLessThan(820);
		await page.keyboard.press('Escape');

		await page.setViewportSize(PHONE);
		await page.goto('/');
		panel = await openDetail(page, game);
		const phoneBox = await panel.boundingBox();
		expect(phoneBox, 'panel has a bounding box').not.toBeNull();
		// Full-screen on mobile — the real-layout delta jsdom can't see
		expect(phoneBox?.width).toBe(PHONE.width);
	} finally {
		await deleteGames([game.id]);
	}
});

test('detail panel traps focus; Escape closes and returns focus to the originating card (2.3e)', async ({
	page,
}) => {
	const game = uniqueGame('Panel Trap');
	try {
		await seedGames([game]);
		await page.goto('/');
		const panel = await openDetail(page, game);

		// Tab many times: focus must never escape the dialog
		for (let i = 0; i < 25; i++) {
			await page.keyboard.press('Tab');
			const inside = await panel.evaluate((el) =>
				el.contains(document.activeElement),
			);
			expect(inside, `focus inside panel after ${i + 1} tabs`).toBe(true);
		}

		await page.keyboard.press('Escape');
		await expect(panel).toHaveCount(0);
		// Focus returns to the originating gridcell
		await expect(cardFor(page, game)).toBeFocused();
	} finally {
		await deleteGames([game.id]);
	}
});

test('backdrop click dismisses the panel without writing (2.3e)', async ({
	page,
}) => {
	const game = uniqueGame('Backdrop Close', {
		tracking: { playStatus: 'Paused' },
	});
	try {
		await seedGames([game]);
		await page.goto('/');
		const panel = await openDetail(page, game);
		await page
			.getByTestId('detail-backdrop')
			.click({ position: { x: 10, y: 10 } });
		await expect(panel).toHaveCount(0);
		// The seeded card can sit past the progressive fold under parallel-suite
		// load (deferred-work: 3.1 parallel-flake) — page it in before asserting.
		await loadAllPages(page);
		await expect(cardFor(page, game)).toHaveAttribute(
			'aria-label',
			`${game.title} — Paused`,
		);
	} finally {
		await deleteGames([game.id]);
	}
});

test('wishlisted game links to the PS Store; owned game does not (2.3c)', async ({
	page,
}) => {
	const wished = createWishlistedGame({
		title: `Store Link ${randomUUID().slice(0, 8)}`,
		tracking: { playStatus: 'Not started' },
	});
	const owned = uniqueGame('No Store Link');
	try {
		await seedGames([wished, owned]);
		await page.goto('/');

		let panel = await openDetail(page, owned);
		await expect(
			panel.getByRole('link', { name: /View on PS Store/ }),
		).toHaveCount(0);
		await page.keyboard.press('Escape');

		// Unowned tier can sit past the progressive fold — page everything in
		// first (deferred-work: 3.1 parallel-flake); scrollIntoViewIfNeeded on an
		// unrendered locator just times out.
		await loadAllPages(page);
		await cardFor(page, wished).scrollIntoViewIfNeeded();
		panel = await openDetail(page, wished);
		await expect(
			panel.getByRole('link', { name: /View on PS Store/ }),
		).toBeVisible();
	} finally {
		await deleteGames([wished.id, owned.id]);
	}
});

test('lifecycle date commits on blur; the open panel survives the refetch (2.4c / 3.4)', async ({
	page,
}) => {
	const game = uniqueGame('Date Edit', { tracking: { playStatus: 'Paused' } });
	try {
		await seedGames([game]);
		await page.goto('/');
		const panel = await openDetail(page, game);
		const started = panel.getByLabel('Started');
		await started.fill('2026-03-15');
		await started.blur(); // DateRow commits on blur, not per keystroke
		await expect(
			page.getByTestId('toast').getByText(`${game.title} — date saved`),
		).toBeVisible();

		// Direct assert (Story 3.4): the panel outlived the write's refetch and
		// shows the committed value.
		await expect(panel).toBeVisible();
		await expect(panel.getByLabel('Started')).toHaveValue('2026-03-15');

		// One reload-based persistence check stays: the value survives a fresh
		// fetch, not just the client cache.
		await page.goto('/');
		const reopened = await openDetail(page, game);
		await expect(reopened.getByLabel('Started')).toHaveValue('2026-03-15');
	} finally {
		await deleteGames([game.id]);
	}
});

// 2.3d invariant refusal (409 on clearing the last milestone): the only game
// state that can trigger it (milestone-only, playStatus null) is hidden from
// the default shelf, and the panel closes itself whenever a write hides its
// card — the flow is unreachable until Epic 3 reveal pills. Listed as skipped
// in COVERAGE.md; the jsdom DetailPanel test pins the toast wiring.

// NOTE (Story 3.4): the open-panel state now lives at the grid level, so a
// write's refetch re-chunking the rows no longer unmounts the panel. The old
// reopen-based workaround asserts below were converted back to direct
// on-open-panel asserts — they double as the AC4 regression pins.

test('ownership: un-own offers UNDO and restores; type switches physical/digital (2.4a/2.4b)', async ({
	page,
}) => {
	const game = uniqueGame('Ownership Flow');
	try {
		await seedGames([game]);
		await page.goto('/');
		const panel = await openDetail(page, game);

		// Type pair only renders while owned
		await panel
			.getByRole('group', { name: `Ownership type for ${game.title}` })
			.getByRole('button', { name: 'digital' })
			.click();

		// Direct assert (Story 3.4): the panel survives the write's refetch and
		// reflects the persisted switch (2.4b).
		await expect(
			panel
				.getByRole('group', { name: `Ownership type for ${game.title}` })
				.getByRole('button', { name: 'digital' }),
		).toHaveAttribute('aria-pressed', 'true');

		// Un-own → UNDO toast (2.4a). Story 6.4 redesigned the panel ownership
		// control: the un-own command is now "Mark as not owned" (the old single
		// "Owned" toggle is gone — owned-ness is the "Owned · …" status text).
		await panel.getByRole('button', { name: 'Mark as not owned' }).click();
		const toast = page
			.getByTestId('toast')
			.getByText(`${game.title} — no longer owned`);
		await expect(toast).toBeVisible();
		// Pause the 6s undo timer: dispatched mouseover reaches the toast's
		// pause handler even under the panel backdrop (hover() can't — the
		// backdrop intercepts pointer actionability checks)
		await toast.dispatchEvent('mouseover');
		// Dispatch the click on the element — the sliding toast defeats
		// coordinate-based clicking
		await page
			.getByTestId('toast')
			.getByRole('button', { name: 'Undo', exact: true })
			.evaluate((el) => (el as HTMLElement).click());

		// Direct asserts (Story 3.4): the still-open panel shows the restored
		// ownership (the un-own command returns only while owned) AND the
		// previous type surviving the round trip.
		await expect(
			panel.getByRole('button', { name: 'Mark as not owned' }),
		).toBeVisible();
		await expect(
			panel
				.getByRole('group', { name: `Ownership type for ${game.title}` })
				.getByRole('button', { name: 'digital' }),
		).toHaveAttribute('aria-pressed', 'true');
	} finally {
		await deleteGames([game.id]);
	}
});

test('genres: novel name auto-creates, chip removes, no merge/rename UI (2.5a/2.5b/2.5c)', async ({
	page,
}) => {
	const game = uniqueGame('Genre Edit');
	const genreName = `E2E Novel Genre ${randomUUID().slice(0, 8)}`;
	try {
		await seedGames([game]);
		await page.goto('/');
		const panel = await openDetail(page, game);

		const input = panel.getByLabel(`Add genre to ${game.title}`);
		await input.fill(genreName);
		await panel.getByRole('button', { name: 'Add', exact: true }).click();

		// Direct assert (Story 3.4): the chip appears on the still-open panel —
		// the vocabulary row was auto-created server-side (2.5b).
		const chip = panel.getByRole('button', { name: `Remove ${genreName}` });
		await expect(chip).toBeVisible();

		// No merge/rename affordance (FR-25) — asserted on the live, populated
		// panel (chip visible above), so the absence isn't vacuous
		await expect(
			panel.getByRole('button', { name: /merge|rename/i }),
		).toHaveCount(0);
		await expect(panel.getByText(/merge|rename/i)).toHaveCount(0);

		await chip.click();
		// Direct assert: the removal lands on the still-open panel (2.5a) —
		// visibility first, so the count(0) can't pass vacuously on a detached
		// panel.
		await expect(panel).toBeVisible();
		await expect(
			panel.getByRole('button', { name: `Remove ${genreName}` }),
		).toHaveCount(0);

		// One reload-based persistence check stays: direct asserts prove the
		// live panel, this proves the server round trip.
		await page.goto('/');
		const reopened = await openDetail(page, game);
		await expect(
			reopened.getByRole('button', { name: `Remove ${genreName}` }),
		).toHaveCount(0);
	} finally {
		// allSettled: a failing game delete must not leak the vocabulary row
		// (deleteGames won't reap it — genre rows are shared vocabulary)
		await Promise.allSettled([
			deleteGames([game.id]),
			d1Execute(`DELETE FROM genre WHERE name = ${sq(genreName)};`),
		]);
	}
});

test('reduced motion swaps the flip entry for a cross-fade (2.3a / closes 1.5h)', async ({
	page,
}) => {
	const game = uniqueGame('Reduced Motion');
	try {
		await seedGames([game]);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		const panel = await openDetail(page, game);
		await expect(panel).toHaveClass(/detail-panel--fade/);
		await expect(panel).not.toHaveClass(/detail-panel--flip/);

		await page.keyboard.press('Escape');
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.goto('/');
		const flipPanel = await openDetail(page, game);
		await expect(flipPanel).toHaveClass(/detail-panel--flip/);
	} finally {
		await deleteGames([game.id]);
	}
});
