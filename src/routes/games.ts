import { Hono } from 'hono';
import { z } from 'zod';
import { createIgdbProvider, type IgdbSearch } from '../providers';
import { createDb } from '../repositories/db';
import {
	addGame,
	getGameById,
	previewAddGame,
	rematchGame,
	searchGamesForResolve,
	todayForUser,
} from '../services';
import { type AuthVariables, requireAuth } from './auth';
import { shelfGameSchema } from './shelf';

/**
 * IGDB creds are Wrangler secrets (absent in e2e/dev until set) — the generated
 * Env type only knows secrets present in `.dev.vars`, so read them loosely.
 * Missing creds return null and every caller degrades to name-only (NFR-4).
 * The provider mints/refreshes its own Twitch app token from id+secret (Epic 5
 * stable-auth) — no manual token rotation.
 */
function igdbFromEnv(rawEnv: Env): IgdbSearch | null {
	const env = rawEnv as Env & {
		IGDB_CLIENT_ID?: string;
		IGDB_CLIENT_SECRET?: string;
	};
	return env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET
		? createIgdbProvider({
				clientId: env.IGDB_CLIENT_ID,
				clientSecret: env.IGDB_CLIENT_SECRET,
			})
		: null;
}

/**
 * The add-by-name boundary (Story 6.1, FR-41/42/43): a preview GET that asks
 * IGDB for a candidate (the ONLY render-adjacent external call, and it fires
 * per explicit user action — never on page load), and the create POST. Both
 * behind `requireAuth` (AD-13), Zod-validated in and out (AR-26). A duplicate
 * create answers 409 WITH the existing game id so the client opens its detail
 * view instead (AR-9).
 */

const previewResponseSchema = z.object({
	available: z.boolean(),
	candidate: z
		.object({
			igdbId: z.string(),
			name: z.string(),
			coverUrl: z.string().nullable(),
			releaseDate: z.string().nullable(),
			genres: z.array(z.string()),
		})
		.nullable(),
});

const addBodySchema = z.object({
	title: z.string().trim().min(1).max(200),
	igdbId: z.string().min(1).max(64).optional(),
	// Rendered as an <img src> — https only, bounded.
	coverUrl: z
		.string()
		.max(500)
		.regex(/^https:\/\//)
		.nullish(),
	releaseDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		// Reject impossible calendar dates the regex lets through (2020-13-45):
		// round-trip through Date and require it lands on the same day. Guard the
		// Invalid-Date case first — .toISOString() on it throws (would 500).
		.refine((s) => {
			const ms = Date.parse(`${s}T00:00:00Z`);
			return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s;
		})
		.nullish(),
	genres: z.array(z.string().max(64)).max(20).optional(),
	owned: z.boolean().optional(),
});

const addResponseSchema = z.object({ gameId: z.string() });

type GamesEnv = { Bindings: Env; Variables: AuthVariables };

export const gamesRoute = new Hono<GamesEnv>();

gamesRoute.get('/games/preview', requireAuth, async (c) => {
	const title = (c.req.query('title') ?? '').trim();
	if (!title || title.length > 200) {
		return c.json({ error: 'invalid title' }, 400);
	}

	const preview = await previewAddGame(igdbFromEnv(c.env), title);
	return c.json(previewResponseSchema.parse(preview), 200);
});

const searchResponseSchema = z.object({
	candidates: z.array(
		z.object({
			igdbId: z.string(),
			name: z.string(),
			coverUrl: z.string().nullable(),
			releaseDate: z.string().nullable(),
			genres: z.array(z.string()),
		}),
	),
});

// Multi-result IGDB search for straggler resolution (Story 6.2): the user
// picks the right match, so this returns a list (empty when creds are absent
// or IGDB is down — the caller shows the degraded notice).
gamesRoute.get('/games/search', requireAuth, async (c) => {
	const title = (c.req.query('title') ?? '').trim();
	if (!title || title.length > 200) {
		return c.json({ error: 'invalid title' }, 400);
	}
	const candidates = await searchGamesForResolve(igdbFromEnv(c.env), title);
	return c.json(searchResponseSchema.parse({ candidates }), 200);
});

/**
 * ONE game by id (Story 7.2, AD-25) — what `/game/:id` resolves through. It is
 * registered AFTER the static `/games/preview` + `/games/search` routes, which
 * therefore still win the match. A pending fetch is a LOADING state client-side;
 * this 404 is the only "not found" (and a game the user doesn't track is one).
 */
gamesRoute.get('/games/:id', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const game = await getGameById(db, c.get('userId'), c.req.param('id'));
	if (!game) return c.json({ error: 'game not found' }, 404);
	return c.json({ game: shelfGameSchema.parse(game) }, 200);
});

// Rematch an already-added game onto a different IGDB entry (PV-4): the
// detail-panel correction for a wrong same-name match. The client passes the
// chosen candidate (IGDB itself is not called here); the service swaps the link
// and overwrites enrichment in place. `not-found` = not this user's game (404);
// `conflict` = the pick already anchors another game (409, AD-20).
const rematchBodySchema = z.object({
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

gamesRoute.post('/games/:id/rematch', requireAuth, async (c) => {
	const gameId = c.req.param('id');
	const body = rematchBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!body.success) {
		return c.json({ error: 'invalid rematch' }, 400);
	}

	const db = createDb(c.env.DB);
	const outcome = await rematchGame(db, c.get('userId'), gameId, {
		...body.data,
		coverUrl: body.data.coverUrl ?? null,
		releaseDate: body.data.releaseDate ?? null,
	});
	if (outcome === 'not-found') {
		return c.json({ error: 'game not found' }, 404);
	}
	if (outcome === 'conflict') {
		return c.json({ error: 'that match already belongs to another game' }, 409);
	}
	return c.json(addResponseSchema.parse({ gameId: outcome.gameId }), 200);
});

gamesRoute.post('/games', requireAuth, async (c) => {
	const body = addBodySchema.safeParse(await c.req.json().catch(() => null));
	if (!body.success) {
		return c.json({ error: 'invalid game' }, 400);
	}

	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	const today = await todayForUser(db, userId);
	const outcome = await addGame(db, userId, body.data, today);
	if (outcome === 'invalid') {
		return c.json({ error: 'invalid game' }, 400);
	}
	if (outcome.kind === 'duplicate') {
		return c.json({ error: 'duplicate', gameId: outcome.gameId }, 409);
	}

	return c.json(addResponseSchema.parse({ gameId: outcome.gameId }), 201);
});
