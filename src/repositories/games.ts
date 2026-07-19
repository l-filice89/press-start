/**
 * Game + external-link persistence (AD-4). Game identity is the
 * `external_link (source, external_id)` (AD-18/20), so lookups by normalized
 * title return an array (non-unique candidate key) while lookups by external
 * link return a single game.
 */
import { and, count, eq, inArray, ne, sql } from 'drizzle-orm';
import {
	type EXTERNAL_LINK_SOURCES,
	externalLink,
	game,
	gameTracking,
	setting,
} from '../schema/catalog';
import type { Db } from './db';

export type GameFacts = {
	title: string;
	titleNormalized: string;
	releaseDate?: string | null;
	coverUrl?: string | null;
	storeUrl?: string | null;
	unenriched?: boolean;
	criticScore?: number | null;
	criticScoreCount?: number | null;
	userScore?: number | null;
	userScoreCount?: number | null;
};

/** The four IGDB reception facts (Story 10.1) — always written as a unit. */
export type GameScores = {
	criticScore: number | null;
	criticScoreCount: number | null;
	userScore: number | null;
	userScoreCount: number | null;
};

/**
 * The scheduled refresh's per-game write (Stories 10.1 + 10.3): every key is
 * optional so the batch sets exactly what the IGDB reply carried — a game
 * with a score row but no time-to-beat record updates its scores and KEEPS
 * its stored hours (absence of fresh data never erases standing data).
 */
export type GameIgdbFacts = Partial<GameScores> & {
	ttbStorySeconds?: number | null;
	ttbCompleteSeconds?: number | null;
	ttbCount?: number | null;
};

export type ExternalLinkSource = (typeof EXTERNAL_LINK_SOURCES)[number];

/** Create a game; the id/`ps_plus_extra`/`unenriched` defaults fill themselves. */
export async function insertGame(db: Db, facts: GameFacts) {
	const [row] = await db.insert(game).values(facts).returning();
	return row;
}

/**
 * All games sharing a normalized title. Returns an array because
 * `title_normalized` has no uniqueness constraint (AD-18) — a clash with a
 * different external id is two games, not one.
 */
export async function findGamesByNormalizedTitle(
	db: Db,
	titleNormalized: string,
) {
	return db
		.select()
		.from(game)
		.where(eq(game.titleNormalized, titleNormalized));
}

/** The single game an external id resolves to, or undefined (AD-20 identity). */
export async function findGameByExternalLink(
	db: Db,
	source: ExternalLinkSource,
	externalId: string,
) {
	const [row] = await db
		.select({ game })
		.from(externalLink)
		.innerJoin(game, eq(externalLink.gameId, game.id))
		.where(
			and(
				eq(externalLink.source, source),
				eq(externalLink.externalId, externalId),
			),
		)
		.limit(1);
	return row?.game;
}

/**
 * Attach an external id to a game. Many links per `(game, source)` are allowed
 * (PS4 + PS5 → one game), but `(source, external_id)` is unique — a duplicate
 * identity rejects at the DB (AD-18/20).
 */
export async function addExternalLink(
	db: Db,
	link: { gameId: string; source: ExternalLinkSource; externalId: string },
) {
	const [row] = await db.insert(externalLink).values(link).returning();
	return row;
}

/**
 * Attach an external id, tolerating a concurrent writer (Story 7.3 review, M3):
 * two POSTs for the same NEW product id both insert a game, and the loser's
 * `addExternalLink` would hit `UNIQUE(source, external_id)` and 500. The insert
 * is a no-op on conflict; the caller re-reads the link to learn who won.
 */
export async function addExternalLinkIfAbsent(
	db: Db,
	link: { gameId: string; source: ExternalLinkSource; externalId: string },
) {
	await db.insert(externalLink).values(link).onConflictDoNothing();
}

/** Every external link for a game. */
export async function listExternalLinks(db: Db, gameId: string) {
	return db.select().from(externalLink).where(eq(externalLink.gameId, gameId));
}

/**
 * Every link of one source — the catalog marker's join (Story 7.3 review, H3).
 * The `PSN_PRODUCT` link is the STABLE identity between a catalog row and a
 * game; the normalized title is not (the add re-seeds the title from the IGDB
 * candidate, so the stored title routinely differs from the store's name).
 */
export async function listExternalLinksBySource(
	db: Db,
	source: ExternalLinkSource,
): Promise<{ gameId: string; externalId: string }[]> {
	return db
		.select({
			gameId: externalLink.gameId,
			externalId: externalLink.externalId,
		})
		.from(externalLink)
		.where(eq(externalLink.source, source));
}

/**
 * Drop a game row (links/genres cascade). The ONLY caller is the add path's
 * concurrent-product race (Story 7.3 review, M3): the request that loses the
 * `PSN_PRODUCT` anchor deletes the row it just inserted and converges on the
 * winner's game, rather than leaving an unlinked duplicate behind. Not a
 * user-facing delete — that is the discard tombstone.
 */
export async function deleteGame(db: Db, gameId: string) {
	await db.delete(game).where(eq(game.id, gameId));
}

/**
 * Drop a game's links for one source — the rematch path (PV-4) clears stale IGDB
 * links so a later add/sync resolves the new id, not the wrong one. Leaves other
 * sources (PSN) intact. `exceptExternalId` keeps one id: rematch anchors the new
 * pick FIRST, then prunes the rest, so the game is never left with no identity
 * even if a write in between fails.
 */
export async function removeExternalLinksBySource(
	db: Db,
	gameId: string,
	source: ExternalLinkSource,
	exceptExternalId?: string,
) {
	await db.delete(externalLink).where(
		and(
			eq(externalLink.gameId, gameId),
			eq(externalLink.source, source),
			// drizzle drops `undefined` clauses, so this is a no-op when unset.
			exceptExternalId
				? ne(externalLink.externalId, exceptExternalId)
				: undefined,
		),
	);
}

/**
 * NULL-only backfill of PSN-captured facts (FR-33/35): fills a missing
 * cover/store URL, never overwrites one that stands (COALESCE keeps the
 * stored value; user- or seed-set facts survive every sync).
 */
export async function backfillGameFacts(
	db: Db,
	gameId: string,
	facts: { coverUrl: string | null; storeUrl: string | null },
) {
	await db
		.update(game)
		.set({
			coverUrl: sql`COALESCE(${game.coverUrl}, ${facts.coverUrl})`,
			storeUrl: sql`COALESCE(${game.storeUrl}, ${facts.storeUrl})`,
		})
		.where(eq(game.id, gameId));
}

/**
 * Persist refreshed reception scores on a batch of games (Story 10.1). One
 * `db.batch` call — one D1 subrequest however many rows (the Epic 9
 * BUDGET-COUNTS-EVERY-SUBREQUEST lesson: a per-row loop of UPDATEs is N
 * subrequests the mock can't see). Values differ per row so this can't be the
 * `inArray` shape `setPsPlusExtraFlags` uses; each statement binds 5 params,
 * far under D1's 100-param cap. Caller passes ONLY rows present in the IGDB
 * response — a game absent from the reply keeps its stored scores (VR-5:
 * absence of fresh data never erases standing data).
 *
 * ponytail: one unchunked batch — fine at the ~65-row library; D1 also caps
 * statements-per-batch, so slice into multiple db.batch calls (each is one
 * subrequest) if the linked library ever grows past a few hundred rows.
 */
export async function updateGameIgdbFacts(
	db: Db,
	updates: { gameId: string; facts: GameIgdbFacts }[],
) {
	// An empty facts object would make Drizzle throw "No values to set" and
	// fail the whole batch — filter defensively (the caller already guards).
	const nonEmpty = updates.filter(({ facts }) => Object.keys(facts).length > 0);
	if (nonEmpty.length === 0) return;
	const statements = nonEmpty.map(({ gameId, facts }) =>
		db.update(game).set(facts).where(eq(game.id, gameId)),
	);
	await db.batch(statements as [(typeof statements)[0], ...typeof statements]);
}

/**
 * Enrich a name-only (`unenriched`) game once a manual IGDB match is confirmed
 * (Story 6.2, FR-28): fill the facts the add-by-name save lacked and clear the
 * flag. Straight `set` (not COALESCE) — resolution is the user deliberately
 * choosing this match, so it overwrites the empty name-only placeholders.
 */
export async function enrichGame(
	db: Db,
	gameId: string,
	facts: {
		coverUrl: string | null;
		releaseDate: string | null;
		/** Correct the name-only title to the chosen IGDB match, when given. */
		title?: string;
		titleNormalized?: string;
		/** Reception scores from the chosen match (Story 10.1) — written as a
		 * unit when given, so a rematch onto an unscored game clears the old
		 * match's scores rather than keeping the wrong game's numbers. */
		scores?: GameScores;
		/** Null the stored time-to-beat columns (Story 10.3). Set on a rematch
		 * that changes the IGDB identity: the hours belong to the OLD match, and
		 * the cron's partial-reply rule would otherwise preserve them forever
		 * (follow-up review). Clients never send TTB, so unlike scores this
		 * clears on identity change alone — the new match's hours arrive with
		 * the next refresh pass. */
		clearTimeToBeat?: boolean;
	},
) {
	await db
		.update(game)
		.set({
			coverUrl: facts.coverUrl,
			releaseDate: facts.releaseDate,
			unenriched: false,
			...(facts.title
				? { title: facts.title, titleNormalized: facts.titleNormalized }
				: {}),
			...(facts.scores ?? {}),
			...(facts.clearTimeToBeat
				? { ttbStorySeconds: null, ttbCompleteSeconds: null, ttbCount: null }
				: {}),
		})
		.where(eq(game.id, gameId));
}

/**
 * A game joined with one user's tracking row — the row shape the shelf/search
 * services bake into a card DTO.
 */
export type LibraryRow = {
	id: string;
	title: string;
	/** The stored match key — the ONE key both syncs join a PSN name on. */
	titleNormalized: string;
	releaseDate: string | null;
	coverUrl: string | null;
	storeUrl: string | null;
	/** DERIVED per user region (Story 8.3, AD-30): any of the three identity
	 * keys hits the region's `ps_plus_catalog`. Never stored on `game`. */
	psPlusExtra: boolean;
	unenriched: boolean;
	criticScore: number | null;
	criticScoreCount: number | null;
	userScore: number | null;
	userScoreCount: number | null;
	/** Date the game LEAVES PS+ (10.4 semantics) — DERIVED from the
	 * `ps_plus_departure` ledger via the same three keys (Story 8.3). */
	psPlusLeavingOn: string | null;
	/** Time-to-beat in seconds (Story 10.3): story / 100% / submission count. */
	ttbStorySeconds: number | null;
	ttbCompleteSeconds: number | null;
	ttbCount: number | null;
	playStatus: (typeof gameTracking.$inferSelect)['playStatus'];
	completedOn: string | null;
	platinumOn: string | null;
	startedOn: string | null;
	boughtOn: string | null;
	wishlistedOn: string | null;
	owned: boolean;
	ownershipType: (typeof gameTracking.$inferSelect)['ownershipType'];
	ownedVia: (typeof gameTracking.$inferSelect)['ownedVia'];
	/** Tombstone (DW-12): only surfaced when `includeDiscarded` asked for it —
	 * the PS+ flag pass writes through tombstones but must not REPORT them. */
	discarded: boolean;
};

/**
 * The signed-in user's whole library: every game they track, with the tracking
 * columns the shelf needs (AD-13 user scope). Deliberately NOT ordered by
 * `play_status` — shelf ordering derives from the `core/` effective-state
 * function (AD-7), never SQL. The join is via `game_tracking` so a game with no
 * tracking row for this user is absent (the library is what the user tracks).
 * Discarded rows (soft-delete tombstone) are excluded here — this is the SINGLE
 * visibility filter, so shelf, search, stragglers, and CSV export all inherit
 * it. Sync reads `listTrackingForUser` (unfiltered) so it still sees discarded
 * rows to skip them (the Epic 4 sync — deleted by Epic 11; a future sync
 * writer MUST also bump the library version, services/library-version.ts).
 */
/**
 * The shelf's tracking-joined column set — shared by the whole-library read
 * and the single-row by-id read so the two can never drift apart.
 *
 * PS+ facts are DERIVATIONS (Story 8.3, AD-30), not columns: membership is an
 * EXISTS against the REGION's `ps_plus_catalog` on the three identity keys —
 * `external_link('PSN_PRODUCT') ↔ product_id`, `external_link('PSN') ↔
 * np_title_id`, then `title_normalized` (empty title joins nothing — the M7
 * guard) — and the leaving date is a COALESCE over the `ps_plus_departure`
 * ledger in exact-key-first precedence (the browse marker's rules). All are
 * index probes (title/np-title/PK indexes), never a catalog scan. A null
 * region (no setting, no seed) derives false/null — honest absence.
 */
function librarySelection(region: string | null) {
	const r = region ?? '';
	const memberByProduct = sql`EXISTS (SELECT 1 FROM external_link el JOIN ps_plus_catalog c ON c.product_id = el.external_id AND c.region = ${r} AND c.tier = 'extra' WHERE el.game_id = ${game.id} AND el.source = 'PSN_PRODUCT')`;
	const memberByNpTitle = sql`EXISTS (SELECT 1 FROM external_link el JOIN ps_plus_catalog c ON c.np_title_id = el.external_id AND c.region = ${r} AND c.tier = 'extra' WHERE el.game_id = ${game.id} AND el.source = 'PSN')`;
	const memberByTitle = sql`(${game.titleNormalized} != '' AND EXISTS (SELECT 1 FROM ps_plus_catalog c WHERE c.region = ${r} AND c.tier = 'extra' AND c.title_normalized = ${game.titleNormalized}))`;
	// EXACT KEY IS AUTHORITATIVE (review, M2): a bare COALESCE cannot tell "no
	// ledger row" from "row with a NULL date" — a product-keyed reprieve would
	// fall through to a title-colliding product's stale date. CASE stops at the
	// first key that HAS a row, whatever its date says. Title legs order by
	// product_id so a multi-row title collision answers deterministically.
	const rowByProduct = sql`EXISTS (SELECT 1 FROM external_link el JOIN ps_plus_departure d ON d.product_id = el.external_id AND d.region = ${r} AND d.tier = 'extra' WHERE el.game_id = ${game.id} AND el.source = 'PSN_PRODUCT')`;
	const rowByNpTitle = sql`EXISTS (SELECT 1 FROM external_link el JOIN ps_plus_departure d ON d.np_title_id = el.external_id AND d.region = ${r} AND d.tier = 'extra' WHERE el.game_id = ${game.id} AND el.source = 'PSN')`;
	// DATED ROWS FIRST (8.3 follow-up review, M2): sibling editions share keys,
	// and a delisted sibling's stamped row carries `leaving_on NULL` by design —
	// bare product-id order let it permanently mask the surviving sibling's live
	// date. `leaving_on IS NULL` sorts dated rows ahead; product_id tiebreaks.
	const leavingByProduct = sql`(SELECT d.leaving_on FROM external_link el JOIN ps_plus_departure d ON d.product_id = el.external_id AND d.region = ${r} AND d.tier = 'extra' WHERE el.game_id = ${game.id} AND el.source = 'PSN_PRODUCT' ORDER BY d.leaving_on IS NULL, d.product_id LIMIT 1)`;
	const leavingByNpTitle = sql`(SELECT d.leaving_on FROM external_link el JOIN ps_plus_departure d ON d.np_title_id = el.external_id AND d.region = ${r} AND d.tier = 'extra' WHERE el.game_id = ${game.id} AND el.source = 'PSN' ORDER BY d.leaving_on IS NULL, d.product_id LIMIT 1)`;
	const leavingByTitle = sql`(SELECT d.leaving_on FROM ps_plus_departure d WHERE d.region = ${r} AND d.tier = 'extra' AND ${game.titleNormalized} != '' AND d.title_normalized = ${game.titleNormalized} ORDER BY d.leaving_on IS NULL, d.product_id LIMIT 1)`;
	return {
		id: game.id,
		title: game.title,
		titleNormalized: game.titleNormalized,
		releaseDate: game.releaseDate,
		coverUrl: game.coverUrl,
		storeUrl: game.storeUrl,
		psPlusExtra:
			sql<boolean>`(${memberByProduct} OR ${memberByNpTitle} OR ${memberByTitle})`.mapWith(
				Boolean,
			),
		unenriched: game.unenriched,
		criticScore: game.criticScore,
		criticScoreCount: game.criticScoreCount,
		userScore: game.userScore,
		userScoreCount: game.userScoreCount,
		psPlusLeavingOn: sql<
			string | null
		>`CASE WHEN ${rowByProduct} THEN ${leavingByProduct} WHEN ${rowByNpTitle} THEN ${leavingByNpTitle} ELSE ${leavingByTitle} END`,
		ttbStorySeconds: game.ttbStorySeconds,
		ttbCompleteSeconds: game.ttbCompleteSeconds,
		ttbCount: game.ttbCount,
		playStatus: gameTracking.playStatus,
		completedOn: gameTracking.completedOn,
		platinumOn: gameTracking.platinumOn,
		startedOn: gameTracking.startedOn,
		boughtOn: gameTracking.boughtOn,
		wishlistedOn: gameTracking.wishlistedOn,
		owned: gameTracking.owned,
		ownershipType: gameTracking.ownershipType,
		ownedVia: gameTracking.ownedVia,
		discarded: gameTracking.discarded,
	} as const;
}

export async function listLibraryForUser(
	db: Db,
	userId: string,
	// DW-12: sweep-style callers need the tombstones too — catalog membership
	// describes the region's catalog, not user visibility.
	// `region` drives the PS+ derivations (Story 8.3); null derives absence.
	{
		includeDiscarded = false,
		region = null,
	}: { includeDiscarded?: boolean; region?: string | null } = {},
): Promise<LibraryRow[]> {
	return db
		.select(librarySelection(region))
		.from(gameTracking)
		.innerJoin(game, eq(gameTracking.gameId, game.id))
		.where(
			and(
				eq(gameTracking.userId, userId),
				...(includeDiscarded ? [] : [eq(gameTracking.discarded, false)]),
			),
		);
}

/**
 * ONE library row by game id (Story 8.6): the `GET /games/:id` read, replacing
 * the bake-everything-and-find shape. Same join, columns, and discard filter as
 * `listLibraryForUser`, so the DTO parity the old shape guaranteed by
 * construction is now guaranteed by the shared `librarySelection`.
 */
export async function findLibraryRowById(
	db: Db,
	userId: string,
	gameId: string,
	region: string | null = null,
): Promise<LibraryRow | null> {
	const rows = await db
		.select(librarySelection(region))
		.from(gameTracking)
		.innerJoin(game, eq(gameTracking.gameId, game.id))
		.where(
			and(
				eq(gameTracking.userId, userId),
				eq(gameTracking.gameId, gameId),
				eq(gameTracking.discarded, false),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

/** The marker columns the catalog browse joins against (Story 8.6) — enough
 * for the in-library/owned/leaving card marks, nothing more. */
export type LibraryMarkerRow = {
	id: string;
	titleNormalized: string;
	owned: boolean;
};

const MARKER_CHUNK = 90; // D1's ~100-bind cap, with headroom for the fixed binds

/**
 * The user's live library rows whose normalized title is in `keys` — the
 * catalog page's title-join, scoped to the page instead of the whole library
 * (Story 8.6). Chunked under the bind cap.
 */
export async function listLibraryRowsByNormalizedTitles(
	db: Db,
	userId: string,
	keys: string[],
): Promise<LibraryMarkerRow[]> {
	const out: LibraryMarkerRow[] = [];
	for (let i = 0; i < keys.length; i += MARKER_CHUNK) {
		const chunk = keys.slice(i, i + MARKER_CHUNK);
		if (chunk.length === 0) continue;
		out.push(
			...(await db
				.select({
					id: game.id,
					titleNormalized: game.titleNormalized,
					owned: gameTracking.owned,
				})
				.from(gameTracking)
				.innerJoin(game, eq(gameTracking.gameId, game.id))
				.where(
					and(
						eq(gameTracking.userId, userId),
						eq(gameTracking.discarded, false),
						inArray(game.titleNormalized, chunk),
					),
				)),
		);
	}
	return out;
}

/**
 * The user's live library rows linked to any of `externalIds` under `source` —
 * the catalog page's exact-key joins (`PSN_PRODUCT` product ids, `PSN`
 * np-title-ids), scoped to the page (Story 8.6). Chunked under the bind cap.
 */
export async function listUserGamesByExternalIds(
	db: Db,
	userId: string,
	source: (typeof EXTERNAL_LINK_SOURCES)[number],
	externalIds: string[],
): Promise<(LibraryMarkerRow & { externalId: string })[]> {
	const out: (LibraryMarkerRow & { externalId: string })[] = [];
	for (let i = 0; i < externalIds.length; i += MARKER_CHUNK) {
		const chunk = externalIds.slice(i, i + MARKER_CHUNK);
		if (chunk.length === 0) continue;
		out.push(
			...(await db
				.select({
					externalId: externalLink.externalId,
					id: game.id,
					titleNormalized: game.titleNormalized,
					owned: gameTracking.owned,
				})
				.from(externalLink)
				.innerJoin(game, eq(externalLink.gameId, game.id))
				.innerJoin(
					gameTracking,
					and(
						eq(gameTracking.gameId, game.id),
						eq(gameTracking.userId, userId),
						eq(gameTracking.discarded, false),
					),
				)
				.where(
					and(
						eq(externalLink.source, source),
						inArray(externalLink.externalId, chunk),
					),
				)),
		);
	}
	return out;
}

/** SQL count of the user's un-enriched (name-only) games — the straggler badge
 * number without a whole-library read (Story 8.6). */
export async function countUnenrichedForUser(
	db: Db,
	userId: string,
): Promise<number> {
	const rows = await db
		.select({ n: count() })
		.from(gameTracking)
		.innerJoin(game, eq(gameTracking.gameId, game.id))
		.where(
			and(
				eq(gameTracking.userId, userId),
				eq(gameTracking.discarded, false),
				eq(game.unenriched, true),
			),
		);
	return rows[0]?.n ?? 0;
}

/** SQL count of live PS+ claims (`owned_via='membership'`) — the cancel-PS+
 * confirm's number without a whole-tracking read (Story 8.6). */
export async function countMembershipClaimsForUser(
	db: Db,
	userId: string,
): Promise<number> {
	const rows = await db
		.select({ n: count() })
		.from(gameTracking)
		.where(
			and(
				eq(gameTracking.userId, userId),
				eq(gameTracking.owned, true),
				eq(gameTracking.ownedVia, 'membership'),
				eq(gameTracking.discarded, false),
			),
		);
	return rows[0]?.n ?? 0;
}

/**
 * Distinct games tracked by ANY user of `region` (Story 8.4): the leaving
 * sweep's target universe — per-region, user-independent, tombstones included
 * (DW-12: membership facts don't care about user visibility). Carries the
 * game's PSN link ids too (deferred-work 2026-07-19): the sweep must resolve
 * its catalog product through the SAME three legs as the 8.3 membership
 * derivation (product link, np-title link, normalized title) — a catalog-added
 * game is IGDB-retitled on add, so a title-only join silently skipped exactly
 * the games the catalog created, and their leaving date could never populate.
 */
export async function listRegionTrackedGames(
	db: Db,
	region: string,
): Promise<
	{ id: string; title: string; psnProductIds: string[]; npTitleIds: string[] }[]
> {
	const rows = await db
		.selectDistinct({
			id: game.id,
			title: game.title,
			linkSource: externalLink.source,
			linkExternalId: externalLink.externalId,
		})
		.from(gameTracking)
		.innerJoin(game, eq(gameTracking.gameId, game.id))
		.innerJoin(
			setting,
			and(
				eq(setting.userId, gameTracking.userId),
				eq(setting.key, 'psn_region'),
				eq(setting.value, region),
			),
		)
		.leftJoin(
			externalLink,
			and(
				eq(externalLink.gameId, game.id),
				inArray(externalLink.source, ['PSN_PRODUCT', 'PSN']),
			),
		);
	const byId = new Map<
		string,
		{ id: string; title: string; psnProductIds: string[]; npTitleIds: string[] }
	>();
	for (const row of rows) {
		const entry = byId.get(row.id) ?? {
			id: row.id,
			title: row.title,
			psnProductIds: [],
			npTitleIds: [],
		};
		if (row.linkExternalId !== null) {
			if (row.linkSource === 'PSN_PRODUCT')
				entry.psnProductIds.push(row.linkExternalId);
			else if (row.linkSource === 'PSN')
				entry.npTitleIds.push(row.linkExternalId);
		}
		byId.set(row.id, entry);
	}
	// Sorted link ids → a multi-link game resolves the same product every sweep.
	for (const entry of byId.values()) {
		entry.psnProductIds.sort();
		entry.npTitleIds.sort();
	}
	return [...byId.values()];
}
