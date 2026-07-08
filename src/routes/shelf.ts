import { Hono } from 'hono';
import { z } from 'zod';
import { EFFECTIVE_STATES } from '../core';
import { createDb } from '../repositories/db';
import { getShelf, searchLibrary } from '../services';
import { type AuthVariables, requireAuth } from './auth';

/**
 * The read-only shelf boundary (Story 1.7). Two user-scoped GET routes behind
 * `requireAuth` (AD-13): the default backlog shelf and a dedicated whole-library
 * search. Both return the baked `ShelfGame` card DTO, Zod-validated on the way
 * out (AR-26). No third-party fetch happens here — the service reads only
 * persisted rows (NFR-3).
 */

const shelfGameSchema = z.object({
	id: z.string(),
	title: z.string(),
	coverUrl: z.string().nullable(),
	storeUrl: z.string().nullable(),
	effectiveState: z.enum(EFFECTIVE_STATES),
	owned: z.boolean(),
	released: z.boolean(),
	wishlisted: z.boolean(),
	psPlusExtra: z.boolean(),
	hasCompleted: z.boolean(),
	hasPlatinum: z.boolean(),
	releaseDate: z.string().nullable(),
	genres: z.array(z.string()),
});

const shelfResponseSchema = z.object({
	games: z.array(shelfGameSchema),
});

export type ShelfGameResponse = z.infer<typeof shelfGameSchema>;
export type ShelfResponse = z.infer<typeof shelfResponseSchema>;

type ShelfEnv = { Bindings: Env; Variables: AuthVariables };

export const shelfRoute = new Hono<ShelfEnv>();

shelfRoute.get('/shelf', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const games = await getShelf(db, c.get('userId'));
	return c.json(shelfResponseSchema.parse({ games }), 200);
});

shelfRoute.get('/shelf/search', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const query = c.req.query('q') ?? '';
	const games = await searchLibrary(db, c.get('userId'), query);
	return c.json(shelfResponseSchema.parse({ games }), 200);
});
