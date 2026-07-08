import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Progressive rendering over an already-materialized list (FR-19). At v1's
 * ~344-game scale the whole effective-state-sorted set arrives in one response;
 * this hook renders it in pages so the DOM grows on scroll rather than mounting
 * every card up front — infinite scroll, NOT a SQL cursor.
 *
 * `visible` is the leading slice; `showMore` advances by one page; `hasMore`
 * says whether a further page exists. When the source list changes (a new fetch
 * or a switch to search results) the window resets to the first page.
 */
export function useProgressiveList<T>(
	items: readonly T[],
	pageSize = 48,
): {
	visible: T[];
	hasMore: boolean;
	showMore: () => void;
	revealThrough: (index: number) => void;
} {
	const [count, setCount] = useState(pageSize);

	// Reset the window whenever the underlying list identity changes (a new
	// fetch or a switch to search results), keyed on the `items` reference.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the `items` reference is the intended reset trigger
	useEffect(() => {
		setCount(pageSize);
	}, [items, pageSize]);

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
