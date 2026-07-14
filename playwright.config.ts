import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e tier (Epic 2.5 TR-1): real browser against the real app —
 * vite dev + Worker + local D1 (isolated `e2e` wrangler environment). The
 * server is spawned by global-setup (not `webServer`) because auth needs to
 * read the magic link from the server's stdout (console email provider).
 * Tests start pre-authenticated via the saved storage state.
 */
export default defineConfig({
	testDir: './playwright/e2e',
	globalSetup: './playwright/support/global-setup',
	globalTeardown: './playwright/support/global-teardown',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	// Playwright's default (half the cores) put TEN chromium workers against one
	// vite + workerd + local D1 on a dev laptop, and the suite wobbled: a random
	// unrelated test timed out on roughly every other full run, each passing on
	// its own (DW-9's "machine contention" wobble, measured again in Story 9.5 —
	// 12 full runs). That is over-subscription, not flaky assertions. Four keeps
	// the parallelism that catches real cross-test races (Story 9.5 found one:
	// epic6's PS+ cancel wiping epic4's claim) without starving the one server
	// they all share. CI has its own runner and keeps `retries: 2`.
	workers: process.env.CI ? undefined : 4,
	timeout: 60_000,
	// Mutations are refetch-driven (no optimistic updates): under parallel
	// load a PATCH + shelf refetch can outlive the 5s default expect window.
	expect: { timeout: 10_000 },
	reporter: process.env.CI
		? [
				['list'],
				['html', { open: 'never' }],
				['junit', { outputFile: 'test-results/junit.xml' }],
			]
		: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: process.env.BASE_URL ?? 'http://localhost:5175',
		storageState: 'playwright/.auth/user.json',
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},
	projects: [
		// ponytail: chromium only — single-user personal app; add firefox/webkit if cross-browser bugs ever show up
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
	],
});
