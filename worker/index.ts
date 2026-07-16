import { Hono } from 'hono';
import { createDb } from '../src/repositories/db';
import { apiRoutes } from '../src/routes';
import { igdbFromEnv } from '../src/routes/games';
import { runScheduledPsPlusCheck } from '../src/services/psplus';
import { runScheduledScoreRefresh } from '../src/services/scores';

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
		const db = createDb(env.DB);
		// Isolated (review): runScheduledPsPlusCheck catches its own body, but a
		// throw from its pre-try user lookup (or a flag write inside its catch)
		// would otherwise abort the invocation and starve the score refresh below.
		await runScheduledPsPlusCheck(db, env).catch((error) =>
			console.error('scheduled ps+ check escaped its own handling', error),
		);
		// Story 10.1: IGDB score refresh rides the SAME cron — sequential, after
		// the PS+ work, inside one invocation's budget (Epic 9 rule, arithmetic
		// in services/scores.ts: PS+ membership pass ≤34 + scores/TTB ≤10 ≈ 44 of 50,
		// and the scores stale-gate fires it once per monthly window). Its
		// failures persist their own FR-40 flag inside, so a throw here never
		// masks the PS+ outcome above.
		await runScheduledScoreRefresh(db, env, igdbFromEnv(env));
	},
} satisfies ExportedHandler<Env>;
