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

	it('resets the window when the source list changes', () => {
		const { result, rerender } = renderHook(
			({ list }) => useProgressiveList(list, 4),
			{ initialProps: { list: items } },
		);
		act(() => result.current.showMore());
		expect(result.current.visible).toHaveLength(8);
		rerender({ list: [1, 2, 3] });
		expect(result.current.visible).toEqual([1, 2, 3]);
		expect(result.current.hasMore).toBe(false);
	});
});
