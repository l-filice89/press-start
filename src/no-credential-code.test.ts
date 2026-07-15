import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The grep-clean guard (Epic 11, story 11.2) — the epic's core invariant,
 * pinned permanently: Luca's PSN account was locked (2026-07-15) right after
 * credentialed calls, so NO identifier of the deleted credential machinery may
 * ever reappear anywhere under src/, web/, test/ or playwright/. A future
 * import of any of these is one line away from a credentialed fan-out; this
 * test is what makes that line red in CI.
 *
 * The identifiers are assembled from split halves so this file (and the
 * migration hazard test, which seeds the retired setting key the same way)
 * passes its own sweep — `grep -riE` over the scanned dirs' code answers ZERO
 * hits. (Markdown is exempt: COVERAGE.md's history rows name what was removed.
 * migrations/ necessarily spells the keys it deletes; _bmad-output/ is
 * planning history — neither is code a future import can reach.)
 */

const REPO_ROOT = join(__dirname, '..');
const SCAN_DIRS = ['src', 'web', 'test', 'playwright', 'scripts'];
const GUARD_FILE = 'src/no-credential-code.test.ts';

// Every identifier of the deleted PSN credential machinery, in one place.
const CREDENTIALED_IDENTIFIERS = [
	['np', 'sso'].join(''), // the credential token (any casing)
	['fetch', 'PurchasedGames'].join(''),
	['fetch', 'TrophyTitles'].join(''),
	['get', 'Bearer'].join(''),
	['AUTHORIZE', '_URL'].join(''),
	['TOKEN', '_URL'].join(''),
	['fetch', 'PlatinumEarnedAt'].join(''),
	['Psn', 'AuthError'].join(''),
	['psn', '_auth'].join(''), // the expired-flag setting key
	['sync', '_attention'].join(''), // the sync-era attention setting key
	['ca.account.', 'sony.com'].join(''), // the Sony OAuth host
];
const CREDENTIALED_PATTERN = new RegExp(
	CREDENTIALED_IDENTIFIERS.join('|'),
	'i',
);

// Generated/report/binary dirs — not source, not ours to police.
const SKIP_DIRS = new Set([
	'node_modules',
	'dist',
	'playwright-report',
	'test-results',
]);

function walkFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue; // .auth, .server.log, …
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) walkFiles(full, found);
			continue;
		}
		found.push(full);
	}
	return found;
}

describe('no credentialed PSN code (Epic 11 grep-clean invariant)', () => {
	it('no source, test or e2e file names a deleted credential identifier', () => {
		const offenders: string[] = [];
		for (const dir of SCAN_DIRS) {
			for (const file of walkFiles(join(REPO_ROOT, dir))) {
				const path = relative(REPO_ROOT, file).replaceAll('\\', '/');
				if (path === GUARD_FILE || path.endsWith('.md')) continue;
				const match = readFileSync(file, 'utf-8').match(CREDENTIALED_PATTERN);
				if (match) offenders.push(`${path} (${match[0]})`);
			}
		}
		expect(
			offenders,
			`credentialed PSN identifiers must never come back (Epic 11 — the real account was locked over them). Delete the reference, do not allowlist it: ${offenders.join(', ')}`,
		).toEqual([]);
	});
});
