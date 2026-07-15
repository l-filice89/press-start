import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { createGame, type SeedGame } from '../support/factories/game-factory';
import {
	d1Execute,
	d1Query,
	deleteGames,
	seedGame,
} from '../support/helpers/d1';
import { loadAllPages } from '../support/helpers/shelf';
import { expect, test } from '../support/merged-fixtures';

const cardFor = (page: Page, game: SeedGame) =>
	page.getByTestId('shelf-card').filter({ hasText: game.title });

/**
 * Open a game's detail by searching for it. The redesign (2026-07-12) dropped
 * the suggestion dropdown — search now filters the shelf grid, so open the card
 * directly. A bare search reaches the whole library (hidden included), so this
 * works for completed/dropped games too (scope rule).
 */
async function openDetailBySearch(page: Page, game: SeedGame) {
	const search = page.getByRole('searchbox', { name: 'Search your library' });
	await search.fill(game.title);
	await page
		.getByRole('button', { name: `Open details — ${game.title}` })
		.click();
	await expect(page.getByTestId('detail-panel')).toBeVisible();
}

/**
 * Story 6.1 (FR-41/42/43): add a game by name from the persistent search bar.
 * The e2e env has NO IGDB credentials (.dev.vars.e2e), so the preview
 * degrades to the name-only path deliberately — the IGDB-prefill half is
 * pinned in Vitest (`igdb.test.ts` wire rows + `games.test.ts` integration).
 * See playwright/COVERAGE.md → Epic 6.
 */

test('searching an existing game narrows the shelf, still offers ＋ Add (FF fix), and the card opens detail — no duplicate (6.1a)', async ({
	page,
}) => {
	await page.goto('/');
	const search = page.getByRole('searchbox', { name: 'Search your library' });
	await search.fill('Baseline Alpha');

	// The card is filtered into view…
	const cardAlpha = cardFor(page, { title: 'Baseline Alpha' } as SeedGame);
	await expect(cardAlpha).toBeVisible();
	// …AND the pinned ＋ Add bar is STILL present even though a game matches —
	// the redesign's fix (the old zero-matches-only Add row couldn't reach a
	// name that other titles matched, e.g. "Final Fantasy").
	await expect(page.getByTestId('search-add-option')).toBeVisible();

	// Opening the card (not a dropdown option) shows its detail; nothing created.
	await page
		.getByRole('button', { name: 'Open details — Baseline Alpha' })
		.click();
	const panel = page.getByTestId('detail-panel');
	await expect(panel).toBeVisible();
	await expect(
		panel.getByRole('heading', { name: 'Baseline Alpha' }),
	).toBeVisible();
	const rows = await d1Query<{ n: number }>(
		"SELECT COUNT(*) AS n FROM game WHERE title = 'Baseline Alpha'",
	);
	expect(rows[0].n).toBe(1);
});

test('add-by-name: ＋ Add row → editable preview → Save → toast → on the shelf (6.1b/c/e)', async ({
	page,
}) => {
	const title = `Added By Name ${randomUUID().slice(0, 8)}`;
	await page.goto('/');
	const search = page.getByRole('searchbox', { name: 'Search your library' });
	await search.fill(title);

	// The pinned Add bar under the field routes to the add-by-name preview.
	const addRow = page.getByTestId('search-add-option');
	await expect(addRow).toBeVisible();
	await expect(addRow).toHaveText(`＋ Add “${title}”`);
	await addRow.click();

	const dialog = page.getByTestId('add-game-dialog');
	await expect(dialog).toBeVisible();
	// Pre-filled with the typed name, everything editable; the e2e env has no
	// IGDB creds so the name-only notice shows (NFR-4 degradation).
	await expect(dialog.getByLabel('Title')).toHaveValue(title);
	await expect(dialog.getByRole('status')).toHaveText(/Games DB unavailable/);

	// The CTA names the outcome and follows the owned toggle (FR-43).
	const cta = dialog.getByRole('button', { name: 'Add to wishlist' });
	await expect(cta).toBeVisible();
	await dialog.getByLabel('I own this game').check();
	await expect(
		dialog.getByRole('button', { name: 'Add as owned' }),
	).toBeVisible();
	await dialog.getByLabel('I own this game').uncheck();

	// Nothing persisted before Save.
	const before = await d1Query<{ n: number }>(
		`SELECT COUNT(*) AS n FROM game WHERE title = '${title}'`,
	);
	expect(before[0].n).toBe(0);

	await cta.click();

	// Toast confirms; the game appears on the shelf without a reload (FR-41).
	await expect(
		page.getByTestId('toast').getByText(`${title} — added to wishlist`),
	).toBeVisible();
	await expect(
		page.getByRole('gridcell', { name: new RegExp(title) }),
	).toBeVisible();

	// Saved with FR-43 wishlist defaults, flagged unenriched (name-only).
	const saved = await d1Query<{
		id: string;
		unenriched: number;
		owned: number;
		play_status: string;
		wishlisted_on: string | null;
	}>(
		`SELECT g.id, g.unenriched, t.owned, t.play_status, t.wishlisted_on
		 FROM game g JOIN game_tracking t ON t.game_id = g.id
		 WHERE g.title = '${title}'`,
	);
	expect(saved).toHaveLength(1);
	expect(saved[0].unenriched).toBe(1);
	expect(saved[0].owned).toBe(0);
	expect(saved[0].play_status).toBe('Not started');
	expect(saved[0].wishlisted_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);

	await deleteGames([saved[0].id]);
});

/**
 * Story 6.5 (+ 2026-07-12 redesign): free-text shelf search. Typing narrows the
 * VISIBLE shelf grid by normalized title substring (case/diacritic-insensitive).
 * There is no suggestion dropdown — the grid is the one result surface; a pinned
 * ＋ Add bar under the field is the sole Add entry point.
 */
test('shelf search narrows the visible grid by normalized title substring (6.5a)', async ({
	page,
}) => {
	// An accent in the title + a plain-ASCII needle proves the case/diacritic fold.
	const game = createGame({
		title: `Pokémon Zephyr ${randomUUID().slice(0, 8)}`,
		tracking: { owned: true, playStatus: 'Playing' },
	});
	try {
		await seedGame(game);
		await page.goto('/');
		await expect(cardFor(page, game)).toBeVisible();
		// A baseline game is in the default visible set to start with.
		const baseline = page
			.getByTestId('shelf-card')
			.filter({ hasText: 'Baseline Alpha' });
		await expect(baseline).toBeVisible();

		const search = page.getByRole('searchbox', { name: 'Search your library' });
		await search.fill('pokemon zephyr');

		// The visible grid narrows to the accented match; the baseline card drops.
		await expect(cardFor(page, game)).toBeVisible();
		await expect(baseline).toHaveCount(0);
	} finally {
		await deleteGames([game.id]);
	}
});

test('a shelf search matching nothing shows NO MATCH and still offers ＋ Add (6.5b)', async ({
	page,
}) => {
	const term = `zzz no shelf match ${randomUUID().slice(0, 8)}`;
	await page.goto('/');
	await expect(page.getByTestId('shelf-card').first()).toBeVisible();

	const search = page.getByRole('searchbox', { name: 'Search your library' });
	await search.fill(term);

	// The visible shelf empties to the NO MATCH state. The ＋ Add path is no
	// longer duplicated inside the empty state (redesign 2026-07-12) — it lives
	// in the single pinned bar under the search field, present for any term.
	const emptyState = page.getByTestId('empty-state');
	await expect(emptyState.getByText('NO MATCH')).toBeVisible();
	await expect(emptyState.getByRole('button')).toHaveCount(0);
	const addRow = page.getByTestId('search-add-option');
	await expect(addRow).toHaveText(`＋ Add “${term}”`);

	await addRow.click();
	await expect(page.getByTestId('add-game-dialog')).toBeVisible();
	// Nothing is saved — close the preview without committing.
	await page.getByRole('button', { name: 'Cancel' }).click();
});

test('clearing the shelf search restores the full visible shelf (6.5c)', async ({
	page,
}) => {
	const game = createGame({
		title: `Restorable Search ${randomUUID().slice(0, 8)}`,
		tracking: { owned: true, playStatus: 'Playing' },
	});
	try {
		await seedGame(game);
		await page.goto('/');
		const baseline = page
			.getByTestId('shelf-card')
			.filter({ hasText: 'Baseline Alpha' });
		await expect(baseline).toBeVisible();

		const search = page.getByRole('searchbox', { name: 'Search your library' });
		await search.fill('restorable search');
		await expect(cardFor(page, game)).toBeVisible();
		await expect(baseline).toHaveCount(0);

		// Clearing the input restores every default-visible card.
		await search.fill('');
		await expect(baseline).toBeVisible();
		await expect(cardFor(page, game)).toBeVisible();
	} finally {
		await deleteGames([game.id]);
	}
});

test('stragglers: amber banner surfaces both kinds, the dialog lists them, and a resolve attempt degrades without IGDB creds (6.2)', async ({
	page,
}) => {
	// An import staging row (kind (a)) and a name-only unenriched game (kind (b)).
	const importId = randomUUID();
	const importTitle = `E2E Import ${importId.slice(0, 8)}`;
	const nameOnly = createGame({
		title: `E2E Name Only ${randomUUID().slice(0, 8)}`,
		tracking: { owned: false, playStatus: 'Not started' },
	});
	await d1Execute(
		`INSERT INTO import_straggler (id, source_title, notion_payload) VALUES ('${importId}', '${importTitle}', '{}');`,
	);
	await seedGame(nameOnly);
	await d1Execute(
		`UPDATE game SET unenriched = 1 WHERE id = '${nameOnly.id}';`,
	);

	await page.goto('/');

	// Amber "enrich" banner (distinct from the sync 'stragglers' variant).
	const banner = page.getByTestId('attention-banner-enrich');
	await expect(banner).toBeVisible();
	await banner.getByRole('button', { name: 'Resolve' }).click();

	const dialog = page.getByTestId('stragglers-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText(importTitle)).toBeVisible();
	await expect(dialog.getByText(nameOnly.title)).toBeVisible();

	// Discard is offered only on a name-only (unenriched) row — an import staging
	// row is not a game (no tracking to flag), so its row carries no Discard.
	const importRow = dialog
		.locator('.stragglers__row')
		.filter({ hasText: importTitle });
	await expect(importRow.getByRole('button', { name: 'Discard' })).toHaveCount(
		0,
	);
	const nameOnlyRow = dialog
		.locator('.stragglers__row')
		.filter({ hasText: nameOnly.title });
	await expect(
		nameOnlyRow.getByRole('button', { name: 'Discard' }),
	).toBeVisible();

	// Pick one → the dialog auto-searches the games DB; e2e carries no IGDB
	// creds, so the search returns nothing and says so (NFR-4). The actual
	// IGDB pick + resolve is pinned in integration (stragglers.test.ts).
	await dialog.getByRole('button', { name: 'Find a match' }).first().click();
	await expect(dialog.getByText(/No games-DB match found/)).toBeVisible();

	await d1Execute(`DELETE FROM import_straggler WHERE id = '${importId}';`);
	await deleteGames([nameOnly.id]);
});

test('rematch (PV-4): the detail panel offers "Wrong match?" → opens the games-DB picker seeded with the title, degrading without IGDB creds', async ({
	page,
}) => {
	const game = createGame({
		title: `Rematch Target ${randomUUID().slice(0, 8)}`,
		tracking: { owned: true, playStatus: 'Playing' },
	});
	try {
		await seedGame(game);
		await page.goto('/');
		await openDetailBySearch(page, game);

		// The correction entry point lives in the detail header.
		await page
			.getByTestId('detail-panel')
			.getByRole('button', { name: 'Wrong match?' })
			.click();

		// The picker opens seeded with the current title and auto-searches; e2e
		// carries no IGDB creds, so it degrades to the no-match notice (NFR-4).
		// The actual rematch write is pinned in integration (games.test.ts).
		const dialog = page.getByTestId('rematch-dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('textbox')).toHaveValue(game.title);
		await expect(dialog.getByText(/No games-DB match found/)).toBeVisible();

		// Back returns to the still-open detail panel (no write).
		await dialog.getByRole('button', { name: 'Back' }).click();
		await expect(dialog).toBeHidden();
		await expect(page.getByTestId('detail-panel')).toBeVisible();
	} finally {
		await deleteGames([game.id]);
	}
});

test('discard: "Remove from library" closes the panel, drops the card, and Undo revives it', async ({
	page,
}) => {
	const game = createGame({
		title: `Discard Detail ${randomUUID().slice(0, 8)}`,
		tracking: { owned: false, playStatus: 'Not started' },
	});
	try {
		await seedGame(game);
		await page.goto('/');
		await openDetailBySearch(page, game);

		await page
			.getByTestId('detail-panel')
			.getByRole('button', { name: 'Remove from library' })
			.click();

		// The panel closes itself (the card is about to unmount) and the card
		// leaves the shelf on refetch.
		await expect(page.getByTestId('detail-panel')).toBeHidden();
		const toast = page
			.getByTestId('toast')
			.getByText(`${game.title} — removed from library`);
		await expect(toast).toBeVisible();
		await toast.hover(); // pause the 6s undo timer
		await expect(cardFor(page, game)).toHaveCount(0);

		// Undo revives the tombstone; the card comes back.
		await page
			.getByTestId('toast')
			.getByRole('button', { name: 'Undo', exact: true })
			.evaluate((el) => (el as HTMLElement).click());
		await loadAllPages(page);
		await expect(cardFor(page, game)).toBeVisible();
	} finally {
		await deleteGames([game.id]);
	}
});

test('discard: re-adding a discarded game by name revives it (no duplicate row)', {
	// Reviving is driven by the add-by-name duplicate path, which answers 409
	// by design (FR-42) — an expected response, not a failure. Opt this test
	// out of the network-error monitor, same as other error-behavior specs.
	annotation: [{ type: 'skipNetworkMonitoring' }],
}, async ({ page }) => {
	const title = `Revive Readd ${randomUUID().slice(0, 8)}`;
	const game = createGame({
		title,
		tracking: { owned: false, playStatus: 'Not started' },
	});
	try {
		await seedGame(game);
		// Pre-discard it directly (the discard UI is covered above) so this test
		// isolates the re-add revive path.
		await d1Execute(
			`UPDATE game_tracking SET discarded = 1 WHERE game_id = '${game.id}';`,
		);
		await page.goto('/');
		await expect(cardFor(page, game)).toHaveCount(0);

		// The pinned ＋ Add bar is present for any typed term; re-adding the name
		// revives the tombstone server-side (409 → opens the existing game).
		const search = page.getByRole('searchbox', { name: 'Search your library' });
		await search.fill(title);
		await page.getByTestId('search-add-option').click();
		const dialog = page.getByTestId('add-game-dialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Add to wishlist' }).click();

		// Server revives the tombstone and reports a duplicate; the client opens
		// its detail and the card is back — with no second game row.
		await expect(
			page.getByTestId('toast').getByText('Already in your library.'),
		).toBeVisible();
		await expect(
			page.getByTestId('detail-panel').getByRole('heading', { name: title }),
		).toBeVisible();
		const rows = await d1Query<{ n: number }>(
			`SELECT COUNT(*) AS n FROM game WHERE title = '${title}'`,
		);
		expect(rows[0].n).toBe(1);
	} finally {
		await deleteGames([game.id]);
	}
});

test('discard: the stragglers dialog discards a name-only mistake', async ({
	page,
}) => {
	const nameOnly = createGame({
		title: `Straggler Discard ${randomUUID().slice(0, 8)}`,
		tracking: { owned: false, playStatus: 'Not started' },
	});
	try {
		await seedGame(nameOnly);
		await d1Execute(
			`UPDATE game SET unenriched = 1 WHERE id = '${nameOnly.id}';`,
		);
		await page.goto('/');

		await page
			.getByTestId('attention-banner-enrich')
			.getByRole('button', { name: 'Resolve' })
			.click();
		const dialog = page.getByTestId('stragglers-dialog');
		const row = dialog
			.locator('.stragglers__row')
			.filter({ hasText: nameOnly.title });
		await expect(row).toBeVisible();

		await row.getByRole('button', { name: 'Discard' }).click();
		await expect(
			page.getByTestId('toast').getByText(`${nameOnly.title} — removed`),
		).toBeVisible();

		// The tombstone is set; the game is gone from the library surfaces.
		const rows = await d1Query<{ discarded: number }>(
			`SELECT discarded FROM game_tracking WHERE game_id = '${nameOnly.id}'`,
		);
		expect(rows[0].discarded).toBe(1);
	} finally {
		await deleteGames([nameOnly.id]);
	}
});

test('stragglers: Ignore an import row is confirm-gated and hard-deletes the staging row', async ({
	page,
}) => {
	const importId = randomUUID();
	const importTitle = `E2E Ignore ${importId.slice(0, 8)}`;
	await d1Execute(
		`INSERT INTO import_straggler (id, source_title, notion_payload) VALUES ('${importId}', '${importTitle}', '{}');`,
	);
	try {
		await page.goto('/');
		await page
			.getByTestId('attention-banner-enrich')
			.getByRole('button', { name: 'Resolve' })
			.click();
		const dialog = page.getByTestId('stragglers-dialog');
		const row = dialog
			.locator('.stragglers__row')
			.filter({ hasText: importTitle });
		await expect(row).toBeVisible();

		// Ignore is confirm-gated (hard delete, no undo). Cancel writes nothing.
		await row.getByRole('button', { name: 'Ignore' }).click();
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(row).toBeVisible();
		let rows = await d1Query<{ n: number }>(
			`SELECT COUNT(*) AS n FROM import_straggler WHERE id = '${importId}'`,
		);
		expect(rows[0].n).toBe(1);

		// Confirm → the row drops and the staging row is gone from D1. Scope the
		// confirm button to the gate (the row's Ignore shares the label).
		await row.getByRole('button', { name: 'Ignore' }).click();
		await page
			.getByTestId('confirm-backdrop')
			.getByRole('button', { name: 'Ignore' })
			.click();
		await expect(
			page.getByTestId('toast').getByText(`${importTitle} — ignored`),
		).toBeVisible();
		await expect(row).toHaveCount(0);
		rows = await d1Query<{ n: number }>(
			`SELECT COUNT(*) AS n FROM import_straggler WHERE id = '${importId}'`,
		);
		expect(rows[0].n).toBe(0);
	} finally {
		await d1Execute(`DELETE FROM import_straggler WHERE id = '${importId}';`);
	}
});

test('Export CSV: the FAB item downloads the library as a CSV file (6.3)', async ({
	page,
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Chores' }).click();

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('fab-export').click(),
	]);
	expect(download.suggestedFilename()).toBe('press-start-library.csv');
	// The body is real CSV, not an error payload saved under a .csv name.
	const content = await readFile((await download.path()) as string, 'utf-8');
	expect(content.startsWith('Title,State,')).toBe(true);
});

test('Settings: About/Help is available; sign-out lives in the header (6.3)', async ({
	page,
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();
	const panel = page.getByTestId('settings-panel');
	await expect(panel.getByText(/About & Help/)).toBeVisible();
	// One sign-out entry point, the header's (deferred-work triage 2026-07-13).
	// The affordance only — CLICKING it revokes the one shared storage-state
	// session and every parallel test 401s off the shelf.
	await expect(panel.getByTestId('settings-sign-out')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
});

/**
 * Story 6.4: ownership source (purchased vs claimed) + un-claim on cancel.
 * Serial because the "I cancelled PS+" action un-owns EVERY membership row for
 * the single shared e2e user — running these in parallel would let one test's
 * cancel nuke another's in-flight claim. Each cleans up its own games.
 */
test.describe('Story 6.4 ownership source', () => {
	test.describe.configure({ mode: 'serial' });

	test('owning a PS+ game prompts buy-vs-claim; "Claimed with PS+" writes owned_via=membership (6.4a)', async ({
		page,
	}) => {
		const game = createGame({
			title: `PS+ Claim ${randomUUID().slice(0, 8)}`,
			psPlusExtra: true,
			tracking: { owned: false, ownedVia: null, playStatus: 'Not started' },
		});
		try {
			await seedGame(game);
			await page.goto('/');
			await page.getByRole('button', { name: `Owned — ${game.title}` }).click();

			// The ambiguous own opens the source prompt — nothing written yet.
			const dialog = page.getByTestId('ownership-source-dialog');
			await expect(dialog).toBeVisible();
			await dialog.getByRole('button', { name: 'Claimed with PS+' }).click();
			await expect(dialog).toBeHidden();
			// The dialog closes on CLICK, not on the write landing: the ownership PUT
			// is still in flight. The owned toast fires in the mutation's onSuccess,
			// so it is the write's completion signal — without it this D1 read races
			// the PUT and flakes under full-suite load (Story 9.5; its "Purchased"
			// sibling below was fixed this way already).
			await expect(
				page.getByTestId('toast').getByText(`${game.title} — owned`),
			).toBeVisible();

			const rows = await d1Query<{ owned: number; owned_via: string | null }>(
				`SELECT owned, owned_via FROM game_tracking WHERE game_id = '${game.id}'`,
			);
			expect(rows[0].owned).toBe(1);
			expect(rows[0].owned_via).toBe('membership');
		} finally {
			await deleteGames([game.id]);
		}
	});

	test('owning a PS+ game via "Purchased" writes owned_via=purchase and stamps bought_on (6.4a)', async ({
		page,
	}) => {
		const game = createGame({
			title: `PS+ Buy ${randomUUID().slice(0, 8)}`,
			psPlusExtra: true,
			tracking: { owned: false, ownedVia: null, playStatus: 'Not started' },
		});
		try {
			await seedGame(game);
			await page.goto('/');
			await page.getByRole('button', { name: `Owned — ${game.title}` }).click();

			const dialog = page.getByTestId('ownership-source-dialog');
			await expect(dialog).toBeVisible();
			await dialog.getByRole('button', { name: 'Purchased' }).click();
			await expect(dialog).toBeHidden();
			// The owned toast fires in the mutation's onSuccess — wait for it so the
			// D1 read below can't race the write's fetch (flaky under CI load).
			await expect(
				page.getByTestId('toast').getByText(`${game.title} — owned`),
			).toBeVisible();

			const rows = await d1Query<{
				owned_via: string | null;
				bought_on: string | null;
			}>(
				`SELECT owned_via, bought_on FROM game_tracking WHERE game_id = '${game.id}'`,
			);
			expect(rows[0].owned_via).toBe('purchase');
			expect(rows[0].bought_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		} finally {
			await deleteGames([game.id]);
		}
	});

	test('owning a non-PS+ game is silent — no prompt, owned_via=purchase (6.4b)', async ({
		page,
	}) => {
		const game = createGame({
			title: `Plain Own ${randomUUID().slice(0, 8)}`,
			psPlusExtra: false,
			tracking: { owned: false, ownedVia: null, playStatus: 'Not started' },
		});
		try {
			await seedGame(game);
			await page.goto('/');
			await page.getByRole('button', { name: `Owned — ${game.title}` }).click();

			// No prompt for a non-catalog game — it writes straight through.
			await expect(page.getByTestId('ownership-source-dialog')).toHaveCount(0);
			await expect(
				page.getByTestId('toast').getByText(`${game.title} — owned`),
			).toBeVisible();
			const rows = await d1Query<{ owned_via: string | null }>(
				`SELECT owned_via FROM game_tracking WHERE game_id = '${game.id}'`,
			);
			expect(rows[0].owned_via).toBe('purchase');
		} finally {
			await deleteGames([game.id]);
		}
	});

	test('detail panel states the source: "Owned · via PS+" for a claim, "Owned · purchased" otherwise (6.4c)', async ({
		page,
	}) => {
		const claim = createGame({
			title: `Src Claim ${randomUUID().slice(0, 8)}`,
			tracking: {
				owned: true,
				ownedVia: 'membership',
				playStatus: 'Not started',
			},
		});
		const bought = createGame({
			title: `Src Bought ${randomUUID().slice(0, 8)}`,
			tracking: {
				owned: true,
				ownedVia: 'purchase',
				playStatus: 'Not started',
			},
		});
		try {
			await seedGame(claim);
			await seedGame(bought);
			await page.goto('/');

			await openDetailBySearch(page, claim);
			await expect(page.getByTestId('detail-owned-via')).toHaveText(
				'Owned · via PS+',
			);
			await page.getByRole('button', { name: 'Close details' }).click();

			await openDetailBySearch(page, bought);
			await expect(page.getByTestId('detail-owned-via')).toHaveText(
				'Owned · purchased',
			);
		} finally {
			await deleteGames([claim.id, bought.id]);
		}
	});

	test('detail "I bought this" upgrades a PS+ claim to a purchase, stamping bought_on (6.4c)', async ({
		page,
	}) => {
		const claim = createGame({
			title: `Upgrade Claim ${randomUUID().slice(0, 8)}`,
			tracking: {
				owned: true,
				ownedVia: 'membership',
				playStatus: 'Not started',
			},
		});
		try {
			await seedGame(claim);
			await page.goto('/');
			await openDetailBySearch(page, claim);
			await expect(page.getByTestId('detail-owned-via')).toHaveText(
				'Owned · via PS+',
			);

			await page
				.getByRole('button', { name: 'I bought this — mark as purchased' })
				.click();

			// The source line flips to purchased without a reload…
			await expect(page.getByTestId('detail-owned-via')).toHaveText(
				'Owned · purchased',
			);
			// …and the row is now a purchase with a stamped bought_on.
			const rows = await d1Query<{
				owned_via: string | null;
				bought_on: string | null;
			}>(
				`SELECT owned_via, bought_on FROM game_tracking WHERE game_id = '${claim.id}'`,
			);
			expect(rows[0].owned_via).toBe('purchase');
			expect(rows[0].bought_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		} finally {
			await deleteGames([claim.id]);
		}
	});

	// Moved here from `epic4-settings.spec.ts` (Story 9.5): it seeds a membership
	// row, and 6.4d's cancel un-owns EVERY membership row of the shared e2e user.
	// Serial mode is per-FILE, so from another file the cancel raced this claim
	// and wiped it mid-assert.
	test('a game owned via PS+ claim carries the PS+ tag on its card (FR-9 amended)', async ({
		page,
	}) => {
		const claimed = createGame({
			title: `PS+ Tag Claim ${randomUUID().slice(0, 8)}`,
			tracking: { owned: true, ownedVia: 'membership', playStatus: 'Playing' },
		});
		const bought = createGame({
			title: `PS+ Tag Buy ${randomUUID().slice(0, 8)}`,
			tracking: { owned: true, ownedVia: 'purchase', playStatus: 'Playing' },
		});
		try {
			await seedGame(claimed);
			await seedGame(bought);
			await page.goto('/');

			await expect(cardFor(page, claimed)).toBeVisible();
			await expect(
				cardFor(page, claimed).getByTestId('card-owned-via-membership'),
			).toHaveText(/PS\+/);

			// A purchase shows the plain OWNED chip — no subscription tag.
			await expect(cardFor(page, bought)).toBeVisible();
			await expect(
				cardFor(page, bought).getByTestId('card-owned-via-membership'),
			).toHaveCount(0);
		} finally {
			await deleteGames([claimed.id, bought.id]);
		}
	});

	test('Settings "I cancelled PS+" un-owns claimed rows and leaves ps_plus_extra to the catalog (6.4d)', async ({
		page,
	}) => {
		// `ps_plus_extra` is the CACHE of `ps_plus_catalog`, maintained for every
		// tracked game (Story 7.1) — owned ones included. So cancel writes NOTHING to
		// it: an Extra claim already carries `true` (its pill returns the moment it is
		// un-owned), and an ESSENTIAL monthly claim — not in the Extra catalog at all —
		// must NOT be handed one (Epic 7 cross-story review, H2: cancel used to force
		// the flag true, so an Essential game wore the ◈ PS+ pill, counted in the PS+
		// filter and exported as `yes` for up to a month).
		const claim = createGame({
			title: `Cancel Claim ${randomUUID().slice(0, 8)}`,
			psPlusExtra: true,
			tracking: {
				owned: true,
				ownedVia: 'membership',
				playStatus: 'Not started',
			},
		});
		const essential = createGame({
			title: `Cancel Essential ${randomUUID().slice(0, 8)}`,
			psPlusExtra: false,
			tracking: {
				owned: true,
				ownedVia: 'membership',
				playStatus: 'Not started',
			},
		});
		try {
			await seedGame(claim);
			await seedGame(essential);
			await page.goto('/');
			await page.getByRole('button', { name: 'Settings' }).click();

			// The section copy names the claim count; the button is a plain command
			// and the confirm re-states the count before acting.
			const cancel = page.getByTestId('cancel-ps-plus');
			await expect(cancel).toBeEnabled();
			await expect(cancel).toHaveText('I cancelled PS+');
			await expect(
				page.getByText(/\d+ games? claimed with PS\+/),
			).toBeVisible();
			await cancel.click();
			await page.getByRole('button', { name: 'Un-own claims' }).click();

			// The Extra claim is un-owned (ownership only) and keeps the flag the
			// catalog gave it — so its pill re-shows.
			const rowOf = (gameId: string) =>
				d1Query<{
					owned: number;
					owned_via: string | null;
					ps_plus_extra: number;
				}>(
					`SELECT t.owned, t.owned_via, g.ps_plus_extra
					 FROM game_tracking t JOIN game g ON g.id = t.game_id
					 WHERE t.game_id = '${gameId}'`,
				).then((rows) => rows[0]);

			await expect
				.poll(() => rowOf(claim.id))
				.toEqual({ owned: 0, owned_via: null, ps_plus_extra: 1 });
			// …and the Essential claim is un-owned with its flag UNTOUCHED: cancelling
			// a subscription does not put a game into the Extra catalog.
			await expect
				.poll(() => rowOf(essential.id))
				.toEqual({ owned: 0, owned_via: null, ps_plus_extra: 0 });
		} finally {
			await deleteGames([claim.id, essential.id]);
		}
	});
});

test('Settings: FAB handedness moves the button and persists across a reload (6.3)', async ({
	page,
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByTestId('handedness-left').click();
	// The FAB moves to the left immediately.
	await expect(page.getByTestId('fab')).toHaveClass(/fab--left/);

	await page.reload();
	await expect(page.getByTestId('fab')).toHaveClass(/fab--left/);

	// Reset to the default so a shared-DB sibling test isn't left left-handed.
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByTestId('handedness-right').click();
	await expect(page.getByTestId('fab')).not.toHaveClass(/fab--left/);
});

/**
 * Story 6.6 (PV-6): correct a wrong IGDB auto-match BEFORE the row exists.
 * The e2e env has no IGDB creds, so the preview + search responses are stubbed
 * (justified interception, the epic1-shelf pattern) — the wire shapes are
 * Vitest-pinned in `igdb.test.ts` / `games.test.ts`. Everything else is real:
 * the picker, the draft overwrite, the trap stacking and the D1 write.
 */
test('add: "Not the right game?" picks a different match, overwrites the draft, and saves the picked igdbId (6.6)', async ({
	page,
}) => {
	const title = `Picker Corrected ${randomUUID().slice(0, 8)}`;
	const wrong = {
		igdbId: '900001',
		name: `${title} (the wrong one)`,
		coverUrl: null,
		releaseDate: '2004-06-28',
		genres: ['Platform'],
	};
	const right = {
		igdbId: '900002',
		name: `${title} Remastered`,
		coverUrl: null,
		releaseDate: '2023-10-20',
		genres: ['Adventure'],
	};

	await page.route(
		(url) => url.pathname === '/api/games/preview',
		(route) => route.fulfill({ json: { available: true, candidate: wrong } }),
	);
	await page.route(
		(url) => url.pathname === '/api/games/search',
		(route) => route.fulfill({ json: { candidates: [wrong, right] } }),
	);

	try {
		await page.goto('/');
		await page
			.getByRole('searchbox', { name: 'Search your library' })
			.fill(title);
		await page.getByTestId('search-add-option').click();

		const dialog = page.getByTestId('add-game-dialog');
		await expect(dialog.getByLabel('Title')).toHaveValue(wrong.name);

		// Correct the match: the stacked picker lists both candidates.
		await dialog.getByTestId('add-game-rematch').click();
		const picker = page.getByTestId('add-game-picker');
		await expect(picker).toBeVisible();

		// Escape closes the PICKER only — the add modal and its draft survive.
		await page.keyboard.press('Escape');
		await expect(picker).toBeHidden();
		await expect(dialog).toBeVisible();

		await dialog.getByTestId('add-game-rematch').click();
		await picker
			.getByRole('listitem')
			.filter({ hasText: right.name })
			.getByRole('button', { name: 'Use this match' })
			.click();

		// The whole draft is the picked game's now, not the auto-match's.
		await expect(picker).toBeHidden();
		await expect(dialog.getByLabel('Title')).toHaveValue(right.name);
		await expect(dialog.getByLabel('Release date')).toHaveValue('2023-10-20');
		await expect(dialog.getByLabel('Genres (comma-separated)')).toHaveValue(
			'Adventure',
		);

		await dialog.getByRole('button', { name: 'Add to wishlist' }).click();
		await expect(
			page.getByTestId('toast').getByText(`${right.name} — added to wishlist`),
		).toBeVisible();

		// Saved against the PICKED igdb id — the wrong auto-match never lands.
		const rows = await d1Query<{ external_id: string }>(
			`SELECT l.external_id FROM external_link l
			 JOIN game g ON g.id = l.game_id
			 WHERE g.title = '${right.name}' AND l.source = 'IGDB'`,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].external_id).toBe(right.igdbId);
	} finally {
		await d1Execute(
			`DELETE FROM game_tracking WHERE game_id IN (SELECT id FROM game WHERE title LIKE '${title}%');`,
		);
		await d1Execute(`DELETE FROM game WHERE title LIKE '${title}%';`);
	}
});
