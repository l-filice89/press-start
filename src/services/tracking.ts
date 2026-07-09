/**
 * Play-status and milestone writes (Stories 2.1/2.2). The orchestration seam:
 * reads the user's tracking row through `repositories/` (AD-4), asks `core/`
 * what to write (AD-11 — write-once dates), persists, and reports the new
 * effective state through the single read function (AD-7). Every call is
 * user-scoped (AD-13): a row that isn't this user's simply isn't found.
 */
import {
	applyMilestone,
	applyPlayStatusChange,
	computeEffectiveState,
	type EffectiveState,
	type Milestone,
	type PlayStatus,
	wouldViolateCompletionInvariant,
} from '../core';
import { getTracking, upsertTracking } from '../repositories';
import type { Db } from '../repositories/db';

/**
 * Apply a play status (or clear it with `null`, Story 2.3) to this user's
 * tracking row. Returns the game's new effective state; `null` when the user
 * has no tracking row for that game (unknown game, or another user's — the
 * route answers 404 either way); or `'invariant'` when clearing would leave
 * neither a status nor a milestone (FR-3/AR-12 — refused, nothing written,
 * the route answers 409).
 */
export async function changePlayStatus(
	db: Db,
	userId: string,
	gameId: string,
	next: PlayStatus | null,
	today: string,
): Promise<EffectiveState | 'invariant' | null> {
	const current = await getTracking(db, userId, gameId);
	if (!current) return null;

	// The completion invariant is enforced HERE, at the API boundary — the UI
	// hiding its Clear control is not the enforcement (AR-12/FR-3).
	if (
		next === null &&
		wouldViolateCompletionInvariant({
			playStatus: null,
			completedOn: current.completedOn,
			platinumOn: current.platinumOn,
		})
	) {
		return 'invariant';
	}

	// `upsertTracking` drops `undefined`, so an omitted `startedOn` is exactly
	// "leave the recorded date alone" — no no-overwrite branch needed here.
	const patch = applyPlayStatusChange({ next, current, today });
	const updated = await upsertTracking(db, userId, gameId, patch);
	// The row was there a moment ago; if the upsert returned nothing, it was
	// deleted underneath us. Report "not found" rather than dereferencing.
	if (!updated) return null;

	return computeEffectiveState({
		playStatus: updated.playStatus,
		completedOn: updated.completedOn,
		platinumOn: updated.platinumOn,
	});
}

/**
 * Log a completion milestone on this user's tracking row. `core/` decides the
 * patch (AR-21): a `null` patch means the date already stands (FR-6), so no
 * UPDATE is issued at all — the current state is reported back unchanged.
 * Returns `null` when the user has no tracking row for that game (unknown, or
 * another user's — the route answers 404 either way).
 */
export async function logMilestone(
	db: Db,
	userId: string,
	gameId: string,
	milestone: Milestone,
	today: string,
): Promise<EffectiveState | null> {
	const current = await getTracking(db, userId, gameId);
	if (!current) return null;

	const patch = applyMilestone({ milestone, current, today });
	const row = patch ? await upsertTracking(db, userId, gameId, patch) : current;
	// The row was there a moment ago; if the upsert returned nothing, it was
	// deleted underneath us. Report "not found" rather than dereferencing.
	if (!row) return null;

	return computeEffectiveState({
		playStatus: row.playStatus,
		completedOn: row.completedOn,
		platinumOn: row.platinumOn,
	});
}
