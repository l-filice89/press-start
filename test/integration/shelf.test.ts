import {
	applyD1Migrations,
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
	insertGame,
	linkGameGenre,
	upsertGenre,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { getShelf, searchLibrary } from '../../src/services';
import worker from '../../worker/index';

/**
 * Story 1.7 integration tests: the read-only shelf/search read path against
 * real workerd + local D1. The substantive ordering/visibility/scoping logic is
 * exercised through the `services/` functions (the route wrapper is a thin
 * `requireAuth` + Zod layer, proven separately by the 401 case below and the
 * `/api/me` seam in the auth suite).
 */

const db = () => createDb(env.DB);

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

/** Create a game + this user's tracking row in one shot; returns the game id. */
async function addGame(
	userId: string,
	title: string,
	tracking: Parameters<typeof upsertTracking>[3],
	facts: Partial<{
		releaseDate: string;
		coverUrl: string;
		psPlusExtra: boolean;
	}> = {},
) {
	const g = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
		...facts,
	});
	await upsertTracking(db(), userId, g.id, tracking);
	return g.id;
}

let userA: string;
let userB: string;

describe('read-only shelf + search (integration, real workerd + local D1)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		userA = await seedUser('shelf-a@example.com');
		userB = await seedUser('shelf-b@example.com');

		// A spread of states for user A. Alpha-out-of-order within groups so the
		// alphabetical tiebreak is actually tested.
		await addGame(
			userA,
			'Zephyr',
			{ playStatus: 'Playing', owned: true },
			{ releaseDate: '2020-01-01' },
		);
		const apexId = await addGame(userA, 'Apex', {
			playStatus: 'Playing',
			owned: true,
		});
		const shooter = await upsertGenre(db(), 'Shooter');
		await linkGameGenre(db(), apexId, shooter.id);
		await addGame(userA, 'Mist', { playStatus: 'Paused', owned: true });
		await addGame(userA, 'Nova', { playStatus: 'Up next', owned: false });
		await addGame(userA, 'Bolt', { playStatus: 'Not started', owned: true });
		// Hidden from the default shelf:
		await addGame(userA, 'Done Game', {
			playStatus: null,
			completedOn: '2024-01-01',
			owned: true,
		});
		await addGame(userA, 'Dropped Game', {
			playStatus: 'Dropped',
			owned: true,
		});
		// A live game that also carries a completion milestone (still shown).
		await addGame(userA, 'Replaying', {
			playStatus: 'Playing',
			completedOn: '2023-05-05',
			owned: true,
		});

		// User B tracks the same title with a different status (scope check).
		await addGame(userB, 'Apex', { playStatus: 'Paused', owned: false });
	});

	it('orders the default shelf Playing→Paused→Up next→Not started, alpha within group', async () => {
		const shelf = await getShelf(db(), userA);
		expect(shelf.map((g) => g.title)).toEqual([
			'Apex', // Playing
			'Replaying', // Playing
			'Zephyr', // Playing
			'Mist', // Paused
			'Nova', // Up next
			'Bolt', // Not started
		]);
	});

	it('hides Completed/Platinum/Dropped from the default shelf', async () => {
		const shelf = await getShelf(db(), userA);
		const titles = shelf.map((g) => g.title);
		expect(titles).not.toContain('Done Game');
		expect(titles).not.toContain('Dropped Game');
	});

	it('carries a milestone flag on a live card (milestone persists regardless of status)', async () => {
		const shelf = await getShelf(db(), userA);
		const replaying = shelf.find((g) => g.title === 'Replaying');
		expect(replaying?.effectiveState).toBe('Playing');
		expect(replaying?.hasCompleted).toBe(true);
	});

	it('bakes derived flags (wishlisted = not owned)', async () => {
		const shelf = await getShelf(db(), userA);
		const nova = shelf.find((g) => g.title === 'Nova');
		expect(nova?.owned).toBe(false);
		expect(nova?.wishlisted).toBe(true);
	});

	it('bakes playableNow = (owned OR PS+ catalog) AND released (Story 3.2)', async () => {
		const shelf = await getShelf(db(), userA);
		// Owned + released 2020 → playable now.
		expect(shelf.find((g) => g.title === 'Zephyr')?.playableNow).toBe(true);
		// Owned but no release date → released false → not playable now.
		expect(shelf.find((g) => g.title === 'Bolt')?.playableNow).toBe(false);
		// Un-owned, not in the PS+ catalog → not playable now.
		expect(shelf.find((g) => g.title === 'Nova')?.playableNow).toBe(false);
	});

	// HAZARD (Story 3.2): the default response must not widen when the state
	// order list gains hidden ranks — visibility is decoupled from ordering.
	it('includeHidden returns the whole ordered library; the default stays live-only', async () => {
		const all = await getShelf(db(), userA, true);
		expect(all.map((g) => g.title)).toEqual([
			'Apex', // Playing
			'Replaying', // Playing
			'Zephyr', // Playing
			'Mist', // Paused
			'Nova', // Up next
			'Bolt', // Not started
			'Done Game', // Story completed — hidden states rank after live ones
			'Dropped Game', // Dropped ranks last
		]);
		const defaults = await getShelf(db(), userA);
		expect(defaults.map((g) => g.title)).not.toContain('Done Game');
		expect(defaults.map((g) => g.title)).not.toContain('Dropped Game');
	});

	it('groups IGDB genres onto the card DTO', async () => {
		const shelf = await getShelf(db(), userA);
		const apex = shelf.find((g) => g.title === 'Apex');
		expect(apex?.genres).toEqual(['Shooter']);
		// A game with no genres carries an empty array, never undefined.
		expect(shelf.find((g) => g.title === 'Bolt')?.genres).toEqual([]);
	});

	it('search matches the whole library incl. hidden states, ignoring the shelf filter', async () => {
		const results = await searchLibrary(db(), userA, 'game');
		const titles = results.map((g) => g.title);
		// Both hidden games match a whole-library search.
		expect(titles).toContain('Done Game');
		expect(titles).toContain('Dropped Game');
	});

	it('search is case-insensitive substring; blank query returns nothing', async () => {
		expect(
			(await searchLibrary(db(), userA, 'APEX')).map((g) => g.title),
		).toEqual(['Apex']);
		expect(await searchLibrary(db(), userA, '   ')).toEqual([]);
	});

	it('scopes shelf + search to the signed-in user', async () => {
		const shelfB = await getShelf(db(), userB);
		expect(shelfB.map((g) => g.title)).toEqual(['Apex']);
		// User B's Apex is Paused, not User A's Playing — no cross-user bleed.
		expect(shelfB[0].effectiveState).toBe('Paused');
	});

	it('rejects an unauthenticated GET /api/shelf with 401 JSON (requireAuth seam)', async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			new Request('http://example.com/api/shelf'),
			env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(401);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ error: 'unauthorized' });
	});
});
