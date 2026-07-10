import type { PlayStatus, ShelfGame } from './api';

/**
 * Shelf filter model (Story 3.1, FR-20/21). OR within a group, AND across
 * groups; an empty group applies no constraint, so the empty filter yields the
 * default visible set unchanged. Filtering is a pure, order-preserving subset
 * of the already server-ordered `/api/shelf` payload — FR-18 ordering survives
 * because a subset of a sorted list stays sorted (never re-sort here).
 *
 * The State group offers the four LIVE statuses only — Dropped and the
 * milestone states are hidden by default and only reachable via Story 3.2's
 * reveal pills, which extend this type.
 */

export const LIVE_STATUSES = [
	'Not started',
	'Up next',
	'Playing',
	'Paused',
] as const satisfies readonly PlayStatus[];

export type LiveStatus = (typeof LIVE_STATUSES)[number];

export type ShelfFilter = {
	states: LiveStatus[];
	genres: string[];
};

export const EMPTY_FILTER: ShelfFilter = { states: [], genres: [] };

export function isFilterActive(filter: ShelfFilter): boolean {
	return filter.states.length > 0 || filter.genres.length > 0;
}

/**
 * The filter predicate consumes the server-computed `effectiveState` and
 * `genres` on each game — never recomputed client-side (AD-7).
 */
export function applyShelfFilter(
	games: ShelfGame[],
	filter: ShelfFilter,
): ShelfGame[] {
	if (!isFilterActive(filter)) return games;
	const states: readonly string[] = filter.states;
	return games.filter(
		(game) =>
			(states.length === 0 || states.includes(game.effectiveState)) &&
			(filter.genres.length === 0 ||
				game.genres.some((genre) => filter.genres.includes(genre))),
	);
}

/** Toggle one value in a selection list, preserving insertion order. */
export function toggleSelection<T>(selected: T[], value: T): T[] {
	return selected.includes(value)
		? selected.filter((v) => v !== value)
		: [...selected, value];
}
