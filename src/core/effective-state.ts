import type { EffectiveState, PlayStatus } from './types';

export interface EffectiveStateInput {
	playStatus: PlayStatus | null;
	completedOn: string | null;
	platinumOn: string | null;
}

/**
 * AD-7: the single implementation every consumer (ordering, labels, filters)
 * calls to read a game's effective state — never recomputed elsewhere.
 */
export function computeEffectiveState({
	playStatus,
	completedOn,
	platinumOn,
}: EffectiveStateInput): EffectiveState {
	if (playStatus) return playStatus;
	if (platinumOn) return 'Platinum achieved';
	if (completedOn) return 'Story completed';
	// Invariant violation (no status, no milestone) — enforcement is Epic 2's
	// job (AD-12), not this pure function's, so fall back rather than throw.
	return 'Not started';
}
