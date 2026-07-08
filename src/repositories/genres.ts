/**
 * Genre + game↔genre persistence (AD-4). Genre vocabulary is IGDB-sourced
 * (FR-23) and auto-created on first sighting; both `upsertGenre` and
 * `linkGameGenre` are idempotent so ingest can replay safely.
 */
import { eq, inArray } from 'drizzle-orm';
import { gameGenre, genre } from '../schema/catalog';
import type { Db } from './db';

/** Auto-create a genre by name, or return the existing one. Idempotent (unique name). */
export async function upsertGenre(db: Db, name: string) {
	const [row] = await db
		.insert(genre)
		.values({ name })
		.onConflictDoUpdate({ target: genre.name, set: { name } })
		.returning();
	return row;
}

/** Tag a game with a genre. Idempotent — the composite PK ignores a repeat. */
export async function linkGameGenre(db: Db, gameId: string, genreId: string) {
	await db.insert(gameGenre).values({ gameId, genreId }).onConflictDoNothing();
}

/** Every genre tagged on a game. */
export async function listGenresForGame(db: Db, gameId: string) {
	return db
		.select({ id: genre.id, name: genre.name })
		.from(gameGenre)
		.innerJoin(genre, eq(gameGenre.genreId, genre.id))
		.where(eq(gameGenre.gameId, gameId));
}

/**
 * Genres for many games in one query (the shelf bakes ~344 games' genres at
 * once — a per-game query would be N+1). Returns flat `{ gameId, name }` rows
 * for the service to group. An empty id list short-circuits (drizzle's
 * `inArray([])` would otherwise emit an always-false clause / warn).
 */
export async function listGenresForGames(
	db: Db,
	gameIds: readonly string[],
): Promise<{ gameId: string; name: string }[]> {
	if (gameIds.length === 0) return [];
	return db
		.select({ gameId: gameGenre.gameId, name: genre.name })
		.from(gameGenre)
		.innerJoin(genre, eq(gameGenre.genreId, genre.id))
		.where(inArray(gameGenre.gameId, [...gameIds]));
}
