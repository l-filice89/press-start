import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { createGame, type SeedGame } from '../support/factories/game-factory';
import { d1Execute, deleteGames, seedGames, sq } from '../support/helpers/d1';
import { loadAllPages } from '../support/helpers/shelf';
import { expect, test } from '../support/merged-fixtures';
import { E2E_EMAIL, MAGIC_LINK_RE, SERVER_LOG } from '../support/server';

/**
 * Stories 3.4/3.5 (focus & interaction hardening): focus survives grid
 * re-chunks, lands deliberately when a card leaves the shelf — including when
 * the LAST visible card leaves and the grid unmounts to the empty state — and
 * the login swap takes focus into the form. Seeds are run-unique (parallel
 * workers share the DB).
 */

const cardFor = (page: Page, game: SeedGame) =>
	page.getByTestId('shelf-card').filter({ hasText: game.title });

const focusedLabel = (page: Page) =>
	page.evaluate(() => document.activeElement?.getAttribute('aria-label'));

test('keyboard focus survives a viewport resize that re-chunks the ARIA rows (AC1)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	// Enough owned Playing games to guarantee multiple columns and row shifts.
	const games = Array.from({ length: 6 }, (_, i) =>
		createGame({
			title: `Refocus ${String.fromCharCode(65 + i)} ${run}`,
			tracking: { playStatus: 'Playing' },
		}),
	);
	try {
		await seedGames(games);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/');
		await loadAllPages(page);
		const target = cardFor(page, games[3]);
		await target.scrollIntoViewIfNeeded();
		// Programmatic focus fires the grid's focus-capture, syncing the roving
		// index exactly like a user's pointer/keyboard focus would.
		await target.focus();
		await expect(target).toBeFocused();

		// Crossing a column boundary re-buckets every row (1280px auto-fill →
		// ~600px is a different column count) — the focused card remounts.
		await page.setViewportSize({ width: 620, height: 800 });
		await expect
			.poll(() => focusedLabel(page), {
				message: 'focus restored to the same card after the re-chunk',
			})
			.toContain(games[3].title);

		await page.setViewportSize({ width: 1280, height: 800 });
		await expect.poll(() => focusedLabel(page)).toContain(games[3].title);
	} finally {
		await deleteGames(games.map((g) => g.id));
	}
});

test('focus lands on a neighbor after Dropped removes the focused card; UNDO is Tab-reachable (AC3)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const first = createGame({
		title: `Neighbor A ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	const second = createGame({
		title: `Neighbor B ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([first, second]);
		await page.goto('/');
		const card = cardFor(page, first);
		await expect(card).toBeVisible();
		await card.focus();

		// Drop it via the keyboard path: Enter → pill, Enter → menu, pick Dropped.
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page
			.getByTestId('status-menu')
			.getByRole('menuitemradio', { name: 'Dropped' })
			.click();
		const toast = page.getByTestId('toast');
		await expect(toast.getByText(`${first.title} — Dropped`)).toBeVisible();
		await toast.hover(); // pause the undo timer
		await expect(card).toHaveCount(0);

		// Focus landed on a shelf card (a deliberate target), not <body>.
		const landed = await page.evaluate(
			() => document.activeElement?.getAttribute('data-testid') ?? null,
		);
		expect(landed).toBe('shelf-card');

		// (WHICH neighbor is the clamped-index contract, pinned in jsdom
		// Shelf.test.tsx — parallel workers' cards interleave here.)

		// From there the toast's UNDO is keyboard-reachable: a bounded number
		// of Tabs leaves the grid's single stop and reaches the Undo button.
		let reachedUndo = false;
		for (let i = 0; i < 10 && !reachedUndo; i++) {
			await page.keyboard.press('Tab');
			reachedUndo =
				(await page.evaluate(
					() => (document.activeElement as HTMLElement | null)?.textContent,
				)) === 'Undo';
		}
		expect(reachedUndo).toBe(true);
	} finally {
		await deleteGames([first.id, second.id]);
	}
});

// HAZARD (Story 3.5; the 3.4 AC3 boundary): dropping the LAST visible card
// unmounts ShelfGrid entirely — its restore effect dies with it, so the
// FilteredShelf-level handoff must land focus on the empty state's Clear
// filters, never <body>. A run-unique genre makes "last visible card"
// deterministic under parallel workers.
test('focus hands off to Clear filters when the last visible card leaves the shelf (Story 3.5)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const genre = `Focus Genre ${run}`;
	const genreId = randomUUID();
	const only = createGame({
		title: `LastCard ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	try {
		await seedGames([only]);
		await d1Execute(
			`INSERT INTO genre (id, name) VALUES (${sq(genreId)}, ${sq(genre)});`,
			`INSERT INTO game_genre (game_id, genre_id) VALUES (${sq(only.id)}, ${sq(genreId)});`,
		);
		await page.goto('/');
		await expect(cardFor(page, only)).toBeVisible();

		// Narrow to the run-unique genre: this card is the whole visible set.
		await page.getByTestId('filter-genre').click();
		await page.getByRole('menuitemcheckbox', { name: genre }).click();
		await page.keyboard.press('Escape');
		const card = cardFor(page, only);
		await expect(card).toBeVisible();
		await card.focus();

		// Drop the focused (and last visible) card via the keyboard path.
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page
			.getByTestId('status-menu')
			.getByRole('menuitemradio', { name: 'Dropped' })
			.click();

		// The grid unmounted to NO MATCH — focus landed on Clear filters.
		const empty = page.getByTestId('empty-state');
		await expect(empty).toContainText('NO MATCH');
		await expect(
			empty.getByRole('button', { name: 'Clear filters' }),
		).toBeFocused();
	} finally {
		await d1Execute(`DELETE FROM genre WHERE id = ${sq(genreId)};`);
		await deleteGames([only.id]);
	}
});

test.describe('login swap (AC2)', () => {
	// A fresh, disposable session (auth-journey pattern): signing THIS session
	// out must not revoke the shared storage-state session other workers use.
	test.use({ storageState: { cookies: [], origins: [] } });

	test('signing out moves focus into the login form and announces the swap', async ({
		page,
	}) => {
		await page.goto('/');
		const email = page.getByRole('textbox', { name: /magic link/i });
		await expect(email).toBeVisible();
		// Cold load already takes focus into the form — the same mount effect
		// the gate swap exercises.
		await expect(email).toBeFocused();

		// Sign in via the console-captured magic link (no real email).
		const offset = readFileSync(SERVER_LOG, 'utf8').length;
		await email.fill(E2E_EMAIL);
		await page.getByRole('button', { name: /sign-in link/i }).click();
		let link: string | undefined;
		await expect
			.poll(
				() => {
					const tail = readFileSync(SERVER_LOG, 'utf8').slice(offset);
					link = [...tail.matchAll(new RegExp(MAGIC_LINK_RE.source, 'g'))].map(
						(m) => m[1],
					)[0];
					return link;
				},
				{ message: 'magic link in server log', timeout: 15_000 },
			)
			.toBeDefined();
		if (!link) throw new Error('unreachable: poll resolved without a link');
		await page.goto(link);
		await expect(page.getByTestId('shelf-grid')).toBeVisible();

		// The swap under test: sign out → focus lands in the form, announced.
		await page.getByRole('button', { name: /Sign out/ }).click();
		const emailAgain = page.getByRole('textbox', { name: /magic link/i });
		await expect(emailAgain).toBeVisible();
		await expect(emailAgain).toBeFocused();
		await expect(page.getByTestId('live-region')).toHaveText(
			/Sign in with your email to continue\./,
		);
	});
});
