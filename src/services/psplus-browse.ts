/**
 * The catalog browse read (Story 7.2). The Catalog destination's only data
 * source: repositories only, nothing external on render (AD-6). It never
 * touches `PsnProvider` — the snapshot 7.1 persisted is all it reads.
 *
 * ORDERING is A–Z by title through `core/compareTitle` — the same tiebreaker
 * `compareShelf` ends on, and deliberately NOT `compareShelf` itself: its state
 * and ownership tiers would hoist the games already discovered to the top of a
 * discovery surface. No state tier, no ownership tier (UX: catalog ordering).
 *
 * PAGING is an offset cursor over that sorted set. ~490 rows is one D1 read, so
 * the honest simple thing is: filter in SQL, sort in `core/`, slice here. The
 * snapshot DOES move under it (this destination runs Check PS+ Extra itself, and
 * the cron fires several times a month), so every page carries the `generation`
 * it was cut from and the client restarts its paging when that moves (review, M3)
 * — the same discipline as the genre sweep's cursor.
 * ponytail: offset paging + a generation stamp, not a keyset cursor — a keyset
 * would have to page in SQL collation order, which is not the A–Z order the UI
 * shows (`core/compareTitle`).
 */
import { compareTitle, normalizeTitle } from '../core';
import {
	type CatalogBrowseRow,
	countCatalogProducts,
	getCatalogGeneration,
	listCatalogForBrowse,
	listCatalogGenres,
	listExternalLinksBySource,
	listLibraryForUser,
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
	const rows = await listCatalogForBrowse(db, scope, {
		genreKeys,
		searchNormalized,
	});
	// "Is the snapshot empty" is a different question from "did the filter match
	// nothing" — EMPTY CATALOG vs NO MATCH — so it is asked separately. A COUNT
	// (review, M5): re-reading the whole table for its `.length` is a count query
	// wearing a table scan.
	const filtering = Boolean(genreKeys?.length || searchNormalized);
	// Only ever compared against 0 (EMPTY CATALOG vs NO MATCH), so the raw SKU
	// count is the honest answer — the collapsed count is `total`, below.
	const snapshotTotal = filtering
		? await countCatalogProducts(db, scope)
		: rows.length;
	const generation = await getCatalogGeneration(db, scope);

	// The membership marker: the user's library keyed by the AD-9 normalized
	// title — the one key both sides already store (AD-24: a catalog row has no
	// link to a GAME except this). Owned wins on a normalized-title clash: the
	// stronger claim is the one that removes the actions.
	//
	// An EMPTY key joins nothing on either side (review, M7): a product named
	// "Remastered" normalizes to '' (the edition suffix IS the whole title), and
	// with '' in the map every other ''-keyed row reads as In library / Owned and
	// links to a WRONG gameId. Same reason `psplus.ts` filters its title keys.
	const library = await listLibraryForUser(db, userId);
	const tracked = new Map<
		string,
		{ gameId: string; owned: boolean; leavingOn: string | null }
	>();
	for (const row of library) {
		if (!row.titleNormalized) continue;
		const existing = tracked.get(row.titleNormalized);
		// Owned wins (unchanged); among UN-OWNED duplicates the dated row wins
		// (review) — first-inserted-wins silently dropped a leaving warning when
		// a date-less duplicate landed first.
		if (
			!existing ||
			(row.owned && !existing.owned) ||
			(!existing.owned && !existing.leavingOn && row.psPlusLeavingOn)
		) {
			tracked.set(row.titleNormalized, {
				gameId: row.id,
				owned: row.owned,
				leavingOn: row.psPlusLeavingOn,
			});
		}
	}

	// …and the STABLE key, checked FIRST (Story 7.3 review, H3): the add anchors
	// `EXTERNAL_LINK('PSN_PRODUCT', product_id)` on the game, and the title it
	// saves is the IGDB candidate's — routinely NOT the store's name. Keyed on the
	// title alone, the two diverge and the card a user just added still reads
	// `＋ Add`, forever (every re-add 409s and bounces to the detail). The link is
	// the one key that cannot drift.
	//
	// …and the SYNC's key (Epic 7 cross-story review, H1): a game the library sync
	// created carries `EXTERNAL_LINK('PSN', np_title_id)` and PSN's own title,
	// which routinely does not normalize like the store's name ("…Valhalla
	// Ragnarök Edition" vs "…Valhalla"). Without this join the card offered ＋Add
	// for a game the user OWNS. The catalog row carries the same np_title_id, so
	// it is a third exact key.
	const byId = new Map(library.map((row) => [row.id, row]));
	const byLink = async (source: 'PSN_PRODUCT' | 'PSN') => {
		const map = new Map<
			string,
			{ gameId: string; owned: boolean; leavingOn: string | null }
		>();
		for (const link of await listExternalLinksBySource(db, source)) {
			const row = byId.get(link.gameId);
			if (!row) continue; // linked, but not in THIS user's library
			const existing = map.get(link.externalId);
			// Same merge rule as the tracked map: owned wins; else a dated row
			// beats a date-less one.
			if (
				!existing ||
				(row.owned && !existing.owned) ||
				(!existing.owned && !existing.leavingOn && row.psPlusLeavingOn)
			) {
				map.set(link.externalId, {
					gameId: row.id,
					owned: row.owned,
					leavingOn: row.psPlusLeavingOn,
				});
			}
		}
		return map;
	};
	const linked = await byLink('PSN_PRODUCT');
	const byNpTitleId = await byLink('PSN');

	// A TOTAL order (review, M1): `compareTitle` is `sensitivity: 'base'`, so NieR
	// and NIER compare EQUAL — not an order at all. Each page is a separate query
	// + sort, so an unspecified tie order lets two base-equal titles swap across
	// the offset boundary between requests: one row served twice, one never shown.
	// `productId` is the primary key, so it makes the order total.
	const sorted = collapseEditions(rows).sort(
		(a, b) =>
			compareTitle(a.name, b.name) || a.productId.localeCompare(b.productId),
	);
	const from = Number.isFinite(cursor) && cursor > 0 ? Math.trunc(cursor) : 0;
	const page = sorted.slice(from, from + PAGE_SIZE);
	const next = from + PAGE_SIZE;

	return {
		region,
		total: sorted.length,
		snapshotTotal,
		nextCursor: next < sorted.length ? next : null,
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
 * stored). The sweep's FROZEN key list (7.1 state) is the vocabulary, so a key
 * the sweep has not reached yet is still listed (count 0) rather than looking
 * like it does not exist; keys the tag table knows are unioned in.
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
	return keys
		.map((key) => ({ key, count: byKey.get(key) ?? 0 }))
		.sort((a, b) => a.key.localeCompare(b.key));
}
