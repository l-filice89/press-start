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
import { changePlayStatus, getShelf } from '../../src/services';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

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
				.where(eq(user.email, ALLOWED_EMAIL))
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
	});
});
