import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { createGame, type SeedGame } from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
import { loadAllPages } from '../support/helpers/shelf';
import { expect, test } from '../support/merged-fixtures';

/**
 * Epic 2 backfill (story 2.5.3, TR-2): status popover + milestone write
 * paths in a real browser — popover anchoring/viewport flip, confirm gating,
 * UNDO toasts, refetch-driven card removal. See playwright/COVERAGE.md.
 * Every test seeds its own game (never touches BASELINE_GAMES) and deletes
 * it in finally. Mutations are refetch-driven — hidden-state removal is
 * always polled, never asserted instantly.
 */

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

async function openStatusMenu(page: Page, game: SeedGame) {
	const pill = cardFor(page, game).getByTestId('status-pill-button');
	const menu = page.getByTestId('status-menu');
	// Menu open-state is grid-owned since Story 3.6 — a refetch re-chunk no
	// longer kills an OPEN menu (jsdom-pinned), so the old blind retry loop is
	// gone. What remains is a different race the loop also absorbed: a click
	// dispatched while a just-settled write's refetch COMMITS (overlapping
	// invalidations + parallel-worker DB churn = every commit is a full
	// re-chunk, and the click lands in a mid-commit DOM — trace-verified).
	// Our page only refetches on its own writes, so network quiescence is a
	// deterministic gate: after networkidle nothing is pending, no commit can
	// race the click.
	// …and under FULL-SUITE load (Story 9.5, measured across 15 runs) even that is
	// not enough: the shelf commits on its own cache invalidations too, so a click
	// can still land in a mid-commit DOM and be swallowed — the button it hit is
	// no longer in the tree, and the menu never opens. Re-CLICK rather than wait
	// longer: waiting cannot deliver an event that was already dropped.
	await page.waitForLoadState('networkidle');
	await expect(async () => {
		await pill.click();
		await expect(menu).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	return { pill, menu };
}

test('status pill opens a five-status menu; selection applies instantly with a toast (2.1a/2.1d)', async ({
	page,
}) => {
	const game = uniqueGame('Status Flow', {
		tracking: { playStatus: 'Paused' },
	});
	try {
		await seedGames([game]);
		await page.goto('/');
		const { menu } = await openStatusMenu(page, game);

		await expect(menu.getByRole('menuitemradio')).toHaveCount(5);
		await expect(
			menu.getByRole('menuitemradio', { name: 'Paused' }),
		).toHaveAttribute('aria-checked', 'true');

		// No confirm dialog for plain statuses — the click writes immediately
		await menu.getByRole('menuitemradio', { name: 'Up next' }).click();
		await expect(
			page.getByTestId('toast').getByText(`${game.title} — Up next`),
		).toBeVisible();
		// Absence asserted after the settled signal (the toast), not before
		await expect(page.getByRole('dialog')).toHaveCount(0);

		// Effective state propagates to the card after refetch (2.1d)
		await expect(cardFor(page, game)).toHaveAttribute(
			'aria-label',
			`${game.title} — Up next`,
		);
		// ...and so does the shelf ORDER: Paused→Up next moves the card into
		// the Up next tier — after Baseline Beta (alpha within tier), before
		// Baseline Gamma (Not started tier)
		const order = await page
			.getByTestId('shelf-card')
			.evaluateAll((cells) =>
				cells.map((c) => c.getAttribute('aria-label') ?? ''),
			);
		const beta = order.findIndex((l) => l.startsWith('Baseline Beta —'));
		const moved = order.findIndex((l) => l.startsWith(`${game.title} —`));
		const gamma = order.findIndex((l) => l.startsWith('Baseline Gamma —'));
		expect(moved).toBeGreaterThan(beta);
		expect(moved).toBeLessThan(gamma);
	} finally {
		await deleteGames([game.id]);
	}
});

test('status menu closes on Escape and returns focus to the pill (2.1e)', async ({
	page,
}) => {
	const game = uniqueGame('Escape Flow');
	try {
		await seedGames([game]);
		await page.goto('/');
		const { pill, menu } = await openStatusMenu(page, game);

		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(pill).toBeFocused();
	} finally {
		await deleteGames([game.id]);
	}
});

test('popover flips above the pill at the viewport bottom (2.1a anchoring)', async ({
	page,
}) => {
	const game = uniqueGame('Flip Bottom');
	try {
		await seedGames([game]);
		// Short viewport guarantees the shelf scrolls, so scrollIntoView
		// (block: 'end') really pins the card to the bottom edge even when the
		// parallel DB happens to be sparse.
		await page.setViewportSize({ width: 1280, height: 450 });
		await page.goto('/');
		const card = cardFor(page, game);
		// Position the card near the bottom edge BEFORE opening — the menu
		// closes on any outside scroll after it opens.
		await card.evaluate((el) =>
			el.scrollIntoView({ block: 'end', behavior: 'instant' }),
		);
		await card.getByTestId('status-pill-button').click();

		const menu = page.getByTestId('status-menu');
		await expect(menu).toBeVisible();
		// JS-computed anchoring (jsdom-blind): no room below → flip up
		await expect(menu).toHaveAttribute('data-flip', 'up');
	} finally {
		await deleteGames([game.id]);
	}
});

test('Dropped shows an UNDO toast, the card leaves the shelf, Undo restores it (2.1c)', async ({
	page,
}) => {
	const game = uniqueGame('Drop Undo', { tracking: { playStatus: 'Playing' } });
	try {
		await seedGames([game]);
		await page.goto('/');
		const { menu } = await openStatusMenu(page, game);
		await menu.getByRole('menuitemradio', { name: 'Dropped' }).click();

		const toast = page
			.getByTestId('toast')
			.getByText(`${game.title} — Dropped`);
		await expect(toast).toBeVisible();
		// Hovering pauses the undoable toast's 6s timer (WCAG 2.2.1) so the
		// refetch-driven removal poll below can't outlive the Undo button.
		await toast.hover();
		// Removal is refetch-driven, never instant
		await expect(cardFor(page, game)).toHaveCount(0);

		// Undo restores the previous status and the card reappears. Dispatch on
		// the element — the sliding toast defeats coordinate-based clicking.
		await page
			.getByTestId('toast')
			.getByRole('button', { name: 'Undo', exact: true })
			.evaluate((el) => (el as HTMLElement).click());
		// The restored card can reappear past the progressive fold under
		// parallel-suite load (deferred-work: 3.1 parallel-flake) — page it in.
		await loadAllPages(page);
		await expect(cardFor(page, game)).toBeVisible();
		await expect(cardFor(page, game)).toHaveAttribute(
			'aria-label',
			`${game.title} — Playing`,
		);
	} finally {
		await deleteGames([game.id]);
	}
});

test('first move to Playing stamps started_on, visible in the detail panel (2.1b)', async ({
	page,
}) => {
	const game = uniqueGame('Start Stamp', {
		tracking: { playStatus: 'Not started' },
	});
	try {
		await seedGames([game]);
		await page.goto('/');
		// The seeded card can sit past the progressive fold under parallel-suite
		// load (deferred-work: 3.1 parallel-flake) — page it in first.
		await loadAllPages(page);
		const { menu } = await openStatusMenu(page, game);
		await menu.getByRole('menuitemradio', { name: 'Playing' }).click();
		await expect(
			page.getByTestId('toast').getByText(`${game.title} — Playing`),
		).toBeVisible();
		// Wait for the refetch to land before opening the panel — the shelf
		// re-renders the card and a mid-render click can go stale.
		await loadAllPages(page);
		await expect(cardFor(page, game)).toHaveAttribute(
			'aria-label',
			`${game.title} — Playing`,
		);

		await cardFor(page, game).getByTestId('card-cover-button').click();
		const panel = page.getByTestId('detail-panel');
		await expect(panel).toBeVisible();
		const started = panel.getByLabel('Started');
		// Server stamped TODAY's date (write-once hazard, AR-11; the re-stamp
		// guard itself is server-side, Vitest-pinned). "Today" is stamped in the
		// user's captured IANA zone (Epic 2 timezone policy) — but the capture
		// itself is a fire-and-forget PUT racing this test's first write, so
		// between local midnight and UTC midnight the stamp can legitimately be
		// either calendar day. Accept both; the zone-correctness hazard itself
		// is pinned deterministically in test/integration/settings.test.ts.
		const localToday = new Intl.DateTimeFormat('en-CA', {
			dateStyle: 'short',
		}).format(new Date());
		const utcToday = new Date().toISOString().slice(0, 10);
		await expect(started).toHaveValue(
			new RegExp(`^(${localToday}|${utcToday})$`),
		);
	} finally {
		await deleteGames([game.id]);
	}
});

test('milestones are confirm-gated: Cancel writes nothing, Confirm badges the card (2.2a/2.2b/2.2d)', async ({
	page,
}) => {
	const game = uniqueGame('Milestone Gate', {
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([game]);
		await page.goto('/');

		// Round 1: open the gate and Cancel — nothing may be written
		let { pill, menu } = await openStatusMenu(page, game);
		await menu.getByRole('menuitem', { name: /Story completed/ }).click();
		const dialog = page.getByRole('dialog', { name: /This is permanent/ });
		await expect(dialog).toBeVisible();
		// Focus lands on Cancel — the safe default for a permanent action
		await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
		// The dialog traps Tab: focus never escapes across a full cycle
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('Tab');
			const inside = await dialog.evaluate((el) =>
				el.contains(document.activeElement),
			);
			expect(inside, `focus inside confirm dialog after ${i + 1} tabs`).toBe(
				true,
			);
		}
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(pill).toBeFocused(); // focus returns to the origin
		const badge = cardFor(page, game).getByText('✓');
		await expect(badge).toHaveCount(0);

		// Round 2: Confirm — badge appears, row becomes inert with the date
		({ pill, menu } = await openStatusMenu(page, game));
		await menu.getByRole('menuitem', { name: /Story completed/ }).click();
		const confirmDialog = page.getByRole('dialog', {
			name: /This is permanent/,
		});
		await confirmDialog.getByRole('button', { name: 'Confirm' }).click();
		await expect(confirmDialog).toHaveCount(0); // gate closes after confirm
		await expect(
			page.getByTestId('toast').getByText(`${game.title} — Story completed`),
		).toBeVisible();
		// Story-complete keeps the live status, so the card stays on-shelf
		// with the permanent silver badge (platinum-across-hide needs Epic 3)
		await expect(cardFor(page, game).getByText('✓')).toBeVisible();

		// 2.2d: the badge survives a later LIVE status change (across a hidden
		// state needs Epic 3 reveal pills)
		({ menu } = await openStatusMenu(page, game));
		await menu.getByRole('menuitemradio', { name: 'Paused' }).click();
		await expect(cardFor(page, game)).toHaveAttribute(
			'aria-label',
			`${game.title} — Paused`,
		);
		await expect(cardFor(page, game).getByText('✓')).toBeVisible();

		({ menu } = await openStatusMenu(page, game));
		const achieved = menu.getByRole('menuitem', { name: /Story completed/ });
		await expect(achieved).toHaveAttribute('aria-disabled', 'true');
	} finally {
		await deleteGames([game.id]);
	}
});

test('an achieved milestone re-log is refused with an already-logged toast (2.2c)', async ({
	page,
}) => {
	const game = uniqueGame('Already Logged', {
		tracking: { playStatus: 'Playing', completedOn: '2026-01-05' },
	});
	try {
		await seedGames([game]);
		await page.goto('/');
		const { menu } = await openStatusMenu(page, game);
		// The achieved row is aria-disabled (Playwright treats it unclickable);
		// force the activation — the handler answers with the refusal toast.
		await menu
			.getByRole('menuitem', { name: /Story completed/ })
			.click({ force: true });
		// Refusal toast is the settled signal; only then is dialog absence
		// meaningful ("no gate ever opened")
		await expect(
			page.getByTestId('toast').getByText(/already logged/),
		).toBeVisible();
		await expect(page.getByRole('dialog')).toHaveCount(0);
	} finally {
		await deleteGames([game.id]);
	}
});

test('platinum clears the play status and the card leaves the shelf (2.2b)', async ({
	page,
}) => {
	const game = uniqueGame('Platinum Hide', {
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([game]);
		await page.goto('/');
		const { menu } = await openStatusMenu(page, game);
		await menu.getByRole('menuitem', { name: /Platinum achieved/ }).click();
		await page
			.getByRole('dialog', { name: /This is permanent/ })
			.getByRole('button', { name: 'Confirm' })
			.click();

		await expect(
			page.getByTestId('toast').getByText(`${game.title} — Platinum achieved`),
		).toBeVisible();
		// Platinum auto-clears status → hidden effective state → refetch removes
		await expect(cardFor(page, game)).toHaveCount(0);
	} finally {
		await deleteGames([game.id]);
	}
});
