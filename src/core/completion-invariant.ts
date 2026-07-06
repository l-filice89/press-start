import type { PlayStatus } from './types';

export interface CompletionInvariantInput {
	playStatus: PlayStatus | null;
	completedOn: string | null;
	platinumOn: string | null;
}

/**
 * AD-12/FR-3: pure predicate reporting whether a candidate edit would leave
 * neither a play status nor a completion milestone. Enforcement at the edit
 * boundary is wired in Epic 2 — this story only builds the predicate.
 */
export function wouldViolateCompletionInvariant({
	playStatus,
	completedOn,
	platinumOn,
}: CompletionInvariantInput): boolean {
	return !playStatus && !completedOn && !platinumOn;
}
