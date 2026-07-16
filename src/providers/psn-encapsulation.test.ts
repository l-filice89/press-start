/**
 * PSN encapsulation guard (Story 4.1, trimmed to the anonymous catalog surface
 * by Epic 11 story 11.2 — AR-5/AD-5: "the wire mechanics live entirely inside
 * the adapter"). Scans every non-test source under the app dirs and asserts the
 * PSN store-browse mechanics appear ONLY in `src/providers/psn.ts` — and that
 * the DELETED credentialed machinery (the purchased-list query, the trophy
 * host, the Sony OAuth exchange, the legacy session cookie) appears nowhere at
 * all. (The identifier-level sweep — the token name and friends, tests
 * included — lives in `src/no-credential-code.test.ts`.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_DIRS = ['src', 'web', 'worker', 'scripts', 'playwright'];
const PROVIDER = 'src/providers/psn.ts';

const PSN_WIRE_PATTERNS: {
	label: string;
	pattern: RegExp;
	allowed: string[];
}[] = [
	// Story 10.4's discovery probe is allowlisted for the ANONYMOUS surface
	// only: it must call the grid with arbitrary candidate category ids, which
	// the provider deliberately does not expose. Not spent — the 10.4 unblock
	// path (probe artifact: run `--id <uuid>` once Luca supplies the category)
	// still needs it. The credentialed patterns below apply to it unweakened,
	// so the probe can never grow an auth path unnoticed.
	{
		label: 'the PSN API endpoint',
		pattern: /web\.np\.playstation\.com/,
		allowed: [
			PROVIDER,
			'scripts/probe-psn-last-chance.ts',
			'scripts/probe-psn-leaving.ts',
		],
	},
	{
		label: 'the persisted categoryGridRetrieve query (PS+ catalog, 5.1)',
		pattern: /categoryGridRetrieve|4ce7d410a4db2c8b/,
		allowed: [PROVIDER, 'scripts/probe-psn-last-chance.ts'],
	},
	// Everything below was DELETED by Epic 11 (stories 11.1/11.2): the
	// credentialed surface is gone from every source file, the provider included.
	{
		label: 'the deleted PSN trophy API host (credentialed, Epic 11)',
		pattern: /m\.np\.playstation\.com|trophyTitles/,
		allowed: [],
	},
	{
		label: 'the deleted persisted getPurchasedGameList query (Epic 11)',
		pattern: /getPurchasedGameList|827a423f6a8ddca4/,
		allowed: [],
	},
	{
		label: 'the deleted Sony OAuth exchange host (Epic 11)',
		pattern: /ca\.account\.sony\.com/,
		allowed: [],
	},
	{
		label: 'the deleted OAuth client credentials of the exchange (Epic 11)',
		pattern: /09515159-7237-4370-9b40-3806e67c0891|com\.scee\.psxandroid/,
		allowed: [],
	},
	{
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

describe('PSN encapsulation (AR-5)', () => {
	const files = SCAN_DIRS.flatMap((dir) => listSourceFiles(join(ROOT, dir)));

	it('discovers the provider itself among the scanned files', () => {
		expect(
			files.some((f) => relative(ROOT, f).replaceAll('\\', '/') === PROVIDER),
		).toBe(true);
	});

	for (const file of files) {
		const relativePath = relative(ROOT, file).replaceAll('\\', '/');
		for (const { label, pattern, allowed } of PSN_WIRE_PATTERNS) {
			if (allowed.includes(relativePath)) continue;
			it(`${relativePath} does not reference ${label}`, () => {
				expect(readFileSync(file, 'utf-8')).not.toMatch(pattern);
			});
		}
	}
});
