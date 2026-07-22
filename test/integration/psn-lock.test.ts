import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	claimRegionLock,
	deleteSetting,
	ensureRegionState,
	getRegionState,
	getSetting,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { psPlusRegionState, user } from '../../src/schema';
import {
	acquirePsnLock,
	PSN_LOCK_SETTING_KEY,
	releasePsnLock,
	withRegionLock,
} from '../../src/services/psn-lock';
import { runPsPlusCheck } from '../../src/services/psplus';
import { catalogPagePayload } from '../fixtures/psn';
import { stubStore } from './psn-stub';
import { establishSession, TEST_EMAIL } from './session';

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
// Story 8.4: the catalog ops run under the REGION lock (the POST routes died
// with the manual button) — the per-user lock seam survives for future ops.
const REGION = 'it-it';

let userId: string;

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	await establishSession();
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
	await db()
		.update(psPlusRegionState)
		.set({ lock: null })
		.where(eq(psPlusRegionState.region, REGION));
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

	it('expires: a REGION lock left behind by a crashed run is taken over after its TTL', async () => {
		// A held lock whose expiry is in the past — what a Worker that died mid-run
		// leaves behind (its release never ran). Region-homed since 8.4.
		await ensureRegionState(db(), REGION);
		await db()
			.update(psPlusRegionState)
			.set({ lock: `${Date.now() - 1}:catalog-refresh:dead-run` })
			.where(eq(psPlusRegionState.region, REGION));
		stubStore(() => ({ body: catalogPagePayload(['Whatever']) }));
		const held = await withRegionLock(db(), REGION, (token) =>
			runPsPlusCheck(db(), REGION, token),
		);
		expect(held).toMatchObject({ busy: false, result: { ok: true } });
	});

	/**
	 * The PS+ catalog ops (Story 7.1, region-homed by 8.4). The refresh is a
	 * WRITER of a snapshot a second run would prune underneath it — one REGION
	 * lock, and a refused run must never reach the store.
	 */
	it('refuses a second PS+ catalog op as busy — and the STORE sees zero calls', async () => {
		const storeCalls = stubStore(() => ({
			body: catalogPagePayload(['Whatever']),
		}));
		const token = `${Date.now() + 60_000}:catalog-refresh:holder`;
		await ensureRegionState(db(), REGION);
		expect(await claimRegionLock(db(), REGION, token, Date.now())).toBe(true);

		const held = await withRegionLock(db(), REGION, (t) =>
			runPsPlusCheck(db(), REGION, t),
		);
		expect(held).toEqual({ busy: true });
		expect(storeCalls).toHaveLength(0);
	});

	// The "a CURSOR is not a capability" HTTP test died with the client-driven
	// sweep loop (8.4) — the forged-token fence is pinned at the service seam in
	// psplus-genres.test.ts ("a chunk that LOST the lock writes nothing").

	it('a continuation that presents its OWN token renews (and ROTATES) it — the seam survives 8.4', async () => {
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
		// Release: the row is GONE, not merely expired.
		await releasePsnLock(db(), userId, renewed as string);
		expect(
			await getSetting(db(), userId, PSN_LOCK_SETTING_KEY),
		).toBeUndefined();
	});

	it('the PS+ refresh releases the REGION lock on the way out — a finished run does not block the next one', async () => {
		stubStore(() => ({ body: catalogPagePayload(['Crow Country']) }));
		const held = await withRegionLock(db(), REGION, (token) =>
			runPsPlusCheck(db(), REGION, token),
		);
		expect(held).toMatchObject({ busy: false, result: { ok: true } });
		expect((await getRegionState(db(), REGION))?.lock).toBeNull();
	});

	it('releases even when the run FAILS — a store 500 must not lock the region out', async () => {
		stubStore(() => ({ status: 500, body: { error: 'store down' } }));
		const held = await withRegionLock(db(), REGION, (token) =>
			runPsPlusCheck(db(), REGION, token),
		);
		expect(held).toMatchObject({
			busy: false,
			result: { ok: false, reason: 'provider' },
		});
		// The failed run's lock is GONE — the next check is not refused for a TTL.
		expect((await getRegionState(db(), REGION))?.lock).toBeNull();
	});

	it('a release only ever clears the caller’s OWN lock', async () => {
		const mine = await acquirePsnLock(db(), userId, 'catalog-refresh');
		expect(mine).toBeTruthy();
		// Someone else's token (a run that timed out and came back late).
		await releasePsnLock(db(), userId, '999:catalog-refresh:not-mine');
		expect(await getSetting(db(), userId, PSN_LOCK_SETTING_KEY)).toBe(mine);
	});
});
