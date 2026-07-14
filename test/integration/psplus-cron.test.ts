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
	isPsPlusRefreshFailed,
	markPsPlusRefreshFailed,
	PSN_REGION_SETTING_KEY,
} from '../../src/services/settings';
import worker from '../../worker/index';
import { catalogPagePayload, productId } from '../fixtures/psn';
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
	 * filtered against nothing. The cron drives ONE chunk per run after a
	 * successful membership pass — 7 runs a month, so a multi-chunk sweep
	 * converges within days and self-heals — and it RESUMES from the persisted
	 * cursor, which is the only reason it converges at all.
	 */
	it('drives a genre-sweep chunk after the membership pass, and the NEXT cron resumes the cursor', async () => {
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

		stub();
		await runScheduledPsPlusCheck(db(), env);
		// Chunk 1 = the first 3 of the 4 discovered keys: ACTION landed, HORROR has
		// not been reached yet.
		expect(await listCatalogGenres(db(), scope)).toEqual([
			{ productId: productId('Cron Sifu'), genreKey: 'ACTION' },
		]);

		// The catalog has not moved, so the cursor SURVIVES the next refresh and the
		// sweep advances instead of re-walking chunk 1 forever.
		stub();
		await runScheduledPsPlusCheck(db(), env);
		expect(
			(await listCatalogGenres(db(), scope)).map((row) => row.genreKey).sort(),
		).toEqual(['ACTION', 'HORROR']);
		await setSetting(db(), userId, PSN_REGION_SETTING_KEY, 'it-it');
	});

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
