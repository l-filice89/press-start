import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { deleteSetting, getSetting, setSetting } from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import {
	acquirePsnLock,
	PSN_LOCK_SETTING_KEY,
	releasePsnLock,
} from '../../src/services/psn-lock';
import {
	PSN_NPSSO_SETTING_KEY,
	TIMEZONE_SETTING_KEY,
} from '../../src/services/settings';
import { PSN_LIBRARY_HOST, PSN_TROPHY_HOST, stubPsnFetch } from './psn-stub';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

/**
 * Single-flight over the PSN long-ops (Story 9.5, deferred since Epic 4). The
 * hazards: two tabs must not double the PSN fan-out and both report the same
 * rows as written; the claim must be ATOMIC (a read-then-write acquire is the
 * very race being closed); a finished or failed run must RELEASE (a lock nobody
 * clears is a user who can never sync again); and a crashed run must expire.
 */

const db = () => createDb(env.DB);

let cookie: string;
let userId: string;

/** Counts what actually reached PSN — a refused run must call it ZERO times. */
let psnCalls: number;

function stubPsn() {
	psnCalls = 0;
	stubPsnFetch((url) => {
		if (url.startsWith(PSN_LIBRARY_HOST)) {
			psnCalls++;
			return new Response(
				JSON.stringify({
					data: {
						purchasedTitlesRetrieve: { games: [], pageInfo: { isLast: true } },
					},
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			);
		}
		if (url.startsWith(PSN_TROPHY_HOST)) {
			psnCalls++;
			return new Response(
				JSON.stringify({ trophyTitles: [], totalItemCount: 0 }),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			);
		}
		return undefined;
	});
}

const post = (path: string) =>
	appFetch(path, { method: 'POST', headers: { cookie } });

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	cookie = await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, ALLOWED_EMAIL));
	userId = row.id;
	await setSetting(db(), userId, PSN_NPSSO_SETTING_KEY, 'test-psn-npsso');
	// The backfill refuses a user with no zone (9.3) — and that refusal is ALSO a
	// 409, which would masquerade as the lock's.
	await setSetting(db(), userId, TIMEZONE_SETTING_KEY, 'Pacific/Auckland');
});

afterEach(async () => {
	vi.unstubAllGlobals();
	// Never leak a held lock into the next test — DELETE it, so a test that
	// asserts the row is ABSENT is not quietly passing on leftovers.
	await deleteSetting(db(), userId, PSN_LOCK_SETTING_KEY);
});

describe('PSN single-flight lock (integration, real workerd + local D1)', () => {
	it('two concurrent claims: exactly ONE wins (hazard: a read-then-write acquire lets both through)', async () => {
		const claims = await Promise.all([
			acquirePsnLock(db(), userId, 'library-sync'),
			acquirePsnLock(db(), userId, 'trophy-sync'),
			acquirePsnLock(db(), userId, 'platinum-backfill'),
		]);
		expect(claims.filter(Boolean)).toHaveLength(1);
	});

	it('is per USER — another account is never blocked by this one', async () => {
		const now = new Date();
		await db()
			.insert(user)
			.values({
				id: 'other-user',
				name: 'Other',
				email: 'other@example.com',
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing();

		expect(await acquirePsnLock(db(), userId, 'library-sync')).toBeTruthy();
		expect(
			await acquirePsnLock(db(), 'other-user', 'library-sync'),
		).toBeTruthy();
	});

	it('refuses a second PSN op with a 409 and a message — and makes NO PSN call', async () => {
		stubPsn();
		const token = await acquirePsnLock(db(), userId, 'library-sync');
		expect(token).toBeTruthy();

		for (const path of [
			'/api/sync',
			'/api/sync/trophies',
			'/api/backfill/platinum-dates',
		]) {
			const res = await post(path);
			expect(res.status, `expected 409 for ${path}`).toBe(409);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/already running/i);
		}
		expect(psnCalls).toBe(0);
	});

	it('a CURSOR is not a capability: a backfill continuation cannot steal a running sync’s lock (hazard)', async () => {
		stubPsn();
		// A library sync is mid-flight and holds the lock.
		expect(await acquirePsnLock(db(), userId, 'library-sync')).toBeTruthy();

		// The cursor is a game_id this very endpoint publishes in its response body
		// (and in a failed chunk's `partial`), so anyone can present one. If it were
		// treated as proof of ownership, this request would OVERWRITE the running
		// sync's lock and fan out to PSN beside it.
		const stolen = await post(
			'/api/backfill/platinum-dates?cursor=any-game-id',
		);
		expect(stolen.status).toBe(409);
		// A stale/forged TOKEN is no better.
		const forged = await post(
			'/api/backfill/platinum-dates?cursor=any-game-id&lockToken=999:platinum-backfill:not-mine',
		);
		expect(forged.status).toBe(409);
		expect(psnCalls).toBe(0);
	});

	it('a continuation that presents its OWN token renews the lock and proceeds', async () => {
		stubPsn();
		const token = await acquirePsnLock(db(), userId, 'platinum-backfill');
		expect(token).toBeTruthy();
		// The renewal at the service seam: presenting the held token wins — and it
		// ROTATES the token, so the old one is spent (a replayed chunk cannot renew
		// a lock that has moved on).
		const renewed = await acquirePsnLock(
			db(),
			userId,
			'platinum-backfill',
			token as string,
		);
		expect(renewed).toBeTruthy();
		expect(renewed).not.toBe(token);
		expect(
			await acquirePsnLock(db(), userId, 'platinum-backfill', token as string),
		).toBeNull();

		const res = await post(
			`/api/backfill/platinum-dates?cursor=any-game-id&lockToken=${encodeURIComponent(renewed as string)}`,
		);
		// The loop's own chunk is never self-refused. (This user has no trophy data,
		// so the run finds zero candidates and needs no PSN call — the lock path is
		// what is under test.)
		expect(res.status).toBe(200);
		// The renewal replaced the token, and the terminating chunk released it.
		expect(
			await getSetting(db(), userId, PSN_LOCK_SETTING_KEY),
		).toBeUndefined();
	});

	it('two CONCURRENT requests to the same route: one runs, one is refused, PSN is called ONCE (the race itself)', async () => {
		stubPsn();
		const [a, b] = await Promise.all([post('/api/sync'), post('/api/sync')]);
		expect([a.status, b.status].sort()).toEqual([200, 409]);
		// The point of the whole story: the account takes ONE fan-out, not two.
		expect(psnCalls).toBe(1);
	});

	it('a backfill REFUSED for a missing timezone still gives the lock back (hazard: refusing yourself out of every op)', async () => {
		await deleteSetting(db(), userId, TIMEZONE_SETTING_KEY);
		try {
			const res = await post('/api/backfill/platinum-dates');
			expect(res.status).toBe(409);
			expect(((await res.json()) as { error: string }).error).toMatch(
				/timezone/i,
			);
			// The 9.3 refusal happens AFTER the lock is claimed — if it did not
			// release, one click would lock the user out of all three ops for the TTL.
			expect(
				await getSetting(db(), userId, PSN_LOCK_SETTING_KEY),
			).toBeUndefined();
		} finally {
			await setSetting(db(), userId, TIMEZONE_SETTING_KEY, 'Pacific/Auckland');
		}
	});

	it('a client that STOPS mid-loop hands the lock back (the chunk brake — otherwise "run it again" is refused for the TTL)', async () => {
		const token = await acquirePsnLock(db(), userId, 'platinum-backfill');
		const released = await post(
			`/api/backfill/platinum-dates?release=1&lockToken=${encodeURIComponent(token as string)}`,
		);
		expect(released.status).toBe(200);
		expect(
			await getSetting(db(), userId, PSN_LOCK_SETTING_KEY),
		).toBeUndefined();

		// A release presenting someone else's token clears nothing.
		const mine = await acquirePsnLock(db(), userId, 'trophy-sync');
		await post(
			'/api/backfill/platinum-dates?release=1&lockToken=999:x:not-mine',
		);
		expect(await getSetting(db(), userId, PSN_LOCK_SETTING_KEY)).toBe(mine);
	});

	it('releases on the way out — a finished run does not block the next one', async () => {
		stubPsn();
		expect((await post('/api/sync')).status).toBe(200);
		// The row is gone (not merely expired): the next run claims it immediately.
		expect(
			await getSetting(db(), userId, PSN_LOCK_SETTING_KEY),
		).toBeUndefined();
		expect((await post('/api/sync/trophies')).status).toBe(200);
		expect(psnCalls).toBe(2);
	});

	it('releases even when the run FAILS — a 502 must not lock the user out', async () => {
		stubPsnFetch((url) =>
			url.startsWith(PSN_LIBRARY_HOST)
				? new Response('{}', { status: 500 })
				: undefined,
		);
		expect((await post('/api/sync')).status).toBe(502);
		expect(
			await getSetting(db(), userId, PSN_LOCK_SETTING_KEY),
		).toBeUndefined();
	});

	it('expires: a lock left behind by a crashed run is taken over after its TTL', async () => {
		// A held lock whose expiry is in the past — what a Worker that died mid-sync
		// leaves behind (its release never ran).
		await setSetting(
			db(),
			userId,
			PSN_LOCK_SETTING_KEY,
			`${Date.now() - 1}:library-sync:dead-run`,
		);
		stubPsn();
		expect((await post('/api/sync')).status).toBe(200);
	});

	it('a release only ever clears the caller’s OWN lock', async () => {
		const mine = await acquirePsnLock(db(), userId, 'library-sync');
		expect(mine).toBeTruthy();
		// Someone else's token (a run that timed out and came back late).
		await releasePsnLock(db(), userId, '999:library-sync:not-mine');
		expect(await getSetting(db(), userId, PSN_LOCK_SETTING_KEY)).toBe(mine);
	});
});
