import { execFileSync } from 'node:child_process';
import type { SeedGame } from '../factories/game-factory';

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
