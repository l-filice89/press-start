/**
 * PSN library sync (Story 4.2, FR-33/34/35). The orchestration seam: reads
 * the matching index through `repositories/` (AD-4), fetches the purchased
 * list through `PsnProvider` (AD-5), asks the pure planner what to write
 * (AD-3), and executes the additive-only plan. Owned-flips go through the
 * SAME `changeOwnership` path the detail view uses (AD-10: one write-path
 * guard — `bought_on` stamps write-once, digital inferred, nothing else
 * touched). A `PsnAuthError` persists `psn_auth=expired` so the Story 4.1
 * banner lights, and is reported — never retried (AD-14).
 */

import { planSync, type SyncEntry, type SyncIndex } from '../core';
import { createPsnProvider, PsnAuthError } from '../providers';
import {
	addExternalLink,
	backfillGameFacts,
	insertGame,
	insertTrackingIfAbsent,
	listGamesWithPsnLinks,
	listTrackingForUser,
} from '../repositories';
import type { Db } from '../repositories/db';
import {
	getPsnCookie,
	markPsnAuthExpired,
	type SyncAttentionItem,
	todayForUser,
	writeSyncAttention,
} from './settings';
import { changeOwnership } from './tracking';

/** One synced title; `viaMembership` = a PS+ claim, not a purchase. */
export interface SyncTitle {
	title: string;
	viaMembership: boolean;
}

export interface SyncResult {
	/** Games this run created (or newly started tracking). */
	added: SyncTitle[];
	/** Games whose `Owned` flag flipped false→true this run. */
	flipped: SyncTitle[];
	/** Claimed games found purchased this run — owned_via upgraded, bought_on stamped. */
	upgraded: string[];
	skippedWebApps: number;
	needsAttention: SyncAttentionItem[];
}

/** Sync failed before any write: expired/missing cookie (FR-36). */
export type SyncOutcome =
	| { ok: true; result: SyncResult }
	| { ok: false; reason: 'auth'; message: string };

// ponytail: whole-catalog index per button press — fine at hobby scale
// (hundreds of rows); page or scope it if the shared catalog ever grows
// beyond that.
async function buildIndex(db: Db): Promise<{
	index: SyncIndex;
	/** `game.id` → stored facts, for skipping no-op backfills. */
	factsByGameId: Map<
		string,
		{ coverUrl: string | null; storeUrl: string | null }
	>;
}> {
	const { games, links } = await listGamesWithPsnLinks(db);
	const psnIdsByGameId = new Map<string, string[]>();
	const linkedGameIdByExternalId: Record<string, string> = {};
	for (const link of links) {
		linkedGameIdByExternalId[link.externalId] = link.gameId;
		const ids = psnIdsByGameId.get(link.gameId) ?? [];
		ids.push(link.externalId);
		psnIdsByGameId.set(link.gameId, ids);
	}
	const gamesByNormalizedTitle: SyncIndex['gamesByNormalizedTitle'] = {};
	const factsByGameId = new Map<
		string,
		{ coverUrl: string | null; storeUrl: string | null }
	>();
	for (const g of games) {
		factsByGameId.set(g.id, { coverUrl: g.coverUrl, storeUrl: g.storeUrl });
		const bucket = gamesByNormalizedTitle[g.titleNormalized] ?? [];
		bucket.push({
			gameId: g.id,
			psnExternalIds: psnIdsByGameId.get(g.id) ?? [],
		});
		gamesByNormalizedTitle[g.titleNormalized] = bucket;
	}
	return {
		index: { linkedGameIdByExternalId, gamesByNormalizedTitle },
		factsByGameId,
	};
}

export async function runSync(
	db: Db,
	userId: string,
	env: { PSN_SESSION_COOKIE?: string },
): Promise<SyncOutcome> {
	const provider = createPsnProvider({
		getCookie: () => getPsnCookie(db, userId, env),
	});

	let entries: SyncEntry[];
	try {
		entries = await provider.fetchPurchasedGames();
	} catch (error) {
		if (error instanceof PsnAuthError) {
			// Light the persistent banner (4.1) and surface — never retry.
			await markPsnAuthExpired(db, userId);
			return { ok: false, reason: 'auth', message: error.message };
		}
		throw error;
	}

	const { index, factsByGameId } = await buildIndex(db);
	const plan = planSync(entries, index);
	const [today, trackingRows] = await Promise.all([
		todayForUser(db, userId),
		listTrackingForUser(db, userId),
	]);
	const trackingByGameId = new Map(trackingRows.map((t) => [t.gameId, t]));
	const result: SyncResult = {
		added: [],
		flipped: [],
		upgraded: [],
		skippedWebApps: plan.skippedWebApps,
		needsAttention: plan.conflicts.map((c) => ({
			title: c.title,
			reason: c.reason,
		})),
	};

	// FR-33 defaults for every row sync creates. A claim is owned but not
	// BOUGHT (FR-9 amended): no bought_on, and owned_via records the source
	// so a future subscription-cancel flow can un-own claims only.
	const newTracking = (viaMembership: boolean) =>
		({
			owned: true,
			ownershipType: 'digital',
			playStatus: 'Not started',
			boughtOn: viaMembership ? undefined : today,
			ownedVia: viaMembership ? 'membership' : 'purchase',
		}) as const;

	// Execution is untransacted sequential writes (no D1 transaction across
	// reads). Every op is additive and the whole plan is idempotent, so a
	// mid-plan failure is recoverable by re-running — report it as
	// needs-attention instead of aborting the games already synced.
	for (const create of plan.creates) {
		try {
			const created = await insertGame(db, {
				title: create.title,
				titleNormalized: create.titleNormalized,
				coverUrl: create.coverUrl,
				storeUrl: create.storeUrl,
				// Genres/release date come from Epic 6's enrichment flow (AD-22b),
				// never from an in-sync IGDB fan-out (AD-15).
				unenriched: true,
			});
			for (const externalId of create.externalIds) {
				await addExternalLink(db, {
					gameId: created.id,
					source: 'PSN',
					externalId,
				});
			}
			await insertTrackingIfAbsent(
				db,
				userId,
				created.id,
				newTracking(create.viaMembership),
			);
			result.added.push({
				title: create.title,
				viaMembership: create.viaMembership,
			});
		} catch (error) {
			result.needsAttention.push({
				title: create.title,
				reason: `could not be added (${error instanceof Error ? error.message : 'write failed'}) — re-run sync`,
			});
		}
	}

	for (const match of plan.matches) {
		try {
			for (const externalId of match.externalIdsToAdd) {
				await addExternalLink(db, {
					gameId: match.gameId,
					source: 'PSN',
					externalId,
				});
			}
			// NULL-only backfill, and only when something is actually missing —
			// a steady-state re-sync issues zero writes here.
			const stored = factsByGameId.get(match.gameId);
			if (
				(stored?.coverUrl == null && match.coverUrl) ||
				(stored?.storeUrl == null && match.storeUrl)
			) {
				await backfillGameFacts(db, match.gameId, {
					coverUrl: match.coverUrl,
					storeUrl: match.storeUrl,
				});
			}

			const tracking = trackingByGameId.get(match.gameId);
			const via = match.viaMembership ? 'membership' : 'purchase';
			if (!tracking) {
				// A shared game this user never tracked: an entry in their
				// library means they own it. `IfAbsent` closes the read-write
				// race — a row that appeared since the bulk read stays
				// byte-identical (FR-33).
				const inserted = await insertTrackingIfAbsent(
					db,
					userId,
					match.gameId,
					newTracking(match.viaMembership),
				);
				if (inserted)
					result.added.push({
						title: match.title,
						viaMembership: match.viaMembership,
					});
			} else if (!tracking.owned) {
				// The one mutation sync may make to existing user data
				// (FR-33/AD-10), through the standard guard: bought_on COALESCEs
				// (claims never stamp it), nothing else moves. Count only what
				// actually persisted.
				const outcome = await changeOwnership(
					db,
					userId,
					match.gameId,
					{ owned: true, ownershipType: 'digital' },
					today,
					via,
				);
				if (outcome && outcome !== 'invalid')
					result.flipped.push({
						title: match.title,
						viaMembership: match.viaMembership,
					});
			} else if (tracking.ownedVia === 'membership' && via === 'purchase') {
				// Bought a game previously only claimed: upgrade the source and
				// stamp bought_on — otherwise a future subscription-cancel
				// cleanup would un-own a game the user actually paid for.
				const outcome = await changeOwnership(
					db,
					userId,
					match.gameId,
					{ owned: true },
					today,
					'purchase',
				);
				if (outcome && outcome !== 'invalid') result.upgraded.push(match.title);
			}
		} catch (error) {
			result.needsAttention.push({
				title: match.title,
				reason: `could not be updated (${error instanceof Error ? error.message : 'write failed'}) — re-run sync`,
			});
		}
	}

	// Persist for the attention banner (AR-22): items survive the modal and
	// reloads; a clean run clears them (self-resolution). Only a COMPLETED
	// sync writes here — the auth path above returned before any write. A
	// failed persist must not report the (fully applied) run as failed.
	try {
		await writeSyncAttention(db, userId, result.needsAttention);
	} catch (error) {
		console.error('sync: persisting needs-attention failed', error);
	}

	return { ok: true, result };
}
