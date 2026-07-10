import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
	createGame,
	createWishlistedGame,
	type SeedGame,
} from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

/**
 * Epic 1 backfill (story 2.5.2, TR-2): the read-only shelf's behavior pinned
 * by a real layout engine. Covers 1.7a-e/g and 1.5i — see
 * playwright/COVERAGE.md for the full AC map. Tests seed their own rows with
 * unique ids/titles and delete them in finally; BASELINE_GAMES (Alpha=Playing,
 * Beta=Up next, Gamma=Not started) are read-only shared fixture.
 */

/**
 * Reveals every client page: scrolls the IntersectionObserver sentinel until
 * the shelf removes it (rendered when hasMore only — Shelf.tsx:260).
 */
async function loadAllPages(page: Page): Promise<void> {
	const cards = page.getByTestId('shelf-card');
	await expect(cards.first()).toBeVisible();
	const sentinel = page.locator('.shelf__sentinel');
	for (;;) {
		if ((await sentinel.count()) === 0) return; // no more pages
		const before = await cards.count();
		await sentinel.scrollIntoViewIfNeeded();
		await expect
			.poll(async () => (await cards.count()) > before || (await sentinel.count()) === 0, {
				message: 'next page to render after sentinel scroll',
				timeout: 10_000,
			})
			.toBe(true);
	}
}

/** aria-labels of shelf cards ("{title} — {state}"), filtered to `titles`, in DOM order. */
async function cardOrder(page: Page, titles: string[]): Promise<string[]> {
	const labels = await page
		.getByTestId('shelf-card')
		.evaluateAll((cells) => cells.map((c) => c.getAttribute('aria-label') ?? ''));
	return labels
		.map((l) => titles.find((t) => l.startsWith(`${t} —`)))
		.filter((t): t is string => t !== undefined);
}

test('shelf renders card content: title, state, OWNED chip, cover fallback, PS+ flag (1.7a)', async ({
	page,
}) => {
	// An unowned in-catalog game carries the PS+ Extra flag (owned games don't)
	const psPlus = createWishlistedGame({
		title: `Flag Carrier ${randomUUID().slice(0, 8)}`,
		psPlusExtra: true,
		tracking: { playStatus: 'Not started' },
	});
	try {
		seedGames([psPlus]);
		await page.goto('/');
		const alpha = page
			.getByTestId('shelf-card')
			.filter({ hasText: 'Baseline Alpha' });
		await expect(alpha).toHaveAttribute('aria-label', 'Baseline Alpha — Playing');
		await expect(alpha.getByText('OWNED')).toBeVisible();
		// No cover_url seeded: the fallback mark renders instead of an <img>
		await expect(alpha.getByText('▹')).toBeVisible();
		await expect(alpha.getByTestId('card-cover')).toHaveCount(0);

		await loadAllPages(page); // unowned tier can sit past the first fold
		const flagged = page
			.getByTestId('shelf-card')
			.filter({ hasText: psPlus.title });
		await expect(
			flagged.getByText('In the PlayStation Plus Extra catalog'),
		).toBeAttached();
	} finally {
		deleteGames([psPlus.id]);
	}
});

test('default shelf hides finished states and orders by state → owned → alpha (1.7b)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const paused = createGame({
		title: `Order Paused ${run}`,
		tracking: { playStatus: 'Paused' },
	});
	// Two owned Not-started games seeded in REVERSE alpha order pin the
	// alpha-within-tier rule (insertion order must not leak through)
	const notStartedZ = createGame({
		title: `Order Zeta ${run}`,
		tracking: { playStatus: 'Not started' },
	});
	const notStartedM = createGame({
		title: `Order Mid ${run}`,
		tracking: { playStatus: 'Not started' },
	});
	const wishlisted = createWishlistedGame({
		title: `A Wishlist ${run}`,
		tracking: { playStatus: 'Not started' },
	});
	const completed = createGame({
		title: `Order Completed ${run}`,
		tracking: { playStatus: null, completedOn: '2026-01-01' },
	});
	const dropped = createGame({
		title: `Order Dropped ${run}`,
		tracking: { playStatus: 'Dropped' },
	});
	const seeded = [paused, notStartedZ, notStartedM, wishlisted, completed, dropped];
	try {
		seedGames(seeded);
		await page.goto('/');
		await loadAllPages(page); // parallel seeds may push the unowned tier past page 1

		// Hidden states never render, even after full reveal
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: completed.title }),
		).toHaveCount(0);
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: dropped.title }),
		).toHaveCount(0);

		// Playing → Paused → Up next → Not started(owned, alpha) → Not started(unowned)
		const expected = [
			'Baseline Alpha',
			paused.title,
			'Baseline Beta',
			'Baseline Gamma',
			notStartedM.title, // "Order Mid" < "Order Zeta": alpha beats insertion order
			notStartedZ.title,
			wishlisted.title,
		];
		expect(await cardOrder(page, expected)).toEqual(expected);
	} finally {
		deleteGames(seeded.map((g) => g.id));
	}
});

test('infinite scroll reveals the next page when the sentinel is reached (1.7c)', async ({
	page,
}) => {
	// 49 unowned wishlisted pads sort after every owned game, so parallel
	// specs asserting on their own owned seeds stay above the fold.
	const pads: SeedGame[] = Array.from({ length: 49 }, (_, i) =>
		createWishlistedGame({
			id: `scroll-${randomUUID().slice(0, 8)}-${String(i).padStart(3, '0')}`,
			title: `Scroll Pad ${String(i).padStart(3, '0')}`,
			tracking: { playStatus: 'Not started' },
		}),
	);
	try {
		seedGames(pads);
		await page.goto('/');
		const cards = page.getByTestId('shelf-card');
		// First fold settles at exactly PAGE_SIZE (49 pads + 3 baseline > 48)
		await expect(cards).toHaveCount(48);

		await page.locator('.shelf__sentinel').scrollIntoViewIfNeeded();
		await expect.poll(() => cards.count()).toBeGreaterThan(48);
	} finally {
		deleteGames(pads.map((g) => g.id));
	}
});

test('whole-library search matches games hidden from the shelf, NO MATCH otherwise (1.7d)', async ({
	page,
}) => {
	const quarry = createGame({
		title: `Hidden Quarry ${randomUUID().slice(0, 8)}`,
		tracking: { playStatus: null, completedOn: '2026-01-01' },
	});
	try {
		seedGames([quarry]);
		await page.goto('/');
		// Shelf must have finished loading before absence proves filtering
		await expect(page.getByTestId('shelf-card').first()).toBeVisible();
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: quarry.title }),
		).toHaveCount(0);

		const search = page.getByRole('combobox', { name: 'Search your library' });
		await search.fill(quarry.title);
		await expect(
			page.getByRole('option').filter({ hasText: quarry.title }),
		).toBeVisible();

		await search.fill('zzz no such game xyzzy');
		await expect(page.getByText('NO MATCH')).toBeVisible();
	} finally {
		deleteGames([quarry.id]);
	}
});

test('empty library shows INSERT GAMES with no dead CTAs (1.7e)', async ({
	page,
}) => {
	// The shared per-run fixture is never empty, so this client-render state
	// is unreachable against real data — stub the one response (justified
	// interception per story 2.5.2 spec; the response shape is Vitest-pinned).
	await page.route('**/api/shelf', (route) =>
		route.fulfill({ json: { games: [] } }),
	);
	await page.goto('/');
	const empty = page.getByTestId('empty-state');
	await expect(empty).toContainText('INSERT GAMES');
	await expect(empty).toContainText('Sync your library or add a game');
	await expect(empty.getByRole('button')).toHaveCount(0);
	await expect(empty.getByRole('link')).toHaveCount(0);
});

test('first load shows skeletons until the shelf arrives (1.7e)', async ({
	page,
}) => {
	// Local D1 answers too fast to observe the pending state — delay the one
	// response (justified interception per story 2.5.2 spec).
	await page.route('**/api/shelf', async (route) => {
		await new Promise((r) => setTimeout(r, 1_200));
		await route.fallback();
	});
	await page.goto('/');
	await expect(page.getByTestId('skeleton-grid')).toBeVisible();
	await expect(page.getByTestId('shelf-card').first()).toBeVisible();
	await expect(page.getByTestId('skeleton-grid')).toHaveCount(0);
});

test('shelf grid supports arrow traversal in reading order with roving tabindex (1.7g)', async ({
	page,
}) => {
	// Enough owned rows to guarantee at least two real grid rows on desktop
	const run = randomUUID().slice(0, 8);
	const fillers = Array.from({ length: 10 }, (_, i) =>
		createGame({
			title: `Grid Filler ${run} ${String(i).padStart(2, '0')}`,
			tracking: { playStatus: 'Not started' },
		}),
	);
	try {
		seedGames(fillers);
		await page.goto('/');
		await loadAllPages(page);
		const cards = page.getByTestId('shelf-card');

		// Real resolved column count — what jsdom (always 1 column) can't see
		const columns = await page
			.getByTestId('shelf-grid')
			.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
		expect(columns).toBeGreaterThan(1);

		await cards.first().focus();
		await expect(cards.first()).toBeFocused();

		// Reading order: ArrowRight moves to the next card in DOM order
		await page.keyboard.press('ArrowRight');
		await expect(cards.nth(1)).toBeFocused();
		await expect(cards.nth(1)).toHaveAttribute('tabindex', '0'); // roving
		await expect(cards.first()).toHaveAttribute('tabindex', '-1');

		// ArrowDown must jump exactly one real row — distinguishable from
		// ArrowRight only in a true multi-column layout
		await page.keyboard.press('ArrowDown');
		const focusedIndex = await cards.evaluateAll((cells) =>
			cells.findIndex((c) => c === document.activeElement),
		);
		expect(focusedIndex).toBe(1 + columns);
	} finally {
		deleteGames(fillers.map((g) => g.id));
	}
});

test('keyboard-focused card shows a focus outline (1.5i)', async ({ page }) => {
	await page.goto('/');
	const cards = page.getByTestId('shelf-card');
	await cards.first().focus();
	// Arrow keypress establishes keyboard modality, so the :focus-visible
	// outline is guaranteed (programmatic .focus() alone is heuristic-y)
	await page.keyboard.press('ArrowRight');
	const second = cards.nth(1);
	await expect(second).toBeFocused();
	const outline = await second.evaluate((el) => {
		const s = getComputedStyle(el);
		return { style: s.outlineStyle, width: s.outlineWidth };
	});
	expect(outline.style).not.toBe('none');
	expect(Number.parseFloat(outline.width)).toBeGreaterThan(0);
});
