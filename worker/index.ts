import { Hono } from 'hono';
import { deleteExpiredVerifications } from '../src/repositories';
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
/** The daily scores trigger (wrangler.jsonc). The other trigger is the monthly
 * PS+ window; routing by `controller.cron` keeps the two workloads in separate
 * invocations, each with the 50-subrequest budget to itself. */
const SCORES_CRON = '0 3 * * *';

export default {
	fetch: app.fetch,
	async scheduled(controller, env: Env, _ctx) {
		const db = createDb(env.DB);
		// Story 8.2 (AD-29), re-gated by review: the verification TTL sweep runs
		// on EVERY invocation — the old spentFanOut gating made it unreachable
		// exactly when needed most (zero users → spentFanOut is false forever;
		// steady state → sweeps are rare). One D1 call.
		await deleteExpiredVerifications(db, new Date()).catch((error) =>
			console.error('verification TTL sweep failed', error),
		);
		if (controller.cron === SCORES_CRON) {
			// IGDB score refresh on its OWN daily cron (deferred-work 2026-07-19,
			// was: piggybacked on the PS+ window, so a failure on the window's last
			// day left the FR-40 banner lit ~3 weeks). Stale-gated inside (~weekly
			// run; a failure retries the next day). Isolated (follow-up review): its
			// pre-try user lookup can throw past its own catch, and an unhandled
			// throw errors the cron.
			await runScheduledScoreRefresh(db, igdbFromEnv(env)).catch((error) =>
				console.error(
					'scheduled score refresh escaped its own handling',
					error,
				),
			);
			return;
		}
		// Isolated (review): runScheduledPsPlusCheck catches its own body, but a
		// throw from its pre-try user lookup (or a flag write inside its catch)
		// would otherwise abort the invocation.
		await runScheduledPsPlusCheck(db, env).catch((error) =>
			console.error('scheduled ps+ check escaped its own handling', error),
		);
	},
} satisfies ExportedHandler<Env>;
