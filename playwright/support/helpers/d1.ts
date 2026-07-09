import { execFileSync } from 'node:child_process';
import { createGame, type SeedGame } from '../factories/game-factory';

/**
 * Direct seeding into the isolated e2e D1 database via `wrangler d1 execute`
 * — there is no create-game API until Epic 6, and UI-based setup is the
 * anti-pattern. The tracking row attaches to the single e2e user created at
 * sign-in (global-setup), hence the `SELECT id FROM user` subquery.
 */
// ponytail: shells out per call (~1-2s); switch to a dev-only seed endpoint if suite setup time starts to hurt

const sq = (value: string | null): string =>
	value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;

export function d1Execute(sql: string): void {
	execFileSync(
		'bun',
		['x', 'wrangler', 'd1', 'execute', 'DB', '--local', '--env', 'e2e', '--command', sql],
		{ stdio: 'pipe' },
	);
}

/** Runs a single SELECT and returns its rows (wrangler `--json` output). */
export function d1Query<T>(sql: string): T[] {
	const raw = execFileSync(
		'bun',
		['x', 'wrangler', 'd1', 'execute', 'DB', '--local', '--env', 'e2e', '--json', '--command', sql],
		{ stdio: ['ignore', 'pipe', 'pipe'] },
	).toString();
	// wrangler may prefix the JSON with log lines — anchor on the payload's
	// `[{` opener, not just any bracket (log noise like [WARNING] has those)
	const start = raw.search(/\[\s*\{/);
	if (start === -1) {
		throw new Error(`no JSON in wrangler d1 output:\n${raw}`);
	}
	return (JSON.parse(raw.slice(start)) as Array<{ results: T[] }>)[0]?.results ?? [];
}

export function seedGame(game: SeedGame): void {
	const t = game.tracking;
	d1Execute(
		`INSERT INTO game (id, title, title_normalized, release_date, cover_url, store_url, ps_plus_extra, unenriched)
		 VALUES (${sq(game.id)}, ${sq(game.title)}, ${sq(game.title.toLowerCase())}, ${sq(game.releaseDate)}, ${sq(game.coverUrl)}, ${sq(game.storeUrl)}, ${game.psPlusExtra ? 1 : 0}, 0);
		 INSERT INTO game_tracking (user_id, game_id, owned, play_status, completed_on, platinum_on, wishlisted_on)
		 SELECT id, ${sq(game.id)}, ${t.owned ? 1 : 0}, ${sq(t.playStatus)}, ${sq(t.completedOn)}, ${sq(t.platinumOn)}, ${sq(t.wishlistedOn)} FROM user LIMIT 1;`,
	);
}

export function deleteGame(gameId: string): void {
	// game_tracking rows cascade
	d1Execute(`DELETE FROM game WHERE id = ${sq(gameId)};`);
}

/**
 * Wipes every app + auth table so each suite run starts from the identical
 * baseline (Epic 2.5 TR-1: deterministic, resettable fixture). Tables come
 * from sqlite_master so a future migration can never silently escape the
 * wipe; FKs are toggled off around the deletes so ordering doesn't matter.
 * Migrations seed no rows, so empty is the true zero state; `d1_migrations`
 * bookkeeping and sqlite internals are excluded.
 */
export function resetDb(): void {
	const tables = d1Query<{ name: string }>(
		`SELECT name FROM sqlite_master WHERE type = 'table'
		 AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%' AND name != 'd1_migrations';`,
	).map((r) => r.name);
	d1Execute(
		`PRAGMA defer_foreign_keys = on; ${tables.map((t) => `DELETE FROM "${t}";`).join(' ')}`,
	);
}

/**
 * Deterministic baseline fixture: fixed ids and titles, statuses chosen so
 * all three sit in the default visible shelf set. Seeded once per run by
 * global-setup (after auth creates the e2e user); specs may rely on these
 * rows existing and MUST NOT mutate or delete them.
 */
export const BASELINE_GAMES: SeedGame[] = [
	createGame({
		id: 'baseline-0000-0000-0000-000000000001',
		title: 'Baseline Alpha',
		tracking: { playStatus: 'Playing' },
	}),
	createGame({
		id: 'baseline-0000-0000-0000-000000000002',
		title: 'Baseline Beta',
		tracking: { playStatus: 'Up next' },
	}),
	createGame({
		id: 'baseline-0000-0000-0000-000000000003',
		title: 'Baseline Gamma',
		tracking: { playStatus: 'Not started' },
	}),
];

export function seedBaseline(): void {
	for (const game of BASELINE_GAMES) {
		seedGame(game);
	}
}
