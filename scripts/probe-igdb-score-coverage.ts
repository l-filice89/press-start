/**
 * Story 10.1 coverage probe — measures how many of the library's real
 * IGDB-linked titles carry critic (`aggregated_rating`) and user (`rating`)
 * scores, BEFORE any score column is built (spec gate: <60% either-score
 * coverage blocks the story on the OpenCritic decision).
 *
 * Out-of-band bun script (never deployed). Reads Twitch credentials from
 * .dev.vars, pulls the id list from the REMOTE (production) D1 via wrangler
 * (read-only SELECT), and asks IGDB for the four score fields by id — the
 * exact query shape the refresh job will use.
 *
 * Usage: bun scripts/probe-igdb-score-coverage.ts [--local]
 */

const useLocal = process.argv.includes('--local');

function devVar(name: string): string {
	const text = require('node:fs').readFileSync('.dev.vars', 'utf8') as string;
	const line = text.split(/\r?\n/).find((l: string) => l.startsWith(`${name}=`));
	const value = line?.slice(name.length + 1).trim().replace(/^"|"$/g, '');
	if (!value) throw new Error(`${name} missing from .dev.vars`);
	return value;
}

async function d1Ids(): Promise<{ id: string; title: string }[]> {
	const { spawnSync } = require('node:child_process') as
		typeof import('node:child_process');
	const proc = spawnSync(
		'bunx',
		[
			'wrangler',
			'd1',
			'execute',
			'DB',
			useLocal ? '--local' : '--remote',
			'--command',
			// shell:true (bunx is a .cmd on Windows) re-splits args on spaces —
			// wrap the SQL in literal double quotes so it survives as one arg.
			'"select el.external_id as id, g.title as title from external_link el join game g on g.id = el.game_id where el.source = \'IGDB\'"',
			'--json',
		],
		{ encoding: 'utf8', shell: true },
	);
	if (proc.status !== 0) {
		throw new Error(`wrangler d1 execute failed: ${proc.stderr}`);
	}
	// wrangler prefixes the JSON with log lines; take from the first '['.
	const out = proc.stdout;
	const start = out.indexOf('[');
	if (start < 0) {
		throw new Error(`no JSON in wrangler d1 output: ${out.slice(0, 200)}`);
	}
	return JSON.parse(out.slice(start))[0].results;
}

interface ScoreRow {
	id: number;
	name?: string;
	aggregated_rating?: number;
	aggregated_rating_count?: number;
	rating?: number;
	rating_count?: number;
}

async function fetchScores(ids: string[]): Promise<ScoreRow[]> {
	const clientId = devVar('IGDB_CLIENT_ID');
	const clientSecret = devVar('IGDB_CLIENT_SECRET');
	// Secret in the POST body, not the URL (query strings land in proxy logs).
	const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'client_credentials',
		}).toString(),
	});
	if (!tokenRes.ok) throw new Error(`Twitch token: HTTP ${tokenRes.status}`);
	const { access_token } = (await tokenRes.json()) as { access_token: string };

	const rows: ScoreRow[] = [];
	// IGDB max limit is 500; chunk defensively.
	for (let i = 0; i < ids.length; i += 500) {
		const chunk = ids.slice(i, i + 500);
		const res = await fetch('https://api.igdb.com/v4/games', {
			method: 'POST',
			headers: {
				'Client-ID': clientId,
				Authorization: `Bearer ${access_token}`,
				Accept: 'application/json',
			},
			body: `fields id, name, aggregated_rating, aggregated_rating_count, rating, rating_count; where id = (${chunk.join(',')}); limit 500;`,
		});
		if (!res.ok) throw new Error(`IGDB: HTTP ${res.status} ${await res.text()}`);
		const parsed = await res.json();
		if (!Array.isArray(parsed)) throw new Error(`IGDB non-array 200: ${JSON.stringify(parsed).slice(0, 200)}`);
		rows.push(...(parsed as ScoreRow[]));
		if (i + 500 < ids.length) await new Promise((r) => setTimeout(r, 300));
	}
	return rows;
}

const linked = await d1Ids();
console.log(`IGDB-linked games in ${useLocal ? 'local' : 'production'} D1: ${linked.length}`);
if (linked.length === 0) {
	console.log('No IGDB-linked games — nothing to measure.');
	process.exit(0);
}
// Only numeric ids can be interpolated into the apicalypse where-clause.
const rows = await fetchScores(
	linked.map((l) => l.id).filter((id) => /^\d+$/.test(id)),
);
const byId = new Map(rows.map((r) => [String(r.id), r]));

let critic = 0;
let user = 0;
let either = 0;
const missing: string[] = [];
for (const l of linked) {
	const r = byId.get(l.id);
	const hasCritic = typeof r?.aggregated_rating === 'number';
	const hasUser = typeof r?.rating === 'number';
	if (hasCritic) critic++;
	if (hasUser) user++;
	if (hasCritic || hasUser) either++;
	else missing.push(`${l.title} (igdb ${l.id}${r ? '' : ' — NOT IN RESPONSE'})`);
}

const pct = (n: number) => `${((n / linked.length) * 100).toFixed(1)}%`;
console.log(`critic score:  ${critic}/${linked.length} (${pct(critic)})`);
console.log(`user score:    ${user}/${linked.length} (${pct(user)})`);
console.log(`either score:  ${either}/${linked.length} (${pct(either)})`);
console.log(`returned rows: ${rows.length}/${linked.length}`);
console.log('\nGames with NO score:');
for (const m of missing) console.log(`  - ${m}`);
console.log(`\nGATE (>=60% either): ${either / linked.length >= 0.6 ? 'PASS' : 'FAIL'}`);
