import { Hono } from 'hono';
import { createDb } from '../repositories/db';
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
