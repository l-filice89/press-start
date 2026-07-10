/**
 * Genre editing (Story 2.5, FR-24/FR-25): the detail panel's add/remove of a
 * game's genre set. Genres are shared catalog facts, but the write is gated
 * by "this user tracks the game" — no tracking row reads as not found (404),
 * mirroring every other detail-panel write (AD-13). Adding a name not yet in
 * the vocabulary auto-creates the genre row; a case-insensitive match reuses
 * the existing row so the vocabulary never grows near-duplicates. Removing a
 * link never deletes the genre row — the vocabulary persists.
 */

import {
	findGenreByNameInsensitive,
	getTracking,
	linkGameGenre,
	listAllGenres,
	listGenresForGame,
	unlinkGameGenre,
	upsertGenre,
} from '../repositories';
import type { Db } from '../repositories/db';

function normalizeGenreName(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ');
}

async function genreNames(db: Db, gameId: string): Promise<string[]> {
	return (await listGenresForGame(db, gameId)).map((g) => g.name);
}

/**
 * Tag a game with a genre by name. `'invalid'` (empty after trim → 400) and
 * `null` (no tracking row → 404) pass through; otherwise the updated list.
 * Idempotent: re-adding a linked genre changes nothing.
 */
export async function addGenreToGame(
	db: Db,
	userId: string,
	gameId: string,
	rawName: string,
): Promise<string[] | 'invalid' | null> {
	if (!(await getTracking(db, userId, gameId))) return null;

	const name = normalizeGenreName(rawName);
	if (!name) return 'invalid';

	// FR-24: auto-create exactly once — a case-insensitive hit reuses the row.
	// The DB's `lower(name)` unique index is the backstop: two concurrent adds
	// of case-variants can no longer mint a near-duplicate (the loser errors).
	const existing = await findGenreByNameInsensitive(db, name);
	const row = existing ?? (await upsertGenre(db, name));
	await linkGameGenre(db, gameId, row.id);

	return genreNames(db, gameId);
}

/**
 * Untag a game. Idempotent: an unknown or unlinked name answers the current
 * list unchanged. `null` (no tracking row) → 404.
 */
export async function removeGenreFromGame(
	db: Db,
	userId: string,
	gameId: string,
	rawName: string,
): Promise<string[] | null> {
	if (!(await getTracking(db, userId, gameId))) return null;

	const name = normalizeGenreName(rawName);
	if (name) {
		const existing = await findGenreByNameInsensitive(db, name);
		if (existing) await unlinkGameGenre(db, gameId, existing.id);
	}

	return genreNames(db, gameId);
}

/** The whole vocabulary, sorted by name — feeds the add input's suggestions. */
export async function listGenreVocabulary(db: Db): Promise<string[]> {
	return (await listAllGenres(db)).map((g) => g.name);
}
