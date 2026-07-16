import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useProgressiveList } from './useProgressiveList';

const items = Array.from({ length: 10 }, (_, i) => i);

describe('useProgressiveList', () => {
	it('exposes the first page and reports more remaining', () => {
		const { result } = renderHook(() => useProgressiveList(items, 4));
		expect(result.current.visible).toEqual([0, 1, 2, 3]);
		expect(result.current.hasMore).toBe(true);
	});

	it('grows by a page on showMore, until nothing remains', () => {
		const { result } = renderHook(() => useProgressiveList(items, 4));
		act(() => result.current.showMore());
		expect(result.current.visible).toHaveLength(8);
		expect(result.current.hasMore).toBe(true);
		act(() => result.current.showMore());
		expect(result.current.visible).toHaveLength(10);
		expect(result.current.hasMore).toBe(false);
	});

	it('reveals through a target index in one step (keyboard nav past page 1)', () => {
		const { result } = renderHook(() => useProgressiveList(items, 4));
		// Jump straight to the last item: the window grows to include it at once,
		// not one page at a time (End-key nav must reach the true last card).
		act(() => result.current.revealThrough(9));
		expect(result.current.visible).toHaveLength(10);
		expect(result.current.hasMore).toBe(false);
	});

	it('never shrinks the window on revealThrough', () => {
		const { result } = renderHook(() => useProgressiveList(items, 4));
		act(() => result.current.showMore()); // 8 visible
		act(() => result.current.revealThrough(1)); // target already visible
		expect(result.current.visible).toHaveLength(8);
	});

	// The scroll-jump root cause (UX sweep 2026-07-16): a tracking write refetches
	// the shelf, handing this hook a NEW array of the SAME view — the window must
	// survive it, or a deep scroll snaps back to page 1 on every status change.
	it('preserves the window when the source list is refetched (same resetKey)', () => {
		const { result, rerender } = renderHook(
			({ list }) => useProgressiveList(list, 4, 'view-a'),
			{ initialProps: { list: items } },
		);
		act(() => result.current.showMore());
		expect(result.current.visible).toHaveLength(8);
		rerender({ list: [...items] }); // new reference, same view
		expect(result.current.visible).toHaveLength(8);
	});

	it('clamps the window to a shrunken list without resetting to one page', () => {
		const long = Array.from({ length: 20 }, (_, i) => i);
		const { result, rerender } = renderHook(
			({ list }) => useProgressiveList(list, 4, 'view-a'),
			{ initialProps: { list: long } },
		);
		act(() => result.current.revealThrough(15)); // window at 16
		rerender({ list: long.slice(0, 10) }); // a game left the view
		// Clamped to the new length — not snapped back to the first page — and
		// still the LEADING slice of the new list.
		expect(result.current.visible).toEqual(long.slice(0, 10));
		expect(result.current.hasMore).toBe(false);
	});

	it('resets to the first page when resetKey changes (a filter change)', () => {
		const { result, rerender } = renderHook(
			({ list, key }) => useProgressiveList(list, 4, key),
			{ initialProps: { list: items, key: 'view-a' } },
		);
		act(() => result.current.showMore());
		expect(result.current.visible).toHaveLength(8);
		rerender({ list: items.slice(0, 7), key: 'view-b' });
		expect(result.current.visible).toEqual([0, 1, 2, 3]);
		expect(result.current.hasMore).toBe(true);
	});
});
