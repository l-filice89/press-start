/**
 * Genre + game↔genre persistence (AD-4). Genre vocabulary is IGDB-sourced
 * (FR-23) and auto-created on first sighting; both `upsertGenre` and
 * `linkGameGenre` are idempotent so ingest can replay safely.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
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

/**
 * Case-insensitive vocabulary lookup (Story 2.5): `action` finds `Action`, so
 * a manual add reuses the IGDB row instead of minting a near-duplicate.
 */
export async function findGenreByNameInsensitive(db: Db, name: string) {
	const [row] = await db
		.select()
		.from(genre)
		.where(sql`lower(${genre.name}) = lower(${name})`)
		.limit(1);
	return row;
}

/** Untag a game. Idempotent — deleting an absent link is a no-op. */
export async function unlinkGameGenre(db: Db, gameId: string, genreId: string) {
	await db
		.delete(gameGenre)
		.where(and(eq(gameGenre.gameId, gameId), eq(gameGenre.genreId, genreId)));
}

// BINARY collation would sort `Zelda` before `action`; NOCASE keeps every
// genre listing alphabetical regardless of the casing a name arrived with.
const byNameNocase = sql`${genre.name} collate nocase`;

/** The whole vocabulary, sorted by name. The genre row survives unlinking. */
export async function listAllGenres(db: Db) {
	return db
		.select({ id: genre.id, name: genre.name })
		.from(genre)
		.orderBy(asc(byNameNocase));
}

/** Tag a game with a genre. Idempotent — the composite PK ignores a repeat. */
export async function linkGameGenre(db: Db, gameId: string, genreId: string) {
	await db.insert(gameGenre).values({ gameId, genreId }).onConflictDoNothing();
}

/** Every genre tagged on a game, sorted so chips render in a stable order. */
export async function listGenresForGame(db: Db, gameId: string) {
	return db
		.select({ id: genre.id, name: genre.name })
		.from(gameGenre)
		.innerJoin(genre, eq(gameGenre.genreId, genre.id))
		.where(eq(gameGenre.gameId, gameId))
		.orderBy(asc(byNameNocase));
}

/**
 * Genres for many games (the shelf bakes a whole library's genres at once — a
 * per-game query would be N+1). Returns flat `{ gameId, name }` rows for the
 * service to group. An empty id list short-circuits (drizzle's `inArray([])`
 * would otherwise emit an always-false clause / warn).
 *
 * D1/SQLite caps bound parameters per statement well under a real library's
 * size (hit at 181 games), so the id list is chunked into multiple queries
 * rather than one `inArray` with hundreds of params.
 */
const GENRE_LOOKUP_CHUNK_SIZE = 100;

export async function listGenresForGames(
	db: Db,
	gameIds: readonly string[],
): Promise<{ gameId: string; name: string }[]> {
	if (gameIds.length === 0) return [];
	const rows: { gameId: string; name: string }[] = [];
	for (let i = 0; i < gameIds.length; i += GENRE_LOOKUP_CHUNK_SIZE) {
		const chunk = gameIds.slice(i, i + GENRE_LOOKUP_CHUNK_SIZE);
		rows.push(
			...(await db
				.select({ gameId: gameGenre.gameId, name: genre.name })
				.from(gameGenre)
				.innerJoin(genre, eq(gameGenre.genreId, genre.id))
				.where(inArray(gameGenre.gameId, chunk))
				.orderBy(asc(byNameNocase))),
		);
	}
	return rows;
}
