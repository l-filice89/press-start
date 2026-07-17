import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
	countMembershipClaimsForUser,
	countUnenrichedForUser,
	insertGame,
	listCatalogForBrowse,
	PS_PLUS_TIER,
	recordRegionOutcome,
	upsertCatalogProducts,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import {
	addGame as addGameService,
	addGenreToGame,
	cancelMembership,
	changeOwnership,
	changePlayStatus,
	editDates,
	getGameById,
	loadLibrary,
	logMilestone,
	rematchGame,
	resolveStraggler,
	setGameDiscarded,
} from '../../src/services';
import {
	bumpAllLibraryVersions,
	readLibraryVersion,
} from '../../src/services/library-version';
import { browseCatalog } from '../../src/services/psplus-browse';
import { appFetch, establishSession } from './session';

/**
 * Story 8.6 hazard suite — free-tier read-budget hardening.
 *
 * (a) by-id parity: the single-row read answers the SAME card the whole-library
 *     bake did (the shared `librarySelection` makes drift structural, this
 *     pins it behaviorally); a missing/other-user/discarded id is null.
 * (b) counts equal full-scan truth, including zero.
 * (c) THE BYPASS SUITE: the ETag version must rotate after EVERY writer
 *     category — a missed bump is a stale-304 that never self-heals, so each
 *     writer is driven and the version asserted CHANGED. The refusal side
 *     (unchanged version ⇒ 304) is pinned at the route.
 * (d) catalog SQL paging: page N ∪ N+1 covers the ordered set exactly once at
 *     the SKU level; filters still apply in SQL.
 */

const db = () => createDb(env.DB);

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	// Story 8.4: /api/shelf's waitUntil stale-snapshot guard would otherwise
	// hit the REAL store (nothing stubs fetch here) and rotate library versions
	// mid-test — a fresh ledger row for the env-seeded region keeps it dormant.
	await recordRegionOutcome(db(), 'it-it', {
		attemptedOn: new Date().toISOString().slice(0, 10),
		succeeded: true,
		window: new Date().toISOString().slice(0, 7),
	});
});

async function seedUser(email: string) {
	const id = crypto.randomUUID();
	const now = new Date();
	await db().insert(user).values({
		id,
		name: email,
		email,
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
	return id;
}

async function seedGame(
	userId: string,
	title: string,
	tracking: Parameters<typeof upsertTracking>[3],
	facts: Partial<{ unenriched: boolean; psPlusExtra: boolean }> = {},
) {
	const g = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
		...facts,
	});
	await upsertTracking(db(), userId, g.id, tracking);
	return g.id;
}

describe('8.6a — single-row game-by-id', () => {
	let userId: string;
	beforeAll(async () => {
		userId = await seedUser('by-id@test.dev');
	});

	it('answers the identical card the whole-library bake produced', async () => {
		const id = await seedGame(userId, 'Parity Game', {
			owned: true,
			playStatus: 'Playing',
			startedOn: '2026-07-01',
		});
		await addGenreToGame(db(), userId, id, 'Adventure');
		const viaLibrary = (await loadLibrary(db(), userId)).find(
			(g) => g.id === id,
		);
		const viaById = await getGameById(db(), userId, id);
		expect(viaById).toEqual(viaLibrary);
	});

	it("misses on an unknown id, another user's id, and a discarded row", async () => {
		const stranger = await seedUser('by-id-stranger@test.dev');
		const theirs = await seedGame(stranger, 'Theirs', {
			owned: true,
			playStatus: 'Playing',
		});
		expect(await getGameById(db(), userId, crypto.randomUUID())).toBeNull();
		expect(await getGameById(db(), userId, theirs)).toBeNull();
		const discarded = await seedGame(userId, 'Binned', {
			owned: true,
			playStatus: 'Paused',
		});
		await setGameDiscarded(db(), userId, discarded, true);
		expect(await getGameById(db(), userId, discarded)).toBeNull();
	});
});

describe('8.6b — SQL counts', () => {
	it('membership-claim and unenriched counts match full-scan truth, incl. zero', async () => {
		const userId = await seedUser('counts@test.dev');
		expect(await countMembershipClaimsForUser(db(), userId)).toBe(0);
		expect(await countUnenrichedForUser(db(), userId)).toBe(0);

		await seedGame(
			userId,
			'Claimed One',
			{ owned: true, ownershipType: 'digital', ownedVia: 'membership' },
			{},
		);
		await seedGame(
			userId,
			'Bought One',
			{ owned: true, ownershipType: 'digital', ownedVia: 'purchase' },
			{},
		);
		await seedGame(userId, 'Name Only', { owned: false }, { unenriched: true });
		const binned = await seedGame(
			userId,
			'Binned Claim',
			{ owned: true, ownershipType: 'digital', ownedVia: 'membership' },
			{ unenriched: true },
		);
		await setGameDiscarded(db(), userId, binned, true);

		// Discarded rows count for neither (the old scans filtered them too).
		expect(await countMembershipClaimsForUser(db(), userId)).toBe(1);
		expect(await countUnenrichedForUser(db(), userId)).toBe(1);
	});
});

describe('8.6c — the version-bump bypass suite', () => {
	let userId: string;
	let gameId: string;
	beforeAll(async () => {
		userId = await seedUser('bumps@test.dev');
		gameId = await seedGame(userId, 'Bump Target', {
			owned: true,
			ownershipType: 'digital',
			ownedVia: 'membership',
			playStatus: 'Playing',
		});
	});

	async function expectBump(write: () => Promise<unknown>) {
		const before = await readLibraryVersion(db(), userId);
		await write();
		const after = await readLibraryVersion(db(), userId);
		expect(after).not.toBe(before);
	}

	it('rotates on every user-scoped writer category', async () => {
		await expectBump(() =>
			changePlayStatus(db(), userId, gameId, 'Paused', '2026-07-17'),
		);
		await expectBump(() =>
			logMilestone(db(), userId, gameId, 'completed', '2026-07-17'),
		);
		await expectBump(() =>
			changeOwnership(
				db(),
				userId,
				gameId,
				{ ownershipType: 'physical' },
				'2026-07-17',
			),
		);
		await expectBump(() =>
			editDates(db(), userId, gameId, { startedOn: '2026-07-02' }),
		);
		await expectBump(() => addGenreToGame(db(), userId, gameId, 'Action'));
		await expectBump(() => cancelMembership(db(), userId));
		await expectBump(() => setGameDiscarded(db(), userId, gameId, true));
	});

	it("rotates EVERY user's version on a shared-fact write", async () => {
		const other = await seedUser('bumps-other@test.dev');
		const mine = await readLibraryVersion(db(), userId);
		const theirs = await readLibraryVersion(db(), other);
		await bumpAllLibraryVersions(db());
		expect(await readLibraryVersion(db(), userId)).not.toBe(mine);
		expect(await readLibraryVersion(db(), other)).not.toBe(theirs);
	});

	it('reads are idempotent and a fresh user lazily initializes', async () => {
		const fresh = await seedUser('bumps-fresh@test.dev');
		const first = await readLibraryVersion(db(), fresh);
		expect(first).toBeTruthy();
		// Stable across plain reads — otherwise every request self-invalidates.
		expect(await readLibraryVersion(db(), fresh)).toBe(first);
	});

	it('the SHARED-fact writers rotate every tracker, driven through the real seams', async () => {
		// rematch rewrites shared game facts → bump-all (review: the gated call
		// itself must be driven, not the helper — deleting the bump from the
		// writer must fail THIS test).
		const other = await seedUser('bumps-shared@test.dev');
		const shared = await seedGame(other, 'Shared Fact Game', {
			owned: true,
			ownershipType: 'digital',
		});
		await upsertTracking(db(), userId, shared, { owned: false });

		let mine = await readLibraryVersion(db(), userId);
		let theirs = await readLibraryVersion(db(), other);
		const rematched = await rematchGame(db(), other, shared, {
			igdbId: 'igdb-8-6-rematch',
			name: 'Shared Fact Game (Right Match)',
		});
		expect(rematched).toEqual({ kind: 'rematched', gameId: shared });
		expect(await readLibraryVersion(db(), userId)).not.toBe(mine);
		expect(await readLibraryVersion(db(), other)).not.toBe(theirs);

		// straggler resolve enriches a shared row → bump-all (review, H1).
		const nameOnly = await seedGame(
			other,
			'Name Only Shared',
			{ owned: false },
			{ unenriched: true },
		);
		mine = await readLibraryVersion(db(), userId);
		theirs = await readLibraryVersion(db(), other);
		const resolved = await resolveStraggler(db(), other, {
			id: nameOnly,
			kind: 'unenriched',
			igdbId: 'igdb-8-6-resolve',
			name: 'Properly Enriched',
		});
		expect(resolved).toEqual({ kind: 'resolved', gameId: nameOnly });
		expect(await readLibraryVersion(db(), userId)).not.toBe(mine);
		expect(await readLibraryVersion(db(), other)).not.toBe(theirs);

		// addGame converging on an EXISTING shared row → bump-all (review, H2).
		mine = await readLibraryVersion(db(), userId);
		const added = await addGameService(
			db(),
			userId,
			{ title: 'Shared Fact Game (Right Match)' },
			'2026-07-17',
		);
		// The actor already tracks the row (seeded above) — a duplicate route is
		// fine: the point is the EXISTING-shared-row branch ran, and it bumps.
		expect(added).toMatchObject({ kind: 'duplicate' });
		expect(await readLibraryVersion(db(), userId)).not.toBe(mine);

		// genre add writes shared `game_genre` → bump-all (follow-up review, H1:
		// the actor-only bump left every co-tracker on a permanent stale 304).
		mine = await readLibraryVersion(db(), userId);
		theirs = await readLibraryVersion(db(), other);
		const tagged = await addGenreToGame(db(), other, shared, 'Soulslike');
		expect(tagged).toContain('Soulslike');
		expect(await readLibraryVersion(db(), userId)).not.toBe(mine);
		expect(await readLibraryVersion(db(), other)).not.toBe(theirs);
	});
});

describe('8.6c — the 304 refusal at the route', () => {
	it('unchanged version ⇒ 304 with no body; a write flips it back to 200', async () => {
		const cookie = await establishSession();
		// The variant production actually uses (web/shelf/api.ts fetchShelf).
		const SHELF = '/api/shelf?include=hidden';
		const first = await appFetch(SHELF, { headers: { cookie } });
		expect(first.status).toBe(200);
		expect(first.headers.get('cache-control')).toBe('private');
		const etag = first.headers.get('etag');
		expect(etag).toMatch(/^W\//);

		const conditional = await appFetch(SHELF, {
			headers: { cookie, 'if-none-match': etag as string },
		});
		expect(conditional.status).toBe(304);
		expect(await conditional.text()).toBe('');

		// RFC 9110 list form (an aggregating proxy) still matches.
		const listForm = await appFetch(SHELF, {
			headers: { cookie, 'if-none-match': `W/"other-tag", ${etag}` },
		});
		expect(listForm.status).toBe(304);

		// An unconditional GET never 304s.
		const plain = await appFetch(SHELF, { headers: { cookie } });
		expect(plain.status).toBe(200);

		// A write rotates the version: the same conditional GET now gets fresh
		// data and a NEW tag — the stale-304 bypass this suite exists to close.
		const me = await appFetch('/api/me', { headers: { cookie } });
		const sessionUser = (await me.json()) as { id: string };
		const target = await seedGame(sessionUser.id, 'Route Bump', {
			owned: true,
			playStatus: 'Playing',
		});
		await changePlayStatus(
			db(),
			sessionUser.id,
			target,
			'Paused',
			'2026-07-17',
		);
		const after = await appFetch(SHELF, {
			headers: { cookie, 'if-none-match': etag as string },
		});
		expect(after.status).toBe(200);
		expect(after.headers.get('etag')).not.toBe(etag);
	});
});

describe('8.6d — catalog SQL paging', () => {
	const region = 'zz-pg';
	const scope = { region, tier: PS_PLUS_TIER };

	beforeAll(async () => {
		const products = Array.from({ length: 7 }, (_, i) => ({
			productId: `PROD-${String(i).padStart(2, '0')}`,
			npTitleId: null,
			name: `Game ${String.fromCharCode(65 + i)}`,
			titleNormalized: `game ${String.fromCharCode(97 + i)}`,
			coverUrl: null,
			platforms: ['PS5'],
			storeClassification: 'FULL_GAME',
			storeUrl: `https://store.example/PROD-${String(i).padStart(2, '0')}`,
		}));
		await upsertCatalogProducts(db(), scope, 'gen-8-6', products, '2026-07-17');
	});

	it('LIMIT/OFFSET pages cover the ordered set exactly once', async () => {
		const all = await listCatalogForBrowse(db(), scope);
		const page1 = await listCatalogForBrowse(db(), scope, {
			limit: 3,
			offset: 0,
		});
		const page2 = await listCatalogForBrowse(db(), scope, {
			limit: 3,
			offset: 3,
		});
		const page3 = await listCatalogForBrowse(db(), scope, {
			limit: 3,
			offset: 6,
		});
		expect([...page1, ...page2, ...page3].map((r) => r.productId)).toEqual(
			all.map((r) => r.productId),
		);
	});

	it('search filters in SQL under paging', async () => {
		const hit = await listCatalogForBrowse(db(), scope, {
			searchNormalized: 'game c',
			limit: 60,
			offset: 0,
		});
		expect(hit.map((r) => r.productId)).toEqual(['PROD-02']);
	});

	it('browseCatalog later pages read a page, keep generation, and mark nothing falsely', async () => {
		const userId = await seedUser('paging@test.dev');
		// Force the user's region to the fixture region via env fallback.
		const envStub = { PSN_REGION: region };
		const p0 = await browseCatalog(db(), userId, envStub, { cursor: 0 });
		expect(p0.games.length).toBe(7);
		expect(p0.total).toBe(7);
		expect(p0.nextCursor).toBeNull();
		expect(p0.generation).toBe('gen-8-6');
		expect(p0.games.every((g) => !g.inLibrary && !g.owned)).toBe(true);

		// A tracked+owned title marks its card on a NON-zero page too (the
		// page-scoped join, not the old whole-library map).
		await seedGame(userId, 'Game F', { owned: true, ownershipType: 'digital' });
		const paged = await browseCatalog(db(), userId, envStub, { cursor: 5 });
		const gameF = paged.games.find((g) => g.name === 'Game F');
		expect(gameF?.inLibrary).toBe(true);
		expect(gameF?.owned).toBe(true);
	});
});
