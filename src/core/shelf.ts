/**
 * Shelf ordering + visibility (AD-7) — pure, I/O-free. This is the single
 * place that turns a game's effective state into shelf order and default-view
 * visibility; ordering/labels/filters consume it and none re-derive. There is
 * deliberately no SQL `ORDER BY play_status` anywhere — the sorted set is
 * materialized here (in the Worker/client) at v1's ~344-game scale.
 */
import type { EffectiveState } from './types';

/**
 * The default backlog view order (FR-17/18): live play statuses only, in
 * Playing→Paused→Up next→Not started priority. Completion milestones
 * (`Story completed`/`Platinum achieved`) and `Dropped` are NOT here — they are
 * hidden from the default shelf.
 */
export const SHELF_STATE_ORDER: readonly EffectiveState[] = [
	'Playing',
	'Paused',
	'Up next',
	'Not started',
];

/**
 * Whether a game with this effective state shows on the default (unfiltered)
 * shelf. Only the four live statuses in `SHELF_STATE_ORDER` do; `Story
 * completed`, `Platinum achieved`, and `Dropped` are the backlog-hidden states
 * (FR-4/17).
 */
export function isDefaultShelfVisible(state: EffectiveState): boolean {
	return SHELF_STATE_ORDER.includes(state);
}

/** The minimal shape shelf ordering needs — effective state + ownership + title. */
export interface ShelfSortable {
	effectiveState: EffectiveState;
	owned: boolean;
	title: string;
}

/**
 * Sort rank for the default shelf. A visible state maps to its index in
 * `SHELF_STATE_ORDER`; a hidden state sorts after all visible ones (it only
 * matters if a caller sorts an unfiltered set — `getShelf` filters first).
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
	return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}

/** Return a new array ordered for the shelf (never mutates the input). */
export function orderShelf<T extends ShelfSortable>(items: readonly T[]): T[] {
	return [...items].sort(compareShelf);
}
