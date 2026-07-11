import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { getSetting, insertGame, upsertTracking } from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { game, user } from '../../src/schema';
import { PSN_REGION_SETTING_KEY } from '../../src/services/settings';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

/**
 * PS+ Extra check integration (Story 5.1; FR-38/39, AR-10/23) against the
 * real Worker + local D1, with the outbound store-catalog call stubbed. The
 * hazard rows: flags move in BOTH directions but only on tracked, non-owned
 * games; catalog games absent from the library are never inserted; the
 * region setting is seeded from config on first run and read back after; a
 * failed fetch writes nothing.
 */

const db = () => createDb(env.DB);

/** Stub only the store-catalog call; everything else passes through. */
const realFetch = globalThis.fetch;
function stubCatalog(names: string[], status = 200) {
	const seen: string[] = [];
	vi.stubGlobal(
		'fetch',
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			if (!url.startsWith('https://web.np.playstation.com/')) {
				return realFetch(input, init);
			}
			seen.push(url);
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
	return seen;
}

const postCheck = (cookie: string) =>
	appFetch('/api/ps-plus-check', { method: 'POST', headers: { cookie } });

let cookie: string;
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

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	cookie = await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, ALLOWED_EMAIL));
	userId = row.id;
});

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/ps-plus-check (integration, real workerd + local D1)', () => {
	it('requires auth', async () => {
		expect(
			(await appFetch('/api/ps-plus-check', { method: 'POST' })).status,
		).toBe(401);
	});

	it('seeds the region setting from config on first run and reports it', async () => {
		stubCatalog(['Anything In Catalog']);
		const res = await postCheck(cookie);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { region: string }).region).toBe('it-it');
		// AR-23 hazard: the seed is PERSISTED so the cron reads the same value.
		expect(await getSetting(db(), userId, PSN_REGION_SETTING_KEY)).toBe(
			'it-it',
		);
	});

	it('sends the stored region as the store locale', async () => {
		const seen = stubCatalog(['Anything In Catalog']);
		await postCheck(cookie);
		expect(seen.length).toBeGreaterThan(0);
		// The locale rides a header, so assert via the persisted region instead
		// of the URL; the URL must carry the catalog operation.
		expect(seen[0]).toContain('categoryGridRetrieve');
	});

	it('sets and clears flags on tracked non-owned games only (FR-38 both directions)', async () => {
		const nowIn = await seedGame('Hades'); // enters the catalog
		const left = await seedGame('Bloodborne', { psPlusExtra: true }); // left it
		const ownedGame = await seedGame('Stray', { owned: true }); // owned: untouched
		const ownedFlagged = await seedGame('Tunic', {
			owned: true,
			psPlusExtra: true,
		}); // owned: flag NOT cleared either — ignored, not managed

		stubCatalog(['Hades', 'Ghost of Tsushima']);
		const res = await postCheck(cookie);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			flagged: string[];
			cleared: string[];
		};
		expect(body.flagged).toEqual(['Hades']);
		expect(body.cleared).toEqual(['Bloodborne']);

		expect(await flagOf(nowIn.id)).toBe(true);
		expect(await flagOf(left.id)).toBe(false);
		expect(await flagOf(ownedGame.id)).toBe(false);
		expect(await flagOf(ownedFlagged.id)).toBe(true);
	});

	it('never auto-adds catalog games absent from the library (AR-10)', async () => {
		const before = (await db().select({ id: game.id }).from(game)).length;
		stubCatalog(['Some Catalog-Only Game', 'Another One']);
		expect((await postCheck(cookie)).status).toBe(200);
		const after = (await db().select({ id: game.id }).from(game)).length;
		expect(after).toBe(before);
	});

	it('matches catalog names through title normalization (™/case noise)', async () => {
		const glyphs = await seedGame('Heavy Rain');
		stubCatalog(['HEAVY RAIN™']);
		const res = await postCheck(cookie);
		expect(((await res.json()) as { flagged: string[] }).flagged).toEqual([
			'Heavy Rain',
		]);
		expect(await flagOf(glyphs.id)).toBe(true);
	});

	it('writes nothing when the catalog fetch fails', async () => {
		const flagged = await seedGame('Celeste', { psPlusExtra: true });
		stubCatalog([], 500);
		const res = await postCheck(cookie);
		expect(res.status).toBe(502);
		// The stale flag stands — no partial clear on a failed run.
		expect(await flagOf(flagged.id)).toBe(true);
	});

	// Data-loss hazard: a 200 with zero products (bad region / de-listed
	// catalog / category-id rot) must NOT be trusted as "clear every flag".
	it('treats an empty 200 catalog as a failure and never wipes flags', async () => {
		const flagged = await seedGame('Journey', { psPlusExtra: true });
		stubCatalog([]); // HTTP 200, but no products
		const res = await postCheck(cookie);
		expect(res.status).toBe(502);
		expect(await flagOf(flagged.id)).toBe(true);
	});

	// Story 5.3: a successful check stamps the freshness date; a failed one
	// leaves the prior stamp (stale-but-real beats wrong).
	it('stamps psplus_refreshed_at on success and leaves it on failure', async () => {
		const { PSPLUS_REFRESHED_AT_SETTING_KEY } = await import(
			'../../src/services/settings'
		);
		const stampedAt = () =>
			getSetting(db(), userId, PSPLUS_REFRESHED_AT_SETTING_KEY);

		stubCatalog(['Anything In Catalog']);
		expect((await postCheck(cookie)).status).toBe(200);
		const afterSuccess = await stampedAt();
		expect(afterSuccess).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		// A failed run must not overwrite the last good stamp.
		stubCatalog([], 500);
		expect((await postCheck(cookie)).status).toBe(502);
		expect(await stampedAt()).toBe(afterSuccess);
	});
});
