import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, inject, it } from 'vitest';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';

/**
 * Migration 0018 hazard test (Story 8.5, B6): the REAL migration file is
 * applied against a DB seeded with the legacy shapes it will meet — the
 * migration-0010 slice pattern, so an inline hand-copy of the UPDATE can never
 * drift green while the file is wrong. Assertions are two-sided: exactly the
 * owned-NULL rows (tombstones included) flip to `purchase`, every other row —
 * and every other COLUMN — is byte-identical.
 */

const now = new Date();

describe('migration 0018 (owned_via backfill)', () => {
	it('flips exactly the owned-NULL rows to purchase — all other rows and columns byte-identical', async () => {
		const migrations = inject('migrations');
		const target = migrations.findIndex((m) =>
			m.name.includes('0018_owned_via_backfill'),
		);
		expect(target).toBeGreaterThan(-1);

		// Bring the DB to the 0017 state, then seed the world 0018 will meet.
		await applyD1Migrations(env.DB, migrations.slice(0, target));
		const db = createDb(env.DB);
		await db.insert(user).values({
			id: 'mig18-user',
			name: 'Mig18',
			email: 'mig18@example.com',
			createdAt: now,
			updatedAt: now,
		});
		const insertGame = (id: string, title: string) =>
			env.DB.prepare(
				`INSERT INTO game (id, title, title_normalized) VALUES (?, ?, ?)`,
			)
				.bind(id, title, title.toLowerCase())
				.run();
		await insertGame('g-legacy', 'Legacy Owned');
		await insertGame('g-wish', 'Legacy Wishlisted');
		await insertGame('g-claim', 'Legacy Claimed');
		await insertGame('g-binned', 'Legacy Binned');
		const track = (
			gameId: string,
			owned: number,
			via: string | null,
			discarded = 0,
		) =>
			env.DB.prepare(
				`INSERT INTO game_tracking
				   (user_id, game_id, owned, owned_via, play_status, completed_on,
				    started_on, bought_on, wishlisted_on, ownership_type, discarded)
				 VALUES ('mig18-user', ?, ?, ?, 'Paused', '2026-01-01',
				         '2025-12-01', '2025-11-01', NULL, 'digital', ?)`,
			)
				.bind(gameId, owned, via, discarded)
				.run();
		await track('g-legacy', 1, null); // THE backfill target
		await track('g-wish', 0, null); // un-owned: NULL stays (via is meaningless)
		await track('g-claim', 1, 'membership'); // never repainted
		await track('g-binned', 1, null, 1); // tombstone: backfilled too (revive-safe)

		const snapshot = async () =>
			(
				await env.DB.prepare(
					`SELECT * FROM game_tracking WHERE user_id = 'mig18-user' ORDER BY game_id`,
				).all<Record<string, unknown>>()
			).results;
		const before = await snapshot();

		// Apply ONLY the migration under test.
		await applyD1Migrations(env.DB, [migrations[target]]);

		const after = await snapshot();
		// Byte-identical except the two intended owned_via flips (AR-10).
		expect(after).toEqual(
			before.map((row) =>
				row.owned === 1 && row.owned_via === null
					? { ...row, owned_via: 'purchase' }
					: row,
			),
		);
		const byGame = new Map(after.map((r) => [r.game_id, r]));
		expect(byGame.get('g-legacy')?.owned_via).toBe('purchase');
		expect(byGame.get('g-binned')?.owned_via).toBe('purchase');
		expect(byGame.get('g-wish')?.owned_via).toBeNull();
		expect(byGame.get('g-claim')?.owned_via).toBe('membership');

		// The choice is RECORDED (the AC) — and the record scopes its claim
		// honestly: proof for sync-path rows, policy-consistency for the seed
		// window and manual owns (review, H1/M5).
		const { results } = await env.DB.prepare(
			"SELECT value FROM meta WHERE key = 'owned_via_backfill'",
		).all<{ value: string }>();
		expect(results[0]?.value).toContain('set to purchase');
		expect(results[0]?.value).toContain('consistency');
	});
});
