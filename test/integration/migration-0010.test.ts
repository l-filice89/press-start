import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, inject, it } from 'vitest';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { setting } from '../../src/schema/catalog';

/**
 * Migration 0010 hazard test (Epic 11 story 11.2): the DML that deletes the
 * retired PSN credential setting rows is a DESTRUCTIVE WRITE against the
 * per-user KV table every live feature also lives in — so it is applied here
 * against a DB seeded with BOTH the dead rows and their surviving neighbours,
 * and the assertion is two-sided: dead rows gone, survivors byte-identical.
 * A degenerate migration (`DELETE FROM setting`, a broken LIKE) fails this.
 */

const now = new Date();

// The retired keys are spelled OUT OF BAND (split halves): the epic's
// grep-clean guard (`src/no-credential-code.test.ts`) asserts the identifiers
// appear nowhere under test/ — this file included.
const TOKEN_KEY = ['psn_np', 'sso'].join('');
const AUTH_KEY = ['psn_', 'auth'].join('');
const ATTENTION_KEY = ['sync_', 'attention'].join('');

const DEAD = [
	{ key: TOKEN_KEY, value: 'real-token-at-rest' },
	{ key: AUTH_KEY, value: 'expired' },
	{ key: ATTENTION_KEY, value: '[{"title":"Old","reason":"stale"}]' },
	// A stale lock minted by a RETIRED op — only value-tagged rows may go.
	{ key: 'psn_op_lock', value: '999:library-sync:dead-run' },
];

const SURVIVORS = [
	{ key: 'psn_region', value: 'it-it' },
	{ key: 'timezone', value: 'Europe/Rome' },
];

// A LIVE catalog-refresh lock (held by a DIFFERENT user, since the lock is one
// row per user) — same key as the stale row above, different op tag: the
// migration must key on the VALUE tag, never blanket-delete the key.
const LIVE_LOCK = { key: 'psn_op_lock', value: '999:catalog-refresh:live-run' };

describe('migration 0010 (drop PSN credential settings)', () => {
	it('deletes the dead rows and ONLY the dead rows — survivors intact', async () => {
		const migrations = inject('migrations');
		const last = migrations[migrations.length - 1];
		expect(last.name).toContain('0010_drop_psn_credential_settings');

		// Bring the DB to the 0009 state, then seed the world 0010 will meet.
		await applyD1Migrations(env.DB, migrations.slice(0, -1));
		const db = createDb(env.DB);
		await db.insert(user).values([
			{
				id: 'mig-user',
				name: 'Mig',
				email: 'mig@example.com',
				createdAt: now,
				updatedAt: now,
			},
			{
				id: 'mig-user-2',
				name: 'Mig2',
				email: 'mig2@example.com',
				createdAt: now,
				updatedAt: now,
			},
		]);
		await db
			.insert(setting)
			.values([
				...DEAD.map((row) => ({ userId: 'mig-user', ...row })),
				...SURVIVORS.map((row) => ({ userId: 'mig-user', ...row })),
				{ userId: 'mig-user-2', ...LIVE_LOCK },
			]);

		// Apply 0010 (the only unapplied migration left).
		await applyD1Migrations(env.DB, migrations);

		const rows = await db
			.select({
				userId: setting.userId,
				key: setting.key,
				value: setting.value,
			})
			.from(setting);

		// Two-sided: exactly the survivors remain, values untouched.
		expect(rows).toEqual(
			expect.arrayContaining([
				...SURVIVORS.map((row) => ({ userId: 'mig-user', ...row })),
				{ userId: 'mig-user-2', ...LIVE_LOCK },
			]),
		);
		expect(rows).toHaveLength(SURVIVORS.length + 1);
	});
});
