import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	addExternalLink,
	getSetting,
	getTracking,
	insertGame,
	listExternalLinks,
	setSetting,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { game, user } from '../../src/schema';
import {
	PSN_AUTH_EXPIRED,
	PSN_AUTH_SETTING_KEY,
	PSN_COOKIE_SETTING_KEY,
} from '../../src/services/settings';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

/**
 * PSN sync integration (Story 4.2) against the real Worker + local D1, with
 * the outbound PSN call stubbed via `fetchMock`. The hazard rows: append-only
 * (a sync that flips `owned` must leave status/milestones/dates byte-equal),
 * the membership skip (a tracked claim changes NOTHING), and the live
 * 401 → `psn_auth=expired` wiring 4.1 couldn't reach.
 */

const db = () => createDb(env.DB);

const psn = (over: Record<string, unknown> = {}) => ({
	name: 'Astro Bot',
	platform: 'PS5',
	membership: null,
	titleId: 'PPSA01325_00',
	image: { url: 'https://image.api.playstation.com/astro.png' },
	conceptId: '10005478',
	...over,
});

/**
 * Stub the outbound PSN call only. These tests run in the same isolate as
 * the Worker under vitest-pool-workers, so the provider's global `fetch` is
 * this one; every non-PSN URL passes through to the real fetch.
 */
const realFetch = globalThis.fetch;
function stubPsn(games: Record<string, unknown>[], status = 200) {
	vi.stubGlobal(
		'fetch',
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			if (!url.startsWith('https://web.np.playstation.com/')) {
				return realFetch(input, init);
			}
			return new Response(
				status === 200
					? JSON.stringify({
							data: {
								purchasedTitlesRetrieve: { games, pageInfo: { isLast: true } },
							},
						})
					: '{}',
				{ status, headers: { 'content-type': 'application/json' } },
			);
		},
	);
}

const postSync = (cookie: string) =>
	appFetch('/api/sync', { method: 'POST', headers: { cookie } });

let cookie: string;
let userId: string;

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	cookie = await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, ALLOWED_EMAIL));
	userId = row.id;
	await setSetting(db(), userId, PSN_COOKIE_SETTING_KEY, 'test-psn-cookie');
});

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/sync (integration, real workerd + local D1)', () => {
	it('requires auth', async () => {
		expect((await appFetch('/api/sync', { method: 'POST' })).status).toBe(401);
	});

	it('creates a new purchase with FR-33 defaults, PSN facts and link', async () => {
		stubPsn([psn()]);
		const res = await postSync(cookie);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			added: 1,
			flipped: 0,
			skippedMembership: 0,
			needsAttention: [],
		});

		const [created] = await db()
			.select()
			.from(game)
			.where(eq(game.title, 'Astro Bot'));
		expect(created).toMatchObject({
			coverUrl: 'https://image.api.playstation.com/astro.png',
			storeUrl: 'https://store.playstation.com/concept/10005478',
			unenriched: true,
		});
		const links = await listExternalLinks(db(), created.id);
		expect(links).toMatchObject([
			{ source: 'PSN', externalId: 'PPSA01325_00' },
		]);
		const tracking = await getTracking(db(), userId, created.id);
		expect(tracking).toMatchObject({
			owned: true,
			ownershipType: 'digital',
			playStatus: 'Not started',
		});
		expect(tracking?.boughtOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('re-running the same sync is idempotent', async () => {
		stubPsn([psn()]);
		const res = await postSync(cookie);
		expect(await res.json()).toEqual({
			added: 0,
			flipped: 0,
			skippedMembership: 0,
			needsAttention: [],
		});
	});

	it('flips owned on a matched un-owned game and touches NOTHING else (hazard FR-33/AD-10)', async () => {
		const tracked = await insertGame(db(), {
			title: 'Hollow Knight',
			titleNormalized: 'hollow knight',
			coverUrl: 'https://seed-cover.png',
		});
		await upsertTracking(db(), userId, tracked.id, {
			owned: false,
			playStatus: 'Paused',
			startedOn: '2026-01-05',
			completedOn: '2026-02-01',
			wishlistedOn: '2025-12-24',
		});

		stubPsn([
			psn({
				name: 'Hollow Knight',
				titleId: 'CUSA_HK_00',
				image: { url: 'https://psn-cover.png' },
				conceptId: '999',
			}),
		]);
		const res = await postSync(cookie);
		expect(await res.json()).toMatchObject({ added: 0, flipped: 1 });

		const after = await getTracking(db(), userId, tracked.id);
		// The flip and its inferences...
		expect(after).toMatchObject({
			owned: true,
			ownershipType: 'digital',
			boughtOn: after?.boughtOn,
		});
		// ...and the append-only hazard: user-entered state is byte-identical.
		expect(after).toMatchObject({
			playStatus: 'Paused',
			startedOn: '2026-01-05',
			completedOn: '2026-02-01',
			wishlistedOn: '2025-12-24',
		});
		// Facts backfill is NULL-only: the seeded cover survives.
		const [g] = await db().select().from(game).where(eq(game.id, tracked.id));
		expect(g.coverUrl).toBe('https://seed-cover.png');
		expect(g.storeUrl).toBe('https://store.playstation.com/concept/999');
		// The PSN id got linked for next time.
		expect(await listExternalLinks(db(), tracked.id)).toMatchObject([
			{ source: 'PSN', externalId: 'CUSA_HK_00' },
		]);
	});

	it('skips membership claims — a tracked claim stays byte-identical (hazard FR-9/33)', async () => {
		const claimed = await insertGame(db(), {
			title: 'Claim Target',
			titleNormalized: 'claim target',
		});
		await upsertTracking(db(), userId, claimed.id, {
			owned: false,
			playStatus: 'Playing',
			startedOn: '2026-03-03',
		});
		const before = await getTracking(db(), userId, claimed.id);

		stubPsn([
			psn({ name: 'Claim Target', titleId: 'CLAIM_00', membership: 'PS_PLUS' }),
			psn({
				name: 'Unknown Claim',
				titleId: 'CLAIM_01',
				membership: 'PS_PLUS',
			}),
		]);
		const res = await postSync(cookie);
		expect(await res.json()).toEqual({
			added: 0,
			flipped: 0,
			skippedMembership: 2,
			needsAttention: [],
		});

		expect(await getTracking(db(), userId, claimed.id)).toEqual(before);
		expect(await listExternalLinks(db(), claimed.id)).toEqual([]);
		const unknownClaim = await db()
			.select()
			.from(game)
			.where(eq(game.title, 'Unknown Claim'));
		expect(unknownClaim).toEqual([]);
	});

	it('flags a title match carrying a different PSN id — never merges (hazard FR-34)', async () => {
		const original = await insertGame(db(), {
			title: 'Doppelganger',
			titleNormalized: 'doppelganger',
		});
		await addExternalLink(db(), {
			gameId: original.id,
			source: 'PSN',
			externalId: 'ORIGINAL_00',
		});

		stubPsn([psn({ name: 'Doppelganger', titleId: 'IMPOSTOR_00' })]);
		const res = await postSync(cookie);
		const body = (await res.json()) as { needsAttention: string[] };
		expect(body).toMatchObject({ added: 0, flipped: 0 });
		expect(body.needsAttention).toHaveLength(1);
		expect(body.needsAttention[0]).toContain('Doppelganger');

		// Nothing merged, nothing created.
		expect(await listExternalLinks(db(), original.id)).toMatchObject([
			{ externalId: 'ORIGINAL_00' },
		]);
		expect(
			(await db().select().from(game).where(eq(game.title, 'Doppelganger')))
				.length,
		).toBe(1);
	});

	it('a PSN 401 persists psn_auth=expired and answers 401 with the refresh message (hazard FR-36)', async () => {
		stubPsn([], 401);
		const res = await postSync(cookie);
		expect(res.status).toBe(401);
		expect(((await res.json()) as { error: string }).error).toMatch(/expired/);
		// The live wiring 4.1 couldn't reach: the flag the banner reads.
		expect(await getSetting(db(), userId, PSN_AUTH_SETTING_KEY)).toBe(
			PSN_AUTH_EXPIRED,
		);
	});
});
