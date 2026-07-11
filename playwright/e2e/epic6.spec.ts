import { randomUUID } from 'node:crypto';
import { d1Query, deleteGames } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

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
