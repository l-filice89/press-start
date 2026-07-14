import {
	cloudflareTest,
	readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * D1 migrations are read here (Node.js context, at config time) and handed
 * to the "workers" project's tests via `provide`/`inject`, so integration
 * tests can apply them to the in-test D1 binding with `applyD1Migrations()`
 * from `cloudflare:test` (see `test/integration/health.test.ts`). This keeps
 * the test D1 schema-current with `migrations/` without ever migrating at
 * Worker startup (AD-16).
 */
const migrations = await readD1Migrations('./migrations');

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'unit',
					environment: 'node',
					// All pure-Node unit tests under src/ (core, providers, ...);
					// Worker-runtime integration tests live under test/integration.
					include: ['src/**/*.test.ts'],
				},
			},
			{
				plugins: [
					cloudflareTest({
						wrangler: { configPath: './wrangler.jsonc' },
						miniflare: {
							// `vitest-pool-workers` loads `.dev.vars` as bindings, so a
							// local run would otherwise inherit a real RESEND_API_KEY and
							// email real magic links (Epic 2 retro, action item 4).
							// Forcing it empty makes the console email provider win in
							// every test run; BETTER_AUTH_SECRET is test-only likewise.
							bindings: {
								BETTER_AUTH_SECRET:
									'vitest-only-better-auth-secret-0123456789abcdef',
								RESEND_API_KEY: '',
								// Same isolation for IGDB (Story 6.1): tests must never
								// reach the live API — the preview route degrades instead.
								IGDB_CLIENT_ID: '',
								IGDB_ACCESS_TOKEN: '',
								// And for PSN (Story 9.1b): a developer's real NPSSO seed in
								// `.dev.vars` must not leak in — the settings suite asserts
								// the no-credential baseline, and no test may reach PSN.
								PSN_NPSSO: '',
							},
						},
					}),
				],
				test: {
					name: 'workers',
					include: ['test/integration/**/*.test.ts'],
					provide: { migrations },
				},
			},
			{
				// The React SPA (web/) has no Worker/D1 dependency — it renders in a
				// DOM, so it gets its own jsdom project with @testing-library. This
				// is the pattern all later UI stories (cards, filters, detail) reuse.
				plugins: [react()],
				test: {
					name: 'web',
					environment: 'jsdom',
					include: ['web/**/*.test.tsx'],
					setupFiles: ['./web/test-setup.ts'],
				},
			},
		],
	},
});
