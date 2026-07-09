import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '../repositories/db';
import {
	addGenreToGame,
	listGenreVocabulary,
	removeGenreFromGame,
} from '../services';
import { type AuthVariables, requireAuth } from './auth';

/**
 * The genre-editing boundary (Story 2.5): vocabulary listing plus add/remove
 * of a game's genre set, behind `requireAuth` and Zod-validated in and out
 * (AR-26). No merge/rename endpoints exist — FR-25 keeps them out of v1.
 */

// The API's only free-text write: bound it so a runaway string can't lodge
// itself in the vocabulary (and every GET /genres response) forever.
const genreBodySchema = z.object({ name: z.string().max(64) });

// Both writes and the vocabulary GET answer a plain name list; the SPA
// refetches the shelf for everything else.
const genresResponseSchema = z.object({ genres: z.array(z.string()) });

type GenresEnv = { Bindings: Env; Variables: AuthVariables };

export const genresRoute = new Hono<GenresEnv>();

genresRoute.get('/genres', requireAuth, async (c) => {
	const genres = await listGenreVocabulary(createDb(c.env.DB));
	return c.json(genresResponseSchema.parse({ genres }), 200);
});

genresRoute.post('/games/:gameId/genres', requireAuth, async (c) => {
	const body = genreBodySchema.safeParse(await c.req.json().catch(() => null));
	if (!body.success) {
		return c.json({ error: 'invalid genre' }, 400);
	}

	const genres = await addGenreToGame(
		createDb(c.env.DB),
		c.get('userId'),
		c.req.param('gameId'),
		body.data.name,
	);
	if (genres === 'invalid') {
		return c.json({ error: 'invalid genre' }, 400);
	}
	if (!genres) {
		return c.json({ error: 'not found' }, 404);
	}

	return c.json(genresResponseSchema.parse({ genres }), 200);
});

genresRoute.delete('/games/:gameId/genres/:name', requireAuth, async (c) => {
	const genres = await removeGenreFromGame(
		createDb(c.env.DB),
		c.get('userId'),
		c.req.param('gameId'),
		c.req.param('name'),
	);
	if (!genres) {
		return c.json({ error: 'not found' }, 404);
	}

	return c.json(genresResponseSchema.parse({ genres }), 200);
});
