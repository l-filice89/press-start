/**
 * Game + external-link persistence (AD-4). Game identity is the
 * `external_link (source, external_id)` (AD-18/20), so lookups by normalized
 * title return an array (non-unique candidate key) while lookups by external
 * link return a single game.
 */
import { and, eq } from 'drizzle-orm';
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
	owned: boolean;
};

/**
 * The signed-in user's whole library: every game they track, with the tracking
 * columns the shelf needs (AD-13 user scope). Deliberately NOT ordered by
 * `play_status` — shelf ordering derives from the `core/` effective-state
 * function (AD-7), never SQL. The join is via `game_tracking` so a game with no
 * tracking row for this user is absent (the library is what the user tracks).
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
			owned: gameTracking.owned,
		})
		.from(gameTracking)
		.innerJoin(game, eq(gameTracking.gameId, game.id))
		.where(eq(gameTracking.userId, userId));
}
