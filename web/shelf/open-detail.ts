/**
 * Open a game's detail view from anywhere (Story 6.1, FR-42): the search
 * combobox and the add dialog live in the header subtree, outside the shelf —
 * a window event reaches the shelf without a router or context refactor
 * (same pattern as SearchBox's SEED_SEARCH_EVENT). Own module so
 * SearchBox ⇄ AddGameDialog don't import each other in a cycle.
 */
export const OPEN_DETAIL_EVENT = 'shelf:open-detail';

export function openDetail(gameId: string): void {
	window.dispatchEvent(new CustomEvent(OPEN_DETAIL_EVENT, { detail: gameId }));
}
