import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The orphan-test guard (Epic 7 retro, action item 2): every `*.test.*` file
 * on disk must be matched by SOME vitest project's include glob, or it runs
 * nowhere and its green is a lie. `web/shelf/filters.test.ts` sat outside the
 * old `web/**\/*.test.tsx` include from Epic 3 until 2026-07-15 — dead weight
 * that read as coverage.
 *
 * ponytail: the accepted roots mirror vitest.config.ts by hand — importing the
 * config and evaluating its globs needs a matcher dependency for less drift
 * than this comment can prevent. Change the config's includes → change this
 * list, the failure message says so.
 */

const REPO_ROOT = join(__dirname, '..');
const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.wrangler',
	'.bmad-loop',
	'dist',
	'playwright-report',
	'test-results',
]);

function walkTestFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) walkTestFiles(join(dir, entry.name), found);
			continue;
		}
		if (/\.test\.[jt]sx?$/.test(entry.name)) {
			found.push(relative(REPO_ROOT, join(dir, entry.name)).replaceAll('\\', '/'));
		}
	}
	return found;
}

// Mirrors vitest.config.ts projects: src (node), integration (workers), web (jsdom).
function isIncluded(path: string): boolean {
	if (path.startsWith('src/') && path.endsWith('.test.ts')) return true;
	if (path.startsWith('test/integration/') && path.endsWith('.test.ts'))
		return true;
	if (
		path.startsWith('web/') &&
		(path.endsWith('.test.ts') || path.endsWith('.test.tsx'))
	)
		return true;
	return false;
}

describe('orphan tests', () => {
	it('every test file on disk is matched by a vitest project include', () => {
		const orphans = walkTestFiles(REPO_ROOT).filter((f) => !isIncluded(f));
		expect(
			orphans,
			`these test files run in NO vitest project — widen an include in vitest.config.ts (and update isIncluded here): ${orphans.join(', ')}`,
		).toEqual([]);
	});
});
