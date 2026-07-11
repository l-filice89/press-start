import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame, type SeedGame } from '../factories/game-factory';
import { BASE_URL } from '../server';

/**
 * Test data plumbing for the isolated e2e D1 (there is no create-game API
 * until Epic 6, and UI-based setup is the anti-pattern).
 *
 * Two transports:
 * - While the app server is RUNNING (i.e. inside specs), SQL goes through
 *   POST /api/e2e/sql — the Worker serializes all D1 access, so parallel
 *   workers never fight the CLI for the SQLite file lock (SQLITE_BUSY 500s).
 * - Before the server exists (global-setup reset), `wrangler d1 execute`
 *   runs uncontended via `cliExecute`.
 */

export const sq = (value: string | null): string =>
	value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;

/** Runs SQL statements through the Worker's e2e hook. Server must be up. */
async function apiSql(statements: string[]): Promise<unknown[][]> {
	if (statements.length === 0) return [];
	// Route caps a batch at 200 statements — chunk transparently
	if (statements.length > 200) {
		const results: unknown[][] = [];
		for (let i = 0; i < statements.length; i += 200) {
			results.push(...(await apiSql(statements.slice(i, i + 200))));
		}
		return results;
	}
	const res = await fetch(`${BASE_URL}/api/e2e/sql`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ statements }),
	}).catch((error) => {
		throw new Error(`e2e sql hook unreachable at ${BASE_URL}: ${error}`);
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(
			`e2e sql hook failed (${statements.length} statements): ${res.status} ${text}`,
		);
	}
	try {
		return (JSON.parse(text) as { results: unknown[][] }).results;
	} catch {
		throw new Error(`non-JSON from e2e sql hook: ${text.slice(0, 200)}`);
	}
}

export async function d1Execute(...statements: string[]): Promise<void> {
	await apiSql(statements);
}

/** Runs a single SELECT and returns its rows. */
export async function d1Query<T>(sql: string): Promise<T[]> {
	return (await apiSql([sql]))[0] as T[];
}

/** Upserts one per-user setting row for the single e2e user (Story 4.1). */
export async function seedSetting(key: string, value: string): Promise<void> {
	await apiSql([
		`INSERT OR REPLACE INTO setting (user_id, key, value)
		 SELECT id, ${sq(key)}, ${sq(value)} FROM user LIMIT 1;`,
	]);
}

export async function deleteSetting(key: string): Promise<void> {
	await apiSql([`DELETE FROM setting WHERE key = ${sq(key)};`]);
}

/**
 * CLI fallback for global-setup steps that run BEFORE the dev server exists.
 * SQL is handed to wrangler as a file — large batches overflow the Windows
 * ~8K command line — and failures surface stderr, not a bare exit code.
 */
const sleepSync = (ms: number) =>
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function cliExecute(sql: string): void {
	const dir = mkdtempSync(join(tmpdir(), 'e2e-d1-'));
	const file = join(dir, 'batch.sql');
	writeFileSync(file, sql);
	try {
		// Retry lock contention — a stale dev server from an aborted run can
		// still hold the SQLite file when global-setup's reset runs.
		for (let attempt = 1; ; attempt++) {
			try {
				execFileSync(
					'bun',
					[
						'x',
						'wrangler',
						'd1',
						'execute',
						'DB',
						'--local',
						'--env',
						'e2e',
						'--file',
						file,
					],
					{ stdio: ['ignore', 'pipe', 'pipe'] },
				);
				return;
			} catch (error) {
				const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
				const stdout = (error as { stdout?: Buffer }).stdout?.toString() ?? '';
				if (attempt < 4 && /locked|busy/i.test(stderr + stdout)) {
					sleepSync(250 * attempt);
					continue;
				}
				throw new Error(
					`wrangler d1 execute failed:\n${stderr || stdout || String(error)}`,
				);
			}
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** The two INSERTs for one game; tracking attaches to the single e2e user. */
const seedSql = (game: SeedGame): string[] => {
	const t = game.tracking;
	return [
		`INSERT INTO game (id, title, title_normalized, release_date, cover_url, store_url, ps_plus_extra, unenriched)
		 VALUES (${sq(game.id)}, ${sq(game.title)}, ${sq(game.title.toLowerCase())}, ${sq(game.releaseDate)}, ${sq(game.coverUrl)}, ${sq(game.storeUrl)}, ${game.psPlusExtra ? 1 : 0}, 0);`,
		`INSERT INTO game_tracking (user_id, game_id, owned, owned_via, play_status, completed_on, platinum_on, wishlisted_on)
		 SELECT id, ${sq(game.id)}, ${t.owned ? 1 : 0}, ${sq(t.ownedVia)}, ${sq(t.playStatus)}, ${sq(t.completedOn)}, ${sq(t.platinumOn)}, ${sq(t.wishlistedOn)} FROM user LIMIT 1;`,
	];
};

export async function seedGame(game: SeedGame): Promise<void> {
	await apiSql(seedSql(game));
}

/** Seeds many games in one round trip. */
export async function seedGames(games: SeedGame[]): Promise<void> {
	if (games.length > 0) await apiSql(games.flatMap(seedSql));
}

/** Deletes games in one call; game_tracking rows cascade. */
export async function deleteGames(gameIds: string[]): Promise<void> {
	if (gameIds.length > 0)
		await d1Execute(
			`DELETE FROM game WHERE id IN (${gameIds.map(sq).join(', ')});`,
		);
}

export async function deleteGame(gameId: string): Promise<void> {
	await deleteGames([gameId]);
}

/**
 * Wipes every app + auth table so each suite run starts from the identical
 * baseline (Epic 2.5 TR-1: deterministic, resettable fixture). Runs in
 * global-setup BEFORE the server spawns, so it uses the CLI transport.
 * Tables come from sqlite_master so a future migration can never silently
 * escape the wipe; migrations seed no rows, so empty is the true zero state.
 */
export function resetDb(): void {
	// Two passes — wrangler can't do dynamic SQL: enumerate tables, then wipe.
	const dir = mkdtempSync(join(tmpdir(), 'e2e-d1-'));
	try {
		const listFile = join(dir, 'list.sql');
		writeFileSync(
			listFile,
			`SELECT name FROM sqlite_master WHERE type = 'table'
			 AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%' AND name != 'd1_migrations';`,
		);
		const raw = execFileSync(
			'bun',
			[
				'x',
				'wrangler',
				'd1',
				'execute',
				'DB',
				'--local',
				'--env',
				'e2e',
				'--json',
				'--file',
				listFile,
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] },
		).toString();
		const start = raw.search(/\[\s*\{/);
		if (start === -1) throw new Error(`no JSON in wrangler d1 output:\n${raw}`);
		const tables = (
			JSON.parse(raw.slice(start)) as Array<{
				results?: Array<{ name: string }>;
			}>
		)[0]?.results?.map((r) => r.name);
		if (!tables) throw new Error(`no table list in wrangler output:\n${raw}`);
		cliExecute(
			`PRAGMA defer_foreign_keys = on; ${tables.map((t) => `DELETE FROM "${t}";`).join(' ')}`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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

/** Runs after the server + auth bootstrap, so it can use the Worker hook. */
export async function seedBaseline(): Promise<void> {
	await seedGames(BASELINE_GAMES);
}
