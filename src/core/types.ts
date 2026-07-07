/**
 * Domain core (AD-3) — pure, I/O-free. Shared `PlayStatus` vocabulary for the
 * effective-state and completion-invariant functions. Kept in `core/` rather
 * than imported from a schema module, since the `GAME`/`GAME_TRACKING`
 * schema doesn't exist yet (Story 1.4).
 */

/**
 * The play-status vocabulary. Declared as a runtime tuple (not just a type) so
 * the persistence layer (`schema/catalog.ts`) can key its `play_status` enum
 * column off this single source rather than re-listing the values — `core/`
 * owns the domain vocabulary (AD-3).
 */
export const PLAY_STATUSES = [
	'Not started',
	'Up next',
	'Playing',
	'Paused',
	'Dropped',
] as const;

export type PlayStatus = (typeof PLAY_STATUSES)[number];

export type EffectiveState =
	| PlayStatus
	| 'Platinum achieved'
	| 'Story completed';
