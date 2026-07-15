import {
	applyD1Migrations,
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	deleteSetting,
	insertGame,
	listCatalogGenres,
	listCatalogProducts,
	setSetting,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { game, user } from '../../src/schema';
import {
	acquirePsnLock,
	PSN_LOCK_SETTING_KEY,
} from '../../src/services/psn-lock';
import { runScheduledPsPlusCheck } from '../../src/services/psplus';
import {
	getPsPlusSweepState,
	isPsPlusRefreshFailed,
	markPsPlusRefreshFailed,
	PSN_REGION_SETTING_KEY,
	PSPLUS_SWEEP_STATE_SETTING_KEY,
} from '../../src/services/settings';
import worker from '../../worker/index';
import { catalogPagePayload } from '../fixtures/psn';
import { stubStore } from './psn-stub';
import { ALLOWED_EMAIL, establishSession } from './session';

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

async function seedGame(
	title: string,
	{ owned = false, psPlusExtra = false } = {},
) {
	const created = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
		psPlusExtra,
	});
	await upsertTracking(db(), userId, created.id, { owned });
	return created;
}

const flagOf = async (id: string) => {
	const [row] = await db().select().from(game).where(eq(game.id, id));
	return row.psPlusExtra;
};

/** A minimal ScheduledController for driving worker.scheduled directly. */
const controller = {
	scheduledTime: Date.now(),
	cron: '0 12 22 * *',
	noRetry() {},
};

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	// establishSession creates the AUTH_ALLOWED_EMAIL user the cron resolves.
	await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, ALLOWED_EMAIL));
	userId = row.id;
});

afterEach(() => vi.unstubAllGlobals());

describe('scheduled PS+ Extra refresh (Story 5.2)', () => {
	it('runs the check via worker.scheduled and clears a prior failed flag', async () => {
		const nowIn = await seedGame('Cron Hades');
		await markPsPlusRefreshFailed(db(), userId);
		stubCatalog(['Cron Hades', 'Something Else']);

		// The cron wiring lives in the worker export — assert it's actually there
		// (the `?.` below would otherwise vacuously no-op if it went missing).
		expect(worker.scheduled).toBeDefined();
		const ctx = createExecutionContext();
		await worker.scheduled?.(controller, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(await flagOf(nowIn.id)).toBe(true);
		// A successful refresh self-resolves the banner flag.
		expect(await isPsPlusRefreshFailed(db(), userId)).toBe(false);
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

	// Story 7.1: the cron and the button fan out to the same store host for the
	// same account and write the same snapshot — so the cron takes the lock too.
	// Busy is NOT a failure (a refresh IS running): it must not light the banner.
	it('SKIPS (without lighting the banner) when another PSN op holds the lock', async () => {
		await setSetting(db(), userId, PSN_REGION_SETTING_KEY, 'it-it');
		const seen = stubCatalog(['Anything']);
		const token = await acquirePsnLock(db(), userId, 'library-sync');
		expect(token).toBeTruthy();

		try {
			await runScheduledPsPlusCheck(db(), env);
			expect(seen).toHaveLength(0); // the store was never called
			expect(await isPsPlusRefreshFailed(db(), userId)).toBe(false);
		} finally {
			await deleteSetting(db(), userId, PSN_LOCK_SETTING_KEY);
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
		await setSetting(db(), userId, PSN_REGION_SETTING_KEY, 'fr-fr');
		await deleteSetting(db(), userId, PSPLUS_SWEEP_STATE_SETTING_KEY);
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
		expect((await getPsPlusSweepState(db(), userId))?.done).toBe(true);

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
		await deleteSetting(db(), userId, PSPLUS_SWEEP_STATE_SETTING_KEY);
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

	it('sets the failed flag and writes no flags when the catalog fetch fails', async () => {
		const flagged = await seedGame('Cron Celeste', { psPlusExtra: true });
		stubCatalog([], 500);

		await runScheduledPsPlusCheck(db(), env);

		expect(await isPsPlusRefreshFailed(db(), userId)).toBe(true);
		// The stale flag stands — a failed refresh never partial-clears.
		expect(await flagOf(flagged.id)).toBe(true);
	});

	it('does NOT light the banner when region is unconfigured (config gap, not a refresh failure)', async () => {
		const { clearPsPlusRefreshFailed } = await import(
			'../../src/services/settings'
		);
		const { deleteSetting } = await import('../../src/repositories');
		// Force no-region: clear the persisted setting AND pass env without the seed.
		await deleteSetting(db(), userId, PSN_REGION_SETTING_KEY);
		await clearPsPlusRefreshFailed(db(), userId);
		const seen = stubCatalog(['x']);

		await runScheduledPsPlusCheck(db(), {
			AUTH_ALLOWED_EMAIL: env.AUTH_ALLOWED_EMAIL,
		});

		expect(seen.length).toBe(0); // no region → never fetched
		// A config gap must not light a banner the button can't clear.
		expect(await isPsPlusRefreshFailed(db(), userId)).toBe(false);
	});

	it('no-ops (no throw, no writes) when the allowlist email has no user row', async () => {
		const before = (await db().select({ id: game.id }).from(game)).length;
		const seen = stubCatalog(['Whatever']);

		await runScheduledPsPlusCheck(db(), {
			...env,
			AUTH_ALLOWED_EMAIL: 'nobody@press-start.local',
		});

		expect(seen.length).toBe(0); // never fetched — no user to check
		expect((await db().select({ id: game.id }).from(game)).length).toBe(before);
	});
});
