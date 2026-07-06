/**
 * Purity guard for `src/core/` (AD-3: "core/ imports nothing that performs
 * I/O"). Biome's `noRestrictedImports` can catch the *import* violations
 * (drizzle-orm / repositories / providers) but cannot see global `fetch` or
 * D1-binding usage — those aren't imports — so this test scans the raw
 * source of every non-test file under this directory instead.
 *
 * This file itself is excluded from the scan (it ends in `.test.ts`), so the
 * banned-pattern strings below don't trip over themselves.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CORE_DIR = dirname(fileURLToPath(import.meta.url));

const BANNED_PATTERNS: { label: string; pattern: RegExp }[] = [
	{ label: 'an import from drizzle-orm', pattern: /from\s+['"]drizzle-orm/ },
	{
		label: 'an import from a repositories/ module',
		pattern: /from\s+['"][^'"]*\brepositories\//,
	},
	{
		label: 'an import from a providers/ module',
		pattern: /from\s+['"][^'"]*\bproviders\//,
	},
	{ label: 'a global fetch() call', pattern: /(?<![.\w])fetch\s*\(/ },
	{ label: 'a D1Database type reference', pattern: /\bD1Database\b/ },
	{ label: 'a D1 binding read via env.DB', pattern: /\benv\.DB\b/ },
];

function listCoreSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stats = statSync(full);
		if (stats.isDirectory()) {
			files.push(...listCoreSourceFiles(full));
			continue;
		}
		if (
			/\.tsx?$/.test(entry) &&
			!entry.endsWith('.test.ts') &&
			!entry.endsWith('.test.tsx')
		) {
			files.push(full);
		}
	}
	return files;
}

describe('core/ purity guard (AD-3)', () => {
	const files = listCoreSourceFiles(CORE_DIR);

	it('discovers at least one core source file to check', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		const relativePath = relative(CORE_DIR, file);
		for (const { label, pattern } of BANNED_PATTERNS) {
			it(`${relativePath} contains no ${label}`, () => {
				const content = readFileSync(file, 'utf-8');
				expect(content).not.toMatch(pattern);
			});
		}
	}
});
