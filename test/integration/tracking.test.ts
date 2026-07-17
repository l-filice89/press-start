import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
	getTracking,
	insertGame,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { changePlayStatus, getShelf, logMilestone } from '../../src/services';
import { appFetch, establishSession, TEST_EMAIL } from './session';

/**
 * Story 2.1 integration tests: the play-status write path against real workerd +
 * local D1. The substantive rules (started_on write-once, Dropped leaving the
 * default shelf, user scoping) are exercised through `services/`; the route
 * wrapper's requireAuth/Zod/404 behaviour is proven through `worker.fetch`.
 */

const db = () => createDb(env.DB);
const TODAY = '2026-07-09';

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

async function addGame(
	userId: string,
	title: string,
	tracking: Parameters<typeof upsertTracking>[3],
) {
	const g = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
	});
	await upsertTracking(db(), userId, g.id, tracking);
	return g.id;
}

/** PATCH the play-status route through the real Worker. */
function patch(gameId: string, body: unknown, cookie?: string) {
	return appFetch(`/api/games/${gameId}/play-status`, {
		method: 'PATCH',
		headers: {
			'content-type': 'application/json',
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify(body),
	});
}

/** POST the milestone route through the real Worker. */
function postMilestone(gameId: string, body: unknown, cookie?: string) {
	return appFetch(`/api/games/${gameId}/milestones`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify(body),
	});
}

/** PATCH the ownership route through the real Worker. */
function patchOwnership(gameId: string, body: unknown, cookie?: string) {
	return appFetch(`/api/games/${gameId}/ownership`, {
		method: 'PATCH',
		headers: {
			'content-type': 'application/json',
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify(body),
	});
}

/** PATCH the lifecycle-dates route through the real Worker. */
function patchDates(gameId: string, body: unknown, cookie?: string) {
	return appFetch(`/api/games/${gameId}/dates`, {
		method: 'PATCH',
		headers: {
			'content-type': 'application/json',
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify(body),
	});
}

let userA: string;
let userB: string;

describe('play-status writes (integration, real workerd + local D1)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		userA = await seedUser('tracking-a@example.com');
		userB = await seedUser('tracking-b@example.com');
	});

	it('stamps started_on on the first transition to Playing', async () => {
		const id = await addGame(userA, 'First Start', {
			playStatus: 'Not started',
		});
		expect(await changePlayStatus(db(), userA, id, 'Playing', TODAY)).toBe(
			'Playing',
		);
		expect((await getTracking(db(), userA, id))?.startedOn).toBe(TODAY);
	});

	it('never overwrites started_on across repeated Playing transitions', async () => {
		const id = await addGame(userA, 'Rewatched', { playStatus: 'Not started' });
		await changePlayStatus(db(), userA, id, 'Playing', '2024-01-01');
		await changePlayStatus(db(), userA, id, 'Paused', '2024-06-01');
		await changePlayStatus(db(), userA, id, 'Playing', TODAY);
		expect((await getTracking(db(), userA, id))?.startedOn).toBe('2024-01-01');
	});

	it('does not stamp started_on on a replay of a completed game', async () => {
		const id = await addGame(userA, 'Replay', {
			playStatus: null,
			completedOn: '2023-05-05',
		});
		expect(await changePlayStatus(db(), userA, id, 'Playing', TODAY)).toBe(
			'Playing',
		);
		const row = await getTracking(db(), userA, id);
		expect(row?.startedOn).toBeNull();
		// The milestone stands untouched (AD-11).
		expect(row?.completedOn).toBe('2023-05-05');
	});

	it('does not stamp started_on on a replay of a platinumed game', async () => {
		const id = await addGame(userA, 'Replatinum', {
			playStatus: null,
			platinumOn: '2023-05-05',
		});
		await changePlayStatus(db(), userA, id, 'Playing', TODAY);
		expect((await getTracking(db(), userA, id))?.startedOn).toBeNull();
	});

	it('removes a Dropped game from the default shelf', async () => {
		const id = await addGame(userA, 'Abandoned', { playStatus: 'Playing' });
		expect((await getShelf(db(), userA)).map((g) => g.title)).toContain(
			'Abandoned',
		);
		await changePlayStatus(db(), userA, id, 'Dropped', TODAY);
		expect((await getShelf(db(), userA)).map((g) => g.title)).not.toContain(
			'Abandoned',
		);
	});

	it('bakes the raw playStatus onto the card alongside effectiveState', async () => {
		const id = await addGame(userA, 'Raw Status', {
			playStatus: 'Not started',
		});
		await changePlayStatus(db(), userA, id, 'Up next', TODAY);
		const card = (await getShelf(db(), userA)).find((g) => g.id === id);
		expect(card?.playStatus).toBe('Up next');
		expect(card?.effectiveState).toBe('Up next');
	});

	it('clears play_status when a completion milestone exists (Story 2.3)', async () => {
		const id = await addGame(userA, 'Clear With Milestone', {
			playStatus: 'Playing',
			startedOn: '2024-01-01',
			completedOn: '2024-06-01',
		});
		// The effective state falls back to the milestone.
		expect(await changePlayStatus(db(), userA, id, null, TODAY)).toBe(
			'Story completed',
		);
		const row = await getTracking(db(), userA, id);
		expect(row?.playStatus).toBeNull();
		// Clearing never stamps or touches any date.
		expect(row?.startedOn).toBe('2024-01-01');
		expect(row?.completedOn).toBe('2024-06-01');
		expect(row?.platinumOn).toBeNull();
	});

	// The named hazard of Story 2.3 (service level): clearing without a milestone
	// is refused by the API — the UI hiding the control is not the enforcement.
	it('refuses to clear play_status when no milestone exists (FR-3 invariant)', async () => {
		const id = await addGame(userA, 'Clear Without Milestone', {
			playStatus: 'Paused',
		});
		expect(await changePlayStatus(db(), userA, id, null, TODAY)).toBe(
			'invariant',
		);
		// Nothing was written — the row is exactly as before.
		const row = await getTracking(db(), userA, id);
		expect(row?.playStatus).toBe('Paused');
		expect(row?.completedOn).toBeNull();
		expect(row?.platinumOn).toBeNull();
	});

	it('will not touch another user’s tracking row (AD-13 scope)', async () => {
		const id = await addGame(userB, 'B Only', { playStatus: 'Paused' });
		// User A has no tracking row for it → the service reports "not found".
		expect(
			await changePlayStatus(db(), userA, id, 'Playing', TODAY),
		).toBeNull();
		expect((await getTracking(db(), userB, id))?.playStatus).toBe('Paused');
		expect(await getTracking(db(), userA, id)).toBeUndefined();
	});

	it('reports an unknown game as not found rather than creating a row', async () => {
		expect(
			await changePlayStatus(
				db(),
				userA,
				crypto.randomUUID(),
				'Playing',
				TODAY,
			),
		).toBeNull();
	});

	it('rejects an unauthenticated PATCH with 401 JSON (requireAuth seam)', async () => {
		const response = await patch('whatever', { playStatus: 'Playing' });
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'unauthorized' });
	});

	describe('through the route, with a real session', () => {
		let cookie: string;
		let sessionUser: string;

		beforeAll(async () => {
			cookie = await establishSession();
			const [row] = await db()
				.select()
				.from(user)
				.where(eq(user.email, TEST_EMAIL))
				.limit(1);
			sessionUser = row.id;
		});

		it('applies a status and answers with the new effective state', async () => {
			const id = await addGame(sessionUser, 'Routed', {
				playStatus: 'Not started',
			});
			const response = await patch(id, { playStatus: 'Playing' }, cookie);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ effectiveState: 'Playing' });
			// The route is the only path that resolves `today` from the real clock —
			// assert the value it stamped, not merely that it stamped something.
			expect((await getTracking(db(), sessionUser, id))?.startedOn).toBe(
				new Date().toISOString().slice(0, 10),
			);
		});

		it('rejects an unknown status value with 400 and writes nothing', async () => {
			const id = await addGame(sessionUser, 'Bad Status', {
				playStatus: 'Paused',
			});
			const response = await patch(id, { playStatus: 'Finished' }, cookie);
			expect(response.status).toBe(400);
			expect((await getTracking(db(), sessionUser, id))?.playStatus).toBe(
				'Paused',
			);
		});

		it('answers 404 for a game this user does not track', async () => {
			const response = await patch(
				crypto.randomUUID(),
				{ playStatus: 'Playing' },
				cookie,
			);
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ error: 'not found' });
		});

		it('clears the status through the route when a milestone stands (Story 2.3)', async () => {
			const id = await addGame(sessionUser, 'Routed Clear', {
				playStatus: 'Playing',
				platinumOn: '2024-03-03',
			});
			const response = await patch(id, { playStatus: null }, cookie);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				effectiveState: 'Platinum achieved',
			});
			const row = await getTracking(db(), sessionUser, id);
			expect(row?.playStatus).toBeNull();
			expect(row?.platinumOn).toBe('2024-03-03');
		});

		// The named hazard of Story 2.3 (route level): a playStatus:null PATCH
		// reaching the API by any means is refused with 409 and the row unchanged.
		it('refuses playStatus:null with 409 when no milestone exists, row unchanged', async () => {
			const id = await addGame(sessionUser, 'Routed Invariant', {
				playStatus: 'Paused',
			});
			const response = await patch(id, { playStatus: null }, cookie);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({ error: 'completion invariant' });
			const row = await getTracking(db(), sessionUser, id);
			expect(row?.playStatus).toBe('Paused');
			expect(row?.completedOn).toBeNull();
			expect(row?.platinumOn).toBeNull();
		});
	});
});

describe('milestone writes (integration, real workerd + local D1)', () => {
	it('stamps completed_on today and keeps play_status — the game stays on the shelf', async () => {
		const id = await addGame(userA, 'Story Done', { playStatus: 'Playing' });
		// The live status wins the effective state (FR-2 amended 2026-07-09).
		expect(await logMilestone(db(), userA, id, 'completed', TODAY)).toBe(
			'Playing',
		);
		const row = await getTracking(db(), userA, id);
		expect(row?.completedOn).toBe(TODAY);
		expect(row?.playStatus).toBe('Playing');
		expect((await getShelf(db(), userA)).map((g) => g.title)).toContain(
			'Story Done',
		);
	});

	it('stamps platinum_on today and auto-clears play_status — the game leaves the shelf', async () => {
		const id = await addGame(userA, 'Platinumed', { playStatus: 'Paused' });
		expect(await logMilestone(db(), userA, id, 'platinum', TODAY)).toBe(
			'Platinum achieved',
		);
		const row = await getTracking(db(), userA, id);
		expect(row?.platinumOn).toBe(TODAY);
		expect(row?.playStatus).toBeNull();
		expect((await getShelf(db(), userA)).map((g) => g.title)).not.toContain(
			'Platinumed',
		);
	});

	it('completing a status-less platinumed game keeps it hidden — status stays null', async () => {
		const id = await addGame(userA, 'Plat First', {
			playStatus: null,
			platinumOn: '2024-06-01',
		});
		// No live status to preserve: the milestone vocabulary still wins the
		// effective state, so the one completed-log path that yields a hidden
		// state stays hidden (spec matrix row 3).
		expect(await logMilestone(db(), userA, id, 'completed', TODAY)).toBe(
			'Platinum achieved',
		);
		const row = await getTracking(db(), userA, id);
		expect(row?.completedOn).toBe(TODAY);
		expect(row?.playStatus).toBeNull();
		expect((await getShelf(db(), userA)).map((g) => g.title)).not.toContain(
			'Plat First',
		);
	});

	it('re-logging leaves the original date standing — the first achievement stands', async () => {
		const id = await addGame(userA, 'Already Done', {
			playStatus: 'Playing',
			completedOn: '2023-05-05',
		});
		// The no-op still reports the current state (200-shaped), but writes
		// nothing: the date AND the play status are exactly as before.
		expect(await logMilestone(db(), userA, id, 'completed', TODAY)).toBe(
			'Playing',
		);
		const row = await getTracking(db(), userA, id);
		expect(row?.completedOn).toBe('2023-05-05');
		expect(row?.playStatus).toBe('Playing');
	});

	it('logs platinum after story completion without touching completed_on or started_on', async () => {
		const id = await addGame(userA, 'Plat After Story', {
			playStatus: 'Playing',
			startedOn: '2024-01-01',
			completedOn: '2024-06-01',
		});
		expect(await logMilestone(db(), userA, id, 'platinum', TODAY)).toBe(
			'Platinum achieved',
		);
		const row = await getTracking(db(), userA, id);
		expect(row?.platinumOn).toBe(TODAY);
		expect(row?.completedOn).toBe('2024-06-01');
		expect(row?.startedOn).toBe('2024-01-01');
		expect(row?.playStatus).toBeNull();
	});

	it('rejects an unauthenticated POST with 401 JSON (requireAuth seam)', async () => {
		const response = await postMilestone('whatever', {
			milestone: 'completed',
		});
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'unauthorized' });
	});

	describe('through the route, with a real session', () => {
		let cookie: string;
		let sessionUser: string;

		beforeAll(async () => {
			cookie = await establishSession();
			const [row] = await db()
				.select()
				.from(user)
				.where(eq(user.email, TEST_EMAIL))
				.limit(1);
			sessionUser = row.id;
		});

		it('logs a milestone and answers with the new effective state', async () => {
			const id = await addGame(sessionUser, 'Routed Milestone', {
				playStatus: 'Playing',
			});
			const response = await postMilestone(
				id,
				{ milestone: 'platinum' },
				cookie,
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				effectiveState: 'Platinum achieved',
			});
			// The route is the only path that resolves `today` from the real clock.
			expect((await getTracking(db(), sessionUser, id))?.platinumOn).toBe(
				new Date().toISOString().slice(0, 10),
			);
		});

		it('logs story completion through the route (both enum members exercised)', async () => {
			const id = await addGame(sessionUser, 'Routed Completion', {
				playStatus: 'Playing',
			});
			const response = await postMilestone(
				id,
				{ milestone: 'completed' },
				cookie,
			);
			expect(response.status).toBe(200);
			// Status survives a completion (FR-2 amended 2026-07-09), so it stays
			// the effective state.
			expect(await response.json()).toEqual({ effectiveState: 'Playing' });
			expect((await getTracking(db(), sessionUser, id))?.playStatus).toBe(
				'Playing',
			);
		});

		it('answers the FR-6 no-op through the route with the standing state', async () => {
			const id = await addGame(sessionUser, 'Routed No-op', {
				playStatus: 'Playing',
				completedOn: '2023-05-05',
			});
			const response = await postMilestone(
				id,
				{ milestone: 'completed' },
				cookie,
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ effectiveState: 'Playing' });
			expect((await getTracking(db(), sessionUser, id))?.completedOn).toBe(
				'2023-05-05',
			);
		});

		it('rejects a malformed (non-JSON) body with 400 and writes nothing', async () => {
			const id = await addGame(sessionUser, 'Malformed Milestone', {
				playStatus: 'Playing',
			});
			const response = await appFetch(`/api/games/${id}/milestones`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie },
				body: 'not json',
			});
			expect(response.status).toBe(400);
			expect(
				(await getTracking(db(), sessionUser, id))?.completedOn,
			).toBeNull();
		});

		it('rejects an unknown milestone value with 400 and writes nothing', async () => {
			const id = await addGame(sessionUser, 'Bad Milestone', {
				playStatus: 'Playing',
			});
			const response = await postMilestone(
				id,
				{ milestone: 'speedrun' },
				cookie,
			);
			expect(response.status).toBe(400);
			const row = await getTracking(db(), sessionUser, id);
			expect(row?.playStatus).toBe('Playing');
			expect(row?.completedOn).toBeNull();
			expect(row?.platinumOn).toBeNull();
		});

		it('answers 404 for another user’s game and leaves their row untouched', async () => {
			const id = await addGame(userB, 'B Milestone', { playStatus: 'Playing' });
			const response = await postMilestone(
				id,
				{ milestone: 'completed' },
				cookie,
			);
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ error: 'not found' });
			const row = await getTracking(db(), userB, id);
			expect(row?.playStatus).toBe('Playing');
			expect(row?.completedOn).toBeNull();
		});
	});
});

describe('ownership writes (Story 2.4, through the route with a real session)', () => {
	const CLOCK_TODAY = () => new Date().toISOString().slice(0, 10);
	let cookie: string;
	let sessionUser: string;

	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		cookie = await establishSession();
		const [row] = await db()
			.select()
			.from(user)
			.where(eq(user.email, TEST_EMAIL))
			.limit(1);
		sessionUser = row.id;
	});

	// The first named hazard of Story 2.4 (route level): two full own cycles —
	// `bought_on` is stamped once and the re-own never overwrites it.
	it('stamps bought_on once across own → un-own → re-own cycles', async () => {
		const id = await addGame(sessionUser, 'Own Cycles', {
			playStatus: 'Not started',
			boughtOn: '2024-01-01',
		});

		// Re-owning a game with a recorded purchase date must not restamp it.
		let response = await patchOwnership(id, { owned: true }, cookie);
		expect(response.status).toBe(200);
		let row = await getTracking(db(), sessionUser, id);
		expect(row?.owned).toBe(true);
		expect(row?.ownershipType).toBe('physical');
		expect(row?.boughtOn).toBe('2024-01-01');

		await patchOwnership(id, { owned: false }, cookie);
		response = await patchOwnership(id, { owned: true }, cookie);
		expect(response.status).toBe(200);
		row = await getTracking(db(), sessionUser, id);
		expect(row?.owned).toBe(true);
		expect(row?.boughtOn).toBe('2024-01-01');
	});

	it('stamps bought_on today on the very first own', async () => {
		const id = await addGame(sessionUser, 'First Own', {
			playStatus: 'Not started',
		});
		const response = await patchOwnership(id, { owned: true }, cookie);
		expect(response.status).toBe(200);
		const row = await getTracking(db(), sessionUser, id);
		expect(row?.owned).toBe(true);
		expect(row?.ownershipType).toBe('physical');
		// The route is the only path that resolves `today` from the real clock.
		expect(row?.boughtOn).toBe(CLOCK_TODAY());
	});

	// Story 6.4 AC1/AC2: the manual owned-toggle now threads `via`. A claim
	// records owned_via=membership and NEVER stamps bought_on (a claim is not a
	// purchase — the date slot must stay free for a real one).
	it('records owned_via=membership on a claim and never stamps bought_on', async () => {
		const id = await addGame(sessionUser, 'Claimed via toggle', {
			playStatus: 'Not started',
		});
		const response = await patchOwnership(
			id,
			{ owned: true, via: 'membership' },
			cookie,
		);
		expect(response.status).toBe(200);
		const row = await getTracking(db(), sessionUser, id);
		expect(row?.owned).toBe(true);
		expect(row?.ownedVia).toBe('membership');
		expect(row?.boughtOn).toBeNull();
	});

	it('records owned_via=purchase and stamps bought_on when the source is purchase', async () => {
		const id = await addGame(sessionUser, 'Bought via toggle', {
			playStatus: 'Not started',
		});
		const response = await patchOwnership(
			id,
			{ owned: true, via: 'purchase' },
			cookie,
		);
		expect(response.status).toBe(200);
		const row = await getTracking(db(), sessionUser, id);
		expect(row?.ownedVia).toBe('purchase');
		expect(row?.boughtOn).toBe(CLOCK_TODAY());
	});

	it('defaults owned_via=purchase when no source is sent (non-PS+ silent own)', async () => {
		const id = await addGame(sessionUser, 'Silent own', {
			playStatus: 'Not started',
		});
		const response = await patchOwnership(id, { owned: true }, cookie);
		expect(response.status).toBe(200);
		expect((await getTracking(db(), sessionUser, id))?.ownedVia).toBe(
			'purchase',
		);
	});

	it('un-owning clears the type and leaves every date untouched; the UNDO PATCH restores both', async () => {
		const id = await addGame(sessionUser, 'Un-owned', {
			playStatus: 'Playing',
			owned: true,
			ownershipType: 'digital',
			boughtOn: '2024-01-01',
			startedOn: '2024-02-02',
		});

		const response = await patchOwnership(id, { owned: false }, cookie);
		expect(response.status).toBe(200);
		let row = await getTracking(db(), sessionUser, id);
		expect(row?.owned).toBe(false);
		expect(row?.ownershipType).toBeNull();
		expect(row?.boughtOn).toBe('2024-01-01');
		expect(row?.startedOn).toBe('2024-02-02');

		// The toast UNDO path: one PATCH restoring flag + previous type.
		const undo = await patchOwnership(
			id,
			{ owned: true, ownershipType: 'digital' },
			cookie,
		);
		expect(undo.status).toBe(200);
		row = await getTracking(db(), sessionUser, id);
		expect(row?.owned).toBe(true);
		expect(row?.ownershipType).toBe('digital');
		// Still write-once: the UNDO never restamps the purchase date.
		expect(row?.boughtOn).toBe('2024-01-01');
	});

	it('switches the type of an owned game and nothing else', async () => {
		const id = await addGame(sessionUser, 'Type Switch', {
			playStatus: 'Playing',
			owned: true,
			ownershipType: 'physical',
			boughtOn: '2024-01-01',
		});
		const response = await patchOwnership(
			id,
			{ ownershipType: 'digital' },
			cookie,
		);
		expect(response.status).toBe(200);
		const row = await getTracking(db(), sessionUser, id);
		expect(row?.ownershipType).toBe('digital');
		expect(row?.owned).toBe(true);
		expect(row?.boughtOn).toBe('2024-01-01');
	});

	it('refuses a type on an un-owned game with 400, row unchanged', async () => {
		const id = await addGame(sessionUser, 'Type Without Owned', {
			playStatus: 'Not started',
		});
		const response = await patchOwnership(
			id,
			{ ownershipType: 'digital' },
			cookie,
		);
		expect(response.status).toBe(400);
		const row = await getTracking(db(), sessionUser, id);
		expect(row?.owned).toBe(false);
		expect(row?.ownershipType).toBeNull();
	});

	it('rejects an empty body with 400', async () => {
		const id = await addGame(sessionUser, 'Empty Ownership', {
			playStatus: 'Not started',
		});
		const response = await patchOwnership(id, {}, cookie);
		expect(response.status).toBe(400);
	});

	it('rejects an unauthenticated PATCH with 401 JSON (requireAuth seam)', async () => {
		const response = await patchOwnership('whatever', { owned: true });
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'unauthorized' });
	});

	it('answers 404 for a game this user does not track', async () => {
		const response = await patchOwnership(
			crypto.randomUUID(),
			{ owned: true },
			cookie,
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'not found' });
	});
});

describe('lifecycle-date edits (Story 2.4, through the route with a real session)', () => {
	let cookie: string;
	let sessionUser: string;

	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		cookie = await establishSession();
		const [row] = await db()
			.select()
			.from(user)
			.where(eq(user.email, TEST_EMAIL))
			.limit(1);
		sessionUser = row.id;
	});

	it('corrects a date verbatim and answers the effective state', async () => {
		const id = await addGame(sessionUser, 'Date Correction', {
			playStatus: 'Playing',
			startedOn: '2024-03-10',
		});
		const response = await patchDates(id, { startedOn: '2024-03-01' }, cookie);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ effectiveState: 'Playing' });
		expect((await getTracking(db(), sessionUser, id))?.startedOn).toBe(
			'2024-03-01',
		);
	});

	it('clears a non-milestone date', async () => {
		const id = await addGame(sessionUser, 'Clear Bought', {
			playStatus: 'Playing',
			boughtOn: '2023-12-25',
		});
		const response = await patchDates(id, { boughtOn: null }, cookie);
		expect(response.status).toBe(200);
		expect((await getTracking(db(), sessionUser, id))?.boughtOn).toBeNull();
	});

	// The second named hazard of Story 2.4 (route level): a date edit clearing
	// the last milestone of a status-less game is refused with 409, row unchanged.
	it('refuses to clear the last milestone of a status-less game: 409, row unchanged', async () => {
		const id = await addGame(sessionUser, 'Last Milestone', {
			playStatus: null,
			completedOn: '2024-06-01',
		});
		const response = await patchDates(id, { completedOn: null }, cookie);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: 'completion invariant' });
		const row = await getTracking(db(), sessionUser, id);
		expect(row?.completedOn).toBe('2024-06-01');
		expect(row?.playStatus).toBeNull();
		expect(row?.platinumOn).toBeNull();
	});

	it('clears one of two milestones while the other stands', async () => {
		const id = await addGame(sessionUser, 'One Of Two', {
			playStatus: null,
			completedOn: '2024-06-01',
			platinumOn: '2024-07-01',
		});
		const response = await patchDates(id, { platinumOn: null }, cookie);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			effectiveState: 'Story completed',
		});
		const row = await getTracking(db(), sessionUser, id);
		expect(row?.platinumOn).toBeNull();
		expect(row?.completedOn).toBe('2024-06-01');
	});

	it('sets a milestone date manually without touching play_status (no auto-clear)', async () => {
		const id = await addGame(sessionUser, 'Manual Milestone', {
			playStatus: 'Playing',
		});
		const response = await patchDates(
			id,
			{ completedOn: '2024-06-01' },
			cookie,
		);
		expect(response.status).toBe(200);
		const row = await getTracking(db(), sessionUser, id);
		expect(row?.completedOn).toBe('2024-06-01');
		expect(row?.playStatus).toBe('Playing');
	});

	it.each([
		{ startedOn: 'junk' },
		{ startedOn: '2024-13-99' },
		{ startedOn: '2024-02-30' },
	])('rejects the malformed date body %o with 400, row unchanged', async (body) => {
		const id = await addGame(sessionUser, `Bad Date ${JSON.stringify(body)}`, {
			playStatus: 'Playing',
			startedOn: '2024-01-01',
		});
		const response = await patchDates(id, body, cookie);
		expect(response.status).toBe(400);
		expect((await getTracking(db(), sessionUser, id))?.startedOn).toBe(
			'2024-01-01',
		);
	});

	it('rejects an empty body with 400', async () => {
		const id = await addGame(sessionUser, 'Empty Dates', {
			playStatus: 'Playing',
		});
		const response = await patchDates(id, {}, cookie);
		expect(response.status).toBe(400);
	});

	it('rejects an unauthenticated PATCH with 401 JSON (requireAuth seam)', async () => {
		const response = await patchDates('whatever', { boughtOn: null });
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'unauthorized' });
	});

	it('answers 404 for a game this user does not track', async () => {
		const response = await patchDates(
			crypto.randomUUID(),
			{ boughtOn: null },
			cookie,
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'not found' });
	});
});
