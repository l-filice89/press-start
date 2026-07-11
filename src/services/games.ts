/**
 * Add a game by name (Story 6.1, FR-41/42/43): the wishlist-moment write path.
 * `previewAddGame` wraps the IGDB lookup so a provider failure degrades to an
 * empty preview instead of a 5xx — the discovery moment never depends on a
 * third party being up (NFR-4); the unenriched game Story 6.2's stragglers
 * list picks up. `addGame` is the create seam: duplicate-safe (external-ID
 * link first, then the shared normalized-title candidate key — AD-9/18/20),
 * auto-creates genre rows (FR-24), and stamps the FR-43 defaults.
 */

import { normalizeTitle } from '../core';
import type { IgdbCandidate, IgdbSearch } from '../providers';
import {
	addExternalLink,
	findGameByExternalLink,
	findGamesByNormalizedTitle,
	findGenreByNameInsensitive,
	getTracking,
	insertGame,
	insertTrackingIfAbsent,
	linkGameGenre,
	setDiscarded,
	type TrackingPatch,
	upsertGenre,
} from '../repositories';
import type { Db } from '../repositories/db';

export interface AddGamePreview {
	/** False = IGDB unreachable/unconfigured — the client offers name-only save. */
	available: boolean;
	candidate: IgdbCandidate | null;
}

/** IGDB preview for the add dialog. Failures degrade, never throw (AD-14). */
export async function previewAddGame(
	igdb: Pick<IgdbSearch, 'searchCandidate'> | null,
	title: string,
): Promise<AddGamePreview> {
	if (!igdb) return { available: false, candidate: null };
	try {
		return { available: true, candidate: await igdb.searchCandidate(title) };
	} catch (error) {
		console.warn('add-by-name: IGDB preview failed', error);
		return { available: false, candidate: null };
	}
}

export interface AddGameInput {
	title: string;
	/** Present = the previewed IGDB match; absent = name-only (unenriched). */
	igdbId?: string;
	coverUrl?: string | null;
	releaseDate?: string | null;
	genres?: string[];
	/** "Add as owned" (default false = wishlisted, FR-43). */
	owned?: boolean;
}

export type AddGameOutcome =
	| { kind: 'created'; gameId: string }
	| { kind: 'duplicate'; gameId: string }
	| 'invalid';

/**
 * Re-add revive (2026-07-11): is this game already tracked by the user, and if
 * that row is a discarded tombstone, clear it. Returns true when a tracking row
 * exists (discarded or not) — i.e. this is a duplicate the caller must route to
 * its detail view rather than create anew. Re-adding a discarded game's name is
 * the ONLY revive path (no browse-list, by design).
 */
async function reviveIfDiscarded(
	db: Db,
	userId: string,
	gameId: string,
): Promise<boolean> {
	const tracking = await getTracking(db, userId, gameId);
	if (!tracking) return false;
	if (tracking.discarded) await setDiscarded(db, userId, gameId, false);
	return true;
}

/** FR-43 defaults: wishlisted (not owned) or owned-as-purchase, Not started. */
function newTracking(owned: boolean, today: string): TrackingPatch {
	return owned
		? {
				owned: true,
				ownershipType: 'digital',
				playStatus: 'Not started',
				boughtOn: today,
				ownedVia: 'purchase',
			}
		: { owned: false, playStatus: 'Not started', wishlistedOn: today };
}

/**
 * Create (or attach tracking to) a game from the add-by-name dialog.
 * Duplicate hazard (FR-42/AR-9): a title the user already tracks must never
 * become a second row — resolved by IGDB link, then normalized title; the
 * caller answers 409 with the existing id so the UI opens its detail view.
 */
export async function addGame(
	db: Db,
	userId: string,
	input: AddGameInput,
	today: string,
): Promise<AddGameOutcome> {
	const title = input.title.trim();
	const titleNormalized = normalizeTitle(title);
	if (!title || !titleNormalized) return 'invalid';

	// ponytail: the duplicate guard below is read-then-write, not transactional
	// — title_normalized is deliberately non-unique (AD-18), so two *concurrent*
	// POSTs for the same new title could both pass the scan and insert. Guarded
	// in practice: single-user catalog, and the client disables Save while the
	// mutation is in flight. Add a per-user advisory lock (or a partial unique
	// index) if multi-tab concurrent adds ever become real.

	// Resolve an existing catalog game: external-ID identity first (AD-20),
	// then every normalized-title candidate (non-unique key, AD-18).
	let existing = input.igdbId
		? await findGameByExternalLink(db, 'IGDB', input.igdbId)
		: undefined;
	if (!existing) {
		const candidates = await findGamesByNormalizedTitle(db, titleNormalized);
		for (const candidate of candidates) {
			const revived = await reviveIfDiscarded(db, userId, candidate.id);
			if (revived) return { kind: 'duplicate', gameId: candidate.id };
		}
		existing = candidates[0];
	}

	if (existing) {
		if (await reviveIfDiscarded(db, userId, existing.id)) {
			return { kind: 'duplicate', gameId: existing.id };
		}
		// Shared catalog game this user never tracked: attach tracking only —
		// catalog facts stay as ingest wrote them (AD-19). Anchor the IGDB
		// identity if this preview learned it (permanent, survives re-sync).
		if (
			input.igdbId &&
			!(await findGameByExternalLink(db, 'IGDB', input.igdbId))
		) {
			await addExternalLink(db, {
				gameId: existing.id,
				source: 'IGDB',
				externalId: input.igdbId,
			});
		}
		await insertTrackingIfAbsent(
			db,
			userId,
			existing.id,
			newTracking(input.owned ?? false, today),
		);
		return { kind: 'created', gameId: existing.id };
	}

	const created = await insertGame(db, {
		title,
		titleNormalized,
		coverUrl: input.coverUrl ?? null,
		releaseDate: input.releaseDate ?? null,
		// No IGDB identity = name-only entry; release date unknown reads as
		// not released (AR-17). Story 6.2's stragglers list keys off this flag.
		unenriched: !input.igdbId,
	});
	if (input.igdbId) {
		await addExternalLink(db, {
			gameId: created.id,
			source: 'IGDB',
			externalId: input.igdbId,
		});
	}
	// FR-24: unknown genres auto-create exactly once (case-insensitive reuse,
	// same recipe as services/genres.addGenreToGame).
	for (const rawName of input.genres ?? []) {
		const name = rawName.trim().replace(/\s+/g, ' ');
		if (!name) continue;
		const genre =
			(await findGenreByNameInsensitive(db, name)) ??
			(await upsertGenre(db, name));
		await linkGameGenre(db, created.id, genre.id);
	}
	await insertTrackingIfAbsent(
		db,
		userId,
		created.id,
		newTracking(input.owned ?? false, today),
	);
	return { kind: 'created', gameId: created.id };
}
