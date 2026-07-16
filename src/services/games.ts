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
	addExternalLinkIfAbsent,
	backfillGameFacts,
	clearGameGenres,
	deleteGame,
	type ExternalLinkSource,
	enrichGame,
	findCatalogProduct,
	findGameByExternalLink,
	findGamesByNormalizedTitle,
	findGenreByNameInsensitive,
	getTracking,
	insertGame,
	insertTrackingIfAbsent,
	linkGameGenre,
	removeExternalLinksBySource,
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

/** Optional candidate score fields as they arrive from the routes (Story
 * 10.1) — echoed from the IGDB preview like cover/date/genres. */
export interface CandidateScoreInput {
	criticScore?: number | null;
	criticScoreCount?: number | null;
	userScore?: number | null;
	userScoreCount?: number | null;
}

/**
 * Normalize to the repository's all-four-fields unit. Review hardening:
 * a count never persists without its score (an orphan count is a standing
 * inconsistency the UI can't show), and `undefined` throughout means the
 * CLIENT SENT NO SCORE FIELDS AT ALL — the caller must then leave stored
 * scores untouched rather than wipe them (absent ≠ null at this boundary).
 */
function scoresFromInput(input: CandidateScoreInput) {
	const criticScore = input.criticScore ?? null;
	const userScore = input.userScore ?? null;
	return {
		criticScore,
		criticScoreCount:
			criticScore !== null ? (input.criticScoreCount ?? null) : null,
		userScore,
		userScoreCount: userScore !== null ? (input.userScoreCount ?? null) : null,
	};
}

/** True when the payload carried ANY of the four score fields (even null). */
function hasScoreFields(input: CandidateScoreInput): boolean {
	return (
		input.criticScore !== undefined ||
		input.criticScoreCount !== undefined ||
		input.userScore !== undefined ||
		input.userScoreCount !== undefined
	);
}

export interface AddGameInput extends CandidateScoreInput {
	title: string;
	/** Present = the previewed IGDB match; absent = name-only (unenriched). */
	igdbId?: string;
	coverUrl?: string | null;
	releaseDate?: string | null;
	genres?: string[];
	/** "Add as owned" (default false = wishlisted, FR-43). */
	owned?: boolean;
	/**
	 * The PS STORE product id the add came from (Story 7.3) — an `EXTERNAL_LINK`
	 * in the `PSN_PRODUCT` namespace, never `PSN` (AD-20: that one is
	 * `np_title_id` only). Adding from the catalog changes NOTHING else: the
	 * tracking row is still the not-owned default. Availability is not ownership,
	 * and the app never learns whether the user claimed anything — only a sync
	 * that observes the real entitlement sets `owned` (Story 6.4).
	 */
	psnProductId?: string;
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

/**
 * Disambiguate same-normalized-title rows (Epic 6 retro action item 3). AD-18
 * makes `title_normalized` non-unique, so several catalog rows can share a key;
 * the old code picked DB-order `candidates[0]` for both the anchor and the
 * revive, so re-adding could un-discard or anchor the wrong physical row. One
 * shared rule now chooses the row that add + revive + link all act on:
 *   1. a row the user tracks (a live duplicate, or a discarded tombstone to
 *      revive) beats an untracked catalog row;
 *   2. then the row whose facts best match the previewed IGDB candidate
 *      (release date, exact pre-normalize title);
 *   3. DB order breaks the final tie (stable).
 * Returns the chosen row plus its tracking (null = untracked), or null when
 * there are no candidates. Does not close the renamed-then-discarded revive gap
 * (title rewritten on enrichment) — that needs alias matching, still deferred.
 */
async function pickTitleCandidate(
	db: Db,
	userId: string,
	candidates: Awaited<ReturnType<typeof findGamesByNormalizedTitle>>,
	input: AddGameInput,
) {
	const title = input.title.trim();
	const scored = await Promise.all(
		candidates.map(async (row, order) => {
			const tracking = await getTracking(db, userId, row.id);
			// Tracking is a STRICTLY DOMINANT tier, not additive points: any row the
			// user tracks (2 live > 1 tombstone) outranks any untracked one (0),
			// whatever the facts. Facts only break ties WITHIN a tier — so a
			// facts-rich untracked row can never win over a facts-poor tombstone
			// (that tie would attach a second tracked row + bury the tombstone).
			const trackedRank = tracking ? (tracking.discarded ? 1 : 2) : 0;
			let facts = 0;
			if (input.releaseDate && row.releaseDate === input.releaseDate)
				facts += 1;
			if (row.title === title) facts += 1; // exact (pre-normalize) title
			return { row, tracking, trackedRank, facts, order };
		}),
	);
	scored.sort(
		(a, b) =>
			b.trackedRank - a.trackedRank || b.facts - a.facts || a.order - b.order,
	);
	return scored[0] ?? null;
}

/**
 * Link genres to a game by name, auto-creating unknown ones (FR-24,
 * case-insensitive reuse). Idempotent per name (`linkGameGenre` no-ops a repeat).
 */
async function linkGenresByName(db: Db, gameId: string, genres?: string[]) {
	for (const rawName of genres ?? []) {
		const name = rawName.trim().replace(/\s+/g, ' ');
		if (!name) continue;
		const genre =
			(await findGenreByNameInsensitive(db, name)) ??
			(await upsertGenre(db, name));
		await linkGameGenre(db, gameId, genre.id);
	}
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
 * Anchor an external id on the game and answer WHO the id actually identifies
 * (Story 7.3 + its review). Two namespaces use it: `PSN_PRODUCT` (the store
 * product id — its own source, so an already-synced game's `PSN` np_title_id
 * link is neither shadowed nor clashed with, AD-20) and `PSN` (the catalog row's
 * np_title_id, which IS that namespace's value — without it a later library sync
 * matches the game on title alone and duplicates it the moment PSN's title
 * differs).
 *
 * Writes ONLY when the id is unlinked:
 *  - already this game's → no-op (re-add, another edition);
 *  - already ANOTHER game's → do NOT write, log the clash, and return that
 *    game's id (review, M1: this used to short-circuit as success, so the add
 *    reported created/duplicate for game A while the id stayed on game B — a
 *    silent identity split. `rematchGame` treats the same state as a conflict);
 *  - unlinked → insert ON CONFLICT DO NOTHING and re-read (review, M3: a
 *    concurrent add of the same NEW product id used to 500 on the unique index
 *    and strand a duplicate game row).
 */
async function anchorLink(
	db: Db,
	gameId: string,
	source: ExternalLinkSource,
	externalId?: string | null,
): Promise<string> {
	if (!externalId) return gameId;
	const owner = await findGameByExternalLink(db, source, externalId);
	if (owner) {
		if (owner.id !== gameId) {
			console.warn(
				`add-game: ${source} ${externalId} already anchors game ${owner.id}, not ${gameId} — not linking`,
			);
		}
		return owner.id;
	}
	await addExternalLinkIfAbsent(db, { gameId, source, externalId });
	const settled = await findGameByExternalLink(db, source, externalId);
	return settled?.id ?? gameId;
}

type CatalogProduct = Awaited<ReturnType<typeof findCatalogProduct>>;

/**
 * The catalog origin's writes on the game the add resolved to — the ONE place
 * they happen (review, L4: this used to be four call sites on a non-transactional
 * path). Returns the game id the PRODUCT identity settled on, which is the same
 * game except when a concurrent request won the anchor (M3).
 */
async function applyCatalogOrigin(
	db: Db,
	gameId: string,
	product: CatalogProduct,
): Promise<string> {
	// A product the catalog no longer has writes NOTHING (Story 7.3): no link, no
	// store URL, no dangling reference. Only the LOOKUP that resolves identity runs
	// on a pruned id (review, H2) — this is the write side.
	if (!product) return gameId;
	// The np_title_id is the SYNC's identity for this game, and it is checked
	// BEFORE anything is written (Epic 7 cross-story review, H1): the sync may
	// already own this np_title_id under a title that does NOT normalize like the
	// store's name ("…Valhalla Ragnarök Edition" vs "…Valhalla"), so the add's
	// title scan misses and it was about to mint a permanent duplicate. Whoever
	// holds the np_title_id IS the game — converge on it and put every catalog
	// write (product link included) there, not on the row we were handed.
	const psnOwner = product.npTitleId
		? await findGameByExternalLink(db, 'PSN', product.npTitleId)
		: undefined;
	const target = psnOwner?.id ?? gameId;
	const anchored = await anchorLink(
		db,
		target,
		'PSN_PRODUCT',
		product.productId,
	);
	if (anchored !== target) return anchored;
	await anchorLink(db, target, 'PSN', product.npTitleId);
	// NULL-only (review, M2): an EXISTING game (seed import, name-only add, a sync
	// with no store URL) added from the catalog kept the link and no store URL —
	// and `Claim now` keys off the store URL, so the claim path stayed dead for
	// exactly those games. Never overwrites a fact that stands.
	await backfillGameFacts(db, target, {
		coverUrl: product.coverUrl,
		storeUrl: product.storeUrl,
	});
	return target;
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
	// A CATALOG add is never an owned add (review, H1). Availability is not
	// ownership: a PS+ title counts as owned only via `owned_via: 'membership'`,
	// and only when a SYNC observes the entitlement (Story 6.4) — the app cannot
	// see the PS Store tab. `owned: true` here would write a purchase with a made-up
	// purchase date. The dialog hides the toggle; this is the defence in depth.
	if (input.owned && input.psnProductId) return 'invalid';

	// ponytail: the duplicate guard below is read-then-write, not transactional
	// — title_normalized is deliberately non-unique (AD-18), so two *concurrent*
	// POSTs for the same new title could both pass the scan and insert. Guarded
	// in practice: single-user catalog, and the client disables Save while the
	// mutation is in flight. Add a per-user advisory lock (or a partial unique
	// index) if multi-tab concurrent adds ever become real.

	// The product id is a CLAIM about a snapshot that may have been pruned since
	// the card rendered. The catalog row carries the FACTS (store URL, cover,
	// np_title_id) — a miss means the add proceeds on the title alone, writing no
	// store URL and no dangling reference to a product the catalog no longer has.
	// IDENTITY is a different question: it does not depend on the row still
	// existing (review, H2 — gating the link lookup on the row let a pruned
	// product + a diverged title insert exactly the duplicate the namespace exists
	// to prevent).
	const productId = input.psnProductId;
	const product = productId
		? await findCatalogProduct(db, productId)
		: undefined;

	// Resolve an existing catalog game: external-ID identity first (AD-20),
	// then every normalized-title candidate (non-unique key, AD-18).
	let existing = input.igdbId
		? await findGameByExternalLink(db, 'IGDB', input.igdbId)
		: undefined;
	if (!existing && productId) {
		existing = await findGameByExternalLink(db, 'PSN_PRODUCT', productId);
	}
	// …and the catalog row's np_title_id, which is the SYNC's identity (Epic 7
	// cross-story review, H1). A synced game whose PSN title ("Assassin's Creed
	// Valhalla Ragnarök Edition") does not normalize like the store's name
	// ("Assassin's Creed Valhalla") misses BOTH the product link and the title
	// scan — and the add would then create a second, un-owned row for a game the
	// user already OWNS, forever.
	if (!existing && product?.npTitleId) {
		existing = await findGameByExternalLink(db, 'PSN', product.npTitleId);
	}
	if (!existing) {
		const candidates = await findGamesByNormalizedTitle(db, titleNormalized);
		existing = (await pickTitleCandidate(db, userId, candidates, input))?.row;
	}

	if (existing) {
		// A row this user already tracks (live, or a tombstone to revive) is the
		// SAME game (FR-42): route to it, create nothing. An untracked shared
		// catalog row gets tracking attached, and its facts stay as ingest wrote
		// them (AD-19) — bar the NULL-only catalog backfill below.
		const tracked = await reviveIfDiscarded(db, userId, existing.id);
		if (!tracked) {
			// Anchor the IGDB identity if this preview learned it (permanent).
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
		}
		await applyCatalogOrigin(db, existing.id, product);
		return { kind: tracked ? 'duplicate' : 'created', gameId: existing.id };
	}

	const created = await insertGame(db, {
		title,
		titleNormalized,
		coverUrl: input.coverUrl ?? null,
		releaseDate: input.releaseDate ?? null,
		// Reception scores ride the previewed candidate (Story 10.1) — persisted
		// at add time so a fresh game isn't scoreless until the next cron.
		// ANCHOR-GATED (review): a name-only add has no IGDB identity, so the
		// refresh could never correct a fabricated value — scores are only
		// accepted alongside the igdbId they claim to describe.
		...(input.igdbId ? scoresFromInput(input) : {}),
		// The store URL comes from the CATALOG ROW we just resolved, never from the
		// client — a pruned product contributes nothing (Story 7.3). It is what
		// "Claim now" deep-links to on the shelf card later.
		storeUrl: product?.storeUrl ?? null,
		// No IGDB identity = name-only entry; release date unknown reads as
		// not released (AR-17). Story 6.2's stragglers list keys off this flag.
		unenriched: !input.igdbId,
	});
	// Anchor BEFORE the rest of the writes: a concurrent add of the same NEW
	// product id inserted its own game row too, and exactly one of the two wins
	// the unique `(source, external_id)` index (review, M3). The loser drops the
	// row it just created and converges on the winner's game — one game, no 500,
	// no unlinked orphan.
	const gameId = await applyCatalogOrigin(db, created.id, product);
	if (gameId !== created.id) {
		await deleteGame(db, created.id);
		await insertTrackingIfAbsent(
			db,
			userId,
			gameId,
			newTracking(input.owned ?? false, today),
		);
		return { kind: 'created', gameId };
	}
	if (input.igdbId) {
		await addExternalLink(db, {
			gameId,
			source: 'IGDB',
			externalId: input.igdbId,
		});
	}
	// FR-24: unknown genres auto-create exactly once (case-insensitive reuse).
	// They are IGDB genres (AD-26) — the catalog's PS facet keys are a separate
	// vocabulary and never reach these tables.
	await linkGenresByName(db, gameId, input.genres);
	await insertTrackingIfAbsent(
		db,
		userId,
		gameId,
		newTracking(input.owned ?? false, today),
	);
	return { kind: 'created', gameId };
}

export interface RematchInput extends CandidateScoreInput {
	igdbId: string;
	/** Chosen IGDB name — overwrites the game's title when given. */
	name?: string;
	coverUrl?: string | null;
	releaseDate?: string | null;
	genres?: string[];
}

export type RematchOutcome =
	| { kind: 'rematched'; gameId: string }
	| 'not-found'
	| 'conflict';

/**
 * Re-point a wrongly-matched game at the right IGDB entry (PV-4), the
 * detail-panel correction for PV-1 same-name mismatches. Edits the EXISTING
 * game in place: swap its IGDB link, overwrite cover/date/title, and REPLACE
 * its genres with the pick's (the old match was wrong, so its facts are too —
 * see spec Design Notes). Never inserts a game and never touches tracking.
 *
 * ponytail: these writes are sequential, not one D1 transaction — same accepted
 * ceiling as `resolveStraggler` (single-user, retryable, D1 has no interactive tx).
 */
export async function rematchGame(
	db: Db,
	userId: string,
	gameId: string,
	input: RematchInput,
): Promise<RematchOutcome> {
	// User-scope (AD-13): only a game this user tracks can be rematched.
	if (!(await getTracking(db, userId, gameId))) return 'not-found';

	// AD-20 identity: the picked IGDB id may already anchor a DIFFERENT game
	// (a real duplicate) — surface it rather than silently attach. The same id
	// already on THIS game is fine (idempotent re-pick / fact refresh).
	const owner = await findGameByExternalLink(db, 'IGDB', input.igdbId);
	if (owner && owner.id !== gameId) return 'conflict';

	// Anchor the new identity FIRST, then prune the stale IGDB links (keeping the
	// one just added). Add-before-delete so a failed write in between never leaves
	// the game with NO IGDB link — it keeps its old identity and the rematch is
	// cleanly retryable. Skip the insert when the id is already this game's.
	if (!owner) {
		await addExternalLink(db, {
			gameId,
			source: 'IGDB',
			externalId: input.igdbId,
		});
	}
	await removeExternalLinksBySource(db, gameId, 'IGDB', input.igdbId);
	await enrichGame(db, gameId, {
		coverUrl: input.coverUrl ?? null,
		releaseDate: input.releaseDate ?? null,
		...(input.name?.trim()
			? {
					title: input.name.trim(),
					titleNormalized: normalizeTitle(input.name),
				}
			: {}),
		// Written as a unit: the old match's numbers are the WRONG game's — an
		// unscored new pick must clear them, not inherit them (VR-5). But a
		// payload with NO score fields at all (older client) means "unknown",
		// and unknown must not erase data (review): leave stored scores alone.
		...(hasScoreFields(input) ? { scores: scoresFromInput(input) } : {}),
		// TTB clears whenever the IGDB identity CHANGES (`!owner` = the picked id
		// wasn't already this game's): the stored hours are the old match's, and
		// no client payload nor partial cron reply would ever correct them. A
		// same-id re-pick keeps them — still the right game.
		clearTimeToBeat: !owner,
	});
	await clearGameGenres(db, gameId);
	await linkGenresByName(db, gameId, input.genres);

	return { kind: 'rematched', gameId };
}
