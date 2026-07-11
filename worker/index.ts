import { Hono } from 'hono';
import { createDb } from '../src/repositories/db';
import { apiRoutes } from '../src/routes';
import { runScheduledPsPlusCheck } from '../src/services/psplus';

/**
 * The Worker is the composition root (AD-1): one deploy serves both the
 * React SPA (Workers Static Assets) and the Hono JSON API.
 *
 * `/api/*` is mounted ahead of the static-asset fallback, so it always
 * resolves to JSON — never `index.html`. Everything else falls through to
 * `env.ASSETS.fetch()`, which serves the built SPA and, per
 * `wrangler.jsonc`'s `assets.not_found_handling: "single-page-application"`,
 * serves `index.html` for any deep client route that isn't a real asset file.
 */
const app = new Hono<{ Bindings: Env }>();

app.route('/api', apiRoutes);

// `app.route()` only merges apiRoutes' own registered paths into this
// router — an unmatched path under /api/* (wrong method, unknown route)
// does NOT fall through to apiRoutes' own notFound handler, it falls
// through to the next handler registered here. Without this catch-all,
// that would be the ASSETS fallback below, silently returning index.html
// (or throwing, since ASSETS isn't bound in the test environment) for a
// request that should always resolve to JSON.
app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

/**
 * `{ fetch, scheduled }` — `fetch` is the Hono app unchanged; `scheduled` is
 * the Story 5.2 monthly PS+ Extra refresh. The cron work is awaited (not
 * `waitUntil`-detached) so a failure is caught and persisted as the
 * failed-refresh flag rather than lost.
 */
export default {
	fetch: app.fetch,
	async scheduled(_controller, env: Env, _ctx) {
		await runScheduledPsPlusCheck(createDb(env.DB), env);
	},
} satisfies ExportedHandler<Env>;
