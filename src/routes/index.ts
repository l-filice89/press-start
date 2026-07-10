import { Hono } from 'hono';
import { authRoute, meRoute } from './auth';
import { e2eRoute } from './e2e';
import { genresRoute } from './genres';
import { healthRoute } from './health';
import { settingsRoute } from './settings';
import { shelfRoute } from './shelf';
import { trackingRoute } from './tracking';

/**
 * Aggregates every Hono route module under `/api/*`. The Worker composition
 * root (`worker/index.ts`) mounts this ahead of the static-asset/SPA
 * fallback, so `/api/*` always resolves to JSON, never `index.html`.
 */
export const apiRoutes = new Hono<{ Bindings: Env }>();

apiRoutes.route('/', healthRoute);
apiRoutes.route('/', authRoute);
apiRoutes.route('/', meRoute);
apiRoutes.route('/', shelfRoute);
apiRoutes.route('/', trackingRoute);
apiRoutes.route('/', genresRoute);
apiRoutes.route('/', settingsRoute);
apiRoutes.route('/', e2eRoute); // 404s unless E2E_TEST_HOOKS=1 (local e2e env only)
