/**
 * One-off platinum-date backfill (Story 9.3). PSN knows WHEN every platinum was
 * earned; Story 9.2 only persisted how many. This run fills the blanks —
 * and ONLY the blanks.
 *
 * THE ONE PLACE A SYNC WRITES A MILESTONE. The trophy sync (9.2) writes trophy
 * columns and nothing else, deliberately; this is the single, documented
 * exception, and it may only ever fill a NULL (write-once, FR-6/FR-45/AD-11 —
 * re-enforced in SQL by the COALESCE idiom it reuses). Do not generalize it.
 *
 * DELIBERATE DIVERGENCE from the manual milestone write: `applyMilestone` pairs
 * a platinum with `playStatus: null` (the game leaves the "playing" set); this
 * backfill does NOT touch `play_status`. A date recovered from history says
 * nothing about what the user is playing NOW, and silently un-setting "Playing"
 * on a game they are replaying would be a lie the user never asked for.
 *
 * WRITE-ONCE MEANS NO ROLLBACK. A failure mid-chunk cannot un-write the rows
 * already stamped, so it does not pretend to: the outcome carries the PARTIAL
 * report (what was actually filled/skipped before the failure) plus a cursor
 * positioned AT the candidate that failed, so a re-run resumes exactly there.
 *
 * A user with NO timezone is REFUSED (`no-timezone`): `platinum_on` is a local
 * calendar date, the column is write-once, and a UTC fallback misdates every
 * evening platinum — permanently. Better no date than a wrong, unfixable one.
 *
 * Bounded by construction: the candidate query is CURSOR-PAGED, so one request
 * issues at most `CHUNK_SIZE` per-title calls and the client loops on the
 * cursor. A title PSN no longer resolves (the captured 404), one with no
 * platinum date on record, and one PSN simply FAILS on (a 5xx, a truncated
 * trophy set) are all SKIPPED and reported — the cursor still advances. That is
 * load-bearing: candidates are ordered by `game_id` and filled rows drop out, so
 * aborting the chunk on a bad title would make every re-run die on that same
 * title and permanently strand every candidate behind it. ONLY an auth failure
 * stops the run.
 */
import { todayInZone } from '../core';
import { createPsnProvider, PsnAuthError } from '../providers';
import {
	hasAnyTrophyData,
	listPlatinumBackfillCandidates,
	updateTrackingMilestone,
} from '../repositories';
import type { Db } from '../repositories/db';
import { getPsnNpsso, getUserTimeZone, markPsnAuthExpired } from './settings';

/**
 * Candidates per invocation. The Workers free tier allows 50 subrequests per
 * invocation and D1 binding calls count too. This chunk spends, at worst:
 * 2 exchange legs + 15 detail fetches + 15 UPDATEs = 32, plus the D1 READS this
 * request issues that are NOT in that sum — the auth middleware's session/user
 * lookups, the npsso read, the timezone read and the candidate page (~5-6). Call
 * it ~38 of 50: real headroom, unlike the 45 an earlier count claimed by
 * ignoring the middleware. The probed account has 53 platinum titles — 4 chunks.
 */
const CHUNK_SIZE = 15;

/** Why a candidate could not be dated — `code` is what the UI branches on. */
export interface PlatinumBackfillSkip {
	title: string;
	reason: string;
	code: 'not-found' | 'no-date' | 'error';
}

export interface PlatinumBackfillResult {
	filled: { gameId: string; title: string; date: string }[];
	skipped: PlatinumBackfillSkip[];
	/** Pass back to continue; null = the last chunk (the client loop stops). */
	nextCursor: string | null;
	/**
	 * False only when the trophy sync (9.2) has never written a single row — the
	 * difference between "nothing left to recover" and "there is no trophy data
	 * to recover FROM yet", which the UI must not conflate.
	 */
	hasTrophyData: boolean;
}

/**
 * `no-timezone`: refused before any write (see the doc block).
 * `auth`: the ONLY failure that stops the run — rows written before it stand and
 * are reported in `partial`, whose `nextCursor` resumes at the failed candidate.
 * Any other per-title failure is a SKIP inside a successful run, never an abort.
 */
export type PlatinumBackfillOutcome =
	| { ok: true; result: PlatinumBackfillResult }
	| { ok: false; reason: 'no-timezone'; message: string }
	| {
			ok: false;
			reason: 'auth';
			message: string;
			partial: PlatinumBackfillResult;
	  };

export async function runPlatinumBackfill(
	db: Db,
	userId: string,
	env: { PSN_NPSSO?: string },
	cursor?: string,
): Promise<PlatinumBackfillOutcome> {
	// Read the zone ONCE, BEFORE anything else: PSN sends a UTC instant and
	// `platinum_on` is a LOCAL calendar date. With no zone there is no honest
	// date to write and the column cannot be corrected later — refuse the run.
	const timeZone = await getUserTimeZone(db, userId);
	if (!timeZone) {
		return {
			ok: false,
			reason: 'no-timezone',
			message:
				'Set your timezone before recovering platinum dates — a recovered date is permanent, and without your zone every evening platinum would be dated a day off.',
		};
	}

	const candidates = await listPlatinumBackfillCandidates(db, userId, {
		after: cursor,
		limit: CHUNK_SIZE,
	});

	const result: PlatinumBackfillResult = {
		filled: [],
		skipped: [],
		// A short page IS the end of the candidate set — and the cursor advances
		// past every row this chunk saw, filled or skipped.
		nextCursor:
			candidates.length === CHUNK_SIZE
				? candidates[candidates.length - 1].gameId
				: null,
		// One extra read, and only on the empty page: with candidates in hand the
		// trophy sync has demonstrably run.
		hasTrophyData:
			candidates.length > 0 || (await hasAnyTrophyData(db, userId)),
	};
	// Nothing to do: no provider is ever constructed, so a user with no trophy
	// data (or an already-complete backfill) needs no PSN credential at all.
	if (candidates.length === 0) return { ok: true, result };

	const provider = createPsnProvider({
		getNpsso: () => getPsnNpsso(db, userId, env),
	});

	// The cursor that resumes AT the candidate currently in hand: the last row
	// this run finished with, or (for the first candidate) the cursor we came in
	// on. `after` is exclusive, so this is what a failure hands back.
	let resumeCursor: string | null = cursor ?? null;

	for (const candidate of candidates) {
		let earned: { earnedAt: string | null; found: boolean };
		try {
			earned = await provider.fetchPlatinumEarnedAt(
				candidate.npCommId,
				// NULL on rows the trophy sync wrote before it stored this: the
				// provider then defaults, and a wrong default 404s into the
				// `not-found` skip below — whose copy says to re-run the sync.
				candidate.npServiceName ?? undefined,
			);
		} catch (error) {
			if (error instanceof PsnAuthError) {
				// No rollback, no pretending: rows already stamped in this chunk are
				// permanent and are reported. The cursor points AT the candidate that
				// failed so a re-run picks up exactly there. Light the persistent
				// banner and stop the WHOLE run (the client loop stops on 401 — never
				// retry an expired credential).
				await markPsnAuthExpired(db, userId);
				return {
					ok: false,
					reason: 'auth',
					message: error.message,
					partial: { ...result, nextCursor: resumeCursor },
				};
			}
			// One title PSN cannot answer for is a SKIP, not the end of the run.
			// Aborting here would be permanent: candidates are ordered by game_id and
			// filled rows drop out, so every re-run would march back into this same
			// title and die on it — nothing behind it could EVER be backfilled.
			// Log the real upstream text; the user gets the short reason.
			console.error(
				'platinum backfill skipped a title',
				candidate.gameId,
				error,
			);
			result.skipped.push({
				title: candidate.title,
				reason: `PlayStation did not answer as expected: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
				code: 'error',
			});
			resumeCursor = candidate.gameId;
			continue;
		}

		if (!earned.found) {
			result.skipped.push({
				title: candidate.title,
				reason:
					'PlayStation returned no trophy record for this title — re-run the trophy sync, then try again',
				code: 'not-found',
			});
			resumeCursor = candidate.gameId;
			continue;
		}
		const instant = earned.earnedAt ? new Date(earned.earnedAt) : null;
		if (!instant || Number.isNaN(instant.getTime())) {
			result.skipped.push({
				title: candidate.title,
				reason: 'PlayStation has no earned date on record for its platinum',
				code: 'no-date',
			});
			resumeCursor = candidate.gameId;
			continue;
		}
		const date = todayInZone(timeZone, instant);

		// BACKFILL-ONLY HEURISTIC: a platinum implies the game was completed, so a
		// still-NULL `completed_on` takes the same date. The reverse is NOT the
		// rule and this is NOT what synced games do going forward — the trophy
		// sync writes no milestone at all. COALESCE makes both writes NULL-fills:
		// a date the user already set stands, whatever PSN says.
		const written = await updateTrackingMilestone(
			db,
			userId,
			candidate.gameId,
			{
				platinumOn: date,
				completedOn: date,
			},
		);
		// Report the date that actually STANDS on the row (a concurrent stamp wins
		// the COALESCE — the readout must not claim a date it did not write). A
		// row deleted underneath us updates nothing and is reported as neither.
		if (written)
			result.filled.push({
				gameId: candidate.gameId,
				title: candidate.title,
				date: written.platinumOn ?? date,
			});
		resumeCursor = candidate.gameId;
	}

	return { ok: true, result };
}
