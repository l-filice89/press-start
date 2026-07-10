import type { Page } from '@playwright/test';
import { expect } from '../merged-fixtures';

/**
 * Reveals every progressive page: scrolls the IntersectionObserver sentinel
 * until the shelf removes it (rendered while hasMore only — Shelf.tsx).
 * Safe on an empty/filtered-out shelf: no sentinel means nothing to reveal.
 * Call before absence or full-set ordering assertions.
 */
export async function loadAllPages(page: Page): Promise<void> {
	// Wait for the shelf query to resolve first — with no cards AND no
	// empty-state the sentinel's absence just means "still loading", and
	// returning early would let callers assert against a blank shelf.
	await expect(
		page.getByTestId('shelf-grid').or(page.getByTestId('empty-state')).first(),
	).toBeVisible();
	const sentinel = page.locator('.shelf__sentinel');
	for (;;) {
		if ((await sentinel.count()) === 0) return;
		const cards = page.getByTestId('shelf-card');
		const before = await cards.count();
		await sentinel.scrollIntoViewIfNeeded();
		await expect
			.poll(
				async () =>
					(await cards.count()) > before || (await sentinel.count()) === 0,
				{
					message: 'next page to render after sentinel scroll',
					timeout: 10_000,
				},
			)
			.toBe(true);
	}
}
