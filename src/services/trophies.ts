/**
 * PSN trophy sync (Story 9.2). Mirrors `services/sync.ts`: fetch through
 * `PsnProvider` (AR-5), match against the user's library, write through
 * `repositories/` (AR-6). What it does NOT do is the point — it writes ONLY
 * the trophy columns: no play status, no milestone, no lifecycle date, no
 * game row is ever created. A trophy title with no library game is simply
 * unmatched (a demo, an unowned game — not an error); two library games
 * sharing a normalized title are ambiguous and NEVER guessed (needs-attention).
 *
 * The fetch completes fully before any write, so an expired NPSSO or a
 * DEGENERATE response (200 + error body, empty list on a non-zero total) leaves
 * every stored count intact — the provider throws and nothing has been written.
 */

import { trophyTitleToMatchKey } from '../core';
import {
	createPsnProvider,
	PsnAuthError,
	type PsnTrophyTitle,
} from '../providers';
import {
	listLibraryForUser,
	setTrophyCountsBatch,
	type TrophyCountsWrite,
} from '../repositories';
import type { Db } from '../repositories/db';
import {
	getPsnNpsso,
	markPsnAuthExpired,
	type SyncAttentionItem,
	todayForUser,
} from './settings';

export interface TrophySyncResult {
	/** Games whose trophy counts this run wrote. */
	updated: string[];
	/** Trophy titles with no library game — informational, not a failure. */
	unmatched: string[];
	/** Ambiguous names: two library games share the key, so nothing was written. */
	needsAttention: SyncAttentionItem[];
}

/** Failed before any write: expired/missing NPSSO token (FR-36). */
export type TrophySyncOutcome =
	| { ok: true; result: TrophySyncResult }
	| { ok: false; reason: 'auth'; message: string };

const earnedTotal = (title: PsnTrophyTitle) =>
	title.earnedTrophies.bronze +
	title.earnedTrophies.silver +
	title.earnedTrophies.gold +
	title.earnedTrophies.platinum;

const definedTotal = (title: PsnTrophyTitle) =>
	title.definedTrophies.bronze +
	title.definedTrophies.silver +
	title.definedTrophies.gold +
	title.definedTrophies.platinum;

/**
 * MANY trophy titles → ONE game. PSN lists the PS4 and PS5 trophy sets of the
 * same game as separate entries ("Hades" and "Hades Trophies"), and both
 * normalize to one match key: writing them in PSN's arbitrary order would let
 * an abandoned 3% PS4 run OVERWRITE a 100% PS5 platinum, silently. Collapse to
 * ONE entry per key first — the set with the most EARNED trophies wins (the
 * platform the user actually played), tiebroken on the most defined.
 *
 * A blank/missing `trophyTitleName` normalizes to an empty key and is dropped
 * outright: it can join nothing, and reporting it would print an empty row in
 * the readout's unmatched list.
 */
function collapseByMatchKey(
	titles: PsnTrophyTitle[],
): Map<string, PsnTrophyTitle> {
	const best = new Map<string, PsnTrophyTitle>();
	for (const title of titles) {
		const key = trophyTitleToMatchKey(title.trophyTitleName);
		if (!key) continue;
		const standing = best.get(key);
		if (
			!standing ||
			earnedTotal(title) > earnedTotal(standing) ||
			(earnedTotal(title) === earnedTotal(standing) &&
				definedTotal(title) > definedTotal(standing))
		) {
			best.set(key, title);
		}
	}
	return best;
}

export async function runTrophySync(
	db: Db,
	userId: string,
	env: { PSN_NPSSO?: string },
): Promise<TrophySyncOutcome> {
	const provider = createPsnProvider({
		getNpsso: () => getPsnNpsso(db, userId, env),
	});

	let titles: PsnTrophyTitle[];
	try {
		titles = await provider.fetchTrophyTitles();
	} catch (error) {
		if (error instanceof PsnAuthError) {
			// Light the persistent banner (4.1) and surface — never retry. Caught
			// BEFORE any write, so existing trophy counts are untouched.
			await markPsnAuthExpired(db, userId);
			return { ok: false, reason: 'auth', message: error.message };
		}
		// A degenerate 200 lands here: the route answers 502 and NOTHING is written.
		throw error;
	}

	const [today, library] = await Promise.all([
		todayForUser(db, userId),
		listLibraryForUser(db, userId),
	]);

	// Bucket by the STORED normalized title — the same key `services/sync.ts`
	// matches a PSN name on, so the two syncs cannot drift. The " Trophies"
	// strip is trophy-side ONLY (a library game legitimately named "X Trophies"
	// must not collide with "X"); a bucket of two is the ambiguity we refuse to
	// guess at.
	const gamesByKey = new Map<string, { id: string; title: string }[]>();
	for (const row of library) {
		if (!row.titleNormalized) continue;
		const bucket = gamesByKey.get(row.titleNormalized) ?? [];
		bucket.push({ id: row.id, title: row.title });
		gamesByKey.set(row.titleNormalized, bucket);
	}

	const result: TrophySyncResult = {
		updated: [],
		unmatched: [],
		needsAttention: [],
	};

	const matched: { title: string; write: TrophyCountsWrite }[] = [];
	for (const [key, title] of collapseByMatchKey(titles)) {
		const matches = gamesByKey.get(key) ?? [];
		if (matches.length === 0) {
			result.unmatched.push(title.trophyTitleName);
			continue;
		}
		if (matches.length > 1) {
			result.needsAttention.push({
				title: title.trophyTitleName,
				reason: `matches ${matches.length} games with the same name — trophy counts not written; rename or remove the duplicate, then re-sync`,
			});
			continue;
		}
		matched.push({
			title: matches[0].title,
			write: {
				gameId: matches[0].id,
				npCommId: title.npCommunicationId,
				earned: title.earnedTrophies,
				defined: title.definedTrophies,
				syncedAt: today,
			},
		});
	}

	// ONE batched write per 50 matched titles, not one D1 call per title: D1
	// binding calls count against the Workers subrequest budget (AD-15), and a
	// per-title UPDATE would blow it on a real (~137-title) account. Bulk is the
	// right shape here — unlike the library sync, every statement is the same
	// unconditional trophy-column SET.
	const written = await setTrophyCountsBatch(
		db,
		userId,
		matched.map((m) => m.write),
	);
	// Only what ACTUALLY persisted is reported: a row deleted underneath us
	// updates nothing, and the readout must not claim counts it never wrote.
	for (const m of matched) {
		if (written.has(m.write.gameId)) result.updated.push(m.title);
	}

	// Deliberately NOT persisted to `sync_attention`: that row belongs to the
	// library sync's self-resolving banner (AR-22), and a trophy ambiguity would
	// be cleared by the next clean LIBRARY sync without ever being fixed. The
	// trophy readout modal is where these surface.
	return { ok: true, result };
}
