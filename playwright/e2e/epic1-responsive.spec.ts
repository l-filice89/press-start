import { randomUUID } from 'node:crypto';
import { createGame } from '../support/factories/game-factory';
import { d1Execute, deleteGames, seedGames, sq } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

/**
 * Epic 1 backfill (story 2.5.2, TR-2): responsive deltas + hit areas in the
 * phone/desktop viewport pair — the retro-named jsdom blind spots (1.5c,
 * 1.5g, 1.7a genres-desktop-only). Breakpoint is 600px (Card genres).
 */

const PHONE = { width: 375, height: 667 };
const DESKTOP = { width: 1280, height: 800 };

test('genres show on desktop and hide on phone (1.7a / 1.5c)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const game = createGame({
		title: `Genre Carrier ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	const genreId = `genre-${run}`;
	const genreName = `E2E Genre ${run}`;
	try {
		await seedGames([game]);
		await d1Execute(
			`INSERT INTO genre (id, name) VALUES (${sq(genreId)}, ${sq(genreName)});`,
			`INSERT INTO game_genre (game_id, genre_id) VALUES (${sq(game.id)}, ${sq(genreId)});`,
		);
		await page.setViewportSize(DESKTOP);
		await page.goto('/');
		const card = page.getByTestId('shelf-card').filter({ hasText: game.title });
		await expect(card.getByText(genreName)).toBeVisible();

		await page.setViewportSize(PHONE);
		await expect(card.getByText(genreName)).toBeHidden();
	} finally {
		try {
			await deleteGames([game.id]);
		} finally {
			await d1Execute(`DELETE FROM genre WHERE id = ${sq(genreId)};`);
		}
	}
});

test('owned toggle hit area is at least 44x44 in both viewports (1.5g)', async ({
	page,
}) => {
	for (const viewport of [PHONE, DESKTOP]) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		const toggle = page
			.getByTestId('shelf-card')
			.filter({ hasText: 'Baseline Alpha' })
			.getByTestId('card-owned-toggle');
		await toggle.scrollIntoViewIfNeeded(); // elementFromPoint needs on-screen coords
		await expect(toggle).toBeVisible();
		// The visual chip is 22px; the tap-expander ::before overlay projects
		// the 44px hit area, invisible to boundingBox(). Prove it functionally:
		// cardinal points just inside the 44px boundary must hit the toggle.
		// (Corner diagonals are clipped by the cover's border-radius — known
		// ceiling, logged in deferred work.)
		const hit = await toggle.evaluate((el) => {
			const { left, top, width, height } = el.getBoundingClientRect();
			const cx = left + width / 2;
			const cy = top + height / 2;
			const probes: Array<[number, number]> = [
				[cx - 21.9, cy],
				[cx + 21.9, cy],
				[cx, cy - 21.9],
				[cx, cy + 21.9],
			];
			return probes.map(
				([x, y]) =>
					el.contains(document.elementFromPoint(x, y)) ||
					document.elementFromPoint(x, y) === el,
			);
		});
		expect(hit, `44px probe hits at ${viewport.width}px`).toEqual([
			true,
			true,
			true,
			true,
		]);
	}
});

test('phone viewport never scrolls sideways', async ({ page }) => {
	// A long title is the trigger: `.card__title` is `white-space: nowrap`, so a
	// bare `1fr` track floors at the untruncated title's width and drags the
	// whole page past the viewport. Short-titled fixtures can't reproduce it.
	const game = createGame({
		title: `Marvels Spider Man Miles Morales Ultimate Launch Edition ${randomUUID().slice(0, 8)}`,
	});
	try {
		await seedGames([game]);
		await page.setViewportSize(PHONE);
		await page.goto('/');
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: game.title }),
		).toBeVisible();

		const { scrollWidth, clientWidth } = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}));
		expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
	} finally {
		await deleteGames([game.id]);
	}
});

test('phone Add bar sits inside the viewport, above the pinned search', async ({
	page,
}) => {
	await page.setViewportSize(PHONE);
	await page.goto('/');
	const search = page.getByPlaceholder('Search your library');
	await search.fill('Some Unowned Title');
	const add = page.getByTestId('search-add-option');
	await expect(add).toBeVisible();
	// Search is bottom-pinned on phone: the Add bar hangs above it, not below
	// the viewport's bottom edge (where it was unreachable).
	const box = (await add.boundingBox()) as { y: number; height: number };
	expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
});

test('phone viewport grid renders 2-up (1.5c)', async ({ page }) => {
	await page.setViewportSize(PHONE);
	await page.goto('/');
	const grid = page.getByTestId('shelf-grid');
	await expect(grid).toBeVisible();
	// Real layout: at 375px the grid resolves to exactly 2 columns
	const columns = await grid.evaluate(
		(el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
	);
	expect(columns).toBe(2);
});
