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

/** One rendered token of the summary sentence (Story 3.3, UX-DR23). */
export type SummaryPart = {
	text: string;
	/** Set on the literal connector words so the UI can tint them (color redundant to the word). */
	connector?: 'or' | 'and';
};

const joinWithOr = (terms: string[]): SummaryPart[] =>
	terms.flatMap((text, i) =>
		i === 0 ? [{ text }] : [{ text: 'or', connector: 'or' as const }, { text }],
	);

/**
 * Plain-English readback of an active filter: OR within a group, AND across
 * groups, as literal words. Reveals narrate inside the state group (they
 * extend it) — with no explicit state selection they extend the DEFAULT set,
 * so the sentence spells the live statuses out rather than claiming a
 * reveal-only subset the shelf doesn't show. Groups are comma-separated
 * before each "and" so two OR-groups can't misread as one. Empty filter → no
 * parts.
 */
export function summarizeFilter(filter: ShelfFilter): SummaryPart[] {
	const groups: SummaryPart[][] = [];
	const stateTerms =
		filter.states.length > 0
			? [...filter.states, ...filter.reveals]
			: filter.reveals.length > 0
				? [...LIVE_STATUSES, ...filter.reveals]
				: [];
	if (stateTerms.length > 0) groups.push(joinWithOr(stateTerms));
	if (filter.genres.length > 0) groups.push(joinWithOr(filter.genres));
	for (const key of filter.flags) {
		const flag = FLAGS.find((f) => f.key === key);
		if (flag) groups.push([{ text: flag.label }]);
	}
	if (groups.length === 0) return [];
	const parts: SummaryPart[] = [{ text: 'Showing' }];
	groups.forEach((group, i) => {
		if (i > 0) {
			// Comma on the previous token scopes the groups audibly and visually.
			parts[parts.length - 1].text += ',';
			parts.push({ text: 'and', connector: 'and' });
		}
		parts.push(...group);
	});
	parts.push({ text: 'games.' });
	return parts;
}

/** The summary as one plain string — feeds live-region announcements. */
export function summarizeFilterText(filter: ShelfFilter): string {
	return summarizeFilter(filter)
		.map((p) => p.text)
		.join(' ');
}

/** Toggle one value in a selection list, preserving insertion order. */
export function toggleSelection<T>(selected: T[], value: T): T[] {
	return selected.includes(value)
		? selected.filter((v) => v !== value)
		: [...selected, value];
}
