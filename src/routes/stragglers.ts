import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '../repositories/db';
import { listStragglerView, resolveStraggler } from '../services';
import { type AuthVariables, requireAuth } from './auth';

/**
 * The straggler-resolution boundary (Story 6.2, FR-28/29). GET lists both
 * kinds (import staging rows + this user's name-only games); POST resolves one
 * onto an IGDB-matched game, writing the permanent external link. Both behind
 * `requireAuth` (AD-13), Zod-validated (AR-26). An unknown straggler answers
 * 404 so the client can drop a stale row from its list.
 */

const listResponseSchema = z.object({
	stragglers: z.array(
		z.object({
			id: z.string(),
			kind: z.enum(['import', 'unenriched']),
			title: z.string(),
		}),
	),
});

const resolveBodySchema = z.object({
	id: z.string().min(1),
	kind: z.enum(['import', 'unenriched']),
	igdbId: z.string().min(1).max(64),
	name: z.string().trim().min(1).max(200).optional(),
	coverUrl: z
		.string()
		.max(500)
		.regex(/^https:\/\//)
		.nullish(),
	releaseDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.refine((s) => {
			const ms = Date.parse(`${s}T00:00:00Z`);
			return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s;
		})
		.nullish(),
	genres: z.array(z.string().max(64)).max(20).optional(),
});

type StragglersEnv = { Bindings: Env; Variables: AuthVariables };

export const stragglersRoute = new Hono<StragglersEnv>();

stragglersRoute.get('/stragglers', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const stragglers = await listStragglerView(db, c.get('userId'));
	return c.json(listResponseSchema.parse({ stragglers }), 200);
});

stragglersRoute.post('/stragglers/resolve', requireAuth, async (c) => {
	const body = resolveBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!body.success) {
		return c.json({ error: 'invalid resolution' }, 400);
	}

	const db = createDb(c.env.DB);
	const outcome = await resolveStraggler(db, c.get('userId'), {
		...body.data,
		coverUrl: body.data.coverUrl ?? null,
		releaseDate: body.data.releaseDate ?? null,
	});
	if (outcome === 'invalid') {
		return c.json({ error: 'invalid resolution' }, 400);
	}
	if (outcome === 'not-found') {
		return c.json({ error: 'straggler not found' }, 404);
	}
	return c.json({ gameId: outcome.gameId }, 200);
});
