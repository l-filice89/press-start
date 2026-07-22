/**
 * The shelf ETag's version source (Story 8.6, AD-33 §4). ONE opaque per-user
 * version, rotated by every writer that changes what the user's shelf renders:
 * user-scoped writers rotate that user's row; shared-`game`-fact writers (PS+
 * flags, leaving sweep, scores) rotate EVERY user's row in one UPDATE — the
 * `setting` FK to `user` rules out a global second component without a
 * migration, and an all-rows rotate is the same invalidation for one statement.
 *
 * The invariant is one-directional on purpose: a spurious rotate costs one full
 * 200 instead of a 304; a MISSED rotate serves a stale 304 forever. When in
 * doubt, rotate.
 */
import {
	getSetting,
	setSetting,
	updateSettingForAllUsers,
} from '../repositories';
import type { Db } from '../repositories/db';

export const LIBRARY_VERSION_KEY = 'library_version';

/** Current version, lazily initialized on first read (write-once race-safe). */
export async function readLibraryVersion(
	db: Db,
	userId: string,
): Promise<string> {
	const existing = await getSetting(db, userId, LIBRARY_VERSION_KEY);
	if (existing) return existing;
	const fresh = crypto.randomUUID();
	await setSetting(db, userId, LIBRARY_VERSION_KEY, fresh, {
		onlyIfUnset: true,
	});
	// Re-read: if a concurrent request won the insert race, its value stands.
	return (await getSetting(db, userId, LIBRARY_VERSION_KEY)) ?? fresh;
}

/** Rotate after a user-scoped library write (tracking, genres, add, discard…). */
export async function bumpLibraryVersion(db: Db, userId: string) {
	await setSetting(db, userId, LIBRARY_VERSION_KEY, crypto.randomUUID());
}

/** Rotate every user's version after a shared `game`-fact write (flags,
 * leaving sweep, scores) — one UPDATE, no per-user fan-out. */
export async function bumpAllLibraryVersions(db: Db) {
	await updateSettingForAllUsers(db, LIBRARY_VERSION_KEY, crypto.randomUUID());
}
