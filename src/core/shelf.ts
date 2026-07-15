/**
 * Shelf ordering + visibility (AD-7) — pure, I/O-free. This is the single
 * place that turns a game's effective state into shelf order and default-view
 * visibility; ordering/labels/filters consume it and none re-derive. There is
 * deliberately no SQL `ORDER BY play_status` anywhere — the sorted set is
 * materialized here (in the Worker/client) at v1's ~344-game scale.
 */
import type { EffectiveState } from './types';

/**
 * Shelf state priority (FR-17/18): live play statuses first, in
 * Playing→Paused→Up next→Not started priority. The backlog-hidden states rank
 * after every live one — they only appear when a reveal filter (Story 3.2)
 * asks for the unfiltered ordering — milestones grouped before `Dropped`.
 */
export const SHELF_STATE_ORDER: readonly EffectiveState[] = [
	'Playing',
	'Paused',
	'Up next',
	'Not started',
	'Story completed',
	'Platinum achieved',
	'Dropped',
];

/**
 * The four live statuses of the default (unfiltered) shelf view. Deliberately
 * NOT derived from `SHELF_STATE_ORDER` — the order list now ranks hidden
 * states too, and visibility must not widen when ordering does.
 */
const DEFAULT_VISIBLE_STATES: readonly EffectiveState[] = [
	'Playing',
	'Paused',
	'Up next',
	'Not started',
];

/**
 * Whether a game with this effective state shows on the default (unfiltered)
 * shelf. Only the four live statuses do; `Story completed`,
 * `Platinum achieved`, and `Dropped` are the backlog-hidden states (FR-4/17).
 */
export function isDefaultShelfVisible(state: EffectiveState): boolean {
	return DEFAULT_VISIBLE_STATES.includes(state);
}

/** The minimal shape shelf ordering needs — effective state + ownership + title. */
export interface ShelfSortable {
	effectiveState: EffectiveState;
	owned: boolean;
	title: string;
}

/**
 * Sort rank: the state's index in `SHELF_STATE_ORDER`. Every effective state
 * is listed, so the fallback is defensive only (a future state added to the
 * vocabulary but not the order list sorts last instead of first).
 */
function shelfRank(state: EffectiveState): number {
	const index = SHELF_STATE_ORDER.indexOf(state);
	return index === -1 ? SHELF_STATE_ORDER.length : index;
}

/**
 * Comparator over the shelf: by state priority, then owned before wishlisted
 * (`wishlisted = !owned` — this tier is ownership, NOT `playableNow`: an owned
 * pre-order still sorts first, an un-owned PS+-catalog game still sinks),
 * then alphabetical by title. Case-insensitive, locale-aware title compare so
 * `apex` and `Apex` sort together. (FR-18, ownership tier 2026-07-09.)
 */
export function compareShelf(a: ShelfSortable, b: ShelfSortable): number {
	const byState = shelfRank(a.effectiveState) - shelfRank(b.effectiveState);
	if (byState !== 0) return byState;
	if (a.owned !== b.owned) return a.owned ? -1 : 1;
	return compareTitle(a.title, b.title);
}

/**
 * The title tiebreaker — case-insensitive, locale-aware (`apex` sorts with
 * `Apex`). Extracted (Story 7.2) because the CATALOG orders by title ALONE:
 * it reuses this comparison, never `compareShelf` itself, whose state and
 * ownership tiers would hoist the games you already have to the top of a
 * discovery surface (UX: "reuse the tiebreaker, not the sort").
 */
export function compareTitle(a: string, b: string): number {
	return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

/** Return a new array ordered for the shelf (never mutates the input). */
export function orderShelf<T extends ShelfSortable>(items: readonly T[]): T[] {
	return [...items].sort(compareShelf);
}
