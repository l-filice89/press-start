/**
 * Straggler resolution (Story 6.2, FR-28/29): the stragglers list is one view
 * over two kinds — import staging rows the seed couldn't match (carry a Notion
 * payload) and name-only `unenriched` games from add-by-name. Resolving one
 * writes a PERMANENT `external_link('IGDB', id)` so a later add/seed/sync
 * recognizes the game and never re-adds a duplicate (AD-9/20), enriches the
 * facts, and — for an import straggler — carries the Notion payload onto the
 * game's tracking before dropping the staging row. IGDB is reached only here,
 * only on the user's explicit pick, and a failure degrades to an empty list.
 */

import { normalizeTitle, notionRowToTracking } from '../core';
import type { IgdbCandidate, IgdbSearch } from '../providers';
import {
	addExternalLink,
	deleteStraggler,
	enrichGame,
	findGameByExternalLink,
	findGamesByNormalizedTitle,
	findGenreByNameInsensitive,
	getStragglerById,
	getTracking,
	insertGame,
	insertTrackingIfAbsent,
	linkGameGenre,
	listLibraryForUser,
	listStragglers,
	upsertGenre,
} from '../repositories';
import type { Db } from '../repositories/db';

export interface StragglerView {
	/** import-row id (kind `import`) or game id (kind `unenriched`). */
	id: string;
	kind: 'import' | 'unenriched';
	title: string;
}

/** Both straggler kinds as one list (import rows + this user's unenriched games). */
export async function listStragglerView(
	db: Db,
	userId: string,
): Promise<StragglerView[]> {
	const imports = await listStragglers(db);
	const library = await listLibraryForUser(db, userId);
	return [
		...imports.map(
			(s): StragglerView => ({
				id: s.id,
				kind: 'import',
				title: s.sourceTitle,
			}),
		),
		...library
			.filter((g) => g.unenriched)
			.map(
				(g): StragglerView => ({
					id: g.id,
					kind: 'unenriched',
					title: g.title,
				}),
			),
	];
}

/** How many stragglers need attention — feeds the amber banner (AR-22). */
export async function countStragglers(db: Db, userId: string): Promise<number> {
	return (await listStragglerView(db, userId)).length;
}

/** IGDB pick list for the resolve dialog. Failures degrade to `[]` (NFR-4). */
export async function searchGamesForResolve(
	igdb: Pick<IgdbSearch, 'searchCandidates'> | null,
	title: string,
): Promise<IgdbCandidate[]> {
	if (!igdb) return [];
	try {
		return await igdb.searchCandidates(title);
	} catch (error) {
		console.warn('straggler resolve: IGDB search failed', error);
		return [];
	}
}

async function ensureGenres(db: Db, gameId: string, genres?: string[]) {
	for (const rawName of genres ?? []) {
		const name = rawName.trim().replace(/\s+/g, ' ');
		if (!name) continue;
		const genre =
			(await findGenreByNameInsensitive(db, name)) ??
			(await upsertGenre(db, name));
		await linkGameGenre(db, gameId, genre.id);
	}
}

/**
 * Attach the permanent IGDB identity unless that id is already linked.
 * ponytail: if the id is already linked to a DIFFERENT game (only reachable on
 * the unenriched path, where the target game is fixed), this silently no-ops —
 * the game is enriched but unlinked, i.e. a duplicate of the linked one. Rare
 * in a single-user catalog; add a conflict outcome if it ever surfaces.
 */
async function anchorIgdb(db: Db, gameId: string, igdbId: string) {
	if (!(await findGameByExternalLink(db, 'IGDB', igdbId))) {
		await addExternalLink(db, { gameId, source: 'IGDB', externalId: igdbId });
	}
}

export interface ResolveInput {
	/** import-row id or game id, matching `kind`. */
	id: string;
	kind: 'import' | 'unenriched';
	igdbId: string;
	/** Chosen IGDB name — the created game's title when different from the source. */
	name?: string;
	coverUrl?: string | null;
	releaseDate?: string | null;
	genres?: string[];
}

export type ResolveOutcome =
	| { kind: 'resolved'; gameId: string }
	| 'not-found'
	| 'invalid';

function parsePayload(raw: string | null): Record<string, string> | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? parsed
			: null;
	} catch {
		return null;
	}
}

/**
 * Resolve one straggler onto a real IGDB-matched game.
 * - `unenriched`: the game already exists (the user tracks it) — attach the
 *   link, fill facts + genres, clear the flag; tracking is left as the user set.
 * - `import`: create or match a game (dup-safe: IGDB link, then normalized
 *   title), anchor the link, apply the Notion payload to tracking (only if the
 *   user has none), then delete the staging row.
 */
export async function resolveStraggler(
	db: Db,
	userId: string,
	input: ResolveInput,
): Promise<ResolveOutcome> {
	if (input.kind === 'unenriched') {
		if (!(await getTracking(db, userId, input.id))) return 'not-found';
		await anchorIgdb(db, input.id, input.igdbId);
		const rename = input.name?.trim()
			? {
					title: input.name.trim(),
					titleNormalized: normalizeTitle(input.name),
				}
			: {};
		await enrichGame(db, input.id, {
			coverUrl: input.coverUrl ?? null,
			releaseDate: input.releaseDate ?? null,
			// Picking a match also corrects a name-only typo ("Caleste" → "Celeste").
			...rename,
		});
		await ensureGenres(db, input.id, input.genres);
		return { kind: 'resolved', gameId: input.id };
	}

	const straggler = await getStragglerById(db, input.id);
	if (!straggler) return 'not-found';
	const title = (input.name ?? straggler.sourceTitle).trim();
	const titleNormalized = normalizeTitle(title);
	if (!title || !titleNormalized) return 'invalid';

	// Dup-safe resolve: the IGDB identity first (AD-20), then the shared
	// normalized-title candidate key (AD-18) — never a second row for a title
	// already in the catalog.
	let existing = await findGameByExternalLink(db, 'IGDB', input.igdbId);
	if (!existing) {
		existing = (await findGamesByNormalizedTitle(db, titleNormalized))[0];
	}
	const gameRow =
		existing ??
		(await insertGame(db, {
			title,
			titleNormalized,
			coverUrl: input.coverUrl ?? null,
			releaseDate: input.releaseDate ?? null,
			unenriched: false,
		}));

	await anchorIgdb(db, gameRow.id, input.igdbId);
	// A title-matched game that is itself still name-only must be enriched and
	// de-flagged here — otherwise it stays a straggler forever (a freshly
	// inserted row is already enriched, so only patch a pre-existing one).
	if (existing?.unenriched) {
		await enrichGame(db, gameRow.id, {
			coverUrl: input.coverUrl ?? null,
			releaseDate: input.releaseDate ?? null,
		});
	}
	await ensureGenres(db, gameRow.id, input.genres);

	// ponytail: these five writes (insert/link/enrich/genres/tracking/delete) are
	// sequential, not one D1 transaction — a mid-sequence failure can leave a
	// linked game plus a live staging row. Single-user, resolve is retryable, and
	// D1 has no interactive tx; batch or add compensation if it ever matters.
	// Carry the Notion payload (status/dates/owned) onto tracking — only if the
	// user isn't already tracking this game (don't clobber their own state).
	const payload = parsePayload(straggler.notionPayload);
	await insertTrackingIfAbsent(
		db,
		userId,
		gameRow.id,
		payload
			? notionRowToTracking(payload)
			: { owned: false, playStatus: 'Not started' },
	);
	await deleteStraggler(db, input.id);
	return { kind: 'resolved', gameId: gameRow.id };
}
