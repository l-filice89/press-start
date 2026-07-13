import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	getSetting,
	getTracking,
	insertGame,
	setSetting,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import {
	PSN_AUTH_EXPIRED,
	PSN_AUTH_SETTING_KEY,
	PSN_NPSSO_SETTING_KEY,
} from '../../src/services/settings';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

/**
 * Trophy sync integration (Story 9.2) against the real Worker + local D1, with
 * the outbound PSN calls stubbed with the CAPTURED wire shape (probe run
 * 2026-07-13). The hazard rows: the trophy sync writes ONLY trophy columns (a
 * run must leave play status / milestones / every lifecycle date byte-equal),
 * the name-only join tolerates the PS4 " Trophies" suffix, an ambiguous name is
 * NEVER guessed, and both an expired NPSSO and a DEGENERATE 200 fail closed —
 * zero writes, existing counts intact.
 */

const db = () => createDb(env.DB);

const trophyTitle = (over: Record<string, unknown> = {}) => ({
	npCommunicationId: 'NPWR22372_00',
	trophyTitleName: 'Ultimate Chicken Horse Trophies',
	trophyTitlePlatform: 'PS4',
	definedTrophies: { bronze: 40, silver: 12, gold: 6, platinum: 1 },
	earnedTrophies: { bronze: 6, silver: 0, gold: 0, platinum: 0 },
	progress: 4,
	lastUpdatedDateTime: '2026-05-02T19:22:11Z',
	...over,
});

const realFetch = globalThis.fetch;

/**
 * Stubs the NPSSO→bearer exchange plus the trophy host. `trophyResponse` is a
 * factory so a degenerate/401 body can be substituted whole.
 */
function stubPsn(trophyResponse: () => Response) {
	vi.stubGlobal(
		'fetch',
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			if (
				url.startsWith(
					'https://ca.account.sony.com/api/authz/v3/oauth/authorize',
				)
			) {
				return new Response(null, {
					status: 302,
					headers: {
						location:
							'com.scee.psxandroid.scecompcall://redirect?code=test-auth-code',
					},
				});
			}
			if (
				url.startsWith('https://ca.account.sony.com/api/authz/v3/oauth/token')
			) {
				return new Response(JSON.stringify({ access_token: 'test-bearer' }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			}
			if (!url.startsWith('https://m.np.playstation.com/')) {
				return realFetch(input, init);
			}
			return trophyResponse();
		},
	);
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});

const stubTrophies = (titles: unknown[]) =>
	stubPsn(() => json({ trophyTitles: titles, totalItemCount: titles.length }));

const postTrophySync = (cookie: string) =>
	appFetch('/api/sync/trophies', { method: 'POST', headers: { cookie } });

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
	await setSetting(db(), userId, PSN_NPSSO_SETTING_KEY, 'test-psn-npsso');
});

afterEach(() => vi.unstubAllGlobals());

/** A tracked game carrying a full set of user-entered play state. */
async function trackedGame(title: string, normalized: string) {
	const created = await insertGame(db(), {
		title,
		titleNormalized: normalized,
	});
	await upsertTracking(db(), userId, created.id, {
		owned: true,
		ownershipType: 'digital',
		playStatus: 'Paused',
		startedOn: '2026-01-05',
		completedOn: '2026-02-01',
		platinumOn: '2026-03-09',
		boughtOn: '2025-12-01',
		wishlistedOn: '2025-11-11',
	});
	return created;
}

describe('POST /api/sync/trophies (integration, real workerd + local D1)', () => {
	it('requires auth', async () => {
		expect(
			(await appFetch('/api/sync/trophies', { method: 'POST' })).status,
		).toBe(401);
	});

	it('persists the counts by NAME (PS4 " Trophies" suffix stripped) and touches NOTHING else (hazard: trophy data is its own surface)', async () => {
		const game = await trackedGame(
			'Ultimate Chicken Horse',
			'ultimate chicken horse',
		);
		const before = await getTracking(db(), userId, game.id);

		stubTrophies([trophyTitle()]);
		const res = await postTrophySync(cookie);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			updated: ['Ultimate Chicken Horse'],
			unmatched: [],
			needsAttention: [],
		});

		const after = await getTracking(db(), userId, game.id);
		// The counts landed, raw and untransformed (the % is derived on read).
		expect(after).toMatchObject({
			trophyNpCommId: 'NPWR22372_00',
			trophyEarnedBronze: 6,
			trophyEarnedSilver: 0,
			trophyEarnedGold: 0,
			trophyEarnedPlatinum: 0,
			trophyDefinedBronze: 40,
			trophyDefinedSilver: 12,
			trophyDefinedGold: 6,
			trophyDefinedPlatinum: 1,
		});
		expect(after?.trophySyncedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		// The hazard: every non-trophy column is byte-equal across the run.
		expect({
			playStatus: after?.playStatus,
			startedOn: after?.startedOn,
			completedOn: after?.completedOn,
			platinumOn: after?.platinumOn,
			boughtOn: after?.boughtOn,
			wishlistedOn: after?.wishlistedOn,
			owned: after?.owned,
			ownershipType: after?.ownershipType,
			ownedVia: after?.ownedVia,
			discarded: after?.discarded,
		}).toEqual({
			playStatus: before?.playStatus,
			startedOn: before?.startedOn,
			completedOn: before?.completedOn,
			platinumOn: before?.platinumOn,
			boughtOn: before?.boughtOn,
			wishlistedOn: before?.wishlistedOn,
			owned: before?.owned,
			ownershipType: before?.ownershipType,
			ownedVia: before?.ownedVia,
			discarded: before?.discarded,
		});
	});

	it('the shelf ENDPOINT carries the derived trophy block after a sync (hazard: the route schema strips any field it does not declare)', async () => {
		const game = await trackedGame('Tearaway', 'tearaway');
		stubTrophies([
			trophyTitle({
				trophyTitleName: 'Tearaway Trophies',
				earnedTrophies: { bronze: 20, silver: 6, gold: 2, platinum: 0 },
				definedTrophies: { bronze: 30, silver: 10, gold: 4, platinum: 1 },
			}),
		]);
		expect((await postTrophySync(cookie)).status).toBe(200);

		const shelf = (await (
			await appFetch('/api/shelf?include=hidden', { headers: { cookie } })
		).json()) as {
			games: {
				id: string;
				trophy: { percent: number; grade: string } | null;
			}[];
		};
		// 28 of 45 → 62% → B, computed in core/ on read (never a stored column).
		expect(shelf.games.find((g) => g.id === game.id)?.trophy).toMatchObject({
			percent: 62,
			grade: 'B',
			earned: { bronze: 20, silver: 6, gold: 2, platinum: 0 },
			defined: { bronze: 30, silver: 10, gold: 4, platinum: 1 },
		});
		// A game the sync never touched reports NO trophy data — never a 0%.
		const untouched = await insertGame(db(), {
			title: 'No Trophies Here',
			titleNormalized: 'no trophies here',
		});
		await upsertTracking(db(), userId, untouched.id, { owned: true });
		const after = (await (
			await appFetch('/api/shelf?include=hidden', { headers: { cookie } })
		).json()) as { games: { id: string; trophy: unknown }[] };
		expect(after.games.find((g) => g.id === untouched.id)?.trophy).toBeNull();
	});

	it('collapses PSN\'s TWO trophy sets for one game ("Hades" + "Hades Trophies") to the most-earned entry (hazard: PSN\'s arbitrary order would overwrite a platinum with an abandoned run)', async () => {
		const game = await trackedGame('Hades', 'hades');

		// The real two-entry shape: the PS4 set (abandoned) and the PS5 set (100%).
		stubTrophies([
			trophyTitle({
				trophyTitleName: 'Hades Trophies',
				trophyTitlePlatform: 'PS4',
				npCommunicationId: 'NPWR17245_00',
				definedTrophies: { bronze: 30, silver: 12, gold: 6, platinum: 1 },
				earnedTrophies: { bronze: 1, silver: 0, gold: 0, platinum: 0 },
			}),
			trophyTitle({
				trophyTitleName: 'Hades',
				trophyTitlePlatform: 'PS5',
				npCommunicationId: 'NPWR20718_00',
				definedTrophies: { bronze: 30, silver: 12, gold: 6, platinum: 1 },
				earnedTrophies: { bronze: 30, silver: 12, gold: 6, platinum: 1 },
			}),
		]);
		const res = await postTrophySync(cookie);
		expect(res.status).toBe(200);
		// Listed ONCE, not once per trophy set.
		expect(await res.json()).toEqual({
			updated: ['Hades'],
			unmatched: [],
			needsAttention: [],
		});

		// The PS5 platinum stands — the PS4 run never overwrote it.
		expect(await getTracking(db(), userId, game.id)).toMatchObject({
			trophyNpCommId: 'NPWR20718_00',
			trophyEarnedBronze: 30,
			trophyEarnedPlatinum: 1,
		});
	});

	it('a library game legitimately NAMED "<X> Trophies" does not collide with "<X>" (hazard: stripping the suffix on the library side makes both ambiguous and writes neither)', async () => {
		const plain = await trackedGame('Blood', 'blood');
		const suffixed = await trackedGame('Blood Trophies', 'blood trophies');

		stubTrophies([
			trophyTitle({
				trophyTitleName: 'Blood Trophies',
				npCommunicationId: 'NPWR40001_00',
				earnedTrophies: { bronze: 3, silver: 0, gold: 0, platinum: 0 },
			}),
		]);
		const body = (await (await postTrophySync(cookie)).json()) as {
			updated: string[];
			needsAttention: unknown[];
		};
		expect(body).toMatchObject({ updated: ['Blood'], needsAttention: [] });

		expect(
			(await getTracking(db(), userId, plain.id))?.trophyEarnedBronze,
		).toBe(3);
		// The game actually called "Blood Trophies" was never a candidate.
		expect(
			(await getTracking(db(), userId, suffixed.id))?.trophyDefinedBronze,
		).toBeNull();
	});

	it('a PARTIALLY-written trophy row reads as NO DATA on the shelf (hazard: trophy_synced_at is the sentinel — bronze alone would ?? 0-fill the other tiers into a wrong %)', async () => {
		const game = await insertGame(db(), {
			title: 'Partial Row',
			titleNormalized: 'partial row',
		});
		// Bronze counts only, never synced: not trophy data.
		await upsertTracking(db(), userId, game.id, {
			owned: true,
			trophyEarnedBronze: 5,
			trophyDefinedBronze: 40,
		});

		const shelf = (await (
			await appFetch('/api/shelf?include=hidden', { headers: { cookie } })
		).json()) as { games: { id: string; trophy: unknown }[] };
		expect(shelf.games.find((g) => g.id === game.id)?.trophy).toBeNull();
	});

	it('reports a trophy title with no library game as unmatched — not an error, and no game is created', async () => {
		stubTrophies([
			trophyTitle({
				trophyTitleName: 'A Demo Nobody Owns',
				npCommunicationId: 'NPWR99999_00',
			}),
		]);
		const res = await postTrophySync(cookie);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			unmatched: string[];
			needsAttention: unknown[];
		};
		expect(body.unmatched).toContain('A Demo Nobody Owns');
		expect(body.needsAttention).toEqual([]);

		// Trophy sync never creates a game (AR-10/11: it is not an ingest path).
		const { game } = await import('../../src/schema');
		expect(
			await db()
				.select()
				.from(game)
				.where(eq(game.title, 'A Demo Nobody Owns')),
		).toHaveLength(0);
	});

	it('never guesses an ambiguous name — no write, one needs-attention item (hazard)', async () => {
		// Two library games normalizing to the same key.
		const a = await insertGame(db(), {
			title: 'Doppel Trophy',
			titleNormalized: 'doppel trophy',
		});
		const b = await insertGame(db(), {
			title: 'Doppel Trophy',
			titleNormalized: 'doppel trophy',
		});
		await upsertTracking(db(), userId, a.id, { owned: true });
		await upsertTracking(db(), userId, b.id, { owned: true });

		stubTrophies([trophyTitle({ trophyTitleName: 'Doppel Trophy' })]);
		const res = await postTrophySync(cookie);
		const body = (await res.json()) as {
			updated: string[];
			needsAttention: { title: string }[];
		};
		expect(body.updated).not.toContain('Doppel Trophy');
		expect(body.needsAttention).toMatchObject([{ title: 'Doppel Trophy' }]);

		// Neither candidate was written.
		expect(
			(await getTracking(db(), userId, a.id))?.trophyDefinedBronze,
		).toBeNull();
		expect(
			(await getTracking(db(), userId, b.id))?.trophyDefinedBronze,
		).toBeNull();
	});

	it('a DEGENERATE 200 (error body) writes NOTHING and leaves existing counts intact (hazard: fails closed)', async () => {
		const game = await trackedGame('Tales of Arise', 'tales of arise');
		// Seed a prior successful run's counts.
		stubTrophies([
			trophyTitle({
				trophyTitleName: 'Tales of Arise',
				npCommunicationId: 'NPWR21232_00',
				earnedTrophies: { bronze: 6, silver: 0, gold: 0, platinum: 0 },
			}),
		]);
		expect((await postTrophySync(cookie)).status).toBe(200);
		const seeded = await getTracking(db(), userId, game.id);
		expect(seeded?.trophyEarnedBronze).toBe(6);
		vi.unstubAllGlobals();

		// The degenerate response: HTTP 200 carrying an error body.
		stubPsn(() => json({ error: { message: 'Invalid token' } }));
		const res = await postTrophySync(cookie);
		// Surfaced as a failure — never a silent "no trophies".
		expect(res.status).toBe(502);

		const after = await getTracking(db(), userId, game.id);
		expect(after?.trophyEarnedBronze).toBe(6);
		expect(after?.trophyDefinedBronze).toBe(40);
		expect(after?.trophySyncedAt).toBe(seeded?.trophySyncedAt);
	});

	it('an empty trophyTitles while totalItemCount > 0 also fails closed (hazard: degenerate page)', async () => {
		stubPsn(() => json({ trophyTitles: [], totalItemCount: 137 }));
		expect((await postTrophySync(cookie)).status).toBe(502);
	});

	it('a trophy-host 401 persists psn_auth=expired, answers 401, and writes nothing (hazard: one attempt, no retry)', async () => {
		const game = await trackedGame('Astro Bot', 'astro bot');

		// The CAPTURED bogus-bearer response on this host.
		stubPsn(() => json({ error: { message: 'Invalid token' } }, 401));
		const res = await postTrophySync(cookie);
		expect(res.status).toBe(401);
		expect(((await res.json()) as { error: string }).error).toMatch(/expired/);
		expect(await getSetting(db(), userId, PSN_AUTH_SETTING_KEY)).toBe(
			PSN_AUTH_EXPIRED,
		);
		// Auth failure lands BEFORE any write.
		expect(
			(await getTracking(db(), userId, game.id))?.trophyDefinedBronze,
		).toBeNull();
	});
});
