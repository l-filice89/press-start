import { Hono } from 'hono';
import { z } from 'zod';
import { createIgdbProvider, type IgdbSearch } from '../providers';
import { createDb } from '../repositories/db';
import {
	addGame,
	previewAddGame,
	searchGamesForResolve,
	todayForUser,
} from '../services';
import { type AuthVariables, requireAuth } from './auth';

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
