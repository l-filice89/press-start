import type { PlayStatus, ShelfGame } from './api';

/**
 * Shelf filter model (Stories 3.1/3.2, FR-20/21). OR within a group, AND
 * across groups. The payload is the whole server-ordered library (live
 * statuses first, hidden states ranked after — FR-18); the filter derives the
 * visible set: the state group (selected states, or the live default set)
 * unioned with the reveal pills, then each active flag ANDs. Filtering is a
 * pure, order-preserving subset — never re-sort here.
 */

export const LIVE_STATUSES = [
	'Not started',
	'Up next',
	'Playing',
	'Paused',
] as const satisfies readonly PlayStatus[];

export type LiveStatus = (typeof LIVE_STATUSES)[number];

/** The backlog-hidden states, reachable only via their reveal pill (FR-4/17). */
export const REVEAL_STATES = [
	'Story completed',
	'Platinum achieved',
	'Dropped',
] as const;

export type RevealState = (typeof REVEAL_STATES)[number];

/** Derived-flag pills — each active one is its own AND group (FR-20). */
export const FLAGS = [
	{ key: 'owned', label: 'Owned' },
	{ key: 'wishlisted', label: 'Wishlisted' },
	{ key: 'released', label: 'Released' },
	{ key: 'playableNow', label: 'Playable now' },
] as const;

export type FlagKey = (typeof FLAGS)[number]['key'];

export type ShelfFilter = {
	states: LiveStatus[];
	genres: string[];
	reveals: RevealState[];
	flags: FlagKey[];
};

export const EMPTY_FILTER: ShelfFilter = {
	states: [],
	genres: [],
	reveals: [],
	flags: [],
};

export function isFilterActive(filter: ShelfFilter): boolean {
	return (
		filter.states.length > 0 ||
		filter.genres.length > 0 ||
		filter.reveals.length > 0 ||
		filter.flags.length > 0
	);
}

/**
 * The filter predicate consumes the server-computed `effectiveState`, `genres`,
 * and derived flags on each game — never recomputed client-side (AD-7).
 * The empty filter yields the default visible set (live statuses only).
 */
export function applyShelfFilter(
	games: ShelfGame[],
	filter: ShelfFilter,
): ShelfGame[] {
	// State group: the selected states (else the live default set), plus every
	// revealed hidden state (reveal pills extend the group — FR-21).
	const allowedStates: readonly string[] = [
		...(filter.states.length > 0 ? filter.states : LIVE_STATUSES),
		...filter.reveals,
	];
	return games.filter(
		(game) =>
			allowedStates.includes(game.effectiveState) &&
			(filter.genres.length === 0 ||
				game.genres.some((genre) => filter.genres.includes(genre))) &&
			filter.flags.every((flag) => game[flag]),
	);
}

/** Toggle one value in a selection list, preserving insertion order. */
export function toggleSelection<T>(selected: T[], value: T): T[] {
	return selected.includes(value)
		? selected.filter((v) => v !== value)
		: [...selected, value];
}
