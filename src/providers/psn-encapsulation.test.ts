/**
 * PSN auth-encapsulation guard (Story 4.1, AR-5/AD-5: "the auth mechanism
 * lives entirely inside the adapter"). Scans every non-test source under
 * `src/` and `web/` and asserts the PSN wire mechanics appear ONLY in
 * `src/providers/psn.ts` — so a future NPSSO swap stays a one-file change and
 * no route/service/UI ever hand-rolls a PSN call. The cookie NAME is also
 * allowed in the Settings panel, whose user-facing refresh instructions must
 * tell the user which cookie to copy — copy, not mechanics.
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
		// The NAME may appear where the user is told what to copy (panel
		// instructions) and where the paste is sanitized (settings route's
		// leading-`pdccws_p=` strip) — copy and input hygiene, not mechanics.
		label: 'the pdccws_p session cookie',
		pattern: /pdccws_p/,
		allowed: [
			PROVIDER,
			'web/settings/SettingsPanel.tsx',
			'src/routes/settings.ts',
		],
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
