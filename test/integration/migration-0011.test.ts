import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, inject, it } from 'vitest';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { gameTracking } from '../../src/schema/catalog';

/**
 * Migration 0011 hazard test (Epic 11 story 11.3): the DDL that drops the 11
 * dead `trophy_*` columns runs against the SAME table that carries the manual
 * milestone (`platinum_on`/`completed_on`) and ownership (`owned_via`/
 * `bought_on`) flows — so it is applied here against a row seeded with BOTH
 * trophy values and their surviving neighbours, and the assertion is
 * two-sided: no `trophy_*` column remains (PRAGMA), survivors byte-identical.
 * A degenerate migration (a table rebuild that loses data, a wrong DROP)
 * fails this.
 */

const now = new Date();

// Every non-key game_tracking column that must SURVIVE 0011, each with a
// non-NULL value — a rebuild-style bad migration that nulled or dropped ANY
// of them fails the value assert below, not just the four headline ones.
const SURVIVORS = {
	playStatus: 'Paused',
	completedOn: '2025-11-02',
	platinumOn: '2025-12-24',
	startedOn: '2025-01-05',
	boughtOn: '2024-06-15',
	wishlistedOn: '2024-05-01',
	owned: true,
	ownedVia: 'purchase',
	ownershipType: 'digital',
	discarded: false,
} as const;

// The complete expected post-0011 column set ("and ONLY those" made literal).
const EXPECTED_COLUMNS = [
	'user_id',
	'game_id',
	'play_status',
	'completed_on',
	'platinum_on',
	'started_on',
	'bought_on',
	'wishlisted_on',
	'owned',
	'ownership_type',
	'owned_via',
	'discarded',
];

describe('migration 0011 (drop the trophy columns)', () => {
	it('drops every trophy_* column and ONLY those — milestone/ownership values byte-identical', async () => {
		const migrations = inject('migrations');
		// Position-independent: later migrations may exist; seed just before 0011.
		const target = migrations.findIndex((m) =>
			m.name.includes('0011_drop_trophy_columns'),
		);
		expect(target).toBeGreaterThan(-1);

		// Bring the DB to the 0010 state, then seed the row 0011 will meet.
		await applyD1Migrations(env.DB, migrations.slice(0, target));
		const db = createDb(env.DB);
		await db.insert(user).values({
			id: 'mig-user',
			name: 'Mig',
			email: 'mig@example.com',
			createdAt: now,
			updatedAt: now,
		});
		// Raw SQL: the Drizzle schema no longer knows the trophy columns —
		// exactly the pre-0011 world this test has to reconstruct.
		await env.DB.prepare(
			`INSERT INTO game (id, title, title_normalized) VALUES ('mig-game', 'Bloodborne', 'bloodborne');`,
		).run();
		await env.DB.prepare(
			`INSERT INTO game_tracking (
				user_id, game_id, play_status, completed_on, platinum_on, started_on,
				bought_on, wishlisted_on, owned, owned_via, ownership_type, discarded,
				trophy_np_comm_id, trophy_np_service_name,
				trophy_earned_bronze, trophy_earned_silver, trophy_earned_gold, trophy_earned_platinum,
				trophy_defined_bronze, trophy_defined_silver, trophy_defined_gold, trophy_defined_platinum,
				trophy_synced_at
			) VALUES (
				'mig-user', 'mig-game', 'Paused', '2025-11-02', '2025-12-24', '2025-01-05',
				'2024-06-15', '2024-05-01', 1, 'purchase', 'digital', 0,
				'NPWR12345_00', 'trophy2',
				20, 6, 2, 1,
				30, 10, 4, 1,
				'2026-07-13'
			);`,
		).run();

		// Apply ONLY the migration under test — a later 0012 rebuilding the
		// table must not be able to mask (or cause) a failure here.
		await applyD1Migrations(env.DB, migrations.slice(0, target + 1));

		// The post-0011 column set, EXACTLY — "drops the trophy columns and ONLY
		// those" as a full-list assert, not a subset check.
		const columns = await env.DB.prepare(
			'PRAGMA table_info(game_tracking);',
		).all<{ name: string }>();
		const names = columns.results.map((c) => c.name);
		expect(names.toSorted()).toEqual(EXPECTED_COLUMNS.toSorted());

		// …and every survivor VALUE came through the DDL byte-identical.
		const [row] = await db
			.select({
				playStatus: gameTracking.playStatus,
				completedOn: gameTracking.completedOn,
				platinumOn: gameTracking.platinumOn,
				startedOn: gameTracking.startedOn,
				boughtOn: gameTracking.boughtOn,
				wishlistedOn: gameTracking.wishlistedOn,
				owned: gameTracking.owned,
				ownedVia: gameTracking.ownedVia,
				ownershipType: gameTracking.ownershipType,
				discarded: gameTracking.discarded,
			})
			.from(gameTracking);
		expect(row).toEqual(SURVIVORS);
	});
});
