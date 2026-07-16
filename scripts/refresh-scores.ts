/**
 * Out-of-band manual score/TTB refresh (the retry Story 10.1 deferred).
 * Runs the REAL `runScoreRefresh` — same code as the cron, including the
 * degenerate-[] guard, the refreshed-at stamp, and the failed-flag clear —
 * against remote D1 over the Cloudflare HTTP API. Like `seed-import.ts`,
 * this is local-only I/O wiring: no Worker surface, not in CI.
 *
 *   bun scripts/refresh-scores.ts
 *
 * Required env (same .env as the seed): IGDB_CLIENT_ID, IGDB_CLIENT_SECRET,
 * CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN,
 * SEED_USER_EMAIL.
 */
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { createIgdbProvider } from '../src/providers/igdb';
import { findUserByEmail } from '../src/repositories';
import { runScoreRefresh } from '../src/services/scores';
import * as schema from '../src/schema';

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`ERROR: ${name} is not set. See .env.example.`);
		process.exit(1);
	}
	return value;
}

// ponytail: duplicated from seed-import.ts (its main() runs on import, so the
// helper can't be imported) — extract to a shared scripts module if a third
// out-of-band script ever needs it.
function createHttpDb(accountId: string, databaseId: string, apiToken: string) {
	const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

	async function query(
		sql: string,
		params: unknown[],
		method: 'run' | 'all' | 'values' | 'get',
	): Promise<{ rows: unknown[] }> {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ sql, params }),
		});
		if (!response.ok) {
			const body = await response.text();
			console.error(`\nD1 HTTP ${response.status} ${response.statusText}: ${body}`);
			throw new Error(`D1 HTTP query failed: ${response.status}`);
		}
		const data = (await response.json()) as {
			success: boolean;
			errors: unknown[];
			result: { results: Record<string, unknown>[] }[];
		};
		if (!data.success) {
			console.error(`\nD1 error: ${JSON.stringify(data.errors)}`);
			throw new Error(`D1 error: ${JSON.stringify(data.errors)}`);
		}
		const rows = (data.result[0]?.results ?? []).map((r) => Object.values(r));
		return { rows: method === 'get' ? (rows[0] ?? []) : rows };
	}

	return drizzle(
		(sql, params, method) => query(sql, params, method),
		async (queries) => {
			const results: { rows: unknown[] }[] = [];
			for (const q of queries) {
				results.push(await query(q.sql, q.params, q.method));
			}
			return results;
		},
		{ schema },
	);
}

async function main(): Promise<void> {
	const igdb = createIgdbProvider({
		clientId: requireEnv('IGDB_CLIENT_ID'),
		clientSecret: requireEnv('IGDB_CLIENT_SECRET'),
	});
	const db = createHttpDb(
		requireEnv('CLOUDFLARE_ACCOUNT_ID'),
		requireEnv('CLOUDFLARE_D1_DATABASE_ID'),
		requireEnv('CLOUDFLARE_API_TOKEN'),
	);

	const email = requireEnv('SEED_USER_EMAIL');
	const user = await findUserByEmail(db, email);
	if (!user) {
		console.error(`ERROR: no user row for ${email}.`);
		process.exit(1);
	}

	console.log('Refreshing scores + time-to-beat against remote D1…');
	const outcome = await runScoreRefresh(db, user.id, igdb);
	if (!outcome.ok) {
		console.error(`Refresh failed (${outcome.reason}) — stored scores kept.`);
		process.exit(1);
	}
	console.log(`Refresh complete: ${outcome.updated} games updated.`);
}

main().catch((error) => {
	console.error(`\nRefresh failed: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
