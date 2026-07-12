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

/** Open a game's detail via the search combobox (the add/search entry point). */
async function openDetailBySearch(page: Page, game: SeedGame) {
	const search = page.getByRole('combobox', { name: 'Search your library' });
	await search.fill(game.title);
	await page.getByRole('option', { name: game.title }).first().click();
	await expect(page.getByTestId('detail-panel')).toBeVisible();
}

/**
 * Story 6.1 (FR-41/42/43): add a game by name from the persistent search bar.
 * The e2e env has NO IGDB credentials (.dev.vars.e2e), so the preview
 * degrades to the name-only path deliberately — the IGDB-prefill half is
 * pinned in Vitest (`igdb.test.ts` wire rows + `games.test.ts` integration).
 * See playwright/COVERAGE.md → Epic 6.
 */

test('picking an existing library match opens its detail view — no duplicate (6.1a)', async ({
	page,
}) => {
	await page.goto('/');
	const search = page.getByRole('combobox', { name: 'Search your library' });
	await search.fill('Baseline Alpha');

	const option = page.getByRole('option', { name: 'Baseline Alpha' });
	await expect(option).toBeVisible();
	await option.click();

	// The detail dialog opens for that game; nothing was created.
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
	const search = page.getByRole('combobox', { name: 'Search your library' });
	await search.fill(title);

	// No library match → the one option is the Add row.
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

		// It is hidden, so search finds no library match → the ＋ Add row.
		const search = page.getByRole('combobox', { name: 'Search your library' });
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

test('Settings: sign out and About/Help are available (6.3)', async ({
	page,
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();
	const panel = page.getByTestId('settings-panel');
	await expect(panel.getByText(/About & Help/)).toBeVisible();
	// The affordance only — CLICKING sign-out revokes the one shared
	// storage-state session and every parallel test 401s off the shelf.
	// The click → onSignOut wiring is pinned in SettingsPanel.test.tsx.
	await expect(panel.getByTestId('settings-sign-out')).toBeVisible();
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
			await page
				.getByTestId('ownership-source-dialog')
				.getByRole('button', { name: 'Purchased' })
				.click();

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

	test('Settings "I cancelled PS+" un-owns claimed rows and re-shows their PS+ pill (6.4d)', async ({
		page,
	}) => {
		// A sync-ingested claim: owned from the start, so runPsPlusCheck (which only
		// flags NON-owned rows) never set its psPlusExtra. Cancel must re-flag it so
		// the pill returns once it is un-owned.
		const claim = createGame({
			title: `Cancel Claim ${randomUUID().slice(0, 8)}`,
			psPlusExtra: false,
			tracking: {
				owned: true,
				ownedVia: 'membership',
				playStatus: 'Not started',
			},
		});
		try {
			await seedGame(claim);
			await page.goto('/');
			await page.getByRole('button', { name: 'Settings' }).click();

			// The button names the claim count and confirms before acting.
			const cancel = page.getByTestId('cancel-ps-plus');
			await expect(cancel).toBeEnabled();
			await expect(cancel).toHaveText(/I cancelled PS\+ \(\d+\)/);
			await cancel.click();
			await page.getByRole('button', { name: 'Un-own claims' }).click();

			// The claim is un-owned (ownership only) and re-flagged in-catalog so
			// the pill re-shows.
			await expect
				.poll(async () => {
					const rows = await d1Query<{
						owned: number;
						owned_via: string | null;
						ps_plus_extra: number;
					}>(
						`SELECT t.owned, t.owned_via, g.ps_plus_extra
						 FROM game_tracking t JOIN game g ON g.id = t.game_id
						 WHERE t.game_id = '${claim.id}'`,
					);
					return rows[0];
				})
				.toEqual({ owned: 0, owned_via: null, ps_plus_extra: 1 });
		} finally {
			await deleteGames([claim.id]);
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
