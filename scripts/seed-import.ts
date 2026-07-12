/**
 * One-time, out-of-band seed import (Story 1.6, AR-20/AD-15). Reads the two
 * committed CSV exports, enriches every game from IGDB, and writes the real
 * library to D1 — with NO Worker/UI surface. Run by hand (like
 * `scripts/generate-icons.ts`); it is intentionally outside `tsc -b`/Biome and
 * is not exercised in CI (it needs live IGDB credentials). All the tested
 * logic lives in `src/` — this file is only the I/O wiring:
 *
 *   1. read env + the two CSV files
 *   2. build a Drizzle client — local dev D1 (via wrangler's platform proxy)
 *      or the Cloudflare D1 HTTP API for remote — reusing the shared schema
 *      so the same `repositories/` write the DB either way
 *   3. build the real IGDB provider
 *   4. run `runSeedImport` and print the summary
 *
 *   bun run seed:local   (writes to the local D1 `bun dev` already uses)
 *   bun run seed         (writes to remote D1 over the Cloudflare API)
 *
 * Required env (see `.env.example`): IGDB_CLIENT_ID, IGDB_CLIENT_SECRET,
 * SEED_USER_EMAIL always; CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID,
 * CLOUDFLARE_API_TOKEN only for the remote target.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { getPlatformProxy } from 'wrangler';
import { createDb } from '../src/repositories/db';
import { createIgdbProvider } from '../src/providers/igdb';
import { runSeedImport } from '../src/services/seed-import';
import * as schema from '../src/schema';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`ERROR: ${name} is not set. See .env.example.`);
		process.exit(1);
	}
	return value;
}

/** Locate the Notion export (`Gaming list …_all.csv`) at the repo root. */
function findNotionCsv(): string {
	const match = readdirSync(repoRoot).find(
		(f) => /^Gaming list .*_all\.csv$/.test(f),
	);
	if (!match) {
		console.error('ERROR: could not find a "Gaming list …_all.csv" at the repo root.');
		process.exit(1);
	}
	return join(repoRoot, match);
}

/**
 * Drizzle over the Cloudflare D1 HTTP API. The sqlite-proxy callback POSTs raw
 * SQL and returns rows as positional value arrays (the shape drizzle expects);
 * D1 returns column-keyed objects, so we `Object.values()` each (D1 preserves
 * SELECT column order).
 */
function createHttpDb(accountId: string, databaseId: string, apiToken: string) {
	const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
	return drizzle(
		async (sql, params, method) => {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ sql, params }),
			});
			if (!response.ok) {
				// Drizzle re-wraps a thrown error as a generic "Failed query", losing
				// this detail — log it directly so a bad token / wrong account id is
				// visible (a 403 here means the API token lacks D1 edit permission).
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
			// `.get()` expects a single positional row, `.all()`/`.values()` an array of them.
			return { rows: method === 'get' ? (rows[0] ?? []) : rows };
		},
		{ schema },
	);
}

/** Local dev D1 — the same on-disk state `bun dev` reads/writes, via wrangler's platform proxy. No Cloudflare API creds needed. */
async function createLocalDb() {
	const { env, dispose } = await getPlatformProxy<{ DB: D1Database }>({
		configPath: join(repoRoot, 'wrangler.jsonc'),
	});
	return { db: createDb(env.DB), dispose };
}

async function main(): Promise<void> {
	const local = process.argv.includes('--local');

	const igdb = createIgdbProvider({
		clientId: requireEnv('IGDB_CLIENT_ID'),
		clientSecret: requireEnv('IGDB_CLIENT_SECRET'),
	});
	const { db, dispose } = local
		? await createLocalDb()
		: {
				db: createHttpDb(
					requireEnv('CLOUDFLARE_ACCOUNT_ID'),
					requireEnv('CLOUDFLARE_D1_DATABASE_ID'),
					requireEnv('CLOUDFLARE_API_TOKEN'),
				),
				dispose: async () => {},
			};

	const psCsv = readFileSync(join(repoRoot, 'ps_catalog.csv'), 'utf-8');
	const notionCsv = readFileSync(findNotionCsv(), 'utf-8');

	console.log(`Seeding library into ${local ? 'local' : 'remote'} D1 (out-of-band)…`);
	const summary = await runSeedImport({
		db,
		igdb,
		psCsv,
		notionCsv,
		userEmail: requireEnv('SEED_USER_EMAIL'),
	});
	await dispose();

	console.log('\nSeed complete:');
	console.log(`  games created:       ${summary.gamesCreated}`);
	console.log(`  games already present: ${summary.gamesExisting}`);
	console.log(`  tracking rows:       ${summary.tracked}`);
	console.log(`  genre links:         ${summary.genresLinked}`);
	console.log(`  unenriched (name-only): ${summary.unenriched}`);
	console.log(`  stragglers:          ${summary.stragglers}`);
	console.log(`  web-app entries skipped: ${summary.skippedWebApp}`);
}

main().catch((error) => {
	console.error(`\nSeed failed: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
