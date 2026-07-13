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

/** Every external link for a game. */
export async function listExternalLinks(db: Db, gameId: string) {
	return db.select().from(externalLink).where(eq(externalLink.gameId, gameId));
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
 * Every game with its PSN external ids — the sync planner's matching index
 * (Story 4.2). One bulk read instead of a per-entry lookup fan-out; `game` is
 * shared catalog data (AD-19), so this is not user-scoped.
 */
export async function listGamesWithPsnLinks(db: Db) {
	const games = await db
		.select({
			id: game.id,
			titleNormalized: game.titleNormalized,
			coverUrl: game.coverUrl,
			storeUrl: game.storeUrl,
		})
		.from(game);
	const links = await db
		.select({
			gameId: externalLink.gameId,
			externalId: externalLink.externalId,
		})
		.from(externalLink)
		.where(eq(externalLink.source, 'PSN'));
	return { games, links };
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
 * FR-38). Caller scopes the ids to tracked, non-owned games — this is a dumb
 * batched write.
 */
export async function setPsPlusExtraFlags(
	db: Db,
	gameIds: string[],
	value: boolean,
) {
	if (gameIds.length === 0) return;
	await db
		.update(game)
		.set({ psPlusExtra: value })
		.where(inArray(game.id, gameIds));
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
	releaseDate: string | null;
	coverUrl: string | null;
	storeUrl: string | null;
	psPlusExtra: boolean;
	unenriched: boolean;
	playStatus: (typeof gameTracking.$inferSelect)['playStatus'];
	completedOn: string | null;
	platinumOn: string | null;
	startedOn: string | null;
	boughtOn: string | null;
	wishlistedOn: string | null;
	owned: boolean;
	ownershipType: (typeof gameTracking.$inferSelect)['ownershipType'];
	ownedVia: (typeof gameTracking.$inferSelect)['ownedVia'];
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
): Promise<LibraryRow[]> {
	return db
		.select({
			id: game.id,
			title: game.title,
			releaseDate: game.releaseDate,
			coverUrl: game.coverUrl,
			storeUrl: game.storeUrl,
			psPlusExtra: game.psPlusExtra,
			unenriched: game.unenriched,
			playStatus: gameTracking.playStatus,
			completedOn: gameTracking.completedOn,
			platinumOn: gameTracking.platinumOn,
			startedOn: gameTracking.startedOn,
			boughtOn: gameTracking.boughtOn,
			wishlistedOn: gameTracking.wishlistedOn,
			owned: gameTracking.owned,
			ownershipType: gameTracking.ownershipType,
			ownedVia: gameTracking.ownedVia,
		})
		.from(gameTracking)
		.innerJoin(game, eq(gameTracking.gameId, game.id))
		.where(
			and(eq(gameTracking.userId, userId), eq(gameTracking.discarded, false)),
		);
}
