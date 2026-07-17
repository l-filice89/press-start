import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	deleteSetting,
	getSetting,
	listCatalogGenres,
	listCatalogProducts,
	setSetting,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { psPlusCatalog, user } from '../../src/schema';
import {
	acquirePsnLock,
	PSN_LOCK_SETTING_KEY,
} from '../../src/services/psn-lock';
import { runGenreSweep } from '../../src/services/psplus-genres';
import {
	getPsPlusSweepState,
	PSN_REGION_SETTING_KEY,
	PSPLUS_SWEEP_STATE_SETTING_KEY,
	setPsPlusSweepState,
} from '../../src/services/settings';
import {
	catalogPagePayload,
	DE_DE_GENRE_KEYS,
	productId,
} from '../fixtures/psn';
import { stubStore } from './psn-stub';
import { appFetch, establishSession, TEST_EMAIL } from './session';

/**
 * The PS+ genre sweep (Story 7.1, AD-26/28) — chunked, resumable, additive.
 *
 * The hazards, each from the CAPTURED facet response: the key list is
 * DISCOVERED per region (de-de 19, en-us 20 — it adds `MUSIC/RHYTHM`), never
 * hardcoded; a key with a SLASH round-trips through the URL-encoded `filterBy`;
 * a key the store will not answer for is SKIPPED, not an abort, and the
 * membership snapshot stays valid; a refresh landing mid-sweep INVALIDATES the
 * cursor instead of letting it resume into a re-ordered catalog.
 */

const db = () => createDb(env.DB);
const REGION = 'it-it';
const scope = { region: REGION };

/** Which products each genre key answers with — the sweep's whole world. */
// Six keys against a CHUNK_SIZE of four: the sweep must take two chunks, which
// is what makes the cursor (and its resumption) observable at all.
const CATALOG: Record<string, string[]> = {
	ACTION: ['Crow Country', 'Sifu'],
	ADVENTURE: ['Crow Country'],
	ARCADE: [],
	HORROR: ['Crow Country'],
	'MUSIC/RHYTHM': ['Entwined'],
	SPORTS: [],
};
const ALL_NAMES = [...new Set(Object.values(CATALOG).flat())];
/** The facet keys the STUBBED region names — deliberately including the slash one. */
const KEYS = Object.keys(CATALOG);

/**
 * The store: the unfiltered page carries the whole catalog + the facet list; a
 * filtered page carries that key's products. `fail` makes ONE key blow up.
 */
function stubCatalogStore({
	fail,
	catalog = CATALOG,
	keys = KEYS,
	all,
}: {
	fail?: string;
	catalog?: Record<string, string[]>;
	keys?: string[];
	all?: string[];
} = {}) {
	return stubStore(({ offset, genreKey }) => {
		if (genreKey === fail) return { status: 500, body: '{}' };
		const names = genreKey
			? (catalog[genreKey] ?? [])
			: (all ?? [...new Set(Object.values(catalog).flat())]);
		return {
			body: catalogPagePayload(offset === 0 ? names : [], {
				totalCount: names.length,
				offset,
				genreKeys: keys,
			}),
		};
	});
}

let cookie: string;
let userId: string;

const post = (query = '') =>
	appFetch(`/api/ps-plus-catalog/genres${query}`, {
		method: 'POST',
		headers: { cookie },
	});

interface SweepBody {
	generation: string;
	keys: string[];
	tagged: number;
	skipped: { key: string; reason: string }[];
	notInSnapshot: number;
	nextCursor: string | null;
	lockToken?: string;
}

/** Run the membership pass first — the sweep tags what IT stored. */
async function refresh() {
	stubCatalogStore();
	const res = await appFetch('/api/ps-plus-check', {
		method: 'POST',
		headers: { cookie },
	});
	expect(res.status).toBe(200);
	return (await res.json()) as { generation: string };
}

/** Loop the sweep on its cursor + token, exactly as a client would. */
async function sweepToCompletion() {
	const chunks: SweepBody[] = [];
	let query = '';
	for (let i = 0; i < 20; i++) {
		const res = await post(query);
		expect(res.status).toBe(200);
		const body = (await res.json()) as SweepBody;
		chunks.push(body);
		if (!body.nextCursor) break;
		query = `?cursor=${encodeURIComponent(body.nextCursor)}&generation=${encodeURIComponent(body.generation)}&lockToken=${encodeURIComponent(body.lockToken ?? '')}`;
	}
	return chunks;
}

const tagsFor = async (name: string) =>
	(await listCatalogGenres(db(), scope))
		.filter((row) => row.productId === productId(name))
		.map((row) => row.genreKey)
		.sort();

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	cookie = await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, TEST_EMAIL));
	userId = row.id;
	await setSetting(db(), userId, PSN_REGION_SETTING_KEY, REGION);
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await deleteSetting(db(), userId, PSN_LOCK_SETTING_KEY);
	await deleteSetting(db(), userId, PSPLUS_SWEEP_STATE_SETTING_KEY);
	// The snapshot is shared state across these tests — wipe it (the genre rows
	// cascade) so each test starts from a bare region.
	await db().delete(psPlusCatalog);
});

describe('POST /api/ps-plus-catalog/genres (integration, real workerd + local D1)', () => {
	it('requires auth', async () => {
		expect(
			(await appFetch('/api/ps-plus-catalog/genres', { method: 'POST' }))
				.status,
		).toBe(401);
	});

	it('refuses the sweep before any catalog is stored (nothing to tag)', async () => {
		stubCatalogStore();
		const res = await post();
		expect(res.status).toBe(409);
		expect(((await res.json()) as { error: string }).error).toMatch(
			/PS\+ check first/i,
		);
	});

	// AD-26: the key list is whatever the RESPONSE named. A hardcoded 19-key enum
	// would silently drop a whole genre for a region carrying one we never saw.
	it('sweeps the keys the RESPONSE named — and a key with a SLASH round-trips (MUSIC/RHYTHM)', async () => {
		await refresh();
		stubCatalogStore();
		const chunks = await sweepToCompletion();

		const swept = chunks.flatMap((chunk) => chunk.keys).sort();
		expect(swept).toEqual([...KEYS].sort());
		// The slash key filtered correctly and its tag is stored VERBATIM.
		expect(await tagsFor('Entwined')).toEqual(['MUSIC/RHYTHM']);
		expect(await tagsFor('Crow Country')).toEqual([
			'ACTION',
			'ADVENTURE',
			'HORROR',
		]);
		expect(await tagsFor('Sifu')).toEqual(['ACTION']);
		// Additive: a second sweep re-tags nothing and duplicates nothing.
		stubCatalogStore();
		await sweepToCompletion();
		expect(await tagsFor('Crow Country')).toEqual([
			'ACTION',
			'ADVENTURE',
			'HORROR',
		]);
	});

	// The CAPTURED regional facet list, driven through the SWEEP (review, L6): a
	// test that reads a fixture back and asserts it contains what its author typed
	// proves nothing. This one asserts what the CODE did with the payload — it
	// discovered all 19 de-de keys, froze them into the sweep state, and started
	// walking them in order.
	it('sweeps the CAPTURED de-de facet list (19 keys) — discovered from the payload, frozen into the state', async () => {
		await refresh();
		stubCatalogStore({ catalog: {}, keys: DE_DE_GENRE_KEYS, all: ALL_NAMES });

		const chunk = (await (await post()).json()) as SweepBody;

		const expected = [...DE_DE_GENRE_KEYS].sort();
		expect(expected).toHaveLength(19);
		// en-us names MUSIC/RHYTHM; de-de does not — the whole point of discovering.
		expect(expected).not.toContain('MUSIC/RHYTHM');
		expect(chunk.keys).toEqual(expected.slice(0, 4)); // CHUNK_SIZE
		const state = await getPsPlusSweepState(db(), userId);
		expect(state?.keys).toEqual(expected);
	});

	// M3: a 200 whose productGenres facet is missing or empty is a TOTAL failure,
	// not a completed sweep of zero keys.
	it('an EMPTY facet list is a provider failure, not a finished sweep', async () => {
		await refresh();
		stubCatalogStore({ keys: [] });

		const res = await post();
		expect(res.status).toBe(502);
		expect(await listCatalogGenres(db(), scope)).toEqual([]);
	});

	// M4: a genre query can name a product that entered the store AFTER the last
	// membership pass. Its tag would violate the composite FK and kill the WHOLE
	// key — so it is filtered out and counted, and it lands after the next pass.
	it('skips a genre hit that is not in the snapshot yet — the rest of the key still lands', async () => {
		await refresh();
		stubCatalogStore({
			catalog: { ...CATALOG, ACTION: ['Sifu', 'Brand New Arrival'] },
			all: ALL_NAMES,
		});

		const chunk = (await (await post()).json()) as SweepBody;
		expect(chunk.skipped).toEqual([]);
		expect(chunk.notInSnapshot).toBe(1);
		expect(await tagsFor('Sifu')).toEqual(['ACTION']);
		expect(await tagsFor('Brand New Arrival')).toEqual([]);
	});

	// H4: a product the store RE-CLASSIFIES kept its old tag forever (tag rows were
	// insert-if-absent and nothing ever pruned them), so 7.2's genre filter would
	// keep returning it under a genre it left.
	it('a product that CHANGES genre between sweeps ends up with ONLY the new genre', async () => {
		await refresh();
		stubCatalogStore();
		await sweepToCompletion();
		expect(await tagsFor('Sifu')).toEqual(['ACTION']);

		// The store re-classifies Sifu: out of ACTION, into ADVENTURE.
		const reclassified = {
			...CATALOG,
			ACTION: ['Crow Country'],
			ADVENTURE: ['Crow Country', 'Sifu'],
		};
		stubCatalogStore({ catalog: reclassified, all: ALL_NAMES });
		await sweepToCompletion();

		expect(await tagsFor('Sifu')).toEqual(['ADVENTURE']);
	});

	// M2: re-discovering the key list every chunk walks a SHIFTING list under a
	// keyset cursor — a key that appears mid-sweep and sorts BEFORE the cursor is
	// silently never swept at all. The list is discovered ONCE and frozen.
	it('sweeps the FROZEN key list: a key the store adds mid-sweep is not walked into oblivion', async () => {
		await refresh();
		stubCatalogStore();
		const first = (await (await post()).json()) as SweepBody;
		expect(first.keys).toEqual(['ACTION', 'ADVENTURE', 'ARCADE', 'HORROR']);

		// The store starts naming AAA — which sorts BEFORE the cursor. The
		// continuation must walk the list it FROZE, not this new one.
		const seen = stubCatalogStore({
			catalog: { ...CATALOG, AAA: ['Sifu'] },
			keys: ['AAA', ...KEYS],
			all: ALL_NAMES,
		});
		const res = await post(
			`?cursor=${encodeURIComponent(first.nextCursor ?? '')}&generation=${first.generation}&lockToken=${encodeURIComponent(first.lockToken ?? '')}`,
		);
		const second = (await res.json()) as SweepBody;

		expect(second.keys).toEqual(['MUSIC/RHYTHM', 'SPORTS']);
		expect(second.nextCursor).toBeNull();
		expect(seen.some((call) => call.genreKey === 'AAA')).toBe(false);
		const state = await getPsPlusSweepState(db(), userId);
		expect(state?.keys).not.toContain('AAA');
	});

	// L1/L2: the release brake. `?release=0` is a truthy STRING — it used to
	// RELEASE the lock. And a release with no token released nothing while
	// answering `{released: true}`.
	it('the release brake needs release=1 AND a token — and it never lies about it', async () => {
		const token = await acquirePsnLock(db(), userId, 'catalog-refresh');
		stubCatalogStore();
		expect((await post('?release=0')).status).not.toBe(200);
		expect(await getSetting(db(), userId, PSN_LOCK_SETTING_KEY)).toBe(token);

		const noToken = await post('?release=1');
		expect(noToken.status).toBe(400);
		expect(await getSetting(db(), userId, PSN_LOCK_SETTING_KEY)).toBe(token);

		const released = await post(
			`?release=1&lockToken=${encodeURIComponent(token as string)}`,
		);
		expect(released.status).toBe(200);
		expect(
			await getSetting(db(), userId, PSN_LOCK_SETTING_KEY),
		).toBeUndefined();
	});

	it('CHUNKS on a cursor and resumes after a mid-key failure — the membership snapshot stays intact', async () => {
		await refresh();
		const before = (await listCatalogProducts(db(), scope)).map((r) => r.name);

		// ADVENTURE dies mid-chunk: a SKIP, never an abort — the cursor still moves.
		stubCatalogStore({ fail: 'ADVENTURE' });
		const first = await post();
		expect(first.status).toBe(200);
		const chunk = (await first.json()) as SweepBody;
		expect(chunk.skipped.map((s) => s.key)).toEqual(['ADVENTURE']);
		// Its siblings in the same chunk still landed.
		expect(await tagsFor('Sifu')).toEqual(['ACTION']);
		expect(await tagsFor('Crow Country')).toEqual(['ACTION', 'HORROR']);

		// Resume from the cursor: the completed keys are NOT re-walked.
		const seen = stubCatalogStore();
		const res = await post(
			`?cursor=${encodeURIComponent(chunk.nextCursor ?? '')}&generation=${chunk.generation}&lockToken=${encodeURIComponent(chunk.lockToken ?? '')}`,
		);
		expect(res.status).toBe(200);
		const second = (await res.json()) as SweepBody;
		expect(second.keys).not.toContain('ACTION');
		expect(seen.some((call) => call.genreKey === 'ACTION')).toBe(false);
		expect(await tagsFor('Entwined')).toEqual(['MUSIC/RHYTHM']);

		// The snapshot was never touched by any of it (AD-28).
		expect((await listCatalogProducts(db(), scope)).map((r) => r.name)).toEqual(
			before,
		);
	});

	/**
	 * PREEMPTION (Epic 7 cross-story review, M2). The lock TTL hands a stalled
	 * chunk's lock to the cron, which prunes and mints a new generation. The chunk,
	 * waking up, used to tag against a snapshot that is gone and stamp the state
	 * with its DEAD generation + cursor — after which every continuation is refused
	 * against a generation that is itself stale, and the facet list freezes on a
	 * discarded snapshot. `runPsPlusCheck` was given exactly this fence; the sweep
	 * never had one.
	 */
	it('a chunk that LOST the lock writes nothing — no tags, no state', async () => {
		await refresh();
		const before = await getPsPlusSweepState(db(), userId);
		const stalled = await acquirePsnLock(db(), userId, 'catalog-refresh');
		// The TTL fires: the cron takes the lock over while the chunk is in flight.
		await deleteSetting(db(), userId, PSN_LOCK_SETTING_KEY);
		expect(await acquirePsnLock(db(), userId, 'catalog-refresh')).toBeTruthy();

		stubCatalogStore();
		const outcome = await runGenreSweep(db(), userId, env, {
			lockToken: stalled as string,
		});

		expect(outcome).toEqual({ ok: false, reason: 'stale-generation' });
		expect(await listCatalogGenres(db(), scope)).toEqual([]);
		expect(await getPsPlusSweepState(db(), userId)).toEqual(before);
	});

	// …and the same hazard from the other side: the state is re-read IMMEDIATELY
	// before the write, so a refresh that lands MID-CHUNK cannot have the chunk's
	// stale generation + cursor spread back over it.
	it('a refresh landing MID-CHUNK cannot be overwritten by the chunk it preempted', async () => {
		await refresh();
		const before = await getPsPlusSweepState(db(), userId);
		expect(before).toBeTruthy();

		// The store call is where a chunk spends its time — the cron lands right here.
		let landed = false;
		stubStore(async ({ offset, genreKey }) => {
			if (genreKey && !landed) {
				landed = true;
				await setPsPlusSweepState(db(), userId, {
					...(before as NonNullable<typeof before>),
					generation: 'gen-from-the-cron',
					keys: [],
					cursor: null,
					done: false,
				});
			}
			const names = genreKey ? (CATALOG[genreKey] ?? []) : ALL_NAMES;
			return {
				body: catalogPagePayload(offset === 0 ? names : [], {
					totalCount: names.length,
					offset,
					genreKeys: KEYS,
				}),
			};
		});

		expect((await runGenreSweep(db(), userId, env)).ok).toBe(true);

		// The cron's state stands: no dead generation, no cursor from a snapshot that
		// no longer exists, no key list frozen off a discarded one.
		const state = await getPsPlusSweepState(db(), userId);
		expect(state?.generation).toBe('gen-from-the-cron');
		expect(state?.cursor).toBeNull();
		expect(state?.keys).toEqual([]);
	});

	// M2: the generation was only checked when a CURSOR rode along, so the FIRST
	// chunk of a restarted sweep never checked it at all.
	it('refuses a FIRST chunk (no cursor) whose generation is already stale', async () => {
		await refresh();
		stubCatalogStore();
		const res = await post('?generation=gen-that-is-long-gone');
		expect(res.status).toBe(409);
		expect(await listCatalogGenres(db(), scope)).toEqual([]);
	});

	// AD-28: a refresh landing mid-sweep mints a new generation and prunes, so the
	// cursor is meaningless — resuming would leave the new products untagged.
	it('refuses a continuation whose GENERATION has moved on (a refresh landed mid-sweep)', async () => {
		await refresh();
		stubCatalogStore();
		const first = (await (await post()).json()) as SweepBody;
		await deleteSetting(db(), userId, PSN_LOCK_SETTING_KEY);

		// A second refresh re-stamps every row under a new generation.
		const { generation } = await refresh();
		expect(generation).not.toBe(first.generation);
		await deleteSetting(db(), userId, PSN_LOCK_SETTING_KEY);

		stubCatalogStore();
		const stale = await post(
			`?cursor=${encodeURIComponent(first.nextCursor ?? '')}&generation=${first.generation}&lockToken=${encodeURIComponent(first.lockToken ?? '')}`,
		);
		expect(stale.status).toBe(409);
		expect(((await stale.json()) as { error: string }).error).toMatch(
			/refreshed/i,
		);
	});
});
