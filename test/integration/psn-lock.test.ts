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
import { catalogPagePayload } from '../fixtures/psn';
import { stubStore } from './psn-stub';
import { appFetch, establishSession, TEST_EMAIL } from './session';

/**
 * Single-flight over the PSN long-ops (Story 9.5, deferred since Epic 4). The
 * hazards: two tabs must not double the PSN fan-out and both report the same
 * rows as written; the claim must be ATOMIC (a read-then-write acquire is the
 * very race being closed); a finished or failed run must RELEASE (a lock nobody
 * clears is a user who can never sync again); and a crashed run must expire.
 *
 * Epic 11 severed the credentialed ops: 11.1 removed the routes, 11.2 trimmed
 * `PsnOp` to `catalog-refresh` alone. Every hazard below is re-pointed at the
 * surviving anonymous refresh — the semantics are op-agnostic and stay pinned
 * at the service seam and through the PS+ catalog routes.
 */

const db = () => createDb(env.DB);

let cookie: string;
let userId: string;

const post = (path: string) =>
	appFetch(path, { method: 'POST', headers: { cookie } });

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	cookie = await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, TEST_EMAIL));
	userId = row.id;
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
			acquirePsnLock(db(), userId, 'catalog-refresh'),
			acquirePsnLock(db(), userId, 'catalog-refresh'),
			acquirePsnLock(db(), userId, 'catalog-refresh'),
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

		expect(await acquirePsnLock(db(), userId, 'catalog-refresh')).toBeTruthy();
		expect(
			await acquirePsnLock(db(), 'other-user', 'catalog-refresh'),
		).toBeTruthy();
	});

	// The cross-op steal hazard (Story 7.1 review, H2) has no second live op to
	// steal from since 11.2 trimmed `PsnOp` — but the op-segment authorization
	// branch in acquirePsnLock still exists, and if an op ever returns it must
	// already be guarded. Pin it at the seam with a forged retired-op token.
	it('a token whose OP SEGMENT differs never renews the held lock (H2 guard survives the union trim)', async () => {
		const held = await acquirePsnLock(db(), userId, 'catalog-refresh');
		expect(held).toBeTruthy();
		const expiry = Date.now() + 60_000;
		expect(
			await acquirePsnLock(
				db(),
				userId,
				'catalog-refresh',
				`${expiry}:some-retired-op:${(held as string).split(':')[2]}`,
			),
		).toBeNull();
		expect(await getSetting(db(), userId, PSN_LOCK_SETTING_KEY)).toBe(held);
	});

	it('expires: a lock left behind by a crashed run is taken over after its TTL', async () => {
		// A held lock whose expiry is in the past — what a Worker that died mid-run
		// leaves behind (its release never ran).
		await setSetting(
			db(),
			userId,
			PSN_LOCK_SETTING_KEY,
			`${Date.now() - 1}:catalog-refresh:dead-run`,
		);
		stubStore(() => ({ body: catalogPagePayload(['Whatever']) }));
		expect((await post('/api/ps-plus-check')).status).toBe(200);
	});

	/**
	 * The PS+ catalog ops (Story 7.1). The refresh took NO lock before this story
	 * — and 7.1 multiplies its fan-out (5 catalog pages + a ~20-key genre sweep)
	 * and makes it a WRITER of a snapshot a second run would prune underneath it.
	 */
	it('refuses a second PS+ catalog op with a 409 — and the STORE sees zero calls', async () => {
		const storeCalls = stubStore(() => ({
			body: catalogPagePayload(['Whatever']),
		}));
		expect(await acquirePsnLock(db(), userId, 'catalog-refresh')).toBeTruthy();

		for (const path of ['/api/ps-plus-check', '/api/ps-plus-catalog/genres']) {
			const res = await post(path);
			expect(res.status, `expected 409 for ${path}`).toBe(409);
			expect(((await res.json()) as { error: string }).error).toMatch(
				/already running/i,
			);
		}
		expect(storeCalls).toHaveLength(0);
	});

	it('a CURSOR is not a capability: a genre-sweep continuation cannot steal a running refresh’s lock (hazard)', async () => {
		const storeCalls = stubStore(() => ({
			body: catalogPagePayload(['Whatever']),
		}));
		expect(await acquirePsnLock(db(), userId, 'catalog-refresh')).toBeTruthy();

		// The cursor is a GENRE KEY — server-published data (the facet list is
		// public store data), so anyone can present one. It authorizes nothing.
		const stolen = await post(
			'/api/ps-plus-catalog/genres?cursor=ACTION&generation=whatever',
		);
		expect(stolen.status).toBe(409);
		// A stale/forged TOKEN is no better.
		const forged = await post(
			'/api/ps-plus-catalog/genres?cursor=ACTION&generation=whatever&lockToken=999:catalog-refresh:not-mine',
		);
		expect(forged.status).toBe(409);
		expect(storeCalls).toHaveLength(0);
	});

	it('a genre-sweep continuation that presents its OWN token renews (and ROTATES) it and proceeds', async () => {
		stubStore(() => ({ body: catalogPagePayload([]) }));
		const token = await acquirePsnLock(db(), userId, 'catalog-refresh');
		const renewed = await acquirePsnLock(
			db(),
			userId,
			'catalog-refresh',
			token as string,
		);
		expect(renewed).toBeTruthy();
		expect(renewed).not.toBe(token);
		// The old token is SPENT — a replayed chunk cannot renew a moved-on lock.
		expect(
			await acquirePsnLock(db(), userId, 'catalog-refresh', token as string),
		).toBeNull();

		// The loop's own chunk is never self-refused. (No catalog is stored for this
		// user, so the sweep answers 409 `no-catalog` — NOT the busy 409; the point
		// under test is that it got past the lock. The message tells them apart.)
		const res = await post(
			`/api/ps-plus-catalog/genres?cursor=ACTION&generation=x&lockToken=${encodeURIComponent(renewed as string)}`,
		);
		expect(((await res.json()) as { error: string }).error).not.toMatch(
			/already running/i,
		);
		// A non-continuing chunk releases: the row is GONE, not merely expired.
		expect(
			await getSetting(db(), userId, PSN_LOCK_SETTING_KEY),
		).toBeUndefined();
	});

	it('the PS+ refresh releases on the way out — a finished run does not block the next one', async () => {
		stubStore(() => ({ body: catalogPagePayload(['Crow Country']) }));
		expect((await post('/api/ps-plus-check')).status).toBe(200);
		expect(
			await getSetting(db(), userId, PSN_LOCK_SETTING_KEY),
		).toBeUndefined();
	});

	it('releases even when the run FAILS — a store 500 must not lock the user out', async () => {
		stubStore(() => ({ status: 500, body: { error: 'store down' } }));
		const res = await post('/api/ps-plus-check');
		expect(res.status).toBeGreaterThanOrEqual(500);
		// The failed run's lock is GONE — the next check is not refused for a TTL.
		expect(
			await getSetting(db(), userId, PSN_LOCK_SETTING_KEY),
		).toBeUndefined();
	});

	it('a release only ever clears the caller’s OWN lock', async () => {
		const mine = await acquirePsnLock(db(), userId, 'catalog-refresh');
		expect(mine).toBeTruthy();
		// Someone else's token (a run that timed out and came back late).
		await releasePsnLock(db(), userId, '999:catalog-refresh:not-mine');
		expect(await getSetting(db(), userId, PSN_LOCK_SETTING_KEY)).toBe(mine);
	});
});
