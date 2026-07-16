/**
 * Game + external-link persistence (AD-4). Game identity is the
 * `external_link (source, external_id)` (AD-18/20), so lookups by normalized
 * title return an array (non-unique candidate key) while lookups by external
 * link return a single game.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
	type EXTERNAL_LINK_SOURCES,
	externalLink,
	game,
	gameTracking,
} from '../schema/catalog';
import type { Db } from './db';

export type GameFacts = {
	title: string;
	titleNormalized: string;
	releaseDate?: string | null;
	coverUrl?: string | null;
	storeUrl?: string | null;
	psPlusExtra?: boolean;
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
 * Set/clear the PS+ Extra catalog flag on a batch of games (Story 5.1,
 * FR-38). Caller scopes the ids to tracked games — this is a dumb batched write.
 *
 * CHUNKED, like `listGenresForGames`: D1 caps bound parameters per statement at
 * 100, and a real library clears more games than that in one refresh (103 →
 * `D1_ERROR: too many SQL variables`, which failed the whole PS+ check). The
 * `value` bind takes one slot, so the id slice is 99, and the chunks go through
 * one `db.batch` so the write still costs a single binding call (AD-15).
 */
const PS_PLUS_FLAG_CHUNK_SIZE = 99;

export async function setPsPlusExtraFlags(
	db: Db,
	gameIds: string[],
	value: boolean,
) {
	if (gameIds.length === 0) return;
	const statements = [];
	for (let i = 0; i < gameIds.length; i += PS_PLUS_FLAG_CHUNK_SIZE) {
		statements.push(
			db
				.update(game)
				.set({ psPlusExtra: value })
				.where(inArray(game.id, gameIds.slice(i, i + PS_PLUS_FLAG_CHUNK_SIZE))),
		);
	}
	await db.batch(statements as [(typeof statements)[0], ...typeof statements]);
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
export async function updateGameScores(
	db: Db,
	updates: { gameId: string; scores: GameScores }[],
) {
	if (updates.length === 0) return;
	const statements = updates.map(({ gameId, scores }) =>
		db.update(game).set(scores).where(eq(game.id, gameId)),
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
	psPlusExtra: boolean;
	unenriched: boolean;
	criticScore: number | null;
	criticScoreCount: number | null;
	userScore: number | null;
	userScoreCount: number | null;
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
 * rows to skip them (services/sync.ts).
 */
export async function listLibraryForUser(
	db: Db,
	userId: string,
	// DW-12: the PS+ flag pass needs the tombstones too — `game.psPlusExtra`
	// describes catalog membership, not user visibility, and a pass that skips
	// discarded rows freezes their flag forever (wrong the moment one is revived).
	{ includeDiscarded = false }: { includeDiscarded?: boolean } = {},
): Promise<LibraryRow[]> {
	return db
		.select({
			id: game.id,
			title: game.title,
			titleNormalized: game.titleNormalized,
			releaseDate: game.releaseDate,
			coverUrl: game.coverUrl,
			storeUrl: game.storeUrl,
			psPlusExtra: game.psPlusExtra,
			unenriched: game.unenriched,
			criticScore: game.criticScore,
			criticScoreCount: game.criticScoreCount,
			userScore: game.userScore,
			userScoreCount: game.userScoreCount,
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
		})
		.from(gameTracking)
		.innerJoin(game, eq(gameTracking.gameId, game.id))
		.where(
			and(
				eq(gameTracking.userId, userId),
				...(includeDiscarded ? [] : [eq(gameTracking.discarded, false)]),
			),
		);
}
