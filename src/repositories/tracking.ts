/**
 * Per-user tracking persistence (AD-4). PK is `(user_id, game_id)` (AD-17);
 * every function is scoped by `user_id` (AD-13) — no query here can read or
 * write another user's tracking row. This story ships the create/read
 * primitives only; the completion-invariant and append-only-date guards
 * (AD-10/11/12/21) are wired at their edit/ingest boundaries in later epics.
 */
import { and, eq } from 'drizzle-orm';
import { gameTracking } from '../schema/catalog';
import type { Db } from './db';

/** Columns a caller may set on a tracking row (never `user_id`/`game_id` — those are the key). */
export type TrackingPatch = Partial<
	Omit<typeof gameTracking.$inferInsert, 'userId' | 'gameId'>
>;

/** The tracking row for one user + game, or undefined. */
export async function getTracking(db: Db, userId: string, gameId: string) {
	const [row] = await db
		.select()
		.from(gameTracking)
		.where(
			and(eq(gameTracking.userId, userId), eq(gameTracking.gameId, gameId)),
		)
		.limit(1);
	return row;
}

/** Create or update this user's tracking row for a game; returns the stored row. */
export async function upsertTracking(
	db: Db,
	userId: string,
	gameId: string,
	patch: TrackingPatch = {},
) {
	// Drizzle drops `undefined` values, so a patch that is empty — or carries
	// only `undefined` values (e.g. `{ playStatus: undefined }`) — would leave
	// the `onConflictDoUpdate` SET clause empty and error on the update path.
	// Measure the *defined* fields and, if none remain, fall back to
	// insert-if-absent, returning whatever row now stands.
	const definedFields = Object.fromEntries(
		Object.entries(patch).filter(([, value]) => value !== undefined),
	) as TrackingPatch;

	if (Object.keys(definedFields).length === 0) {
		const [inserted] = await db
			.insert(gameTracking)
			.values({ userId, gameId })
			.onConflictDoNothing()
			.returning();
		return inserted ?? (await getTracking(db, userId, gameId));
	}

	const [row] = await db
		.insert(gameTracking)
		.values({ userId, gameId, ...definedFields })
		.onConflictDoUpdate({
			target: [gameTracking.userId, gameTracking.gameId],
			set: definedFields,
		})
		.returning();
	return row;
}

/** Every tracking row for a user (AD-13 scope). */
export async function listTrackingForUser(db: Db, userId: string) {
	return db.select().from(gameTracking).where(eq(gameTracking.userId, userId));
}
