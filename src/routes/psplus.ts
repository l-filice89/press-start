import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '../repositories/db';
import {
	acquirePsnLock,
	PSN_BUSY_MESSAGE,
	releasePsnLock,
	withPsnLock,
} from '../services/psn-lock';
import { runPsPlusCheck } from '../services/psplus';
import {
	browseCatalog,
	listCatalogGenreFacets,
} from '../services/psplus-browse';
import { runGenreSweep } from '../services/psplus-genres';
import { type AuthVariables, requireAuth } from './auth';

/**
 * The PS+ Extra catalog ingest (Story 5.1, widened in 7.1 — FR-38/50):
 * button-fired, in-Worker, user-scoped. The catalog endpoint is public, so
 * there is no expired-token path here — any provider failure surfaces as 502
 * with a generic message (details go to `wrangler tail` from the service).
 *
 * SINGLE-FLIGHT (Story 7.1): the refresh now takes the same per-user PSN lock
 * as the syncs. It had none — and 7.1 multiplies its fan-out (5 catalog pages
 * + a ~20-key genre sweep) and makes it a WRITER of a snapshot a second run
 * would prune underneath it.
 */

type PsPlusEnv = { Bindings: Env; Variables: AuthVariables };

export const psPlusRoute = new Hono<PsPlusEnv>();

psPlusRoute.post('/ps-plus-check', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	const held = await withPsnLock(db, userId, 'catalog-refresh', (token) =>
		// The token FENCES the write phase (review, H3): a run whose lock was taken
		// over mid-fetch must not prune the winner's snapshot out from under it.
		runPsPlusCheck(db, userId, c.env, token).catch((error: unknown) => {
			console.error('ps+ check failed', error);
			return { ok: false as const, reason: 'provider' as const };
		}),
	);
	if (held.busy) return c.json({ error: PSN_BUSY_MESSAGE }, 409);
	const outcome = held.result;

	if (!outcome.ok) {
		if (outcome.reason === 'no-region')
			return c.json(
				{ error: 'No PSN region is configured — set PSN_REGION.' },
				409,
			);
		// The store answered and refused the query — near-always a region that is
		// no real store locale (`uk-uk` instead of `en-gb`). Config, not outage:
		// "try again later" would be a lie, so name the fix.
		if (outcome.reason === 'bad-region')
			return c.json(
				{
					error:
						'The PlayStation store did not recognize your region. Store locales are language-country — en-gb for the UK, en-us for the US, it-it for Italy. Fix it in Settings → PlayStation region.',
				},
				409,
			);
		// The fence tripped: another run owns the catalog now, and it wrote a whole
		// snapshot. Nothing was lost and nothing is wrong — this run just stood down.
		if (outcome.reason === 'conflict')
			return c.json({ error: PSN_BUSY_MESSAGE }, 409);
		return c.json(
			{
				error:
					'PS+ check failed — PlayStation did not answer as expected. Try again later.',
			},
			502,
		);
	}
	return c.json(outcome.result, 200);
});

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

/**
 * The genre sweep (Story 7.1, AD-28). CHUNKED, exactly like the platinum
 * backfill: one request sweeps a bounded page of genre facet keys and answers a
 * `nextCursor` + the snapshot `generation`; the client re-posts with both until
 * the cursor comes back null.
 *
 * The TOKEN is the capability, never the cursor: the cursor is a genre key this
 * endpoint published in its own response body (and the facet list is public
 * store data anyway), so honouring it as proof of ownership would let anyone
 * with one overwrite a RUNNING refresh's lock and fan out to the store beside
 * it. The first chunk claims the lock and answers with a `lockToken`; each
 * continuation presents that token to RENEW (and ROTATE) it; the terminating
 * chunk — or any failure — releases it.
 *
 * A 409 `stale-generation` means a refresh landed mid-sweep: the cursor is dead
 * and the client starts the sweep over (AD-28), rather than silently leaving the
 * newly-arrived products untagged.
 */
psPlusRoute.post('/ps-plus-catalog/genres', requireAuth, async (c) => {
	const cursor = c.req.query('cursor') || undefined;
	const generation = c.req.query('generation') || undefined;
	const heldToken = c.req.query('lockToken') || undefined;
	const db = createDb(c.env.DB);
	const userId = c.get('userId');

	// A client that stops mid-loop on purpose hands the lock back — otherwise the
	// run it abandoned keeps refusing the user's next sync for the whole TTL.
	// `=== '1'` exactly (review, L1): `?release=0` / `?release=false` are truthy
	// strings and used to RELEASE the lock. And a release with no token releases
	// NOTHING, so answering `{released: true}` was a lie (L2) — 400 instead.
	if (c.req.query('release') === '1') {
		if (!heldToken)
			return c.json(
				{ error: 'lockToken is required to release the lock.' },
				400,
			);
		await releasePsnLock(db, userId, heldToken);
		return c.json({ released: true }, 200);
	}

	const token = await acquirePsnLock(
		db,
		userId,
		'catalog-refresh',
		cursor ? heldToken : undefined,
	);
	if (!token) return c.json({ error: PSN_BUSY_MESSAGE }, 409);

	const outcome = await runGenreSweep(db, userId, c.env, {
		cursor,
		generation,
		// The fence (review, M2): the TTL can hand this lock to the cron mid-chunk.
		lockToken: token,
	}).catch((error: unknown) => {
		console.error('ps+ genre sweep failed', error);
		return { ok: false as const, reason: 'provider' as const };
	});

	const loopContinues = outcome.ok && outcome.result.nextCursor !== null;
	// A throwing RELEASE must not 500 a chunk whose tags already landed (review,
	// L3) — the same posture as `withPsnLock`'s finally and the backfill's. The
	// TTL clears a lock this leaves behind.
	if (!loopContinues)
		await releasePsnLock(db, userId, token).catch((error: unknown) =>
			console.error('ps+ genre sweep: lock release failed', error),
		);

	if (!outcome.ok) {
		if (outcome.reason === 'no-region')
			return c.json(
				{ error: 'No PSN region is configured — set PSN_REGION.' },
				409,
			);
		if (outcome.reason === 'no-catalog')
			return c.json(
				{ error: 'No PS+ catalog is stored yet — run the PS+ check first.' },
				409,
			);
		if (outcome.reason === 'stale-generation')
			return c.json(
				{
					error:
						'The PS+ catalog was refreshed while this sweep was running — start it again.',
				},
				409,
			);
		return c.json(
			{
				error:
					'Genre sweep failed — PlayStation did not answer as expected. Try again later.',
			},
			502,
		);
	}
	// The token rides back ONLY while the loop continues — the terminating chunk
	// already released it.
	return c.json(
		loopContinues ? { ...outcome.result, lockToken: token } : outcome.result,
		200,
	);
});
