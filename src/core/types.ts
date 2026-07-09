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

/**
 * The full effective-state vocabulary (a play status, or a completion
 * milestone when no status is set). A runtime tuple (not just a type) so
 * boundary schemas — e.g. the shelf route's Zod response — key their enum off
 * this single source rather than re-listing the values (AD-3/AD-7).
 */
export const EFFECTIVE_STATES = [
	...PLAY_STATUSES,
	'Platinum achieved',
	'Story completed',
] as const;

export type EffectiveState = (typeof EFFECTIVE_STATES)[number];

/**
 * The completion-milestone vocabulary (Story 2.2). A runtime tuple (not just a
 * type) so the milestone route's Zod body enum keys off this single source
 * rather than re-listing the values (AD-3).
 */
export const MILESTONES = ['completed', 'platinum'] as const;

export type Milestone = (typeof MILESTONES)[number];

/**
 * The ownership-type vocabulary (Story 2.4). A runtime tuple (not just a type)
 * so the schema's `ownership_type` enum column and the ownership route's Zod
 * body key off this single source rather than re-listing the values (AD-3).
 */
export const OWNERSHIP_TYPES = ['physical', 'digital'] as const;

export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];
