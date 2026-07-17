/**
 * The catalog browse read (Story 7.2). The Catalog destination's only data
 * source: repositories only, nothing external on render (AD-6). It never
 * touches `PsnProvider` — the snapshot 7.1 persisted is all it reads.
 *
 * ORDERING is A–Z by normalized title, straight from SQL (`title_normalized,
 * product_id` — total order, so pages can never overlap or drop a row), and
 * deliberately NOT `compareShelf`: its state and ownership tiers would hoist
 * the games already discovered to the top of a discovery surface (UX: catalog
 * ordering). Story 8.6 retired the `core/compareTitle` re-sort with the
 * whole-snapshot read; the two orders differ only on accent/case edge cases.
 *
 * PAGING is SQL `LIMIT/OFFSET` in the snapshot's own order (Story 8.6 / AD-33
 * §2 ruling): `ORDER BY title_normalized, product_id` IS the display order —
 * the old in-memory `compareTitle` re-sort retired with the whole-snapshot
 * read. Page 0 still reads the full filtered set ONCE, because the collapsed
 * card `total` (DW-11 chip parity) is a whole-set fact; later pages read
 * `PAGE_SIZE + 1` rows. The snapshot DOES move under it (the cron fires several
 * times a month), so every page carries the `generation` it was cut from and
 * the client restarts its paging when that moves (review, M3).
 * ponytail: `collapseEditions` now runs per page, so an edition pair straddling
 * a page boundary can render one card per page — cosmetic, rare (pairs sit
 * adjacent in title order), and the price of not hauling ~490 rows per scroll.
 */
import { normalizeTitle } from '../core';
import {
	type CatalogBrowseRow,
	countCatalogProducts,
	getCatalogGeneration,
	type LibraryMarkerRow,
	listCatalogForBrowse,
	listCatalogGenres,
	listLibraryRowsByNormalizedTitles,
	listUserGamesByExternalIds,
	PS_PLUS_TIER,
} from '../repositories';
import type { Db } from '../repositories/db';
import { getPsnRegion, getPsPlusSweepState } from './settings';

/** Games per page — the grid pulls the next one as its sentinel scrolls in. */
const PAGE_SIZE = 60;

export interface CatalogGame {
	productId: string;
	name: string;
	coverUrl: string | null;
	storeUrl: string | null;
	/** This user already tracks it (the `In library` / `Owned` marker). */
	inLibrary: boolean;
	/** Departure date of the TRACKED match (Story 10.4 follow-on) — null for
	 * untracked products (the sweep never fans out to the whole catalog). */
	leavingOn: string | null;
	/** …and owns it — bought, or a PS+ claim a sync observed (no actions). */
	owned: boolean;
	/** The tracked game's id, so a marker can route to `/game/:id` later. */
	gameId: string | null;
}

export interface CatalogPage {
	/** null = no region is configured → the NO REGION empty state. */
	region: string | null;
	games: CatalogGame[];
	/** Games matching the filter+search across ALL pages (not just this one). */
	total: number;
	/** Games in the snapshot regardless of filter — 0 = EMPTY CATALOG. */
	snapshotTotal: number;
	/** Pass back as `?cursor=`; null = last page. */
	nextCursor: number | null;
	/**
	 * The snapshot generation this page was cut from (review, M3). A later page
	 * carrying a different one means a refresh landed mid-scroll and every offset
	 * boundary moved: the client re-keys its query on it and pages from the top,
	 * rather than splicing two snapshots (one row twice, one row never).
	 */
	generation: string | null;
}

export interface CatalogGenre {
	key: string;
	count: number;
}

/**
 * ONE CARD PER GAME, not per store SKU. The store lists a game's PS4 and PS5
 * editions as SEPARATE products with their own `product_id` and `np_title_id`
 * ("A Space for the Unbound" ships as `CUSA39157` (PS4) and `PPSA12231` (PS5)),
 * so the grid rendered the same game twice, side by side, each offering its own
 * ＋ Add — and adding one left its twin still saying ＋ Add, since the identity
 * keys (link, np_title_id) differ per SKU.
 *
 * The snapshot keeps BOTH rows — it is a faithful mirror of the store (AD-24),
 * and the flag pass and the add path need whichever SKU the user's library
 * actually carries. Only the BROWSE VIEW collapses them, and it collapses on
 * title + DISJOINT PLATFORMS: a shared title alone is not an edition pair (NieR
 * and NIER normalize alike and are two different games; so would a remake
 * carrying its original's name). Two products with the same title that both ship
 * on PS5 stay two cards — the safe way to be wrong here is to show too much.
 *
 * The PS5 SKU wins the card: it is the one a PS5 owner wants to claim.
 */

/** The column is JSON array TEXT. Unparseable or absent = no known platform, and
 * a row with no known platform is disjoint from nothing, so it never collapses. */
function platformsOf(row: CatalogBrowseRow): string[] {
	if (!row.platforms) return [];
	try {
		const parsed: unknown = JSON.parse(row.platforms);
		return Array.isArray(parsed)
			? parsed.filter((p) => typeof p === 'string')
			: [];
	} catch {
		return [];
	}
}

function collapseEditions(rows: CatalogBrowseRow[]): CatalogBrowseRow[] {
	const byTitle = new Map<string, { row: CatalogBrowseRow; on: string[] }[]>();
	const kept: CatalogBrowseRow[] = [];
	for (const row of rows) {
		// A title that normalizes to '' is not a key — it would collapse every such
		// product onto one card (the same hazard the membership join guards, M7).
		const on = platformsOf(row);
		if (!row.titleNormalized || on.length === 0) {
			kept.push(row);
			continue;
		}
		const siblings = byTitle.get(row.titleNormalized) ?? [];
		// The edition it supersedes, if any: same title, no platform in common.
		const twin = siblings.findIndex(
			(sibling) => !sibling.on.some((platform) => on.includes(platform)),
		);
		if (twin === -1) siblings.push({ row, on });
		else if (on.includes('PS5')) siblings[twin] = { row, on };
		byTitle.set(row.titleNormalized, siblings);
	}
	return [
		...kept,
		...[...byTitle.values()].flat().map((sibling) => sibling.row),
	];
}

export async function browseCatalog(
	db: Db,
	userId: string,
	env: { PSN_REGION?: string },
	{
		genreKeys,
		search,
		cursor = 0,
	}: { genreKeys?: string[]; search?: string; cursor?: number } = {},
): Promise<CatalogPage> {
	const region = await getPsnRegion(db, userId, env);
	if (!region) {
		return {
			region: null,
			games: [],
			total: 0,
			snapshotTotal: 0,
			nextCursor: null,
			generation: null,
		};
	}
	const scope = { region, tier: PS_PLUS_TIER };
	// The TERM is folded with the same AD-9 normalizer the column holds (review,
	// M2), so "Pokémon" finds Pokémon — SQLite's `lower()` is ASCII-only and could
	// not, while the shelf's client-side search always could.
	const searchNormalized = search ? normalizeTitle(search) : undefined;
	const filtering = Boolean(genreKeys?.length || searchNormalized);
	const from = Number.isFinite(cursor) && cursor > 0 ? Math.trunc(cursor) : 0;

	// Page 0 reads the FULL filtered set once: the collapsed-card `total` (the
	// "N games matching" line and the DW-11 chip-parity number) is a whole-set
	// fact no page-sized read can answer. Later pages read PAGE_SIZE + 1 SKUs —
	// the sentinel row answers "is there a next page" without a count query.
	// The CURSOR is a SKU-space offset into the SQL order; the client treats it
	// as opaque and re-keys on `generation`, so the semantics change (it was a
	// collapsed-card offset) is invisible to it.
	const fullRead = from === 0;
	const rows = await listCatalogForBrowse(db, scope, {
		genreKeys,
		searchNormalized,
		...(fullRead ? {} : { limit: PAGE_SIZE + 1, offset: from }),
	});
	// "Is the snapshot empty" is a different question from "did the filter match
	// nothing" — EMPTY CATALOG vs NO MATCH — so it is asked separately. A COUNT
	// (review, M5): re-reading the whole table for its `.length` is a count query
	// wearing a table scan.
	// Later pages skip the count entirely (review): the client reads `total`
	// and `snapshotTotal` from page 0 only, and a COUNT bills the rows it scans
	// — a read-budget story must not ship a per-page scan for dead values.
	const snapshotTotal = fullRead
		? filtering
			? await countCatalogProducts(db, scope)
			: rows.length
		: rows.length;
	const generation = await getCatalogGeneration(db, scope);

	const pageRows = rows.slice(0, PAGE_SIZE);
	const hasNext = fullRead
		? rows.length > from + PAGE_SIZE
		: rows.length > PAGE_SIZE;
	// `total` is the collapsed CARD count across the whole filtered set — a
	// whole-set fact only page 0 computes, and the ONLY value the client reads
	// (`pageList[0].total`). Later pages carry the page length as a schema
	// placeholder rather than paying a count query for a number nothing reads.
	const total = fullRead ? collapseEditions(rows).length : snapshotTotal;

	// The membership markers, PAGE-SCOPED (Story 8.6): three exact-key joins
	// against only this page's keys — never the whole library or the whole
	// external-link table per request. Key precedence and merge rules are
	// unchanged (7.3 H3 / Epic 7 H1 / M7):
	//   1. `EXTERNAL_LINK('PSN_PRODUCT', product_id)` — the add path's anchor,
	//      immune to title drift.
	//   2. `EXTERNAL_LINK('PSN', np_title_id)` — the sync's identity.
	//   3. the AD-9 normalized title — the only key AD-24 gives a catalog row.
	// EMPTY title keys join nothing (M7): "Remastered" normalizes to '' and
	// would false-mark every ''-keyed row. Owned wins on any clash; among
	// un-owned matches a dated row beats a date-less one (a leaving warning must
	// not be dropped by insertion order).
	type Marker = { gameId: string; owned: boolean; leavingOn: string | null };
	const better = (a: Marker | undefined, b: LibraryMarkerRow): boolean =>
		!a ||
		(b.owned && !a.owned) ||
		(!a.owned && !a.leavingOn && Boolean(b.psPlusLeavingOn));
	const toMarker = (row: LibraryMarkerRow): Marker => ({
		gameId: row.id,
		owned: row.owned,
		leavingOn: row.psPlusLeavingOn,
	});
	const titleKeys = [
		...new Set(pageRows.map((r) => r.titleNormalized).filter(Boolean)),
	];
	const productIds = pageRows.map((r) => r.productId);
	const npTitleIds = [
		...new Set(
			pageRows.map((r) => r.npTitleId).filter((v): v is string => Boolean(v)),
		),
	];
	const [titleRows, productLinkRows, npLinkRows] = await Promise.all([
		listLibraryRowsByNormalizedTitles(db, userId, titleKeys),
		listUserGamesByExternalIds(db, userId, 'PSN_PRODUCT', productIds),
		listUserGamesByExternalIds(db, userId, 'PSN', npTitleIds),
	]);
	const tracked = new Map<string, Marker>();
	for (const row of titleRows) {
		if (!row.titleNormalized) continue;
		if (better(tracked.get(row.titleNormalized), row))
			tracked.set(row.titleNormalized, toMarker(row));
	}
	const linked = new Map<string, Marker>();
	for (const row of productLinkRows) {
		if (better(linked.get(row.externalId), row))
			linked.set(row.externalId, toMarker(row));
	}
	const byNpTitleId = new Map<string, Marker>();
	for (const row of npLinkRows) {
		if (better(byNpTitleId.get(row.externalId), row))
			byNpTitleId.set(row.externalId, toMarker(row));
	}

	const page = collapseEditions(pageRows);

	return {
		region,
		total,
		snapshotTotal,
		nextCursor: hasNext ? from + PAGE_SIZE : null,
		generation,
		games: page.map((row) => {
			// OWNED WINS across all three keys, not "first key that hits" (review, H1):
			// a stub row matched by one key must never beat the OWNED row matched by
			// another — that is what made an owned game read `In library` forever.
			const matches = [
				linked.get(row.productId),
				row.npTitleId ? byNpTitleId.get(row.npTitleId) : undefined,
				row.titleNormalized ? tracked.get(row.titleNormalized) : undefined,
			].filter((match) => match !== undefined);
			const match = matches.find((m) => m.owned) ?? matches[0];
			return {
				productId: row.productId,
				name: row.name,
				coverUrl: row.coverUrl,
				storeUrl: row.storeUrl,
				inLibrary: match !== undefined,
				owned: match?.owned ?? false,
				gameId: match?.gameId ?? null,
				// A title-key collision (L6 above) would hand an untracked product a
				// tracked game's date — a stronger false claim than the In-library
				// marker. Accepted with the same rationale: both sides share one
				// normalizer, and the exact-link keys are checked first.
				leavingOn: match?.leavingOn ?? null,
			};
		}),
	};
}

/**
 * The region's genre facet keys with counts (AD-26 — store enum keys, never the
 * shelf's IGDB genres; the localized label is rendered client-side, never
 * stored). The sweep's FROZEN key list (7.1 state) is the vocabulary — keys the
 * tag table knows are unioned in — but only keys with at least one card make
 * the response (UX sweep 2026-07-16): a dead pill filters to NO MATCH.
 *
 * COUNTS ARE CARDS, NOT SKUs (DW-11): a chip's number must equal what the grid
 * says when that chip is pressed, and the grid collapses PS4/PS5 edition pairs
 * onto one card. Counting tag rows said "Fighting 13" while the filtered grid
 * answered "12 games matching" (MORDHAU ships as two SKUs, both tagged). So the
 * counts run the SAME pipeline as a filtered browse — the rows a key's tags
 * name, through the same `collapseEditions` — parity by construction, not by a
 * parallel query kept honest by hand.
 */
export async function listCatalogGenreFacets(
	db: Db,
	userId: string,
	env: { PSN_REGION?: string },
): Promise<CatalogGenre[]> {
	const region = await getPsnRegion(db, userId, env);
	if (!region) return [];
	const scope = { region, tier: PS_PLUS_TIER };
	const [rows, tags] = await Promise.all([
		listCatalogForBrowse(db, scope),
		listCatalogGenres(db, scope),
	]);
	const rowById = new Map(rows.map((row) => [row.productId, row]));
	const taggedRows = new Map<string, CatalogBrowseRow[]>();
	for (const tag of tags) {
		// A tag whose product left the snapshot counts nothing (7.2 review, M6) —
		// the FK cascade removes it, but a read can land between prune and cascade.
		const row = rowById.get(tag.productId);
		if (!row) continue;
		const list = taggedRows.get(tag.genreKey) ?? [];
		list.push(row);
		taggedRows.set(tag.genreKey, list);
	}
	const byKey = new Map(
		[...taggedRows].map(([key, list]) => [key, collapseEditions(list).length]),
	);
	const state = await getPsPlusSweepState(db, userId);
	const keys =
		state?.region === region
			? [...new Set([...state.keys, ...byKey.keys()])]
			: [...byKey.keys()];
	return (
		keys
			.map((key) => ({ key, count: byKey.get(key) ?? 0 }))
			// Zero-count keys are dropped by product decision (UX sweep 2026-07-16):
			// this also hides keys the sweep has not reached yet — acceptable, they
			// surface as the sweep converges rather than as pills that match nothing.
			.filter(({ count }) => count > 0)
			.sort((a, b) => a.key.localeCompare(b.key))
	);
}
