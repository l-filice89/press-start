import { Hono } from 'hono';
import { z } from 'zod';

/**
 * Test-only SQL hook for the Playwright tier (Epic 2.5). Seeding through a
 * separate `wrangler d1 execute` process races the running Worker for the
 * local SQLite file (SQLITE_BUSY → intermittent 500s under parallel
 * workers); routing test writes through the Worker serializes all D1 access.
 *
 * Two independent gates (defense in depth — this executes arbitrary SQL):
 * 1. `E2E_TEST_HOOKS === '1'`, set ONLY in wrangler.jsonc's local `env.e2e`
 *    vars — the deployed Worker never defines it.
 * 2. The request Host must be loopback — even a misconfigured deployment or
 *    a `vite --host`-exposed dev server refuses non-local callers.
 * The refusal mirrors the API catch-all 404 body, so the route is not
 * fingerprintable from outside.
 */

const sqlRequestSchema = z.object({
	statements: z.array(z.string()).min(1).max(200),
});

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export const e2eRoute = new Hono<{ Bindings: Env }>();

e2eRoute.post('/e2e/sql', async (c) => {
	const enabled =
		(c.env as { E2E_TEST_HOOKS?: string }).E2E_TEST_HOOKS === '1' &&
		LOOPBACK.has(new URL(c.req.url).hostname);
	if (!enabled) {
		return c.json({ error: 'not found' }, 404);
	}
	const parsed = sqlRequestSchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		return c.json({ error: parsed.error.message }, 400);
	}
	// batch() is atomic: a failing statement rolls the whole seed back, so a
	// mid-batch SQL error can't leave half-seeded rows in the shared DB.
	const outcomes = await c.env.DB.batch(
		parsed.data.statements.map((sql) => c.env.DB.prepare(sql)),
	);
	return c.json({ results: outcomes.map((o) => o.results ?? []) });
});
