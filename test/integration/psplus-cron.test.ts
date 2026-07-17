import {
	applyD1Migrations,
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	claimRegionLock,
	deleteSetting,
	ensureRegionState,
	getRegionState,
	insertGame,
	listCatalogGenres,
	listCatalogProducts,
	listLibraryForUser,
	recordRegionOutcome,
	releaseRegionLock,
	setSetting,
	upsertCatalogProducts,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { game, user } from '../../src/schema';
import { runScheduledPsPlusCheck, windowOf } from '../../src/services/psplus';
import {
	getPsPlusLeavingState,
	getPsPlusSweepState,
	PSN_REGION_SETTING_KEY,
	setPsPlusLeavingState,
	setPsPlusSweepState,
} from '../../src/services/settings';
import worker from '../../worker/index';
import { catalogPagePayload, productId } from '../fixtures/psn';
import { stubStore } from './psn-stub';
import { appFetch, establishSession, TEST_EMAIL } from './session';

/**
 * Scheduled PS+ Extra refresh (Story 5.2, FR-39/40). Drives the same catalog
 * check the button runs (5.1) from the cron path, with the store call stubbed.
 * Hazards: a failed scheduled run sets `psplus_refresh_failed` and writes no
 * flags; a successful run clears it; the cron reads the SAME stored region as
 * the button (no divergence, AR-23); no user row → a clean no-op.
 */

const db = () => createDb(env.DB);

/**
 * A D1 binding that COUNTS its subrequests (Epic 7 cross-story review, H3). A
 * Worker invocation gets 50, and D1 binding calls count against them just like
 * fetches (AD-15) — so the budget is only guarded if it is measured. One
 * `db.batch()` is ONE call whatever it carries (that is the whole reason the
 * catalog writes batch); a prepared statement counts when it EXECUTES.
 */
function countingDb() {
	const counter = { calls: 0 };
	const runs = new Set(['all', 'run', 'first', 'raw']);
	const wrap = <T extends object>(target: T, executes: Set<string>): T =>
		new Proxy(target, {
			get(obj, prop, receiver) {
				const value = Reflect.get(obj, prop, receiver);
				if (typeof value !== 'function') return value;
				const method = value as (...args: unknown[]) => unknown;
				if (prop === 'prepare' || prop === 'bind') {
					return (...args: unknown[]) =>
						wrap(method.apply(obj, args) as object, runs);
				}
				if (executes.has(String(prop))) {
					return (...args: unknown[]) => {
						counter.calls++;
						return method.apply(obj, args);
					};
				}
				return method.bind(obj);
			},
		});
	const binding = wrap(env.DB, new Set(['batch', 'exec']));
	return {
		db: createDb(binding),
		get calls() {
			return counter.calls;
		},
	};
}

/** Stub the store-catalog call (CAPTURED shape); records the region header. */
const stubCatalog = (names: string[], status = 200) =>
	stubStore(({ offset }) =>
		status !== 200
			? { status, body: '{}' }
			: {
					body: catalogPagePayload(offset === 0 ? names : [], {
						totalCount: names.length,
						offset,
					}),
				},
	);

let userId: string;

async function seedGame(title: string, { owned = false } = {}) {
	const created = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
	});
	await upsertTracking(db(), userId, created.id, { owned });
	return created;
}

/** Pre-seed the region snapshot (Story 8.3): "already a member" is a catalog
 * row now, not a game-column flag. */
async function seedCatalog(names: string[], region = 'it-it') {
	await upsertCatalogProducts(
		db(),
		{ region },
		'gen-old',
		names.map((name) => ({
			productId: productId(name),
			npTitleId: null,
			name,
			titleNormalized: name.toLowerCase(),
			coverUrl: null,
			platforms: ['PS5'],
			storeClassification: null,
			storeUrl: 'https://store.example/x',
		})),
		'2026-07-01',
	);
}

/** Derived membership (Story 8.3) — the cron's region is the env seed. */
const flagOf = async (id: string, region = 'it-it') =>
	(
		await listLibraryForUser(db(), userId, { includeDiscarded: true, region })
	).find((row) => row.id === id)?.psPlusExtra;

/** A minimal ScheduledController for driving worker.scheduled directly. */
const controller = {
	scheduledTime: Date.now(),
	cron: '0 12 22 * *',
	noRetry() {},
};

/** This month's rotation window (`YYYY-MM`) — outcome seeding needs it. */
const WINDOW = new Date().toISOString().slice(0, 7);

/** Park both region sweeps so the rotation hands the slot to the membership pass. */
async function markSweepsDone(region: string) {
	const sweep = await getPsPlusSweepState(db(), region);
	if (sweep) await setPsPlusSweepState(db(), region, { ...sweep, done: true });
	const leaving = await getPsPlusLeavingState(db(), region);
	if (leaving)
		await setPsPlusLeavingState(db(), region, { ...leaving, done: true });
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	// establishSession creates the suite's default user; the cron's region
	// picker walks registered users' psn_region settings (8.4).
	await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, TEST_EMAIL));
	userId = row.id;
	await setSetting(db(), userId, PSN_REGION_SETTING_KEY, 'it-it');
});

afterEach(() => vi.unstubAllGlobals());

describe('scheduled PS+ Extra refresh (Story 5.2)', () => {
	it('runs the check via worker.scheduled and resets a prior failure count on the ledger', async () => {
		const nowIn = await seedGame('Cron Hades');
		// The 5.2 banner died (8.4, AD-31): failures live on the region ledger.
		await recordRegionOutcome(db(), 'it-it', {
			attemptedOn: new Date().toISOString().slice(0, 10),
			succeeded: false,
			window: WINDOW,
		});
		stubCatalog(['Cron Hades', 'Something Else']);

		// The cron wiring lives in the worker export — assert it's actually there
		// (the `?.` below would otherwise vacuously no-op if it went missing).
		expect(worker.scheduled).toBeDefined();
		const ctx = createExecutionContext();
		await worker.scheduled?.(controller, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(await flagOf(nowIn.id)).toBe(true);
		// A successful refresh self-resolves the ledger's failure streak.
		const state = await getRegionState(db(), 'it-it');
		expect(state?.failureCount).toBe(0);
		expect(state?.lastSuccess).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('sends the stored region as the store locale (button/cron parity, AR-23)', async () => {
		await setSetting(db(), userId, PSN_REGION_SETTING_KEY, 'pt-pt');
		const seen = stubCatalog(['Anything']);

		await runScheduledPsPlusCheck(db(), env);

		expect(seen.length).toBeGreaterThan(0);
		expect(seen[0].locale).toBe('pt-pt');
		// The cron persists the SAME snapshot the button does (AD-27, one ingest).
		expect(
			(await listCatalogProducts(db(), { region: 'pt-pt' })).map((r) => r.name),
		).toEqual(['Anything']);
	});

	// Story 7.1, region-homed by 8.4: the cron and the shelf guard fan out to
	// the same store host and write the same region snapshot — one REGION lock.
	// Busy is NOT a failure (a refresh IS running): no outcome is recorded.
	it('SKIPS (without recording a failure) when another op holds the REGION lock', async () => {
		await setSetting(db(), userId, PSN_REGION_SETTING_KEY, 'it-it');
		const seen = stubCatalog(['Anything']);
		// A concurrent refresh (the shelf guard's waitUntil) holds the region lock
		// under its own token — the cron must yield, not steal it.
		const token = `${Date.now() + 60_000}:catalog-refresh:concurrent-guard`;
		await ensureRegionState(db(), 'it-it');
		expect(await claimRegionLock(db(), 'it-it', token, Date.now())).toBe(true);
		const failuresBefore =
			(await getRegionState(db(), 'it-it'))?.failureCount ?? 0;

		try {
			await runScheduledPsPlusCheck(db(), env);
			expect(seen).toHaveLength(0); // the store was never called
			expect((await getRegionState(db(), 'it-it'))?.failureCount).toBe(
				failuresBefore,
			);
		} finally {
			await releaseRegionLock(db(), 'it-it', token);
		}
	});

	/**
	 * THE SWEEP HAS A CALLER (review, M1). Nothing drove the genre sweep: the HTTP
	 * chunk endpoint exists for 7.2's client loop, and with no caller
	 * `ps_plus_catalog_genre` would simply stay EMPTY in production while 7.2
	 * filtered against nothing.
	 *
	 * BUT NOT IN THE SAME INVOCATION AS THE MEMBERSHIP PASS (Epic 7 cross-story
	 * review, H3): the pass alone is ~34 of the 50 subrequests a Worker invocation
	 * gets, so the two together threw "Too many subrequests" mid-sweep — and that
	 * throw skipped the cursor write, so every later cron run re-swept the same
	 * keys and died in the same place, forever. One or the other per run: the
	 * pending sweep first, the membership pass when it is done.
	 */
	it('drives the membership pass and the genre sweep in SEPARATE invocations (never both)', async () => {
		// A fresh region — its region-homed sweep state starts empty (8.4).
		await setSetting(db(), userId, PSN_REGION_SETTING_KEY, 'fr-fr');
		const scope = { region: 'fr-fr' };
		const KEYS = ['ACTION', 'ADVENTURE', 'ARCADE', 'HORROR'];
		const CATALOG: Record<string, string[]> = {
			ACTION: ['Cron Sifu'],
			ADVENTURE: [],
			ARCADE: [],
			HORROR: ['Cron Crow'],
		};
		const stub = () =>
			stubStore(({ offset, genreKey }) => {
				const names = genreKey
					? (CATALOG[genreKey] ?? [])
					: ['Cron Sifu', 'Cron Crow'];
				return {
					body: catalogPagePayload(offset === 0 ? names : [], {
						totalCount: names.length,
						offset,
						genreKeys: KEYS,
					}),
				};
			});

		// Invocation 1: the membership pass ALONE — no sweep rides along.
		stub();
		await runScheduledPsPlusCheck(db(), env);
		expect((await listCatalogProducts(db(), scope)).length).toBe(2);
		expect(await listCatalogGenres(db(), scope)).toEqual([]);

		// Invocation 2: the pending sweep OWNS the run and walks its chunk.
		stub();
		await runScheduledPsPlusCheck(db(), env);
		expect(
			(await listCatalogGenres(db(), scope)).map((row) => row.genreKey).sort(),
		).toEqual(['ACTION', 'HORROR']);
		expect((await getPsPlusSweepState(db(), 'fr-fr'))?.done).toBe(true);

		// Invocation 3: the sweep is done, so the membership pass runs again.
		const seen = stub();
		await runScheduledPsPlusCheck(db(), env);
		expect(seen.some((call) => call.genreKey === null)).toBe(true);
		await setSetting(db(), userId, PSN_REGION_SETTING_KEY, 'it-it');
	});

	/**
	 * THE BUDGET IS OBSERVABLE (Epic 7 cross-story review, H3). The suite drove 2
	 * products and 4 keys and was structurally blind to the ceiling it was meant to
	 * guard: a Worker invocation gets 50 subrequests and D1 BINDING CALLS COUNT
	 * (AD-15). This counts both — every D1 call the invocation makes plus every
	 * store fetch — against a REALISTIC catalog (490 products, one 240-product
	 * genre key, whose tag write alone is 5 batched D1 calls).
	 */
	it('one CRON invocation stays inside the 50-subrequest budget (490 products, a large genre key)', async () => {
		await setSetting(db(), userId, PSN_REGION_SETTING_KEY, 'de-de');
		const scope = { region: 'de-de' };
		const ALL = Array.from({ length: 490 }, (_, i) => `Budget Game ${i}`);
		// A product carries several genres, so the keys are big and they overlap —
		// ACTION alone is ~240 in the real de-de catalog. Each of these costs its own
		// paged walk AND its own batched tag write (ceil((1 + n) / 50) D1 calls).
		const BY_KEY: Record<string, string[]> = {
			ACTION: ALL.slice(0, 240),
			ADVENTURE: ALL.slice(100, 300),
			ARCADE: ALL.slice(0, 120),
			HORROR: ALL.slice(300, 390),
			PUZZLE: ALL.slice(400, 450),
		};
		const KEYS = Object.keys(BY_KEY);
		const stub = () =>
			stubStore(({ offset, genreKey }) => {
				const names = genreKey ? (BY_KEY[genreKey] ?? []) : ALL;
				return {
					body: catalogPagePayload(names.slice(offset, offset + 100), {
						totalCount: names.length,
						offset,
						genreKeys: KEYS,
					}),
				};
			});

		// Invocation 1 — the membership pass: 5 catalog pages + 10 upsert batches + …
		const pass = countingDb();
		const passFetches = stub();
		await runScheduledPsPlusCheck(pass.db, env);
		expect(pass.calls + passFetches.length).toBeLessThan(50);
		expect((await listCatalogProducts(db(), scope)).length).toBe(490);

		// Invocation 2 — the genre sweep chunk: the 240-product key's tag write is 5
		// D1 batches on its own, and it is 1 of CHUNK_SIZE keys in this run.
		const sweep = countingDb();
		const sweepFetches = stub();
		await runScheduledPsPlusCheck(sweep.db, env);
		expect(sweep.calls + sweepFetches.length).toBeLessThan(50);
		// …and it is not vacuously cheap: the chunk's four keys actually landed.
		expect((await listCatalogGenres(db(), scope)).length).toBe(
			240 + 200 + 120 + 90,
		);

		await setSetting(db(), userId, PSN_REGION_SETTING_KEY, 'it-it');
	}, 30_000);

	it('records the failure on the region ledger and writes no membership facts when the catalog fetch fails', async () => {
		await setSetting(db(), userId, PSN_REGION_SETTING_KEY, 'it-it');
		const flagged = await seedGame('Cron Celeste');
		await seedCatalog(['Cron Celeste']); // already a member (region snapshot)
		// Earlier tests left it-it's sweeps pending — park them, or the rotation
		// spends this slot on a sweep chunk instead of the membership pass.
		await markSweepsDone('it-it');
		const before = await getRegionState(db(), 'it-it');
		stubCatalog([], 500);

		await runScheduledPsPlusCheck(db(), env);

		// The failure lands on the LEDGER (banner died, AD-31): count up,
		// last_success untouched.
		const after = await getRegionState(db(), 'it-it');
		expect(after?.failureCount).toBe((before?.failureCount ?? 0) + 1);
		expect(after?.lastSuccess ?? null).toBe(before?.lastSuccess ?? null);
		// The snapshot stands (no prune, no departure stamp) — membership still
		// derives true after a failed refresh.
		expect(await flagOf(flagged.id)).toBe(true);
	});

	it('no-ops when region is unconfigured (config gap: the picker never picks, nothing fetched)', async () => {
		// Force no-region: clear the persisted setting — the picker walks user
		// settings only (env seeding belongs to the request path, not the cron).
		await deleteSetting(db(), userId, PSN_REGION_SETTING_KEY);
		const seen = stubCatalog(['x']);

		await runScheduledPsPlusCheck(db(), {});

		expect(seen.length).toBe(0); // no region → never fetched
		// (The old "must not light a banner" half is structurally gone — there is
		// no banner to light, AD-31.)
	});

	it('no-ops (no throw, no writes) when NO user is registered (Story 8.2: fresh deploy)', async () => {
		// Last test in the file on purpose: registration is open (AD-29) and the
		// cron resolves the OLDEST user — zero users = clean no-op. The cascade
		// takes sessions/settings/tracking with it.
		await db().delete(user);
		const before = (await db().select({ id: game.id }).from(game)).length;
		const seen = stubCatalog(['Whatever']);

		await runScheduledPsPlusCheck(db(), {
			...env,
		});

		expect(seen.length).toBe(0); // never fetched — no user to check
		expect((await db().select({ id: game.id }).from(game)).length).toBe(before);
		// Re-seed so a test appended after this one doesn't inherit an empty
		// user table (review: order landmine).
		await establishSession();
	});
});

describe('8.4 follow-up review hazards — window arithmetic and the guard day gate', () => {
	it('windowOf maps days 1-14 to the PREVIOUS month (the cron window is [15th, next 15th))', () => {
		expect(windowOf('2026-07-14')).toBe('2026-06');
		expect(windowOf('2026-07-15')).toBe('2026-07');
		expect(windowOf('2026-07-28')).toBe('2026-07');
		expect(windowOf('2026-01-05')).toBe('2025-12'); // year boundary
	});

	it('an uncounted outcome stamps the attempt WITHOUT feeding the quarantine counter', async () => {
		const today = new Date().toISOString().slice(0, 10);
		await recordRegionOutcome(db(), 'zz-zz', {
			attemptedOn: today,
			succeeded: false,
			window: WINDOW,
		});
		await recordRegionOutcome(db(), 'zz-zz', {
			attemptedOn: today,
			succeeded: false,
			counted: false,
			window: WINDOW,
		});
		const state = await getRegionState(db(), 'zz-zz');
		expect(state?.lastAttempt).toBe(today);
		expect(state?.failureCount).toBe(1); // the counted one, not two
	});

	it('a store-refused locale costs ONE guard fetch per day, not one per shelf GET (H1)', async () => {
		const cookie = await establishSession();
		const [row] = await db()
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, TEST_EMAIL));
		// Shape-valid locale the store refuses; no ledger row → stale → guard fires.
		await setSetting(db(), row.id, PSN_REGION_SETTING_KEY, 'uk-uk');
		const seen = stubStore(() => ({
			body: { data: null, errors: [{ message: 'refused' }] },
		}));

		const first = await appFetch('/api/shelf', { headers: { cookie } });
		expect(first.status).toBe(200);
		const fired = seen.length;
		expect(fired).toBeGreaterThan(0); // the guard DID try once

		const second = await appFetch('/api/shelf', { headers: { cookie } });
		expect(second.status).toBe(200);
		expect(seen.length).toBe(fired); // day gate: no second store fetch

		const state = await getRegionState(db(), 'uk-uk');
		expect(state?.lastAttempt).toBe(new Date().toISOString().slice(0, 10));
		expect(state?.failureCount).toBe(0); // a typo never quarantines
	});
});
