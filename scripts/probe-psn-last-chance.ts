/**
 * Story 10.4 probe — discover the "Last Chance to Play" store category id for
 * the configured region and verify it answers a plausible grid, BEFORE anything
 * is built (spec gate: no category for the region blocks the story). Anonymous
 * surface only: the same public categoryGridRetrieve endpoint the catalog sync
 * uses — no credential of any kind.
 *
 * Discovery: scan store web pages for category links whose nearby text matches
 * the last-chance label (English + Italian), then probe each candidate uuid
 * against the persisted grid query. The confirmed candidate's raw first page is
 * captured verbatim to test/fixtures/psn/last-chance-page.json.
 *
 * Usage: bun scripts/probe-psn-last-chance.ts [--local] [--id <uuid>]
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const API_URL = 'https://web.np.playstation.com/api/graphql/v1/op';
const CATALOG_QUERY_HASH =
	'4ce7d410a4db2c8b635a48c1dcec375906ff63b19dadd87e073f8fd0c0481d35';
const PS_PLUS_CATALOG_CATEGORY = '3a7006fe-e26f-49fe-87e5-4473d7ed0fb2';
const LABEL_PATTERN = /last[\s-]?chance|ultima occasione/i;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const useLocal = process.argv.includes('--local');
const idFlag = process.argv.indexOf('--id');
const forcedId = idFlag >= 0 ? process.argv[idFlag + 1] : undefined;

function configuredRegion(): string {
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
			'"select value from setting where key = \'psn_region\' limit 1"',
			'--json',
		],
		{ encoding: 'utf8', shell: true },
	);
	if (proc.status === 0) {
		const start = proc.stdout.indexOf('[');
		if (start >= 0) {
			try {
				const value = JSON.parse(proc.stdout.slice(start))?.[0]?.results?.[0]
					?.value;
				if (typeof value === 'string' && /^[a-z]{2}-[a-z]{2}$/.test(value))
					return value;
			} catch {
				// fall through to default
			}
		}
	}
	console.log('No psn_region setting readable — defaulting to it-it');
	return 'it-it';
}

/** Category uuids whose surrounding page text names the last-chance label. */
async function discoverCandidates(region: string): Promise<Map<string, string>> {
	const pages = [
		`https://store.playstation.com/${region}/category/${PS_PLUS_CATALOG_CATEGORY}/1`,
		`https://store.playstation.com/${region}/pages/subscriptions`,
		`https://www.playstation.com/${region}/ps-plus/games/`,
	];
	const candidates = new Map<string, string>();
	for (const url of pages) {
		let html: string;
		try {
			const res = await fetch(url, {
				headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0' },
			});
			if (!res.ok) {
				console.log(`  discovery page ${url} -> HTTP ${res.status}, skipped`);
				continue;
			}
			html = await res.text();
		} catch (error) {
			console.log(`  discovery page ${url} -> ${error}`);
			continue;
		}
		for (const match of html.matchAll(UUID_PATTERN)) {
			const uuid = match[0].toLowerCase();
			if (uuid === PS_PLUS_CATALOG_CATEGORY) continue;
			const window = html.slice(
				Math.max(0, (match.index ?? 0) - 300),
				(match.index ?? 0) + 300,
			);
			if (LABEL_PATTERN.test(window)) {
				const label =
					window.match(/[^"<>{}]{0,60}(last[\s-]?chance|ultima occasione)[^"<>{}]{0,60}/i)?.[0] ??
					'(label context unavailable)';
				if (!candidates.has(uuid)) candidates.set(uuid, label.trim());
			}
		}
		console.log(`  scanned ${url} (${html.length} bytes)`);
	}
	return candidates;
}

async function probeGrid(
	region: string,
	categoryId: string,
): Promise<{ raw: string; totalCount: number; names: string[] } | null> {
	const variables = {
		id: categoryId,
		pageArgs: { size: 100, offset: 0 },
		sortBy: { name: 'productReleaseDate', isAscending: false },
		filterBy: [],
		facetOptions: [],
	};
	const query = new URLSearchParams({
		operationName: 'categoryGridRetrieve',
		variables: JSON.stringify(variables),
		extensions: JSON.stringify({
			persistedQuery: { version: 1, sha256Hash: CATALOG_QUERY_HASH },
		}),
	});
	const res = await fetch(`${API_URL}?${query}`, {
		headers: {
			accept: 'application/json',
			'content-type': 'application/json',
			'x-psn-store-locale-override': region,
		},
	});
	const raw = await res.text();
	if (!res.ok) {
		console.log(`  ${categoryId} -> HTTP ${res.status}`);
		return null;
	}
	let payload: {
		errors?: unknown;
		data?: {
			categoryGridRetrieve?: {
				products?: { name?: string }[];
				pageInfo?: { totalCount?: number };
			};
		};
	};
	try {
		payload = JSON.parse(raw);
	} catch {
		console.log(`  ${categoryId} -> non-JSON 200`);
		return null;
	}
	if (payload.errors) {
		console.log(
			`  ${categoryId} -> GraphQL errors: ${JSON.stringify(payload.errors).slice(0, 200)}`,
		);
		return null;
	}
	const page = payload.data?.categoryGridRetrieve;
	if (!page || !Array.isArray(page.products) || !page.pageInfo) {
		console.log(`  ${categoryId} -> malformed page`);
		return null;
	}
	return {
		raw,
		totalCount: page.pageInfo.totalCount ?? page.products.length,
		names: page.products
			.map((p) => p.name)
			.filter((n): n is string => typeof n === 'string')
			.slice(0, 10),
	};
}

const region = configuredRegion();
console.log(`Region: ${region}\n`);

let candidates: Map<string, string>;
if (forcedId) {
	candidates = new Map([[forcedId.toLowerCase(), '(forced via --id)']]);
} else {
	console.log('Discovering candidate category ids…');
	candidates = await discoverCandidates(region);
}
console.log(`\nCandidates: ${candidates.size}`);
for (const [uuid, label] of candidates) console.log(`  ${uuid} — "${label}"`);

let confirmed: { id: string; totalCount: number; names: string[] } | null =
	null;
for (const [uuid] of candidates) {
	console.log(`\nProbing grid for ${uuid}…`);
	const grid = await probeGrid(region, uuid);
	if (!grid) continue;
	console.log(`  totalCount: ${grid.totalCount}`);
	console.log(`  first titles: ${grid.names.join(' | ')}`);
	// Plausibility: a leaving-soon shelf is small — a three-digit-hundreds count
	// means we hit a full-catalog-sized category, not the last-chance shelf.
	const plausible = grid.totalCount >= 1 && grid.totalCount <= 300;
	console.log(`  plausible last-chance size (1..300): ${plausible ? 'yes' : 'NO'}`);
	if (plausible && !confirmed) {
		confirmed = { id: uuid, totalCount: grid.totalCount, names: grid.names };
		writeFileSync('test/fixtures/psn/last-chance-page.json', grid.raw);
		console.log('  captured first page -> test/fixtures/psn/last-chance-page.json');
	}
}

console.log(
	`\nGATE (category exists + plausible grid for ${region}): ${confirmed ? `PASS — ${confirmed.id} (${confirmed.totalCount} products)` : 'FAIL'}`,
);
