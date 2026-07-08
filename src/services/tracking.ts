/**
 * Play-status writes (Story 2.1). The orchestration seam: reads the user's
 * tracking row through `repositories/` (AD-4), asks `core/` what to write
 * (AD-11 — `started_on` write-once), persists, and reports the new effective
 * state through the single read function (AD-7). Every call is user-scoped
 * (AD-13): a row that isn't this user's simply isn't found.
 */
import {
	applyPlayStatusChange,
	computeEffectiveState,
	type EffectiveState,
	type PlayStatus,
} from '../core';
import { getTracking, upsertTracking } from '../repositories';
import type { Db } from '../repositories/db';

/**
 * Apply a play status to this user's tracking row. Returns the game's new
 * effective state, or `null` when the user has no tracking row for that game
 * (unknown game, or another user's — the route answers 404 either way).
 */
export async function changePlayStatus(
	db: Db,
	userId: string,
	gameId: string,
	next: PlayStatus,
	today: string,
): Promise<EffectiveState | null> {
	const current = await getTracking(db, userId, gameId);
	if (!current) return null;

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
