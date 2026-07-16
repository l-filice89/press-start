import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Progressive rendering over an already-materialized list (FR-19). At v1's
 * ~344-game scale the whole effective-state-sorted set arrives in one response;
 * this hook renders it in pages so the DOM grows on scroll rather than mounting
 * every card up front — infinite scroll, NOT a SQL cursor.
 *
 * `visible` is the leading slice; `showMore` advances by one page; `hasMore`
 * says whether a further page exists. A new `items` reference (a refetch after
 * a tracking write) PRESERVES the window — resetting on it yanked a deep
 * scroll back to page 1 on every status change (UX sweep 2026-07-16); the
 * count only clamps down when the list shrinks. A `resetKey` change (the
 * caller's filter/search context) is what snaps back to the first page.
 */
export function useProgressiveList<T>(
	items: readonly T[],
	pageSize = 48,
	resetKey?: unknown,
): {
	visible: T[];
	hasMore: boolean;
	showMore: () => void;
	revealThrough: (index: number) => void;
} {
	const [count, setCount] = useState(pageSize);

	// A data change keeps the window, only clamping to the new length (never
	// below one page) so a shrunken list doesn't leave a hollow oversized count.
	useEffect(() => {
		setCount((c) => Math.max(pageSize, Math.min(c, items.length)));
	}, [items, pageSize]);

	// Full reset belongs to the CALLER's context change (filter/search), not to
	// refetches — ordered after the clamp so it wins when both fire together.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `resetKey` is the intended reset trigger
	useEffect(() => {
		setCount(pageSize);
	}, [resetKey, pageSize]);

	const showMore = useCallback(() => {
		setCount((c) => c + pageSize);
	}, [pageSize]);

	// Grow the window so `index` is rendered — keyboard nav past the first page
	// isn't gated on a scroll-driven IntersectionObserver (a11y floor).
	const revealThrough = useCallback((index: number) => {
		setCount((c) => Math.max(c, index + 1));
	}, []);

	const visible = useMemo(() => items.slice(0, count), [items, count]);
	const hasMore = count < items.length;

	return { visible, hasMore, showMore, revealThrough };
}
