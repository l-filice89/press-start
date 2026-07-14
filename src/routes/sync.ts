import { Hono } from 'hono';
import { createDb } from '../repositories/db';
import { runPlatinumBackfill } from '../services/backfill';
import {
	acquirePsnLock,
	PSN_BUSY_MESSAGE,
	releasePsnLock,
	withPsnLock,
} from '../services/psn-lock';
import { runSync } from '../services/sync';
import { runTrophySync } from '../services/trophies';
import { type AuthVariables, requireAuth } from './auth';

/**
 * The PSN library sync trigger (Story 4.2, FR-33): button-fired, in-Worker,
 * user-scoped. 401 = the NPSSO token was rejected/missing — the expired
 * flag is already persisted (the banner lights on the next settings fetch)
 * and the body carries the refresh message; the client must NOT retry
 * (AD-14). Any other provider failure surfaces as 502 with its message.
 *
 * SINGLE-FLIGHT (Story 9.5): all three PSN long-ops below share ONE per-user
 * lock — they hit PSN with the same credential and write the same rows, so a
 * second concurrent run is refused with a 409 rather than doubling the fan-out
 * and reporting the same rows twice.
 */

type SyncEnv = { Bindings: Env; Variables: AuthVariables };

export const syncRoute = new Hono<SyncEnv>();

syncRoute.post('/sync', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	const held = await withPsnLock(db, userId, 'library-sync', () =>
		runSync(db, userId, c.env).catch((error: unknown) => {
			// Log the real failure (PSN bodies / DB internals) for `wrangler tail`;
			// the client gets a generic message, never upstream or DB text.
			console.error('sync failed', error);
			return { ok: false as const, reason: 'provider' as const };
		}),
	);
	if (held.busy) return c.json({ error: PSN_BUSY_MESSAGE }, 409);
	const outcome = held.result;

	if (!outcome.ok) {
		return outcome.reason === 'auth'
			? c.json({ error: outcome.message }, 401)
			: c.json(
					{
						error:
							'Sync failed — PlayStation did not answer as expected. Try again later.',
					},
					502,
				);
	}
	return c.json(outcome.result, 200);
});

/**
 * The one-off platinum-date backfill (Story 9.3). CHUNKED: one request fills a
 * bounded page of candidates and answers a `nextCursor`; the client re-posts
 * with it until it comes back null. Same auth contract as the syncs (401 = the
 * NPSSO was rejected, never retry; 502 for anything else) — plus a 409 when the
 * user has no timezone, because `platinum_on` is write-once and a UTC-guessed
 * date could never be corrected.
 *
 * A FAILED chunk is NOT an empty one: `platinum_on` cannot be un-written, so the
 * 401/502 body carries `partial` — the rows this chunk really did fill/skip
 * before it died, and the cursor that resumes at the candidate that failed.
 *
 * The lock spans the WHOLE client loop, not one chunk: the FIRST chunk (no
 * cursor) claims it and answers with a `lockToken`; each continuation presents
 * that token to RENEW the same lock, and it is released when the loop ends — the
 * last chunk, or any failure. Otherwise a second tab could slip in between two
 * chunks and both loops would walk the same candidates.
 *
 * The TOKEN is the capability, never the cursor: a cursor is just a `game_id`
 * this endpoint published in its own response body (and in a failure's
 * `partial`), so honouring it as proof of ownership would let anyone with one
 * overwrite a RUNNING sync's lock and fan out to PSN beside it.
 */
syncRoute.post('/backfill/platinum-dates', requireAuth, async (c) => {
	const cursor = c.req.query('cursor') || undefined;
	const heldToken = c.req.query('lockToken') || undefined;
	const db = createDb(c.env.DB);
	const userId = c.get('userId');

	// The client STOPPING mid-loop on purpose (its chunk brake, or the panel
	// closing) hands the lock back — otherwise the run it just abandoned would
	// keep refusing the user's next sync for the rest of the TTL, with a message
	// ("a sync is already running") that is no longer true.
	if (c.req.query('release')) {
		if (heldToken) await releasePsnLock(db, userId, heldToken);
		return c.json({ released: true }, 200);
	}

	// A continuation RENEWS the lock it already holds (checked against the stored
	// row, in the claim statement itself); a fresh run claims. Both are refused
	// when someone else holds it.
	const token = await acquirePsnLock(
		db,
		userId,
		'platinum-backfill',
		cursor ? heldToken : undefined,
	);
	if (!token) return c.json({ error: PSN_BUSY_MESSAGE }, 409);

	const outcome = await runPlatinumBackfill(db, userId, c.env, cursor).catch(
		(error: unknown) => {
			// A failure the service could not attribute to a candidate (a D1 fault, a
			// broken candidate query): nothing partial to report.
			console.error('platinum backfill failed', error);
			return { ok: false as const, reason: 'provider' as const };
		},
	);
	// Hold the lock only while the loop is still going: the client stops on a
	// failure and on a null cursor, and a lock nobody will release is a lock the
	// user waits out.
	const loopContinues = outcome.ok && outcome.result.nextCursor !== null;
	if (!loopContinues) await releasePsnLock(db, userId, token);

	if (!outcome.ok) {
		if (outcome.reason === 'no-timezone')
			return c.json({ error: outcome.message }, 409);
		const partial = 'partial' in outcome ? outcome.partial : undefined;
		return outcome.reason === 'auth'
			? c.json({ error: outcome.message, partial }, 401)
			: c.json(
					{
						error:
							'Backfill failed — PlayStation did not answer as expected. Try again later.',
						partial,
					},
					502,
				);
	}
	// The token rides back ONLY while the loop continues — there is nothing left
	// to hold once the last chunk released it, so the field is absent then.
	return c.json(
		loopContinues ? { ...outcome.result, lockToken: token } : outcome.result,
		200,
	);
});

/**
 * The trophy sync trigger (Story 9.2). Same contract as the library sync: 401
 * = the NPSSO was rejected/missing (the expired flag is already persisted, the
 * client must not retry); any other failure — including a DEGENERATE trophy
 * response, which the provider throws on — is a 502, and nothing was written.
 */
syncRoute.post('/sync/trophies', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	const held = await withPsnLock(db, userId, 'trophy-sync', () =>
		runTrophySync(db, userId, c.env).catch((error: unknown) => {
			console.error('trophy sync failed', error);
			return { ok: false as const, reason: 'provider' as const };
		}),
	);
	if (held.busy) return c.json({ error: PSN_BUSY_MESSAGE }, 409);
	const outcome = held.result;

	if (!outcome.ok) {
		return outcome.reason === 'auth'
			? c.json({ error: outcome.message }, 401)
			: c.json(
					{
						error:
							'Trophy sync failed — PlayStation did not answer as expected. Try again later.',
					},
					502,
				);
	}
	return c.json(outcome.result, 200);
});
