import {
	applyD1Migrations,
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { insertGame, setSetting, upsertTracking } from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { game, user } from '../../src/schema';
import { runScheduledPsPlusCheck } from '../../src/services/psplus';
import {
	isPsPlusRefreshFailed,
	markPsPlusRefreshFailed,
	PSN_REGION_SETTING_KEY,
} from '../../src/services/settings';
import worker from '../../worker/index';
import { ALLOWED_EMAIL, establishSession } from './session';

/**
 * Scheduled PS+ Extra refresh (Story 5.2, FR-39/40). Drives the same catalog
 * check the button runs (5.1) from the cron path, with the store call stubbed.
 * Hazards: a failed scheduled run sets `psplus_refresh_failed` and writes no
 * flags; a successful run clears it; the cron reads the SAME stored region as
 * the button (no divergence, AR-23); no user row → a clean no-op.
 */

const db = () => createDb(env.DB);

const realFetch = globalThis.fetch;
/** Stub the store-catalog call; capture the region header for parity checks. */
function stubCatalog(names: string[], status = 200) {
	const locales: string[] = [];
	vi.stubGlobal(
		'fetch',
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			if (!url.startsWith('https://web.np.playstation.com/')) {
				return realFetch(input, init);
			}
			const headers = new Headers(
				input instanceof Request ? input.headers : init?.headers,
			);
			locales.push(headers.get('x-psn-store-locale-override') ?? '');
			return new Response(
				status === 200
					? JSON.stringify({
							data: {
								categoryGridRetrieve: {
									products: names.map((name) => ({ name })),
									pageInfo: { totalCount: names.length },
								},
							},
						})
					: '{}',
				{ status, headers: { 'content-type': 'application/json' } },
			);
		},
	);
	return locales;
}

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
		const locales = stubCatalog(['Anything']);

		await runScheduledPsPlusCheck(db(), env);

		expect(locales.length).toBeGreaterThan(0);
		expect(locales[0]).toBe('pt-pt');
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
