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
	countCatalogGenreKeys,
	countCatalogProducts,
	getCatalogGeneration,
	listCatalogForBrowse,
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
	const tracked = new Map<string, { gameId: string; owned: boolean }>();
	for (const row of library) {
		if (!row.titleNormalized) continue;
		const existing = tracked.get(row.titleNormalized);
		if (!existing || (row.owned && !existing.owned)) {
			tracked.set(row.titleNormalized, { gameId: row.id, owned: row.owned });
		}
	}

	// …and the STABLE key, checked FIRST (Story 7.3 review, H3): the add anchors
	// `EXTERNAL_LINK('PSN_PRODUCT', product_id)` on the game, and the title it
	// saves is the IGDB candidate's — routinely NOT the store's name. Keyed on the
	// title alone, the two diverge and the card a user just added still reads
	// `＋ Add`, forever (every re-add 409s and bounces to the detail). The link is
	// the one key that cannot drift.
	const byId = new Map(library.map((row) => [row.id, row]));
	const linked = new Map<string, { gameId: string; owned: boolean }>();
	for (const link of await listExternalLinksBySource(db, 'PSN_PRODUCT')) {
		const row = byId.get(link.gameId);
		if (!row) continue; // linked, but not in THIS user's library
		const existing = linked.get(link.externalId);
		if (!existing || (row.owned && !existing.owned)) {
			linked.set(link.externalId, { gameId: row.id, owned: row.owned });
		}
	}

	// A TOTAL order (review, M1): `compareTitle` is `sensitivity: 'base'`, so NieR
	// and NIER compare EQUAL — not an order at all. Each page is a separate query
	// + sort, so an unspecified tie order lets two base-equal titles swap across
	// the offset boundary between requests: one row served twice, one never shown.
	// `productId` is the primary key, so it makes the order total.
	const sorted = [...rows].sort(
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
			const match =
				linked.get(row.productId) ??
				(row.titleNormalized ? tracked.get(row.titleNormalized) : undefined);
			return {
				productId: row.productId,
				name: row.name,
				coverUrl: row.coverUrl,
				storeUrl: row.storeUrl,
				inLibrary: match !== undefined,
				owned: match?.owned ?? false,
				gameId: match?.gameId ?? null,
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
 */
export async function listCatalogGenreFacets(
	db: Db,
	userId: string,
	env: { PSN_REGION?: string },
): Promise<CatalogGenre[]> {
	const region = await getPsnRegion(db, userId, env);
	if (!region) return [];
	const counts = await countCatalogGenreKeys(db, {
		region,
		tier: PS_PLUS_TIER,
	});
	const byKey = new Map(counts.map((row) => [row.key, row.count]));
	const state = await getPsPlusSweepState(db, userId);
	const keys =
		state?.region === region
			? [...new Set([...state.keys, ...byKey.keys()])]
			: [...byKey.keys()];
	return keys
		.map((key) => ({ key, count: byKey.get(key) ?? 0 }))
		.sort((a, b) => a.key.localeCompare(b.key));
}
