import { Hono } from 'hono';
import { z } from 'zod';
import { EFFECTIVE_STATES, PLAY_STATUSES } from '../core';
import { createDb } from '../repositories/db';
import { OWNERSHIP_TYPES } from '../schema/catalog';
import { getShelf } from '../services';
import { readLibraryVersion } from '../services/library-version';
import { getPsnRegion } from '../services/settings';
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
	// Story 10.2: date the game left the PS+ Extra catalog (warning pill).
	psPlusLeavingOn: z.string().nullable(),
	// Story 10.3: time-to-beat seconds (story / 100% / submissions).
	ttbStorySeconds: z.number().nullable(),
	ttbCompleteSeconds: z.number().nullable(),
	ttbCount: z.number().nullable(),
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
	// Conditional GET (Story 8.6, AD-33 §4): the ETag is the user's library
	// version — rotated by EVERY writer (user-scoped and shared-fact alike, see
	// services/library-version.ts), so a match proves the shelf bytes would be
	// identical and the whole-library read is skipped. Weak tag (`W/`): the
	// guarantee is semantic equivalence, not byte identity across serializers.
	// An unconditional GET always answers 200 + body.
	const version = await readLibraryVersion(db, c.get('userId'));
	// Region rides IN the tag (Story 8.3): the body derives from the user's
	// region, so a region change must miss the validator — otherwise a
	// conditional GET would 304 the OLD region's answer.
	const region = await getPsnRegion(db, c.get('userId'), c.env);
	const etag = `W/"${version}:${region ?? ''}"`;
	// RFC 9110 list form: `If-None-Match` may carry several tags or `*`. A miss
	// only costs a spurious 200 (safe direction), but an aggregating proxy would
	// otherwise silently defeat the whole optimization.
	const ifNoneMatch = (c.req.header('if-none-match') ?? '')
		.split(',')
		.map((t) => t.trim());
	// `private`: the body is one signed-in user's library — a validator with no
	// cache directives invites shared proxies to heuristic-cache it (RFC 9111).
	const headers = { ETag: etag, 'Cache-Control': 'private' };
	if (ifNoneMatch.includes(etag) || ifNoneMatch.includes('*')) {
		return c.body(null, 304, headers);
	}
	// `?include=hidden` (Story 3.2): the whole ordered library, so the client's
	// reveal pills can OR hidden states into the visible set. Default unchanged.
	const includeHidden = c.req.query('include') === 'hidden';
	const games = await getShelf(db, c.get('userId'), includeHidden, region);
	return c.json(shelfResponseSchema.parse({ games }), 200, headers);
});
