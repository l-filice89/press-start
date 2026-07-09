import type { Milestone } from './types';

/** The dates a milestone write reads to decide whether it is a no-op. */
export interface MilestoneInput {
	milestone: Milestone;
	current: {
		completedOn: string | null;
		platinumOn: string | null;
	};
	/** Today as an ISO `YYYY-MM-DD` string — injected, since `core/` is I/O-free (AD-3). */
	today: string;
}

/**
 * The fields a milestone write touches. Exactly one date is stamped and
 * `playStatus` is cleared in the same patch; `started_on` is never here.
 */
export interface MilestonePatch {
	completedOn?: string;
	platinumOn?: string;
	playStatus: null;
}

/**
 * AR-13/AR-21: the single write-side function for logging a milestone, the
 * write twin of `computeEffectiveState`. Stamps the one target date (FR-2/FR-5)
 * and auto-clears `play_status` to null in the same patch — the milestone
 * becomes the effective state. Returns `null` when the target date is already
 * set: the first achievement stands (FR-6), and the caller can skip the write
 * entirely rather than issue an empty UPDATE.
 */
export function applyMilestone({
	milestone,
	current,
	today,
}: MilestoneInput): MilestonePatch | null {
	const field = milestone === 'platinum' ? 'platinumOn' : 'completedOn';
	// `!= null`, not truthiness: an empty-string date must count as "set" too —
	// overwriting it would break first-achievement-stands.
	if (current[field] != null) return null;
	return { [field]: today, playStatus: null };
}
