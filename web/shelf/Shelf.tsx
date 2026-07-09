import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { SkeletonGrid } from '../components/Skeleton';
import { fetchShelf, type ShelfGame } from './api';
import { Card } from './Card';
import { useProgressiveList } from './useProgressiveList';
import './shelf.css';

/**
 * The read-only shelf (Story 1.7). Fetches the default backlog view, renders it
 * as a responsive, keyboard-navigable card grid with progressive rendering, and
 * covers the load/empty/error states with the shell's shared primitives.
 *
 * Ordering + hidden-state filtering happen server-side (AD-7); this component
 * never re-derives state — it renders what `/api/shelf` returns, in order.
 */
export function Shelf() {
	const { data, isPending, isError } = useQuery({
		queryKey: ['shelf'],
		queryFn: ({ signal }) => fetchShelf(signal),
	});

	if (isPending) {
		return <SkeletonGrid label="Loading your shelf" />;
	}
	if (isError) {
		return (
			<p role="alert" className="shelf__error">
				Your shelf couldn’t load. Refresh to try again.
			</p>
		);
	}
	if (data.length === 0) {
		return <EmptyState variant="insert-games" />;
	}
	return <ShelfGrid games={data} />;
}

const PAGE_SIZE = 48;

/**
 * Count of columns from a resolved `grid-template-columns` value. The resolved
 * value is space-separated track sizes ("150px 150px …"); "none" or an
 * unresolved `repeat()`/`minmax()` (jsdom, no layout engine) falls back to 1.
 */
export function countColumns(template: string): number {
	if (!template || template.includes('(')) return 1;
	return Math.max(1, template.split(' ').filter(Boolean).length);
}

/**
 * Partition items into contiguous reading-order rows of `columnCount`. A count
 * below 1 collapses to one item per row. Used to give the ARIA grid faithful
 * `role="row"` groups that match the visual column count.
 */
export function chunkIntoRows<T>(items: T[], columnCount: number): T[][] {
	const cols = Math.max(1, columnCount);
	const rows: T[][] = [];
	for (let i = 0; i < items.length; i += cols) {
		rows.push(items.slice(i, i + cols));
	}
	return rows;
}

/** The card grid with roving-tabindex keyboard nav + progressive rendering. */
function ShelfGrid({ games }: { games: ShelfGame[] }) {
	// jsdom (tests) has no IntersectionObserver — render everything there so the
	// full set is assertable; real browsers page it in on scroll.
	const supportsObserver = typeof IntersectionObserver !== 'undefined';
	const progressive = useProgressiveList(games, PAGE_SIZE);
	const visible = supportsObserver ? progressive.visible : games;

	const [focusedIndex, setFocusedIndex] = useState(0);
	const [columnCount, setColumnCount] = useState(1);
	const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
	const gridRef = useRef<HTMLDivElement | null>(null);
	const sentinelRef = useRef<HTMLDivElement | null>(null);
	// Only steal focus after a keyboard move — never on mount or refetch.
	const pendingFocus = useRef(false);

	// Keep the focused index in range as the visible window shrinks/grows.
	useEffect(() => {
		if (focusedIndex > visible.length - 1) {
			setFocusedIndex(Math.max(0, visible.length - 1));
		}
	}, [visible.length, focusedIndex]);

	// Move focus once the target card is rendered (it may need a page reveal
	// first, so this runs after `visible` grows — not imperatively in the handler).
	// biome-ignore lint/correctness/useExhaustiveDependencies: visible.length is the reveal trigger — the newly-rendered ref only exists after the window grows.
	useEffect(() => {
		if (!pendingFocus.current) return;
		const el = cardRefs.current[focusedIndex];
		if (el) {
			el.focus();
			pendingFocus.current = false;
		}
	}, [focusedIndex, visible.length]);

	// Load the next page when the sentinel scrolls into view.
	useEffect(() => {
		if (!supportsObserver || !progressive.hasMore) return;
		const sentinel = sentinelRef.current;
		if (!sentinel) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) progressive.showMore();
		});
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [supportsObserver, progressive.hasMore, progressive.showMore]);

	// Number of cards per visual row, measured from the resolved grid template
	// and re-measured on resize. Falls back to 1 when layout is unavailable
	// (e.g. jsdom / no ResizeObserver), collapsing Up/Down to prev/next and
	// giving each gridcell its own row.
	useEffect(() => {
		const grid = gridRef.current;
		if (!grid || typeof ResizeObserver === 'undefined') return;
		const measure = () => {
			setColumnCount(countColumns(getComputedStyle(grid).gridTemplateColumns));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(grid);
		return () => observer.disconnect();
	}, []);

	const moveFocus = useCallback(
		(index: number) => {
			const clamped = Math.max(0, Math.min(index, games.length - 1));
			pendingFocus.current = true;
			setFocusedIndex(clamped);
			// If the target is past the rendered window, reveal enough pages so
			// keyboard nav (incl. End) reaches every game, not just the first page.
			if (supportsObserver && clamped > visible.length - 1) {
				progressive.revealThrough(clamped);
			}
		},
		[games.length, supportsObserver, visible.length, progressive],
	);

	const onCardKeyDown = useCallback(
		(index: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
			// Widget-mode Tab cycle (Story 2.3): with focus on the pill (menu
			// closed) or the cover trigger, Tab/Shift+Tab moves between the cell's
			// two widgets instead of leaving it. Escape from either widget hands
			// focus back to the gridcell (each widget wires that itself).
			if (e.key === 'Tab') {
				const target = e.target as HTMLElement;
				const pill = e.currentTarget.querySelector<HTMLElement>(
					'.status-popover__pill',
				);
				const cover = e.currentTarget.querySelector<HTMLElement>(
					'.card__cover-button',
				);
				if (!pill || !cover || (target !== pill && target !== cover)) return;
				// With the menu open, Tab belongs to the popover's own handling.
				if (target === pill && pill.getAttribute('aria-expanded') === 'true') {
					return;
				}
				e.preventDefault();
				// Two widgets: Tab and Shift+Tab both land on the other one.
				(target === pill ? cover : pill).focus();
				return;
			}

			// Keys pressed inside a cell's widgets (the status pill, its popover)
			// belong to that widget — an ArrowDown in the status menu must not also
			// move grid focus. Only the gridcell itself navigates the grid.
			if (e.target !== e.currentTarget) return;

			// The ARIA-grid "enter widget mode" step: Enter moves focus from the
			// focused cell into its status pill, which Escape hands back. Matched on
			// the class, not a `data-testid` — a test hook must not be what keyboard
			// navigation depends on.
			if (e.key === 'Enter') {
				const pill = e.currentTarget.querySelector<HTMLElement>(
					'.status-popover__pill',
				);
				if (pill) {
					e.preventDefault();
					pill.focus();
				}
				return;
			}

			const cols = columnCount;
			switch (e.key) {
				case 'ArrowRight':
					moveFocus(index + 1);
					break;
				case 'ArrowLeft':
					moveFocus(index - 1);
					break;
				case 'ArrowDown':
					moveFocus(index + cols);
					break;
				case 'ArrowUp':
					moveFocus(index - cols);
					break;
				case 'Home':
					moveFocus(0);
					break;
				case 'End':
					moveFocus(games.length - 1);
					break;
				default:
					return;
			}
			e.preventDefault();
		},
		[columnCount, moveFocus, games.length],
	);

	// One clamped column width for both chunking and flat-index math, so the
	// DOM index can never diverge from the row grouping.
	const cols = Math.max(1, columnCount);
	const rows = chunkIntoRows(visible, cols);

	return (
		<div className="shelf">
			{/* biome-ignore lint/a11y/useSemanticElements: an ARIA grid of cards (not
			    a data table) is the correct pattern for the roving-focus shelf. */}
			<div
				ref={gridRef}
				className="shelf__grid"
				role="grid"
				aria-label="Your game shelf"
				data-testid="shelf-grid"
			>
				{rows.map((rowGames, rowIndex) => (
					/* biome-ignore lint/a11y/useSemanticElements: ARIA grid row, not a table row */
					/* biome-ignore lint/a11y/useFocusableInteractive: the row is a structural container (display:contents); focus lives on its gridcells */
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional buckets over a stable-ordered list, not identity-bearing items
						key={rowIndex}
						role="row"
						className="shelf__row"
					>
						{rowGames.map((game, colIndex) => {
							const index = rowIndex * cols + colIndex;
							return (
								<Card
									key={game.id}
									game={game}
									tabIndex={index === focusedIndex ? 0 : -1}
									cardRef={(el) => {
										cardRefs.current[index] = el;
									}}
									onKeyDown={onCardKeyDown(index)}
								/>
							);
						})}
					</div>
				))}
			</div>
			{supportsObserver && progressive.hasMore && (
				<div ref={sentinelRef} className="shelf__sentinel" aria-hidden="true" />
			)}
		</div>
	);
}
