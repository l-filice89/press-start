import {
	keepPreviousData,
	useInfiniteQuery,
	useQuery,
} from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { EmptyState } from '../components/EmptyState';
import { useAnnounce } from '../components/LiveRegion';
import { SkeletonGrid } from '../components/Skeleton';
import { useModalTrap } from '../components/useModalTrap';
import {
	type CatalogGenre,
	fetchCatalogGenres,
	fetchCatalogPage,
	genreLabel,
} from './api';
import { CatalogCard } from './CatalogCard';
import './catalog.css';

/**
 * The Catalog destination (Story 7.2, FR-51) — the one other place you can BE.
 *
 * Reads the stored PS+ Extra snapshot (AD-6: repositories only, nothing external
 * on render), A–Z, PAGED — ~490 cards at once is a phone-hostile DOM, so the
 * grid pulls the next page as its sentinel scrolls in and never holds more than
 * it has scrolled through.
 *
 * `?q=` is the SAME header box as the shelf's, scoped to whichever destination
 * is active and cleared on switch (AD-25). The `＋ Add "<name>"` row is
 * shelf-only: a miss here is `NO MATCH`, because you cannot conjure a game into
 * Sony's catalog by typing it.
 *
 * The genre filter is the PS-store FACET KEY vocabulary (AD-26) — never the
 * shelf's IGDB genres. There are deliberately NO state/ownership/flag filters:
 * those describe tracked games, which these are not.
 */
export function Catalog({ onOpenSettings }: { onOpenSettings?: () => void }) {
	const [searchParams, setSearchParams] = useSearchParams();
	const search = searchParams.get('q') ?? '';
	// The selected facet keys ride in the URL beside `?q=` — a filtered catalog
	// is a place you can link to and come Back to.
	const genreKeys = [...new Set(searchParams.getAll('genre'))];
	const announce = useAnnounce();

	const {
		data: genres = [],
		isError: genresFailed,
		isPending: genresPending,
	} = useQuery({
		queryKey: ['catalog-genres'],
		queryFn: ({ signal }) => fetchCatalogGenres(signal),
	});

	// The snapshot generation the pages were cut from (review, M3). Offset paging
	// tears when the snapshot moves under it — and it does move: the cron and the
	// stale-snapshot guard both refresh it (8.4). A page
	// from a NEWER generation re-keys the query, which restarts the paging cleanly
	// instead of splicing two snapshots together (one row twice, one row never).
	const [generation, setGeneration] = useState<string | null>(null);

	const query = useInfiniteQuery({
		queryKey: ['catalog', { genreKeys, search, generation }],
		queryFn: ({ pageParam, signal }) =>
			fetchCatalogPage({ genreKeys, search }, pageParam, signal),
		initialPageParam: 0,
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		// A genre click must not blank the destination (review, M8): without this the
		// key flip makes the query PENDING, the whole grid + filter row is replaced by
		// the skeleton, the chip you just pressed disappears, and keyboard focus falls
		// to <body>. Keep the previous page on screen while the new one loads.
		placeholderData: keepPreviousData,
	});

	const pageList = query.data?.pages;
	useEffect(() => {
		if (!pageList || pageList.length === 0) return;
		const first = pageList[0].generation;
		const torn = pageList.find((page) => page.generation !== first);
		if (torn) setGeneration(torn.generation);
	}, [pageList]);

	// `{replace: true}`, like the search box (review, L3): a filter is a VIEW of
	// this destination, not a place. Pushing an entry per chip made Back walk the
	// toggle history instead of leaving the catalog.
	function toggleGenre(key: string) {
		setSearchParams(
			(prev) => {
				const next = new URLSearchParams(prev);
				const selected = next.getAll('genre');
				next.delete('genre');
				for (const existing of selected) {
					if (existing !== key) next.append('genre', existing);
				}
				if (!selected.includes(key)) next.append('genre', key);
				return next;
			},
			{ replace: true },
		);
	}

	function clearGenres() {
		setSearchParams(
			(prev) => {
				const next = new URLSearchParams(prev);
				next.delete('genre');
				return next;
			},
			{ replace: true },
		);
	}

	const sentinelRef = useRef<HTMLDivElement | null>(null);
	const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
	useEffect(() => {
		if (typeof IntersectionObserver === 'undefined') return;
		if (!hasNextPage || isFetchingNextPage) return;
		const sentinel = sentinelRef.current;
		if (!sentinel) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) void fetchNextPage();
		});
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	// Announce the result count on every filter/search change (review, L4) — the
	// shelf does, and a screen-reader user pressing a genre chip otherwise gets no
	// signal at all that the grid narrowed. Guarded on the settled fetch (the
	// previous page is still on screen while the new one loads) and on the FILTER
	// KEY, so a background refetch with an unchanged filter stays silent.
	const total = pageList?.[0]?.total;
	const fetching = query.isFetching;
	const filterKey = `${genreKeys.join(',')}|${search}`;
	const lastAnnounced = useRef(filterKey);
	useEffect(() => {
		if (total === undefined || fetching) return;
		if (lastAnnounced.current === filterKey) return;
		lastAnnounced.current = filterKey;
		announce(
			`${total} catalog game${total === 1 ? '' : 's'} match the current filters.`,
		);
	}, [total, fetching, filterKey, announce]);

	if (query.isPending) {
		return <SkeletonGrid label="Loading the PS+ catalog" />;
	}
	if (query.isError) {
		return (
			<p role="alert" className="shelf__error">
				The catalog couldn’t load. Refresh to try again.
			</p>
		);
	}

	const pages = query.data.pages;
	const first = pages[0];
	// Dedupe by productId (Story 8.6, defensive): SQL pages are disjoint within
	// one generation, but a refresh landing mid-scroll can hand two pages an
	// overlapping row before the generation re-key kicks in — rendering both
	// would collide React keys. First occurrence wins. (An edition pair
	// straddling a boundary has distinct ids and stays the documented cosmetic
	// double-card.)
	const games = [
		...new Map(
			pages.flatMap((page) => page.games).map((g) => [g.productId, g]),
		).values(),
	];
	const filtering = genreKeys.length > 0 || search !== '';

	// Cause 1 — no region. The catalog is per-region; without one there is
	// nothing to show and Settings is the way out (never a blank grid, NFR-4).
	if (first.region === null) {
		return (
			<EmptyState
				variant="no-region"
				actions={
					onOpenSettings
						? [{ label: 'Open Settings', onClick: onOpenSettings }]
						: undefined
				}
			/>
		);
	}
	// Cause 2 — a region, but the snapshot was never fetched. (Cause 3, a FAILED
	// refresh, is the shell's attention banner PLUS the stale grid below — a stale
	// catalog beats no catalog, as long as it says so.)
	if (first.snapshotTotal === 0) {
		// Passive (Story 8.4, AD-31): the manual check died — the cron and the
		// shelf's stale-snapshot guard load the catalog automatically.
		return <EmptyState variant="empty-catalog" />;
	}

	return (
		<div className="catalog">
			<CatalogFilters
				genres={genres}
				genresFailed={genresFailed}
				genresPending={genresPending}
				selected={genreKeys}
				onToggle={toggleGenre}
				onClear={clearGenres}
				total={first.total}
				fetching={query.isFetching}
			/>
			<p
				className="catalog__count"
				data-testid="catalog-count"
				aria-busy={query.isFetching || undefined}
			>
				{query.isFetching ? (
					'Updating catalog games…'
				) : (
					<>
						{first.total} game{first.total === 1 ? '' : 's'}
						{filtering ? ' matching' : ' in the PS+ Extra catalog'}
					</>
				)}
			</p>

			{games.length === 0 ? (
				<EmptyState variant="no-match" />
			) : (
				<section
					className="catalog__grid"
					aria-label="The PS Plus Extra catalog"
					data-testid="catalog-grid"
					// Programmatic focus target, like the shelf grid: closing a detail
					// opened from here hands focus back to the grid (UX-DR19), and a
					// catalog card is not a gridcell to aim at. Without a tabindex the
					// `.focus()` no-ops and focus falls to <body> as the panel unmounts.
					tabIndex={-1}
				>
					{games.map((game) => (
						<CatalogCard key={game.productId} game={game} />
					))}
				</section>
			)}
			{query.hasNextPage && (
				<div ref={sentinelRef} className="catalog__sentinel">
					{/* A real button, not only a scroll sentinel: keyboard and
					    reduced-motion users must be able to reach page 2 without
					    an IntersectionObserver ever firing. */}
					<button
						type="button"
						className="catalog__more tap-target"
						data-testid="catalog-more"
						disabled={query.isFetchingNextPage}
						onClick={() => void query.fetchNextPage()}
					>
						{query.isFetchingNextPage ? 'Loading…' : 'Load more'}
					</button>
				</div>
			)}
		</div>
	);
}

/**
 * The genre multiselect — facet KEYS in, localized labels out (AD-26).
 *
 * It renders whenever a genre is SELECTED, even with no vocabulary to show
 * (review, M9): a deep link to `/catalog?genre=HORROR` whose genres query failed
 * (or answered `[]`) used to render nothing at all — a grid filtered by an
 * invisible chip, with no way out but editing the URL. A failed vocabulary also
 * says so, instead of reading as "this region has no genres".
 */
function CatalogFilters({
	genres,
	genresFailed,
	genresPending,
	selected,
	onToggle,
	onClear,
	total,
	fetching,
}: {
	genres: CatalogGenre[];
	genresFailed: boolean;
	genresPending: boolean;
	selected: string[];
	onToggle: (key: string) => void;
	onClear: () => void;
	total: number;
	fetching: boolean;
}) {
	const [sheetOpen, setSheetOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const desktopTriggerRef = useRef<HTMLButtonElement>(null);
	const options = [
		...selected
			.filter((key) => !genres.some((genre) => genre.key === key))
			.map((key) => ({ key, count: null })),
		...genres,
	];
	const closeSheet = useCallback(() => {
		setSheetOpen(false);
		triggerRef.current?.focus();
	}, []);
	const closeSheetForDesktop = useCallback(() => {
		setSheetOpen(false);
		requestAnimationFrame(() => desktopTriggerRef.current?.focus());
	}, []);
	const mountDesktopTrigger = useCallback(
		(element: HTMLButtonElement | null) => {
			desktopTriggerRef.current = element;
		},
		[],
	);

	return (
		<div className="catalog__filters" data-testid="catalog-filters">
			<button
				ref={triggerRef}
				type="button"
				className="catalog__filter-sheet-trigger tap-target"
				data-active={selected.length > 0 || undefined}
				aria-label={
					selected.length > 0
						? `Filters — ${selected.length} active`
						: 'Filters'
				}
				data-testid="catalog-filter-sheet-trigger"
				onClick={() => setSheetOpen(true)}
			>
				Filters
				{selected.length > 0 && (
					<span className="catalog__filter-count" aria-hidden="true">
						{selected.length}
					</span>
				)}
			</button>
			{sheetOpen && (
				<CatalogFilterSheet
					options={options}
					genresFailed={genresFailed}
					genresPending={genresPending}
					selected={selected}
					onToggle={onToggle}
					onClear={onClear}
					total={total}
					fetching={fetching}
					onClose={closeSheet}
					onBreakpointClose={closeSheetForDesktop}
				/>
			)}
			<div className="catalog__filter-desktop">
				{genresFailed && (
					<p role="alert" className="catalog__genres-error">
						The genre filters couldn’t load. Refresh to try again.
					</p>
				)}
				<CatalogGenreMenu
					options={options}
					genresFailed={genresFailed}
					genresPending={genresPending}
					selected={selected}
					onToggle={onToggle}
					onClear={onClear}
					onTriggerMount={mountDesktopTrigger}
				/>
			</div>
		</div>
	);
}

type CatalogGenreOption = { key: string; count: number | null };

function CatalogGenreMenu({
	options,
	genresFailed,
	genresPending,
	selected,
	onToggle,
	onClear,
	onTriggerMount,
}: {
	options: CatalogGenreOption[];
	genresFailed: boolean;
	genresPending: boolean;
	selected: string[];
	onToggle: (key: string) => void;
	onClear: () => void;
	onTriggerMount: (element: HTMLButtonElement | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const menuId = useId();
	const optionCount = options.length;
	const navigableCount = options.length + (selected.length > 0 ? 1 : 0);
	const close = useCallback((returnFocus = true) => {
		setOpen(false);
		if (returnFocus) triggerRef.current?.focus();
	}, []);

	useEffect(() => {
		if (open && optionCount > 0)
			itemRefs.current[0]?.focus({ preventScroll: true });
	}, [open, optionCount]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (
				menuRef.current?.contains(target) ||
				triggerRef.current?.contains(target)
			)
				return;
			close(false);
		};
		const onScroll = (event: Event) => {
			if (!menuRef.current?.contains(event.target as Node)) close();
		};
		const onResize = () => close();
		document.addEventListener('pointerdown', onPointerDown);
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onResize);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onResize);
		};
	}, [open, close]);

	const moveFocus = (event: React.KeyboardEvent, index: number) => {
		const last = navigableCount - 1;
		let target: number | null = null;
		switch (event.key) {
			case 'ArrowDown':
				target = index === last ? 0 : index + 1;
				break;
			case 'ArrowUp':
				target = index === 0 ? last : index - 1;
				break;
			case 'Home':
				target = 0;
				break;
			case 'End':
				target = last;
				break;
			case 'Escape':
				event.preventDefault();
				close();
				return;
			case 'Tab':
				close(false);
				return;
			default:
				return;
		}
		event.preventDefault();
		itemRefs.current[target]?.focus();
	};

	return (
		<span className="catalog__genre-dropdown">
			<button
				ref={(element) => {
					triggerRef.current = element;
					onTriggerMount(element);
				}}
				type="button"
				className="catalog__genre-trigger tap-target"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				aria-label={
					selected.length > 0
						? `Genre — ${selected.length} selected`
						: undefined
				}
				data-active={selected.length > 0 || undefined}
				data-testid="catalog-filter-genre"
				onClick={() => (open ? close() : setOpen(true))}
				onKeyDown={(event) => {
					if (event.key === 'ArrowDown') {
						event.preventDefault();
						setOpen(true);
					} else if (event.key === 'Escape' && open) {
						event.preventDefault();
						close();
					}
				}}
			>
				Genre
				{selected.length > 0 && (
					<span className="catalog__filter-count" aria-hidden="true">
						{selected.length}
					</span>
				)}
			</button>
			{open && (
				<div
					ref={menuRef}
					id={menuId}
					role="menu"
					aria-label="Genre filters"
					className="catalog__genre-menu"
					data-testid="catalog-filter-genre-menu"
				>
					{options.length === 0 && (
						<button
							type="button"
							role="menuitem"
							aria-disabled="true"
							tabIndex={-1}
							className="catalog__genre-empty"
						>
							{genresFailed
								? 'Genres couldn’t load'
								: genresPending
									? 'Loading genres…'
									: 'No genres yet'}
						</button>
					)}
					{options.map((option, index) => (
						<button
							key={option.key}
							ref={(element) => {
								itemRefs.current[index] = element;
							}}
							type="button"
							role="menuitemcheckbox"
							aria-checked={selected.includes(option.key)}
							tabIndex={-1}
							className="catalog__genre-item tap-target"
							onClick={() => onToggle(option.key)}
							onKeyDown={(event) => moveFocus(event, index)}
						>
							{genreLabel(option.key)}
							{option.count !== null && (
								<span className="catalog__genre-count">{option.count}</span>
							)}
						</button>
					))}
					{selected.length > 0 && (
						<button
							ref={(element) => {
								itemRefs.current[options.length] = element;
							}}
							type="button"
							role="menuitem"
							tabIndex={-1}
							className="catalog__clear tap-target"
							onClick={() => {
								onClear();
								close();
							}}
							onKeyDown={(event) => moveFocus(event, options.length)}
						>
							Clear genres
						</button>
					)}
				</div>
			)}
		</span>
	);
}

function CatalogFilterSheet({
	options,
	genresFailed,
	genresPending,
	selected,
	onToggle,
	onClear,
	total,
	fetching,
	onClose,
	onBreakpointClose,
}: {
	options: CatalogGenreOption[];
	genresFailed: boolean;
	genresPending: boolean;
	selected: string[];
	onToggle: (key: string) => void;
	onClear: () => void;
	total: number;
	fetching: boolean;
	onClose: () => void;
	onBreakpointClose: () => void;
}) {
	const sheetRef = useRef<HTMLDivElement>(null);
	const showRef = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	const onKeyDown = useModalTrap(sheetRef, onClose);

	useEffect(() => {
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	}, []);

	const onBreakpointCloseRef = useRef(onBreakpointClose);
	onBreakpointCloseRef.current = onBreakpointClose;
	useEffect(() => {
		const media = window.matchMedia?.('(min-width: 601px)');
		if (!media) return;
		const onChange = () => {
			if (media.matches) onBreakpointCloseRef.current();
		};
		media.addEventListener('change', onChange);
		return () => media.removeEventListener('change', onChange);
	}, []);

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop is a pointer dismiss surface; dialog exposes Escape and a close button.
		<div
			className="catalog-filter-sheet__backdrop"
			data-testid="catalog-filter-sheet-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				ref={sheetRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="catalog-filter-sheet"
				data-testid="catalog-filter-sheet"
				onKeyDown={onKeyDown}
			>
				<p id={titleId} className="catalog-filter-sheet__title">
					Filters
				</p>
				<div className="catalog-filter-sheet__group">
					<p className="catalog-filter-sheet__group-label">
						Genre — any of (or)
					</p>
					{genresFailed && (
						<p role="alert" className="catalog__genres-error">
							The genre filters couldn’t load. Refresh to try again.
						</p>
					)}
					{options.length === 0 && !genresFailed && (
						<p className="catalog-filter-sheet__empty">
							{genresPending ? 'Loading genres…' : 'No genres yet'}
						</p>
					)}
					{options.map((option) => (
						<button
							key={option.key}
							type="button"
							className="catalog-filter-sheet__option tap-target"
							aria-pressed={selected.includes(option.key)}
							data-active={selected.includes(option.key) || undefined}
							onClick={() => onToggle(option.key)}
						>
							{genreLabel(option.key)}
							{option.count !== null && (
								<span className="catalog__genre-count">{option.count}</span>
							)}
						</button>
					))}
				</div>
				{selected.length > 0 && (
					<button
						type="button"
						className="catalog__clear tap-target"
						onClick={() => {
							onClear();
							requestAnimationFrame(() => showRef.current?.focus());
						}}
					>
						Clear genres
					</button>
				)}
				<button
					ref={showRef}
					type="button"
					className="catalog-filter-sheet__show tap-target"
					data-testid="catalog-filter-sheet-show"
					onClick={onClose}
				>
					{fetching
						? 'Close filters — updating games…'
						: `Show ${total} game${total === 1 ? '' : 's'}`}
				</button>
			</div>
		</div>,
		document.body,
	);
}
