/**
 * Domain core (AD-3) — pure, I/O-free. Shared `PlayStatus` vocabulary for the
 * effective-state and completion-invariant functions. Kept in `core/` rather
 * than imported from a schema module, since the `GAME`/`GAME_TRACKING`
 * schema doesn't exist yet (Story 1.4).
 */

export type PlayStatus =
	| 'Not started'
	| 'Up next'
	| 'Playing'
	| 'Paused'
	| 'Dropped';

export type EffectiveState =
	| PlayStatus
	| 'Platinum achieved'
	| 'Story completed';
