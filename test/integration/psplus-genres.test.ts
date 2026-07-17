import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	claimRegionLock,
	ensureRegionState,
	listCatalogGenres,
	listCatalogProducts,
	setRegionSweepState,
	setSetting,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { psPlusCatalog, psPlusRegionState, user } from '../../src/schema';
import { runPsPlusCheck } from '../../src/services/psplus';
import {
	type GenreSweepResult,
	runGenreSweep,
} from '../../src/services/psplus-genres';
import {
	getPsPlusSweepState,
	PSN_REGION_SETTING_KEY,
	setPsPlusSweepState,
} from '../../src/services/settings';
import {
	catalogPagePayload,
	DE_DE_GENRE_KEYS,
	productId,
} from '../fixtures/psn';
import { stubStore } from './psn-stub';
import { establishSession, TEST_EMAIL } from './session';

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

let userId: string;

// Story 8.4: the client-driven HTTP sweep loop died with the manual button —
// the sweep is the per-region SERVICE now, driven by the cron rotation.
const sweep = (
	opts: { cursor?: string; generation?: string; lockToken?: string } = {},
) => runGenreSweep(db(), REGION, opts);

/** One chunk, asserted ok — the service-level stand-in for the old POST. */
async function sweepChunk(
	opts: { cursor?: string; generation?: string } = {},
): Promise<GenreSweepResult> {
	const outcome = await sweep(opts);
	expect(outcome.ok).toBe(true);
	if (!outcome.ok) throw new Error(`sweep refused: ${outcome.reason}`);
	return outcome.result;
}

/** Run the membership pass first — the sweep tags what IT stored. */
async function refresh() {
	stubCatalogStore();
	const outcome = await runPsPlusCheck(db(), REGION);
	expect(outcome.ok).toBe(true);
	if (!outcome.ok) throw new Error(`refresh refused: ${outcome.reason}`);
	return outcome.result;
}

/** Loop the sweep on its cursor, exactly as the cron rotation would. */
async function sweepToCompletion() {
	const chunks: GenreSweepResult[] = [];
	let opts: { cursor?: string; generation?: string } = {};
	for (let i = 0; i < 20; i++) {
		const body = await sweepChunk(opts);
		chunks.push(body);
		if (!body.nextCursor) break;
		opts = { cursor: body.nextCursor, generation: body.generation };
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
	await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, TEST_EMAIL));
	userId = row.id;
	await setSetting(db(), userId, PSN_REGION_SETTING_KEY, REGION);
});

afterEach(async () => {
	vi.unstubAllGlobals();
	// Region-homed state (8.4): clear the sweep state and any held region lock.
	await setRegionSweepState(db(), REGION, null);
	await db()
		.update(psPlusRegionState)
		.set({ lock: null })
		.where(eq(psPlusRegionState.region, REGION));
	// The snapshot is shared state across these tests — wipe it (the genre rows
	// cascade) so each test starts from a bare region.
	await db().delete(psPlusCatalog);
});

describe('runGenreSweep — per-region genre sweep (integration, real workerd + local D1)', () => {
	// "requires auth" died with the HTTP endpoint (8.4): the sweep is
	// cron-driven, there is no client surface left to authenticate.

	it('refuses the sweep before any catalog is stored (nothing to tag)', async () => {
		stubCatalogStore();
		expect(await sweep()).toEqual({ ok: false, reason: 'no-catalog' });
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

		const chunk = await sweepChunk();

		const expected = [...DE_DE_GENRE_KEYS].sort();
		expect(expected).toHaveLength(19);
		// en-us names MUSIC/RHYTHM; de-de does not — the whole point of discovering.
		expect(expected).not.toContain('MUSIC/RHYTHM');
		expect(chunk.keys).toEqual(expected.slice(0, 4)); // CHUNK_SIZE
		const state = await getPsPlusSweepState(db(), REGION);
		expect(state?.keys).toEqual(expected);
	});

	// M3: a 200 whose productGenres facet is missing or empty is a TOTAL failure,
	// not a completed sweep of zero keys.
	it('an EMPTY facet list is a provider failure, not a finished sweep', async () => {
		await refresh();
		stubCatalogStore({ keys: [] });

		expect(await sweep()).toEqual({ ok: false, reason: 'provider' });
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

		const chunk = await sweepChunk();
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
		const first = await sweepChunk();
		expect(first.keys).toEqual(['ACTION', 'ADVENTURE', 'ARCADE', 'HORROR']);

		// The store starts naming AAA — which sorts BEFORE the cursor. The
		// continuation must walk the list it FROZE, not this new one.
		const seen = stubCatalogStore({
			catalog: { ...CATALOG, AAA: ['Sifu'] },
			keys: ['AAA', ...KEYS],
			all: ALL_NAMES,
		});
		const second = await sweepChunk({
			cursor: first.nextCursor ?? '',
			generation: first.generation,
		});

		expect(second.keys).toEqual(['MUSIC/RHYTHM', 'SPORTS']);
		expect(second.nextCursor).toBeNull();
		expect(seen.some((call) => call.genreKey === 'AAA')).toBe(false);
		const state = await getPsPlusSweepState(db(), REGION);
		expect(state?.keys).not.toContain('AAA');
	});

	// The L1/L2 release-brake test died with the HTTP endpoint (8.4): there is
	// no `?release=` surface (or client-held lock) left to brake.

	it('CHUNKS on a cursor and resumes after a mid-key failure — the membership snapshot stays intact', async () => {
		await refresh();
		const before = (await listCatalogProducts(db(), scope)).map((r) => r.name);

		// ADVENTURE dies mid-chunk: a SKIP, never an abort — the cursor still moves.
		stubCatalogStore({ fail: 'ADVENTURE' });
		const chunk = await sweepChunk();
		expect(chunk.skipped.map((s) => s.key)).toEqual(['ADVENTURE']);
		// Its siblings in the same chunk still landed.
		expect(await tagsFor('Sifu')).toEqual(['ACTION']);
		expect(await tagsFor('Crow Country')).toEqual(['ACTION', 'HORROR']);

		// Resume from the cursor: the completed keys are NOT re-walked.
		const seen = stubCatalogStore();
		const second = await sweepChunk({
			cursor: chunk.nextCursor ?? '',
			generation: chunk.generation,
		});
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
		const before = await getPsPlusSweepState(db(), REGION);
		const stalled = `${Date.now() + 60_000}:catalog-refresh:stalled-chunk`;
		await ensureRegionState(db(), REGION);
		expect(await claimRegionLock(db(), REGION, stalled, Date.now())).toBe(true);
		// The TTL fires: the cron takes the REGION lock over mid-flight (8.4).
		await db()
			.update(psPlusRegionState)
			.set({ lock: `${Date.now() + 60_000}:catalog-refresh:the-cron` })
			.where(eq(psPlusRegionState.region, REGION));

		stubCatalogStore();
		const outcome = await sweep({ lockToken: stalled });

		expect(outcome).toEqual({ ok: false, reason: 'stale-generation' });
		expect(await listCatalogGenres(db(), scope)).toEqual([]);
		expect(await getPsPlusSweepState(db(), REGION)).toEqual(before);
	});

	// …and the same hazard from the other side: the state is re-read IMMEDIATELY
	// before the write, so a refresh that lands MID-CHUNK cannot have the chunk's
	// stale generation + cursor spread back over it.
	it('a refresh landing MID-CHUNK cannot be overwritten by the chunk it preempted', async () => {
		await refresh();
		const before = await getPsPlusSweepState(db(), REGION);
		expect(before).toBeTruthy();

		// The store call is where a chunk spends its time — the cron lands right here.
		let landed = false;
		stubStore(async ({ offset, genreKey }) => {
			if (genreKey && !landed) {
				landed = true;
				await setPsPlusSweepState(db(), REGION, {
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

		expect((await sweep()).ok).toBe(true);

		// The cron's state stands: no dead generation, no cursor from a snapshot that
		// no longer exists, no key list frozen off a discarded one.
		const state = await getPsPlusSweepState(db(), REGION);
		expect(state?.generation).toBe('gen-from-the-cron');
		expect(state?.cursor).toBeNull();
		expect(state?.keys).toEqual([]);
	});

	// M2: the generation was only checked when a CURSOR rode along, so the FIRST
	// chunk of a restarted sweep never checked it at all.
	it('refuses a FIRST chunk (no cursor) whose generation is already stale', async () => {
		await refresh();
		stubCatalogStore();
		expect(await sweep({ generation: 'gen-that-is-long-gone' })).toEqual({
			ok: false,
			reason: 'stale-generation',
		});
		expect(await listCatalogGenres(db(), scope)).toEqual([]);
	});

	// AD-28: a refresh landing mid-sweep mints a new generation and prunes, so the
	// cursor is meaningless — resuming would leave the new products untagged.
	it('refuses a continuation whose GENERATION has moved on (a refresh landed mid-sweep)', async () => {
		await refresh();
		stubCatalogStore();
		const first = await sweepChunk();

		// A second refresh re-stamps every row under a new generation.
		const { generation } = await refresh();
		expect(generation).not.toBe(first.generation);

		stubCatalogStore();
		expect(
			await sweep({
				cursor: first.nextCursor ?? '',
				generation: first.generation,
			}),
		).toEqual({ ok: false, reason: 'stale-generation' });
	});
});
