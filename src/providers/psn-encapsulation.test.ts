/**
 * PSN auth-encapsulation guard (Story 4.1, re-pointed at the NPSSO bearer in
 * 9.1b — AR-5/AD-5: "the auth mechanism lives entirely inside the adapter").
 * Scans every non-test source under `src/` and `web/` and asserts the PSN wire
 * mechanics — including the ca.account.sony.com authorize/token exchange —
 * appear ONLY in `src/providers/psn.ts`, so no route/service/UI ever hand-rolls
 * a PSN call or a second credential exchange. The token NAME is also allowed in
 * the Settings panel, whose user-facing instructions must tell the user which
 * value to copy, and in the settings route, which strips a pasted `npsso=`
 * prefix — copy and input hygiene, not mechanics.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_DIRS = ['src', 'web', 'worker', 'scripts', 'playwright'];
const PROVIDER = 'src/providers/psn.ts';

const PSN_AUTH_PATTERNS: {
	label: string;
	pattern: RegExp;
	allowed: string[];
}[] = [
	{
		label: 'the PSN API endpoint',
		pattern: /web\.np\.playstation\.com/,
		allowed: [PROVIDER],
	},
	{
		// Story 9.2: the trophy list rides a SECOND PSN host (m.np.playstation.com,
		// not the GraphQL one) — the seam has to hold there too, or a service could
		// hand-roll a trophy call with its own bearer.
		label: 'the PSN trophy API host',
		pattern: /m\.np\.playstation\.com|trophyTitles/,
		allowed: [PROVIDER],
	},
	{
		label: 'the persisted getPurchasedGameList query',
		pattern: /getPurchasedGameList/,
		allowed: [PROVIDER],
	},
	{
		label: 'the pinned persisted-query hash',
		pattern: /827a423f6a8ddca4/,
		allowed: [PROVIDER],
	},
	{
		label: 'the persisted categoryGridRetrieve query (PS+ catalog, 5.1)',
		pattern: /categoryGridRetrieve|4ce7d410a4db2c8b/,
		allowed: [PROVIDER],
	},
	{
		label: 'the NPSSO authorize/token exchange host',
		pattern: /ca\.account\.sony\.com\/api\/authz/,
		allowed: [PROVIDER],
	},
	{
		label: 'the OAuth client credentials of the exchange',
		pattern: /09515159-7237-4370-9b40-3806e67c0891|com\.scee\.psxandroid/,
		allowed: [PROVIDER],
	},
	{
		// The wire form is allowed only where the paste is sanitized (the settings
		// route strips a leading `npsso=`) — input hygiene, not mechanics. The
		// Settings panel names the token in prose but never spells the pair, and
		// must not start: if the UI ever hand-rolls the wire form, this bites.
		//
		// The pattern is the WIRE form (`npsso=` — the cookie pair the exchange
		// sends), not the identifier: `getPsnNpsso`/`psn_npsso` are the seam's
		// public names and are supposed to travel.
		label: 'the npsso cookie pair',
		pattern: /npsso=/,
		allowed: [PROVIDER, 'src/routes/settings.ts'],
	},
	{
		// Gone from every .ts/.tsx source — which is all this scan covers. The
		// name still legitimately appears in the frozen legacy `export_ps_catalog.py`
		// and in the README's legacy-scripts line; neither is a live code path.
		label: 'the deleted pdccws_p session cookie (the cookie path is gone)',
		pattern: /pdccws_p/,
		allowed: [],
	},
];

function listSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			files.push(...listSourceFiles(full));
			continue;
		}
		if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
			files.push(full);
		}
	}
	return files;
}

describe('PSN auth encapsulation (AR-5)', () => {
	const files = SCAN_DIRS.flatMap((dir) => listSourceFiles(join(ROOT, dir)));

	it('discovers the provider itself among the scanned files', () => {
		expect(
			files.some((f) => relative(ROOT, f).replaceAll('\\', '/') === PROVIDER),
		).toBe(true);
	});

	for (const file of files) {
		const relativePath = relative(ROOT, file).replaceAll('\\', '/');
		for (const { label, pattern, allowed } of PSN_AUTH_PATTERNS) {
			if (allowed.includes(relativePath)) continue;
			it(`${relativePath} does not reference ${label}`, () => {
				expect(readFileSync(file, 'utf-8')).not.toMatch(pattern);
			});
		}
	}
});
