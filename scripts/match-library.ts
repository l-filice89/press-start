/**
 * One-time, out-of-band library matcher. For every game with no IGDB
 * external link: search IGDB by title and, on an EXACT normalized-title
 * match (`pickIgdbMatch` — the same confidence bar the seed used), resolve
 * it through the REAL `resolveStraggler` path (permanent IGDB anchor +
 * enrichment + genres + scores, `unenriched` cleared). No exact match →
 * mark the game `unenriched` so it surfaces in the in-app stragglers
 * dialog for a manual pick. Never guesses a non-exact match.
 *
 *   bun scripts/match-library.ts
 *
 * Run `bun scripts/refresh-scores.ts` afterwards to fill time-to-beat for
 * the newly linked games. Same required env as the seed (.env): IGDB and
 * Cloudflare D1 creds + SEED_USER_EMAIL.
 */
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { eq } from 'drizzle-orm';
import { pickIgdbMatch } from '../src/core/igdb-match';
import { createIgdbProvider } from '../src/providers/igdb';
import { findUserByEmail } from '../src/repositories';
import { resolveStraggler } from '../src/services/stragglers';
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

	// Filtered in JS, not SQL: a `NOT IN (…293 params…)` blows the D1 HTTP
	// API's bound-parameter limit.
	const linked = new Set(
		(
			await db
				.select({ gameId: schema.externalLink.gameId })
				.from(schema.externalLink)
				.where(eq(schema.externalLink.source, 'IGDB'))
		).map((r) => r.gameId),
	);
	const unlinked = (
		await db
			.select({
				id: schema.game.id,
				title: schema.game.title,
				coverUrl: schema.game.coverUrl,
				releaseDate: schema.game.releaseDate,
				unenriched: schema.game.unenriched,
			})
			.from(schema.game)
	).filter((g) => !linked.has(g.id));

	console.log(`${unlinked.length} games without an IGDB link — matching…`);
	let matched = 0;
	let stragglers = 0;
	const problems: string[] = [];

	for (const game of unlinked) {
		const candidates = await igdb
			.searchCandidates(game.title)
			.catch((error) => {
				problems.push(`${game.title}: IGDB search failed (${error})`);
				return null;
			});
		if (candidates === null) continue;

		const index = pickIgdbMatch(
			game.title,
			candidates.map((c) => c.name),
		);
		if (index === null) {
			// No exact match — surface in the stragglers dialog for a manual pick.
			if (!game.unenriched) {
				await db
					.update(schema.game)
					.set({ unenriched: true })
					.where(eq(schema.game.id, game.id));
			}
			stragglers++;
			console.log(`  straggler: ${game.title}`);
			continue;
		}

		const pick = candidates[index];
		const outcome = await resolveStraggler(db, user.id, {
			id: game.id,
			kind: 'unenriched',
			igdbId: pick.igdbId,
			// Keep what the game already has (PS Store cover, seeded release
			// date); the IGDB candidate only fills gaps. No `name`: an exact
			// normalized match means the stored title is already right.
			coverUrl: game.coverUrl ?? pick.coverUrl,
			releaseDate: game.releaseDate ?? pick.releaseDate,
			genres: pick.genres,
			criticScore: pick.criticScore,
			criticScoreCount: pick.criticScoreCount,
			userScore: pick.userScore,
			userScoreCount: pick.userScoreCount,
		});
		if (typeof outcome === 'object' && outcome.kind === 'resolved') {
			matched++;
			console.log(`  linked: ${game.title} → IGDB ${pick.igdbId}`);
		} else if (typeof outcome === 'object' && outcome.kind === 'conflict') {
			problems.push(
				`${game.title}: IGDB ${pick.igdbId} already linked to game ${outcome.gameId} — possible duplicate row, resolve by hand`,
			);
		} else {
			problems.push(`${game.title}: resolve answered '${outcome}'`);
		}
	}

	console.log(`\nMatch complete over ${unlinked.length} games:`);
	console.log(`  linked (exact match):   ${matched}`);
	console.log(`  marked as stragglers:   ${stragglers}`);
	if (problems.length > 0) {
		console.log(`  needs attention (${problems.length}):`);
		for (const p of problems) console.log(`    - ${p}`);
	}
}

main().catch((error) => {
	console.error(`\nMatch failed: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
