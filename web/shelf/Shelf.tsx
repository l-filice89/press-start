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

/** The card grid with roving-tabindex keyboard nav + progressive rendering. */
function ShelfGrid({ games }: { games: ShelfGame[] }) {
	// jsdom (tests) has no IntersectionObserver — render everything there so the
	// full set is assertable; real browsers page it in on scroll.
	const supportsObserver = typeof IntersectionObserver !== 'undefined';
	const progressive = useProgressiveList(games, PAGE_SIZE);
	const visible = supportsObserver ? progressive.visible : games;

	const [focusedIndex, setFocusedIndex] = useState(0);
	const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
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

	// Number of cards per visual row, from layout; falls back to 1 when layout
	// is unavailable (e.g. jsdom), collapsing Up/Down to prev/next.
	const columnCount = useCallback(() => {
		const els = cardRefs.current.filter(Boolean) as HTMLDivElement[];
		if (els.length === 0) return 1;
		const firstTop = els[0].getBoundingClientRect().top;
		let cols = 0;
		for (const el of els) {
			// Tolerance, not strict equality: sub-pixel layout rounding can make
			// same-row cards report slightly different tops.
			if (Math.abs(el.getBoundingClientRect().top - firstTop) < 1) cols++;
			else break;
		}
		return Math.max(1, cols);
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
			const cols = columnCount();
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

	return (
		<div className="shelf">
			{/* biome-ignore lint/a11y/useSemanticElements: an ARIA grid of cards (not
			    a data table) is the correct pattern for the roving-focus shelf. */}
			<div
				className="shelf__grid"
				role="grid"
				aria-label="Your game shelf"
				data-testid="shelf-grid"
			>
				{/* biome-ignore lint/a11y/useSemanticElements: ARIA grid row, not a table row */}
				{/* biome-ignore lint/a11y/useFocusableInteractive: the row is a structural container; focus lives on its gridcells */}
				<div role="row" className="shelf__row">
					{visible.map((game, index) => (
						<Card
							key={game.id}
							game={game}
							tabIndex={index === focusedIndex ? 0 : -1}
							cardRef={(el) => {
								cardRefs.current[index] = el;
							}}
							onKeyDown={onCardKeyDown(index)}
						/>
					))}
				</div>
			</div>
			{supportsObserver && progressive.hasMore && (
				<div ref={sentinelRef} className="shelf__sentinel" aria-hidden="true" />
			)}
		</div>
	);
}
