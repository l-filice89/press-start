/**
 * Per-user tracking persistence (AD-4). PK is `(user_id, game_id)` (AD-17);
 * every function is scoped by `user_id` (AD-13) — no query here can read or
 * write another user's tracking row. This story ships the create/read
 * primitives only; the completion-invariant and append-only-date guards
 * (AD-10/11/12/21) are wired at their edit/ingest boundaries in later epics.
 */
import { and, eq, isNotNull, or, type SQL, sql } from 'drizzle-orm';
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';
import type { DateEdits, OwnershipType, PlayStatus } from '../core';
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

/**
 * Insert a tracking row ONLY if none exists (Story 4.2 sync creates).
 * `onConflictDoNothing` closes the read-decide-write race: a row that
 * appeared since the caller's read is left byte-identical — sync must never
 * overwrite user-entered status/dates (FR-33/AD-10). Returns the inserted
 * row, or undefined when a row already stood.
 */
export async function insertTrackingIfAbsent(
	db: Db,
	userId: string,
	gameId: string,
	values: TrackingPatch,
) {
	const [row] = await db
		.insert(gameTracking)
		.values({ userId, gameId, ...values })
		.onConflictDoNothing()
		.returning();
	return row;
}

/**
 * Guarded UPDATE (never inserts) for the tracking write seam. The services'
 * read-decide-write is untransacted on D1, so the write-once and invariant
 * rules `core/` decided from the read are re-enforced HERE, in the SQL itself
 * (conditional SET / WHERE) — concurrent PATCHes can no longer interleave into
 * a double-stamped write-once date or an invariant-breaking row, and a row
 * deleted underneath us updates nothing instead of being resurrected.
 * Returns the updated row, or undefined when the row is gone or the guard
 * refused — the caller re-reads to tell those apart.
 */
async function updateTrackingWhere(
	db: Db,
	userId: string,
	gameId: string,
	set: SQLiteUpdateSetSource<typeof gameTracking>,
	guard?: SQL,
) {
	const [row] = await db
		.update(gameTracking)
		.set(set)
		.where(
			and(
				eq(gameTracking.userId, userId),
				eq(gameTracking.gameId, gameId),
				guard,
			),
		)
		.returning();
	return row;
}

/**
 * Play-status write (Story 2.1/2.3). `startedOn` is stamped only while the
 * row is still start-less and milestone-free (FR-44 write-once, re-checked in
 * SQL); clearing the status requires a milestone to survive on the row itself
 * (FR-3/AR-12 completion invariant, re-checked in SQL).
 */
export async function updateTrackingStatus(
	db: Db,
	userId: string,
	gameId: string,
	patch: { playStatus: PlayStatus | null; startedOn?: string },
) {
	const set: SQLiteUpdateSetSource<typeof gameTracking> = {
		playStatus: patch.playStatus,
	};
	if (patch.startedOn !== undefined) {
		set.startedOn = sql`CASE WHEN ${gameTracking.startedOn} IS NULL AND ${gameTracking.completedOn} IS NULL AND ${gameTracking.platinumOn} IS NULL THEN ${patch.startedOn} ELSE ${gameTracking.startedOn} END`;
	}
	const guard =
		patch.playStatus === null
			? or(
					isNotNull(gameTracking.completedOn),
					isNotNull(gameTracking.platinumOn),
				)
			: undefined;
	return updateTrackingWhere(db, userId, gameId, set, guard);
}

/**
 * Milestone write (Story 2.2). First achievement stands (FR-6): the date
 * columns are COALESCEd so a concurrent stamp can never be overwritten.
 */
export async function updateTrackingMilestone(
	db: Db,
	userId: string,
	gameId: string,
	patch: { completedOn?: string; platinumOn?: string; playStatus?: null },
) {
	const set: SQLiteUpdateSetSource<typeof gameTracking> = {};
	if (patch.completedOn !== undefined) {
		set.completedOn = sql`COALESCE(${gameTracking.completedOn}, ${patch.completedOn})`;
	}
	if (patch.platinumOn !== undefined) {
		set.platinumOn = sql`COALESCE(${gameTracking.platinumOn}, ${patch.platinumOn})`;
	}
	if ('playStatus' in patch) set.playStatus = patch.playStatus;
	return updateTrackingWhere(db, userId, gameId, set);
}

/**
 * Ownership write (Story 2.4). `bought_on` is COALESCEd (FR-44 write-once,
 * re-checked in SQL); a bare type switch (no `owned` key) is guarded on the
 * row still being owned — a racing un-own refuses it instead of persisting a
 * type on an un-owned row.
 */
export async function updateTrackingOwnership(
	db: Db,
	userId: string,
	gameId: string,
	patch: {
		owned?: boolean;
		ownershipType?: OwnershipType | null;
		boughtOn?: string;
		ownedVia?: 'purchase' | 'membership' | null;
	},
) {
	const set: SQLiteUpdateSetSource<typeof gameTracking> = {};
	if (patch.owned !== undefined) set.owned = patch.owned;
	if (patch.ownershipType !== undefined)
		set.ownershipType = patch.ownershipType;
	if (patch.boughtOn !== undefined) {
		set.boughtOn = sql`COALESCE(${gameTracking.boughtOn}, ${patch.boughtOn})`;
	}
	if (patch.ownedVia !== undefined) set.ownedVia = patch.ownedVia;
	const guard =
		patch.owned === undefined ? eq(gameTracking.owned, true) : undefined;
	return updateTrackingWhere(db, userId, gameId, set, guard);
}

/**
 * Manual date edits (Story 2.4, FR-45 — deliberate overrides, so no COALESCE
 * here). The completion invariant is re-checked in SQL on what the row will
 * hold AFTER the edit: unless the edit itself leaves a milestone date set,
 * the row must still carry a play status or an untouched milestone date.
 */
export async function updateTrackingDates(
	db: Db,
	userId: string,
	gameId: string,
	patch: DateEdits,
) {
	const editKeepsMilestone =
		(patch.completedOn ?? null) !== null || (patch.platinumOn ?? null) !== null;
	let guard: SQL | undefined;
	if (!editKeepsMilestone) {
		const terms = [isNotNull(gameTracking.playStatus)];
		if (patch.completedOn === undefined)
			terms.push(isNotNull(gameTracking.completedOn));
		if (patch.platinumOn === undefined)
			terms.push(isNotNull(gameTracking.platinumOn));
		guard = or(...terms);
	}
	return updateTrackingWhere(db, userId, gameId, patch, guard);
}

/** Every tracking row for a user (AD-13 scope). */
export async function listTrackingForUser(db: Db, userId: string) {
	return db.select().from(gameTracking).where(eq(gameTracking.userId, userId));
}
