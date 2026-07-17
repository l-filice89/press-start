import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '../repositories/db';
import {
	browseCatalog,
	listCatalogGenreFacets,
} from '../services/psplus-browse';
import { type AuthVariables, requireAuth } from './auth';

/**
 * PS+ catalog READ routes (Story 7.2, FR-51). The manual check button and the
 * client-driven genre-sweep loop died with Story 8.4 (AD-31): snapshot writes
 * come only from the cron rotation and the stale-snapshot guard — refreshes
 * are automatic and their failures passive.
 */

type PsPlusEnv = { Bindings: Env; Variables: AuthVariables };

export const psPlusRoute = new Hono<PsPlusEnv>();

/**
 * The catalog BROWSE read (Story 7.2, FR-51). A pure repository read — no
 * provider is reachable from here (AD-6), so opening the destination can never
 * hit PlayStation. `genre` repeats for a multiselect (OR within the group,
 * AD-26); `q` is a case-insensitive title substring; `cursor` is the A–Z offset.
 *
 * Registered BEFORE `/ps-plus-catalog/genres`'s POST sibling and matched on
 * method+path, so the sweep endpoint is untouched.
 */
const catalogResponseSchema = z.object({
	region: z.string().nullable(),
	total: z.number(),
	snapshotTotal: z.number(),
	nextCursor: z.number().nullable(),
	generation: z.string().nullable(),
	games: z.array(
		z.object({
			productId: z.string(),
			name: z.string(),
			coverUrl: z.string().nullable(),
			storeUrl: z.string().nullable(),
			inLibrary: z.boolean(),
			leavingOn: z.string().nullable(),
			owned: z.boolean(),
			gameId: z.string().nullable(),
		}),
	),
});

/**
 * `genre` is UNBOUNDED user input at a trust boundary (review, M4): the raw
 * repeats went straight into an `inArray()`, so `?genre=A&genre=B` ×1000 built a
 * 1000-bind-variable statement — past SQLite's ceiling, which is a 500 where a
 * 400 belongs. And an EMPTY `?genre=` yielded `['']`, which passed the length
 * check, matched no tag, and showed NO MATCH on a perfectly healthy snapshot.
 * Empties are dropped, keys are deduped, and a bad request is refused — never a
 * 500, never a silent empty grid.
 */
const MAX_GENRE_KEYS = 40;
const MAX_GENRE_KEY_LENGTH = 64;

psPlusRoute.get('/ps-plus-catalog', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const genreKeys = [
		...new Set(
			(c.req.queries('genre') ?? []).map((key) => key.trim()).filter(Boolean),
		),
	];
	if (
		genreKeys.length > MAX_GENRE_KEYS ||
		genreKeys.some((key) => key.length > MAX_GENRE_KEY_LENGTH)
	) {
		return c.json({ error: 'Too many or over-long genre filters.' }, 400);
	}
	const search = (c.req.query('q') ?? '').trim().slice(0, 200);
	const cursor = Number.parseInt(c.req.query('cursor') ?? '0', 10);
	const page = await browseCatalog(db, c.get('userId'), c.env, {
		genreKeys,
		search: search || undefined,
		cursor: Number.isNaN(cursor) ? 0 : cursor,
	});
	return c.json(catalogResponseSchema.parse(page), 200);
});

const catalogGenresSchema = z.object({
	genres: z.array(z.object({ key: z.string(), count: z.number() })),
});

psPlusRoute.get('/ps-plus-catalog/genres', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const genres = await listCatalogGenreFacets(db, c.get('userId'), c.env);
	return c.json(catalogGenresSchema.parse({ genres }), 200);
});
