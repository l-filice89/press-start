import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { useAnnounce } from '../components/LiveRegion';
import { SkeletonGrid } from '../components/Skeleton';
import { fetchShelf, type ShelfGame } from './api';
import { Card } from './Card';
import { DetailPanel } from './DetailPanel';
import { FilterRow } from './FilterRow';
import {
	applyShelfFilter,
	EMPTY_FILTER,
	isFilterActive,
	type ShelfFilter,
	summarizeFilterText,
} from './filters';
import { OPEN_DETAIL_EVENT } from './open-detail';
import { useProgressiveList } from './useProgressiveList';
import './shelf.css';

/**
 * The read-only shelf (Story 1.7). Fetches the default backlog view, renders it
 * as a responsive, keyboard-navigable card grid with progressive rendering, and
 * covers the load/empty/error states with the shell's shared primitives.
 *
 * Ordering + hidden-state filtering happen server-side (AD-7); this component
 * never re-derives state — it renders what `/api/shelf` returns, in order.
 * Story 3.1 layers State/Genre filtering on top as a pure, order-preserving
 * subset of that payload (`applyShelfFilter`), so FR-18 ordering holds in
 * every filtered view. The whole-library search is a separate query path and
 * never sees this filter.
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
	return <FilteredShelf games={data} />;
}

/** Filter state + the filter row, between the shelf query and the grid. */
function FilteredShelf({ games }: { games: ShelfGame[] }) {
	const [filter, setFilter] = useState<ShelfFilter>(EMPTY_FILTER);
	const announce = useAnnounce();

	// Search-pick detail view (Story 6.1, FR-42): the combobox lives in the
	// header, outside the grid — the window event carries the game id here,
	// where the WHOLE library payload (hidden states included) is in hand, so
	// a completed/dropped game found by search still opens. Rendered as its
	// own panel: ShelfGrid's panel only knows the filtered visible set.
	const [searchGameId, setSearchGameId] = useState<string | null>(null);
	useEffect(() => {
		function onOpen(e: Event) {
			const id = (e as CustomEvent<string>).detail;
			if (id) setSearchGameId(id);
		}
		window.addEventListener(OPEN_DETAIL_EVENT, onOpen);
		return () => window.removeEventListener(OPEN_DETAIL_EVENT, onOpen);
	}, []);
	const searchGame = searchGameId
		? games.find((g) => g.id === searchGameId)
		: undefined;
	// Stale-id cleanup (3.4 pattern): an id the payload doesn't hold (yet)
	// clears instead of resurrecting a dialog later.
	useEffect(() => {
		if (searchGameId && !searchGame) setSearchGameId(null);
	}, [searchGameId, searchGame]);
	const closeSearchDetail = useCallback(() => {
		setSearchGameId(null);
		// Focus returns to the search field that opened it (UX-DR19).
		document.querySelector<HTMLElement>('.search-box__input')?.focus();
	}, []);
	const visible = useMemo(
		() => applyShelfFilter(games, filter),
		[games, filter],
	);
	// The payload is the whole library (hidden states included) — user-facing
	// counts and the "is the backlog empty" judgment use the default set.
	const defaultCount = useMemo(
		() => applyShelfFilter(games, EMPTY_FILTER).length,
		[games],
	);

	// Grid↔empty-state focus handoff (Story 3.5; deferred from 3.4): when the
	// visible set empties, ShelfGrid unmounts WITH its focus-restore effect —
	// the browser silently drops focus to <body>. Land it deliberately on the
	// empty state's action (Clear filters) or its headline. Symmetrically,
	// activating Clear filters unmounts the empty state under the focused
	// button — land back on the grid. `shelfHadFocus` is armed by focus/blur
	// capture on the wrapper below (same technique as ShelfGrid's restore):
	// a node unmounting fires NO blur, so the flag survives exactly when focus
	// died with the swap — and a user parked in the filter row, on a toast, or
	// on dead page background never gets focus stolen.
	const shelfHadFocus = useRef(false);
	const prevView = useRef<'none' | 'grid' | 'empty'>('none');
	useEffect(() => {
		const view = visible.length > 0 ? 'grid' : 'empty';
		const focusFell =
			shelfHadFocus.current && document.activeElement === document.body;
		if (view === 'empty' && prevView.current === 'grid' && focusFell) {
			const empty = document.querySelector('[data-testid="empty-state"]');
			const target =
				empty?.querySelector<HTMLElement>('.empty-state__action') ??
				empty?.querySelector<HTMLElement>('.empty-state__headline');
			target?.focus();
		} else if (view === 'grid' && prevView.current === 'empty' && focusFell) {
			document
				.querySelector<HTMLElement>('[data-testid="shelf-grid"]')
				?.focus();
		}
		prevView.current = view;
	}, [visible.length]);

	// Announce filter changes from the one filtered result the grid renders —
	// a second applyShelfFilter call here would be duplicated logic waiting to
	// diverge. Skips mount; refetches with an unchanged filter stay silent.
	const lastAnnounced = useRef(filter);
	useEffect(() => {
		if (lastAnnounced.current === filter) return;
		lastAnnounced.current = filter;
		// Denominator: a reveal view selects from the WHOLE library (hidden
		// states included) — "3 of 12" against the default set would exclude the
		// very games being shown. Non-reveal filters narrow the default set.
		const total = filter.reveals.length > 0 ? games.length : defaultCount;
		announce(
			isFilterActive(filter)
				? `Filters applied. ${summarizeFilterText(filter)} ${visible.length} of ${total}.`
				: 'Filters cleared.',
		);
	}, [filter, visible.length, defaultCount, games.length, announce]);

	return (
		<>
			<FilterRow
				filter={filter}
				onChange={setFilter}
				visibleCount={visible.length}
			/>
			{/* display:contents wrapper: arms the handoff flag while focus lives
			    anywhere in the grid OR the empty state (Clear filters included, so
			    the reverse handoff works). Unmounts fire no blur — that's the
			    signal the handoff effect reads. */}
			<div
				style={{ display: 'contents' }}
				onFocusCapture={() => {
					shelfHadFocus.current = true;
				}}
				onBlurCapture={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
						shelfHadFocus.current = false;
					}
				}}
			>
				{visible.length === 0 ? (
					// "NO MATCH" is a filter outcome; a library whose every game is
					// hidden (all completed/dropped) with no filter active is an empty
					// backlog, not a failed filter. The filter outcome offers the way
					// back out (UX-DR18).
					isFilterActive(filter) ? (
						<EmptyState
							variant="no-match"
							actions={[
								{
									label: 'Clear filters',
									onClick: () => setFilter(EMPTY_FILTER),
								},
							]}
						/>
					) : (
						<EmptyState variant="insert-games" />
					)
				) : (
					<ShelfGrid games={visible} />
				)}
			</div>
			{searchGame && (
				<DetailPanel game={searchGame} onClose={closeSearchDetail} />
			)}
		</>
	);
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

	// Open-detail state lives HERE, not in Card (Story 3.4): a refetch that
	// re-chunks the rows remounts Cards, and a panel owned by one would die
	// mid-interaction. One panel renders below, looked up by id — so it also
	// re-renders with fresh data after every refetch.
	const [openGameId, setOpenGameId] = useState<string | null>(null);
	// Same hoist for the status-popover menu (Story 3.6, AC3): the open menu's
	// Card remounts on any refetch re-chunk — the boolean living here re-opens
	// it on the remounted Card. Single id: at most one menu open at a time.
	const [openStatusGameId, setOpenStatusGameId] = useState<string | null>(null);
	// Stale-id cleanup (the other half of the 3.4 pattern): if the open-menu
	// game leaves the rendered set, clear the id — otherwise the menu would
	// spontaneously re-open and steal focus when the game reappears later.
	useEffect(() => {
		if (openStatusGameId && !visible.some((g) => g.id === openStatusGameId)) {
			setOpenStatusGameId(null);
		}
	}, [visible, openStatusGameId]);
	// Look up in the FULL list, not the progressive window: a write that
	// reorders the open game past the rendered page must not kill its panel.
	const openGame = openGameId
		? games.find((g) => g.id === openGameId)
		: undefined;
	const closeDetail = useCallback(() => {
		// Return focus to the owning gridcell (UX-DR19) — by game id, not a
		// captured index: the grid may have re-chunked while the panel was open.
		// Focus first, then clear state (no side effects inside the updater).
		const cell = openGameId
			? gridRef.current?.querySelector<HTMLElement>(
					`[role="gridcell"][data-game-id="${CSS.escape(openGameId)}"]`,
				)
			: null;
		(cell ?? gridRef.current)?.focus();
		setOpenGameId(null);
	}, [openGameId]);

	// A lookup miss (the open game left the filtered list outside the onHidden
	// path — e.g. removed by another actor's refetch) must CLOSE deliberately:
	// clearing the stale id stops the dialog resurrecting when the game
	// reappears, and the focus handoff keeps the user off <body>.
	useEffect(() => {
		if (openGameId && !openGame) closeDetail();
	}, [openGameId, openGame, closeDetail]);

	// Focus restoration (Story 3.4, AC1+AC3): when the focused card unmounts —
	// a resize re-chunk moving it across row parents, or a write removing it
	// from the visible set — browsers drop focus to <body> with NO blur event,
	// so the armed flag survives the unmount and this post-commit effect can
	// land focus deliberately: the same/neighbor card at the clamped index, or
	// the grid container itself. Tab-ing away (toast, panel, header) fires blur
	// capture and disarms it, so this never steals focus from other surfaces.
	const gridHadFocus = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: visible/columnCount identity changes are the re-chunk/unmount triggers this effect exists to observe.
	useEffect(() => {
		if (!gridHadFocus.current) return;
		if (gridRef.current?.contains(document.activeElement)) return;
		const target = cardRefs.current[Math.min(focusedIndex, visible.length - 1)];
		if (target) target.focus();
		else gridRef.current?.focus();
	}, [visible, columnCount, focusedIndex]);

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
			// Widget-mode Tab cycle (Stories 2.3/2.4): with focus on one of the
			// cell's widgets (the pill with its menu closed, the cover trigger, or
			// the owned toggle), Tab/Shift+Tab moves between them instead of
			// leaving the cell. Escape from any widget hands focus back to the
			// gridcell (each widget wires that itself).
			if (e.key === 'Tab') {
				const target = e.target as HTMLElement;
				const cell = e.currentTarget;
				const widgets = [
					'.status-popover__pill',
					'.card__cover-button',
					'.card__owned-toggle',
				]
					.map((selector) => cell.querySelector<HTMLElement>(selector))
					.filter((el): el is HTMLElement => el !== null);
				const from = widgets.indexOf(target);
				if (from === -1) return;
				// With the menu open, Tab belongs to the popover's own handling.
				if (target.getAttribute('aria-expanded') === 'true') return;
				e.preventDefault();
				const step = e.shiftKey ? -1 : 1;
				widgets[(from + step + widgets.length) % widgets.length].focus();
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
				tabIndex={-1}
				onFocusCapture={(e) => {
					gridHadFocus.current = true;
					// Keep the roving index synced with REAL focus: a pointer click
					// focuses a gridcell without going through moveFocus, and the
					// restore-on-unmount path relies on focusedIndex being truthful.
					const cell = (e.target as HTMLElement).closest<HTMLDivElement>(
						'[role="gridcell"]',
					);
					if (cell) {
						const index = cardRefs.current.indexOf(cell);
						if (index !== -1) setFocusedIndex(index);
					}
				}}
				onBlurCapture={(e) => {
					// Deliberate focus moves (toast, panel, header) disarm restoration;
					// an unmount of the focused node fires NO blur, leaving it armed.
					if (!gridRef.current?.contains(e.relatedTarget as Node | null)) {
						gridHadFocus.current = false;
					}
				}}
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
									onOpenDetail={setOpenGameId}
									statusMenuOpen={game.id === openStatusGameId}
									onStatusMenuOpenChange={(menuOpen) =>
										setOpenStatusGameId(menuOpen ? game.id : null)
									}
								/>
							);
						})}
					</div>
				))}
			</div>
			{supportsObserver && progressive.hasMore && (
				<div ref={sentinelRef} className="shelf__sentinel" aria-hidden="true" />
			)}
			{/* One panel for the whole grid: it survives any row re-chunk, and the
			    id lookup feeds it fresh data after every refetch. A lookup miss
			    (game left the visible set outside the onHidden path) unmounts it. */}
			{openGame && <DetailPanel game={openGame} onClose={closeDetail} />}
		</div>
	);
}
