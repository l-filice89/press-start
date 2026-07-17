import {
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState } from '../components/EmptyState';
import { useAnnounce } from '../components/LiveRegion';
import { SkeletonGrid } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { runPsPlusCheck } from '../settings/api';
import { serverMessage } from '../shelf/api';
import {
	type CatalogGenre,
	fetchCatalogGenres,
	fetchCatalogPage,
	genreLabel,
	startGenreSweep,
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
	const genreKeys = searchParams.getAll('genre');
	const announce = useAnnounce();
	const { toast } = useToast();
	const queryClient = useQueryClient();

	const { data: genres = [], isError: genresFailed } = useQuery({
		queryKey: ['catalog-genres'],
		queryFn: ({ signal }) => fetchCatalogGenres(signal),
	});

	// The snapshot generation the pages were cut from (review, M3). Offset paging
	// tears when the snapshot moves under it — and it does move: this destination
	// runs Check PS+ Extra itself, and the cron fires several times a month. A page
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

	// Running the check right here is the EMPTY CATALOG state's own way out — the
	// same ingest the FAB fires, so the destination is never a dead end.
	const check = useMutation({
		mutationFn: runPsPlusCheck,
		onSuccess: (result) => {
			announce('PS plus check complete.');
			queryClient.invalidateQueries({ queryKey: ['catalog'] });
			queryClient.invalidateQueries({ queryKey: ['catalog-genres'] });
			queryClient.invalidateQueries({ queryKey: ['shelf'] });
			queryClient.invalidateQueries({ queryKey: ['settings'] });
			// The snapshot is in; now tag it — otherwise the genre filter stays
			// empty until the monthly cron converges (Story 7.1's "do it now" loop).
			startGenreSweep(queryClient, result.generation);
		},
		onError: (error: Error) =>
			toast({
				message: serverMessage(error) ?? 'PS+ check failed — try again later.',
			}),
	});

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
		return (
			<EmptyState
				variant="empty-catalog"
				actions={[
					{
						label: check.isPending ? 'Checking…' : 'Check PS+ Extra',
						onClick: () => {
							if (!check.isPending) check.mutate();
						},
					},
				]}
			/>
		);
	}

	return (
		<div className="catalog">
			<CatalogFilters
				genres={genres}
				genresFailed={genresFailed}
				selected={genreKeys}
				onToggle={toggleGenre}
				onClear={clearGenres}
			/>
			<p className="catalog__count" data-testid="catalog-count">
				{first.total} game{first.total === 1 ? '' : 's'}
				{filtering ? ' matching' : ' in the PS+ Extra catalog'}
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
	selected,
	onToggle,
	onClear,
}: {
	genres: CatalogGenre[];
	genresFailed: boolean;
	selected: string[];
	onToggle: (key: string) => void;
	onClear: () => void;
}) {
	if (genres.length === 0 && selected.length === 0 && !genresFailed)
		return null;
	return (
		<fieldset className="catalog__filters" data-testid="catalog-filters">
			<legend className="sr-only">Filter by genre</legend>
			{genresFailed && (
				<p role="alert" className="catalog__genres-error">
					The genre filters couldn’t load. Refresh to try again.
				</p>
			)}
			{/* A selected key the vocabulary doesn't list still gets its own chip —
			    the filter is live, so it must be visible and switchable off. Covers
			    both a failed/empty vocabulary (M9) and a key whose count dropped to
			    zero, which the facet response now omits (UX sweep 2026-07-16). */}
			{selected
				.filter((key) => !genres.some((genre) => genre.key === key))
				.map((key) => (
					<button
						key={key}
						type="button"
						className="catalog__genre tap-target"
						aria-pressed={true}
						onClick={() => onToggle(key)}
					>
						{genreLabel(key)}
					</button>
				))}
			{genres.map((genre) => (
				<button
					key={genre.key}
					type="button"
					className="catalog__genre tap-target"
					aria-pressed={selected.includes(genre.key)}
					onClick={() => onToggle(genre.key)}
				>
					{genreLabel(genre.key)}
					<span className="catalog__genre-count"> {genre.count}</span>
				</button>
			))}
			{selected.length > 0 && (
				<button
					type="button"
					className="catalog__clear tap-target"
					onClick={onClear}
				>
					Clear genres
				</button>
			)}
		</fieldset>
	);
}
