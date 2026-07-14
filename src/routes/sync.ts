import { Hono } from 'hono';
import { createDb } from '../repositories/db';
import { runPlatinumBackfill } from '../services/backfill';
import { runSync } from '../services/sync';
import { runTrophySync } from '../services/trophies';
import { type AuthVariables, requireAuth } from './auth';

/**
 * The PSN library sync trigger (Story 4.2, FR-33): button-fired, in-Worker,
 * user-scoped. 401 = the NPSSO token was rejected/missing — the expired
 * flag is already persisted (the banner lights on the next settings fetch)
 * and the body carries the refresh message; the client must NOT retry
 * (AD-14). Any other provider failure surfaces as 502 with its message.
 */

type SyncEnv = { Bindings: Env; Variables: AuthVariables };

export const syncRoute = new Hono<SyncEnv>();

syncRoute.post('/sync', requireAuth, async (c) => {
	const outcome = await runSync(
		createDb(c.env.DB),
		c.get('userId'),
		c.env,
	).catch((error: unknown) => {
		// Log the real failure (PSN bodies / DB internals) for `wrangler tail`;
		// the client gets a generic message, never upstream or DB text.
		console.error('sync failed', error);
		return { ok: false as const, reason: 'provider' as const };
	});

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
 */
syncRoute.post('/backfill/platinum-dates', requireAuth, async (c) => {
	const cursor = c.req.query('cursor') || undefined;
	const outcome = await runPlatinumBackfill(
		createDb(c.env.DB),
		c.get('userId'),
		c.env,
		cursor,
	).catch((error: unknown) => {
		// A failure the service could not attribute to a candidate (a D1 fault, a
		// broken candidate query): nothing partial to report.
		console.error('platinum backfill failed', error);
		return { ok: false as const, reason: 'provider' as const };
	});

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
	return c.json(outcome.result, 200);
});

/**
 * The trophy sync trigger (Story 9.2). Same contract as the library sync: 401
 * = the NPSSO was rejected/missing (the expired flag is already persisted, the
 * client must not retry); any other failure — including a DEGENERATE trophy
 * response, which the provider throws on — is a 502, and nothing was written.
 */
syncRoute.post('/sync/trophies', requireAuth, async (c) => {
	const outcome = await runTrophySync(
		createDb(c.env.DB),
		c.get('userId'),
		c.env,
	).catch((error: unknown) => {
		console.error('trophy sync failed', error);
		return { ok: false as const, reason: 'provider' as const };
	});

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
