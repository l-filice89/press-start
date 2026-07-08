import type { PlayStatus } from './types';

/** The dates a play-status change reads to decide whether `started_on` is stamped. */
export interface PlayStatusChangeInput {
	next: PlayStatus;
	current: {
		startedOn: string | null;
		completedOn: string | null;
		platinumOn: string | null;
	};
	/** Today as an ISO `YYYY-MM-DD` string — injected, since `core/` is I/O-free (AD-3). */
	today: string;
}

/** The fields a play-status change writes. An omitted key means "don't touch it". */
export interface PlayStatusChangePatch {
	playStatus: PlayStatus;
	startedOn?: string;
}

/**
 * AD-11/FR-44/FR-45: the single write-side function for a play-status change,
 * symmetric to `computeEffectiveState`'s read side (AD-7). `started_on` is
 * stamped on the FIRST transition to `Playing` and only while no completion
 * milestone exists — a re-transition never overwrites it, and a replay (a game
 * with `completed_on`/`platinum_on`) never writes it at all.
 */
export function applyPlayStatusChange({
	next,
	current,
	today,
}: PlayStatusChangeInput): PlayStatusChangePatch {
	const stampStart =
		next === 'Playing' &&
		!current.startedOn &&
		!current.completedOn &&
		!current.platinumOn;
	return stampStart
		? { playStatus: next, startedOn: today }
		: { playStatus: next };
}
