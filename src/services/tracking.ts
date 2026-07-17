/**
 * Play-status and milestone writes (Stories 2.1/2.2). The orchestration seam:
 * reads the user's tracking row through `repositories/` (AD-4), asks `core/`
 * what to write (AD-11 — write-once dates), persists, and reports the new
 * effective state through the single read function (AD-7). Every call is
 * user-scoped (AD-13): a row that isn't this user's simply isn't found.
 */
import {
	applyDateEdits,
	applyMilestone,
	applyOwnershipChange,
	applyPlayStatusChange,
	computeEffectiveState,
	type DateEdits,
	type EffectiveState,
	type Milestone,
	type OwnershipType,
	type PlayStatus,
	wouldViolateCompletionInvariant,
} from '../core';
import {
	countMembershipClaimsForUser,
	getTracking,
	listTrackingForUser,
	setDiscarded,
	updateTrackingDates,
	updateTrackingMilestone,
	updateTrackingOwnership,
	updateTrackingStatus,
} from '../repositories';
import type { Db } from '../repositories/db';
import { bumpLibraryVersion } from './library-version';

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

	// The invariant and the write-once `started_on` stamp are ALSO re-checked
	// inside the UPDATE's SQL — the read above is advisory (fast 409), the SQL
	// is the enforcement (untransacted seam, concurrent PATCHes can interleave).
	const patch = applyPlayStatusChange({ next, current, today });
	const updated = await updateTrackingStatus(db, userId, gameId, patch);
	// Nothing updated: the SQL guard refused a clear whose milestone raced
	// away (409), or the row was deleted underneath us (404).
	if (!updated) {
		return (await getTracking(db, userId, gameId)) ? 'invariant' : null;
	}

	await bumpLibraryVersion(db, userId);
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

	// First-achievement-stands (FR-6) is ALSO enforced in the UPDATE's SQL
	// (COALESCE) — a stamp that races this read can never be overwritten.
	const patch = applyMilestone({ milestone, current, today });
	const row = patch
		? await updateTrackingMilestone(db, userId, gameId, patch)
		: current;
	// Nothing updated: the row was deleted underneath us (404).
	if (!row) return null;

	if (patch) await bumpLibraryVersion(db, userId);
	return computeEffectiveState({
		playStatus: row.playStatus,
		completedOn: row.completedOn,
		platinumOn: row.platinumOn,
	});
}

/**
 * Change the ownership flag and/or type on this user's tracking row
 * (Story 2.4). `core/` owns the rules (AR-13): owning stamps `bought_on` only
 * when null (FR-44 write-once) and defaults the type to physical; un-owning
 * clears the type, never a date. `'invalid'` (a type on an un-owned game —
 * nothing written, the route answers 400) and `null` (no tracking row → 404)
 * pass through.
 */
export async function changeOwnership(
	db: Db,
	userId: string,
	gameId: string,
	next: { owned?: boolean; ownershipType?: OwnershipType },
	today: string,
	// `membership` = a PS+ claim (sync only): owned, but no bought_on stamp
	// and flagged for a future subscription-cancel un-own (FR-9 amended).
	via: 'purchase' | 'membership' = 'purchase',
): Promise<EffectiveState | 'invalid' | null> {
	const current = await getTracking(db, userId, gameId);
	if (!current) return null;

	const patch = applyOwnershipChange({ next, current, today, via });
	if (patch === 'invalid') return 'invalid';

	// Write-once `bought_on` (COALESCE) and owned-only type switches (guard)
	// are ALSO enforced in the UPDATE's SQL — the read above is advisory.
	const updated = await updateTrackingOwnership(db, userId, gameId, patch);
	// Nothing updated: the SQL guard refused a type switch whose ownership
	// raced away (400), or the row was deleted underneath us (404).
	if (!updated) {
		return (await getTracking(db, userId, gameId)) ? 'invalid' : null;
	}

	await bumpLibraryVersion(db, userId);
	return computeEffectiveState({
		playStatus: updated.playStatus,
		completedOn: updated.completedOn,
		platinumOn: updated.platinumOn,
	});
}

/**
 * Owned PS+ claims (`owned_via='membership'`) this user still holds — the count
 * the cancel-PS+ confirm names before acting (Story 6.4 AC4). Derives from the
 * one unfiltered tracking read, same filter `cancelMembership` un-owns by.
 */
export async function countMembershipClaims(
	db: Db,
	userId: string,
): Promise<number> {
	// SQL COUNT (Story 8.6) — same predicate `cancelMembership` un-owns by,
	// without hauling the whole tracking table for a `.length`.
	return countMembershipClaimsForUser(db, userId);
}

/**
 * Un-own every PS+ claim on subscription cancel (Story 6.4 AC4, FR-9 amended).
 * Reverses ownership ONLY — `owned=false, ownershipType=null, ownedVia=null` —
 * on each live (`!discarded`) `owned_via='membership'` row; purchases
 * (`owned_via='purchase'`) are never in the filter, and playStatus/milestones/
 * dates/discarded are never written. Discarded claims are excluded so the count
 * the confirm named matches the visible shelf.
 *
 * IT DOES NOT TOUCH `ps_plus_extra` (Epic 7 cross-story review, H2). It used to
 * re-flag every claim `true` from "last-known membership" — on the premise that
 * `runPsPlusCheck` only flagged NON-owned rows. Story 7.1 deleted that premise:
 * the flag is now maintained for EVERY tracked game, owned included, so it is a
 * faithful cache of `ps_plus_catalog` and is already correct at cancel time.
 * Re-flagging forced it TRUE for rows the snapshot says are NOT in the catalog —
 * a PS+ ESSENTIAL monthly game, or an Extra title that has since left — which
 * then wore the ◈ PS+ pill, counted in the filter and exported as `yes` until the
 * next monthly refresh, up to 30 days later.
 */
export async function cancelMembership(
	db: Db,
	userId: string,
): Promise<{ unowned: number }> {
	const rows = await listTrackingForUser(db, userId);
	const claims = rows.filter(
		(r) => r.owned && r.ownedVia === 'membership' && !r.discarded,
	);
	for (const r of claims) {
		await updateTrackingOwnership(db, userId, r.gameId, {
			owned: false,
			ownershipType: null,
			ownedVia: null,
		});
	}
	if (claims.length > 0) await bumpLibraryVersion(db, userId);
	return { unowned: claims.length };
}

/**
 * Manually correct lifecycle dates on this user's tracking row (Story 2.4,
 * FR-45 — a deliberate override that never touches `play_status`). `core/`
 * validates and enforces the completion invariant on the merged result:
 * `'invalid'` (malformed date → 400) and `'invariant'` (would clear the last
 * milestone of a status-less game → 409) pass through with nothing written.
 */
export async function editDates(
	db: Db,
	userId: string,
	gameId: string,
	edits: DateEdits,
): Promise<EffectiveState | 'invalid' | 'invariant' | null> {
	const current = await getTracking(db, userId, gameId);
	if (!current) return null;

	const patch = applyDateEdits({ edits, current });
	if (patch === 'invalid' || patch === 'invariant') return patch;

	// The completion invariant is ALSO re-checked in the UPDATE's SQL against
	// the row as it will stand AFTER the edit — the read above is advisory.
	const updated = await updateTrackingDates(db, userId, gameId, patch);
	// Nothing updated: the SQL guard refused an edit whose invariant cover
	// raced away (409), or the row was deleted underneath us (404).
	if (!updated) {
		return (await getTracking(db, userId, gameId)) ? 'invariant' : null;
	}

	await bumpLibraryVersion(db, userId);
	return computeEffectiveState({
		playStatus: updated.playStatus,
		completedOn: updated.completedOn,
		platinumOn: updated.platinumOn,
	});
}

/**
 * Discard / revive one game (soft-delete tombstone, 2026-07-11). A pure flag
 * flip — no effective-state or invariant logic — so this is a thin scope +
 * existence wrapper over the repository. Returns false when the user has no
 * tracking row for the game (route answers 404); the tombstone is never
 * inserted, only flipped on a real row.
 */
export async function setGameDiscarded(
	db: Db,
	userId: string,
	gameId: string,
	discarded: boolean,
): Promise<boolean> {
	const flipped = Boolean(await setDiscarded(db, userId, gameId, discarded));
	if (flipped) await bumpLibraryVersion(db, userId);
	return flipped;
}
