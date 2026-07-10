/**
 * Shelf + search orchestration (AD-6). The only place that reads the library
 * through `repositories/` (AD-4) and derives state through `core/` (AD-7/AD-8)
 * to bake the fully-resolved card DTO the SPA renders. No third-party fetch is
 * possible here — covers/store links come only from persisted `game` rows
 * (NFR-3). Every read is user-scoped (AD-13).
 */
import {
	computeDerivedStates,
	computeEffectiveState,
	type EffectiveState,
	isDefaultShelfVisible,
	orderShelf,
	type PlayStatus,
} from '../core';
import {
	type LibraryRow,
	listGenresForGames,
	listLibraryForUser,
} from '../repositories';
import type { Db } from '../repositories/db';

/**
 * The card contract, baked server-side. `effectiveState` drove the ordering and
 * feeds the pill; `hasCompleted`/`hasPlatinum` are carried apart from
 * `effectiveState` so a live (`Playing`) card can still show a milestone badge.
 * The raw `playStatus` rides along too: a replayed game reads `Playing` while
 * carrying `completed_on`, so the status popover cannot derive which row is
 * checked from `effectiveState` alone. Derived flags (`released`/`wishlisted`)
 * come from `core/` (AD-8).
 */
export interface ShelfGame {
	id: string;
	title: string;
	coverUrl: string | null;
	storeUrl: string | null;
	playStatus: PlayStatus | null;
	effectiveState: EffectiveState;
	owned: boolean;
	released: boolean;
	wishlisted: boolean;
	playableNow: boolean;
	psPlusExtra: boolean;
	hasCompleted: boolean;
	hasPlatinum: boolean;
	// The raw milestone dates ride along with the booleans: the status popover's
	// already-achieved rows show *when* (Story 2.2), not just that.
	completedOn: string | null;
	platinumOn: string | null;
	// Lifecycle dates + ownership type for the detail panel (Story 2.3) — the
	// card DTO is the panel's only data source; there is no detail endpoint.
	startedOn: string | null;
	boughtOn: string | null;
	wishlistedOn: string | null;
	ownershipType: 'physical' | 'digital' | null;
	releaseDate: string | null;
	genres: string[];
}

function bakeCard(row: LibraryRow, genres: string[]): ShelfGame {
	const effectiveState = computeEffectiveState({
		playStatus: row.playStatus,
		completedOn: row.completedOn,
		platinumOn: row.platinumOn,
	});
	const { released, wishlisted, playableNow } = computeDerivedStates({
		owned: row.owned,
		releaseDate: row.releaseDate,
		// True per-region PS+ Extra membership is Epic 5; until then the catalog
		// flag stands in, so `playableNow` = (owned OR in-catalog) AND released.
		inPsPlusExtraCatalog: row.psPlusExtra,
	});
	return {
		id: row.id,
		title: row.title,
		coverUrl: row.coverUrl,
		storeUrl: row.storeUrl,
		playStatus: row.playStatus,
		effectiveState,
		owned: row.owned,
		released,
		wishlisted,
		playableNow,
		psPlusExtra: row.psPlusExtra,
		hasCompleted: row.completedOn != null,
		hasPlatinum: row.platinumOn != null,
		completedOn: row.completedOn,
		platinumOn: row.platinumOn,
		startedOn: row.startedOn,
		boughtOn: row.boughtOn,
		wishlistedOn: row.wishlistedOn,
		ownershipType: row.ownershipType,
		releaseDate: row.releaseDate,
		genres,
	};
}

/**
 * The user's whole library as baked cards (unordered, unfiltered). Reads the
 * tracking-joined rows and their genres in two queries, then groups + derives.
 */
export async function loadLibrary(
	db: Db,
	userId: string,
): Promise<ShelfGame[]> {
	const rows = await listLibraryForUser(db, userId);
	const genreRows = await listGenresForGames(
		db,
		rows.map((r) => r.id),
	);
	const genresByGame = new Map<string, string[]>();
	for (const { gameId, name } of genreRows) {
		const existing = genresByGame.get(gameId);
		if (existing) existing.push(name);
		else genresByGame.set(gameId, [name]);
	}
	return rows.map((row) => bakeCard(row, genresByGame.get(row.id) ?? []));
}

/**
 * The backlog shelf: ordered Playing→Paused→Up next→Not started (revealed
 * states after), owned before un-owned, alphabetical within each group — the
 * whole sorted set materialized here (AD-7), never a SQL `ORDER BY
 * play_status`. By default only live-play-status games (Completed/Platinum/
 * Dropped hidden); `includeHidden` (Story 3.2 reveal pills) returns the whole
 * library so the client filter can OR hidden states into the visible set.
 */
export async function getShelf(
	db: Db,
	userId: string,
	includeHidden = false,
): Promise<ShelfGame[]> {
	const library = await loadLibrary(db, userId);
	return orderShelf(
		includeHidden
			? library
			: library.filter((g) => isDefaultShelfVisible(g.effectiveState)),
	);
}

/**
 * The dedicated whole-library search (FR-19) — a separate path from `getShelf`,
 * NOT a filter over the shelf result. Matches every game by case-insensitive
 * substring on the display title, ignoring active filters and hidden states.
 * Plain alphabetical on purpose — the shelf's state/ownership tiers (FR-18)
 * do NOT apply here. Blank query → no results (the SPA falls back to the
 * shelf).
 */
export async function searchLibrary(
	db: Db,
	userId: string,
	query: string,
): Promise<ShelfGame[]> {
	const needle = query.trim().toLowerCase();
	if (needle === '') return [];
	const library = await loadLibrary(db, userId);
	return library
		.filter((g) => g.title.toLowerCase().includes(needle))
		.sort((a, b) =>
			a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
		);
}
