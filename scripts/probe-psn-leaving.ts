/**
 * Story 10.4 probe — verify the PS_PLUS offer `endTime` contract (per-game
 * departure date) and CAPTURE verbatim fixtures for the provider tests.
 * Anonymous surface only: two persisted queries on the public store endpoint,
 * no credential. Distribution rule (SAMPLE-OF-ONE): a leaving game must answer
 * a real epoch-ms endTime; staying games must answer null — probed over several
 * games, never one.
 *
 * Usage: bun scripts/probe-psn-leaving.ts [--local] [--capture <productId>]
 *   --capture writes the raw product + pricing payloads for the given product
 *   to test/fixtures/psn/ (defaults to the first LEAVING game found).
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const API_URL = 'https://web.np.playstation.com/api/graphql/v1/op';
const PRODUCT_OP = 'metGetProductById';
const PRODUCT_HASH =
	'a128042177bd93dd831164103d53b73ef790d56f51dae647064cb8f9d9fc9d1a';
const PRICING_OP = 'metGetPricingDataByConceptId';
const PRICING_HASH =
	'abcb311ea830e679fe2b697a27f755764535d825b24510ab1239a4ca3092bd09';

const useLocal = process.argv.includes('--local');
const capIdx = process.argv.indexOf('--capture');
const captureId = capIdx >= 0 ? process.argv[capIdx + 1] : undefined;

async function opRaw(name: string, hash: string, vars: unknown) {
	const q = new URLSearchParams({
		operationName: name,
		variables: JSON.stringify(vars),
		extensions: JSON.stringify({
			persistedQuery: { version: 1, sha256Hash: hash },
		}),
	});
	const r = await fetch(`${API_URL}?${q}`, {
		headers: {
			accept: 'application/json',
			'content-type': 'application/json',
			'x-psn-store-locale-override': 'it-it',
		},
	});
	if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
	return r.text();
}

function findPsPlusOffers(node: unknown, out: { endTime: unknown }[]) {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const n of node) findPsPlusOffers(n, out);
		return;
	}
	const rec = node as Record<string, unknown>;
	if (
		Array.isArray(rec.serviceBranding) &&
		rec.serviceBranding.includes('PS_PLUS') &&
		'endTime' in rec
	) {
		out.push({ endTime: rec.endTime });
	}
	for (const key of Object.keys(rec)) findPsPlusOffers(rec[key], out);
}

function d1(sql: string): { pid: string; name: string }[] {
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
			`"${sql}"`,
			'--json',
		],
		{ encoding: 'utf8', shell: true },
	);
	if (proc.status !== 0)
		throw new Error(`wrangler d1 execute failed: ${proc.stderr}`);
	const start = proc.stdout.indexOf('[');
	if (start < 0) throw new Error(`no JSON in wrangler output`);
	return JSON.parse(proc.stdout.slice(start))[0].results;
}

// Sample: catalog products matched to FLAGGED tracked games (the sweep's real
// population), capped to keep the probe cheap.
const rows = d1(
	"select c.product_id as pid, c.name as name from ps_plus_catalog c join game g on EXISTS (SELECT 1 FROM ps_plus_catalog c WHERE c.title_normalized = g.title_normalized AND g.title_normalized != '') and g.title_normalized = c.title_normalized limit 10",
);
// An explicit --capture target joins the probe even when it is not among the
// sampled flagged games (e.g. a known-leaving anchor for the fixture).
if (captureId && !rows.some((r) => r.pid === captureId)) {
	rows.push({ pid: captureId, name: `(capture target ${captureId})` });
}
console.log(`Probing ${rows.length} flagged-and-in-catalog games (it-it)\n`);

let leaving = 0;
let staying = 0;
let firstLeaving: string | undefined;
for (const row of rows) {
	const productRaw = await opRaw(PRODUCT_OP, PRODUCT_HASH, {
		productId: row.pid,
	});
	const conceptId = JSON.parse(productRaw)?.data?.productRetrieve?.concept?.id;
	if (!conceptId) {
		console.log(`  ${row.name}: NO CONCEPT — skipped`);
		continue;
	}
	const pricingRaw = await opRaw(PRICING_OP, PRICING_HASH, { conceptId });
	const offers: { endTime: unknown }[] = [];
	findPsPlusOffers(JSON.parse(pricingRaw), offers);
	const end = offers.find((o) => o.endTime != null)?.endTime;
	if (end) {
		leaving++;
		firstLeaving ??= row.pid;
		console.log(
			`  ${row.name}: LEAVING ${new Date(Number(end)).toISOString()} (endTime ${end})`,
		);
	} else {
		staying++;
		console.log(
			`  ${row.name}: staying (${offers.length} PS_PLUS offers, endTime null)`,
		);
	}
	if ((captureId ?? firstLeaving) === row.pid) {
		writeFileSync('test/fixtures/psn/leaving-product.json', productRaw);
		writeFileSync('test/fixtures/psn/leaving-pricing.json', pricingRaw);
		console.log('    captured -> test/fixtures/psn/leaving-*.json');
	}
	await new Promise((r) => setTimeout(r, 400));
}

console.log(
	`\nDistribution: ${leaving} leaving / ${staying} staying — semantics ${staying > 0 ? 'CONFIRMED (null = staying)' : 'UNVERIFIED: every game carries endTime, suspect rotation-window semantics'}`,
);
