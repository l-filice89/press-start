import { Hono } from 'hono';
import { z } from 'zod';
import { EFFECTIVE_STATES, PLAY_STATUSES } from '../core';
import { createDb } from '../repositories/db';
import { OWNERSHIP_TYPES } from '../schema/catalog';
import { getShelf } from '../services';
import { type AuthVariables, requireAuth } from './auth';

/**
 * The read-only shelf boundary (Story 1.7). One user-scoped GET route behind
 * `requireAuth` (AD-13): the whole ordered library (the SPA filters/searches it
 * client-side). Returns the baked `ShelfGame` card DTO, Zod-validated on the way
 * out (AR-26). No third-party fetch happens here — the service reads only
 * persisted rows (NFR-3).
 */

export const shelfGameSchema = z.object({
	id: z.string(),
	title: z.string(),
	coverUrl: z.string().nullable(),
	storeUrl: z.string().nullable(),
	playStatus: z.enum(PLAY_STATUSES).nullable(),
	effectiveState: z.enum(EFFECTIVE_STATES),
	owned: z.boolean(),
	released: z.boolean(),
	wishlisted: z.boolean(),
	playableNow: z.boolean(),
	psPlusExtra: z.boolean(),
	hasCompleted: z.boolean(),
	hasPlatinum: z.boolean(),
	completedOn: z.string().nullable(),
	platinumOn: z.string().nullable(),
	startedOn: z.string().nullable(),
	boughtOn: z.string().nullable(),
	wishlistedOn: z.string().nullable(),
	ownershipType: z.enum(OWNERSHIP_TYPES).nullable(),
	// `membership` = PS+ claim (FR-9 amended) — the card tags it.
	ownedVia: z.enum(['purchase', 'membership']).nullable(),
	releaseDate: z.string().nullable(),
	genres: z.array(z.string()),
	// IGDB reception scores (Story 10.1) — null = absent, the UI renders nothing.
	criticScore: z.number().nullable(),
	criticScoreCount: z.number().nullable(),
	userScore: z.number().nullable(),
	userScoreCount: z.number().nullable(),
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
	// `?include=hidden` (Story 3.2): the whole ordered library, so the client's
	// reveal pills can OR hidden states into the visible set. Default unchanged.
	const includeHidden = c.req.query('include') === 'hidden';
	const games = await getShelf(db, c.get('userId'), includeHidden);
	return c.json(shelfResponseSchema.parse({ games }), 200);
});
