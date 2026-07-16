/**
 * Scheduled IGDB score refresh (Story 10.1, VR-5). Scores drift as reviews
 * land, so the stored facts are re-fetched on the existing monthly Cron
 * Trigger — never at render (NFR-3). The whole library refreshes by stored
 * IGDB id (`external_link (IGDB, …)`) — no fuzzy title matching anywhere.
 *
 * SUBREQUEST BUDGET (Epic 9 rule — count EVERY consumer, AD-15's 50 ceiling):
 *   external: ≤1 Twitch token mint (cold isolate) + ceil(links/500) IGDB
 *             fetches = 2 for any library under 500 linked games;
 *   D1:       1 user lookup + 1 stale-stamp read + 1 link list + 1 batched
 *             score write (one `db.batch`, however many rows) + the stamp
 *             (1 timezone read via todayForUser + 1 write) + failed-flag
 *             clear (1) — or, on the failure path, the flag mark (1) = ≤7.
 *   Total ≈ 9 of 50 — and the worker runs it AFTER `runScheduledPsPlusCheck`
 *   in the same invocation, whose heaviest path (membership pass) is 34: the
 *   stale-gate means the two only combine once per monthly window, worst case
 *   ~43 of 50. No cursor machinery at this scale (65 linked games today); the
 *   chunked provider fetch is the only paging.
 */
import type { IgdbScoreFetch, IgdbScores } from '../providers';
import {
	findUserByEmail,
	type GameScores,
	listExternalLinksBySource,
	updateGameScores,
} from '../repositories';
import type { Db } from '../repositories/db';
import {
	clearScoresRefreshFailed,
	getScoresRefreshedAt,
	markScoresRefreshFailed,
	stampScoresRefreshedAt,
} from './settings';

/** Refresh when the last success is at least this old (or absent). The cron
 * window is 7 consecutive days a month, so >6 days guarantees exactly one
 * refresh per window while letting a mid-window failure retry the next day. */
const STALE_AFTER_DAYS = 7;

export type ScoreRefreshOutcome =
	| { ok: true; updated: number }
	| { ok: false; reason: 'provider' };

function toGameScores(row: IgdbScores): GameScores {
	return {
		criticScore: row.criticScore,
		criticScoreCount: row.criticScoreCount,
		userScore: row.userScore,
		userScoreCount: row.userScoreCount,
	};
}

/**
 * One full refresh pass for one user. Writes ONLY games present in the IGDB
 * response — an id IGDB didn't answer for keeps its stored scores, and a
 * degenerate `200 []` for a non-empty id list is a PROVIDER FAILURE, not
 * "nobody has scores anymore" (DEGENERATE-RESPONSE rule: existing state
 * survives; the banner lights; next cron retries).
 */
export async function runScoreRefresh(
	db: Db,
	userId: string,
	igdb: IgdbScoreFetch,
): Promise<ScoreRefreshOutcome> {
	const links = await listExternalLinksBySource(db, 'IGDB');
	// Non-numeric ids can never be queried (the provider drops them before
	// interpolation) — count them HERE so "no queryable ids" is a logged
	// config gap, not a fake provider failure whose banner promises a retry
	// that can never succeed (review — the `no-region` dead-end rule).
	const queryable = links.filter((l) => /^\d+$/.test(l.externalId));
	if (queryable.length < links.length) {
		console.error(
			`score refresh: ${links.length - queryable.length} non-numeric IGDB external ids skipped — those games can never refresh`,
		);
	}
	if (queryable.length === 0) {
		// Nothing queryable = nothing to refresh; a real success, not a failure.
		await stampScoresRefreshedAt(db, userId);
		await clearScoresRefreshFailed(db, userId);
		return { ok: true, updated: 0 };
	}

	let rows: IgdbScores[];
	try {
		rows = await igdb.fetchScoresByIds(queryable.map((l) => l.externalId));
	} catch (error) {
		console.error('score refresh: IGDB fetch failed', error);
		return { ok: false, reason: 'provider' };
	}
	if (rows.length === 0) {
		console.error(
			`score refresh: IGDB answered 0 rows for ${queryable.length} ids — degenerate response, keeping stored scores`,
		);
		return { ok: false, reason: 'provider' };
	}

	// A game can carry several IGDB links only pathologically; last write wins
	// inside the single batch either way. Map response rows back through the
	// link table — ids IGDB skipped simply produce no update.
	const byExternalId = new Map(rows.map((row) => [row.igdbId, row]));
	const updates = queryable.flatMap((link) => {
		const row = byExternalId.get(link.externalId);
		return row ? [{ gameId: link.gameId, scores: toGameScores(row) }] : [];
	});
	await updateGameScores(db, updates);
	await stampScoresRefreshedAt(db, userId);
	await clearScoresRefreshFailed(db, userId);
	return { ok: true, updated: updates.length };
}

/**
 * Cron entry (mirrors `runScheduledPsPlusCheck`): resolve THE single-tenant
 * user, skip while fresh, run, and persist the FR-40 failure flag on any
 * genuine provider failure or throw. Missing IGDB creds are a CONFIG gap, not
 * a transient failure — same posture as PS+'s `no-region` (the banner would
 * point at a retry that can never succeed), so it logs and leaves quietly.
 */
export async function runScheduledScoreRefresh(
	db: Db,
	env: { AUTH_ALLOWED_EMAIL: string },
	igdb: IgdbScoreFetch | null,
): Promise<void> {
	const user = await findUserByEmail(db, env.AUTH_ALLOWED_EMAIL);
	if (!user) return;
	if (!igdb) {
		console.warn('score refresh skipped — IGDB credentials not configured');
		return;
	}
	try {
		const refreshedAt = await getScoresRefreshedAt(db, user.id);
		if (refreshedAt && !isStale(refreshedAt)) return;
		const outcome = await runScoreRefresh(db, user.id, igdb);
		if (!outcome.ok) await markScoresRefreshFailed(db, user.id);
	} catch (error) {
		console.error('scheduled score refresh threw', error);
		// The flag write itself can fail (it's a D1 call inside a catch) — a
		// rethrow here would error the whole cron invocation for a lost flag.
		await markScoresRefreshFailed(db, user.id).catch((flagError) =>
			console.error('score refresh: failed to persist failure flag', flagError),
		);
	}
}

function isStale(refreshedAt: string): boolean {
	const ms = Date.parse(`${refreshedAt}T00:00:00Z`);
	if (Number.isNaN(ms)) return true;
	return Date.now() - ms >= STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
