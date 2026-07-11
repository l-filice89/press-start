import { Hono } from 'hono';
import { createDb } from '../repositories/db';
import { runPsPlusCheck } from '../services/psplus';
import { type AuthVariables, requireAuth } from './auth';

/**
 * The PS+ Extra catalog check trigger (Story 5.1, FR-38): button-fired,
 * in-Worker, user-scoped. The catalog endpoint is public, so there is no
 * expired-cookie path here — any provider failure surfaces as 502 with a
 * generic message (details go to `wrangler tail` from the service).
 */

type PsPlusEnv = { Bindings: Env; Variables: AuthVariables };

export const psPlusRoute = new Hono<PsPlusEnv>();

psPlusRoute.post('/ps-plus-check', requireAuth, async (c) => {
	const outcome = await runPsPlusCheck(
		createDb(c.env.DB),
		c.get('userId'),
		c.env,
	).catch((error: unknown) => {
		console.error('ps+ check failed', error);
		return { ok: false as const, reason: 'provider' as const };
	});

	if (!outcome.ok) {
		return outcome.reason === 'no-region'
			? c.json({ error: 'No PSN region is configured — set PSN_REGION.' }, 409)
			: c.json(
					{
						error:
							'PS+ check failed — PlayStation did not answer as expected. Try again later.',
					},
					502,
				);
	}
	return c.json(outcome.result, 200);
});
