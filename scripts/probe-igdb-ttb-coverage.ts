/**
 * Story 10.3 coverage probe — how many of the library's IGDB-linked titles
 * carry `/game_time_to_beats` values (`normally` = story, `completely` = 100%,
 * `count` = submissions), BEFORE anything is built (spec gate: <50% `normally`
 * blocks the story on the HLTB decision). Sibling of
 * probe-igdb-score-coverage.ts; result recorded next to the 10.1 finding.
 *
 * Usage: bun scripts/probe-igdb-ttb-coverage.ts [--local]
 */

const useLocal = process.argv.includes('--local');

function devVar(name: string): string {
	const text = require('node:fs').readFileSync('.dev.vars', 'utf8') as string;
	const line = text.split(/\r?\n/).find((l: string) => l.startsWith(`${name}=`));
	const value = line
		?.slice(name.length + 1)
		.trim()
		.replace(/^"|"$/g, '');
	if (!value) throw new Error(`${name} missing from .dev.vars`);
	return value;
}

async function d1Ids(): Promise<{ id: string; title: string }[]> {
	const { spawnSync } =
		require('node:child_process') as typeof import('node:child_process');
	const proc = spawnSync(
		'bunx',
		[
			'wrangler',
			'd1',
			'execute',
			'DB',
			useLocal ? '--local' : '--remote',
			'--command',
			// shell:true re-splits on spaces — keep the SQL one quoted arg.
			'"select el.external_id as id, g.title as title from external_link el join game g on g.id = el.game_id where el.source = \'IGDB\'"',
			'--json',
		],
		{ encoding: 'utf8', shell: true },
	);
	if (proc.status !== 0) {
		throw new Error(`wrangler d1 execute failed: ${proc.stderr}`);
	}
	const out = proc.stdout;
	const start = out.indexOf('[');
	if (start < 0) {
		throw new Error(`no JSON in wrangler d1 output: ${out.slice(0, 200)}`);
	}
	const parsed = JSON.parse(out.slice(start));
	if (!parsed?.[0]?.results) {
		throw new Error('unexpected wrangler JSON shape (no [0].results)');
	}
	return parsed[0].results;
}

interface TtbRow {
	id: number;
	game_id?: number;
	normally?: number;
	completely?: number;
	count?: number;
}

async function fetchTtb(ids: string[]): Promise<TtbRow[]> {
	const clientId = devVar('IGDB_CLIENT_ID');
	const clientSecret = devVar('IGDB_CLIENT_SECRET');
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

	const rows: TtbRow[] = [];
	for (let i = 0; i < ids.length; i += 500) {
		const chunk = ids.slice(i, i + 500);
		const res = await fetch('https://api.igdb.com/v4/game_time_to_beats', {
			method: 'POST',
			headers: {
				'Client-ID': clientId,
				Authorization: `Bearer ${access_token}`,
				Accept: 'application/json',
			},
			body: `fields game_id, normally, completely, count; where game_id = (${chunk.join(',')}); limit 500;`,
		});
		if (!res.ok) throw new Error(`IGDB: HTTP ${res.status} ${await res.text()}`);
		const parsed = await res.json();
		if (!Array.isArray(parsed))
			throw new Error(
				`IGDB non-array 200: ${JSON.stringify(parsed).slice(0, 200)}`,
			);
		rows.push(...(parsed as TtbRow[]));
		if (i + 500 < ids.length) await new Promise((r) => setTimeout(r, 300));
	}
	return rows;
}

const linked = await d1Ids();
console.log(
	`IGDB-linked games in ${useLocal ? 'local' : 'production'} D1: ${linked.length}`,
);
if (linked.length === 0) {
	console.log('No IGDB-linked games — nothing to measure.');
	process.exit(0);
}
const rows = await fetchTtb(
	linked.map((l) => l.id).filter((id) => /^\d+$/.test(id)),
);
const byGameId = new Map(rows.map((r) => [String(r.game_id), r]));

let story = 0;
let complete = 0;
let either = 0;
const missing: string[] = [];
for (const l of linked) {
	const r = byGameId.get(l.id);
	const hasStory = typeof r?.normally === 'number';
	const hasComplete = typeof r?.completely === 'number';
	if (hasStory) story++;
	if (hasComplete) complete++;
	if (hasStory || hasComplete) either++;
	else missing.push(`${l.title} (igdb ${l.id}${r ? '' : ' — NO TTB RECORD'})`);
}

const pct = (n: number) => `${((n / linked.length) * 100).toFixed(1)}%`;
console.log(`story (normally):      ${story}/${linked.length} (${pct(story)})`);
console.log(
	`100% (completely):     ${complete}/${linked.length} (${pct(complete)})`,
);
console.log(`either value:          ${either}/${linked.length} (${pct(either)})`);
console.log(`TTB records returned:  ${rows.length}`);
console.log('\nGames with NO time-to-beat value:');
for (const m of missing) console.log(`  - ${m}`);
console.log(
	`\nGATE (>=50% story/normally): ${story / linked.length >= 0.5 ? 'PASS' : 'FAIL'}`,
);
// One sample row so the fixture for tests is CAPTURED, not hand-written.
if (rows.length > 0) {
	console.log('\nSample raw row:', JSON.stringify(rows[0]));
}
