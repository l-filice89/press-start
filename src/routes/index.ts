import { Hono } from 'hono';
import { authRoute, meRoute } from './auth';
import { healthRoute } from './health';
import { shelfRoute } from './shelf';

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
