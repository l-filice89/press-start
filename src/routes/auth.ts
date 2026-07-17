import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { createAuth } from '../services/auth';

/**
 * Auth boundary (FR-47/FR-48). Two exports:
 *
 * - `authRoute` hands `/api/auth/*` to better-auth's own handler (sign-in
 *   request, magic-link verify, session, sign-out, ...).
 * - `requireAuth` is THE user seam (AD-13): every protected route uses it —
 *   no route reads the session ad hoc — and it exposes the session's user as
 *   typed context vars. Story 1.4's repositories take their `user_id` filter
 *   from these vars, which is what makes "every tracking row carries and
 *   filters by user_id" structural rather than per-route discipline.
 */

export type AuthVariables = {
	userId: string;
	userEmail: string;
};

type AuthEnv = { Bindings: Env; Variables: AuthVariables };

export const authRoute = new Hono<{ Bindings: Env }>();

// Registration is open (AD-29): no pre-gate — any email may request a magic
// link, and following it proves control of the address. The `verification`
// rows unauthenticated requests write are bounded by the WAF rate limit on
// /api/auth/* (edge rule, deploy note) and swept by the cron once expired.
authRoute.on(['GET', 'POST'], '/auth/*', (c) => {
	const auth = createAuth(c.env, { baseURL: new URL(c.req.url).origin });
	return auth.handler(c.req.raw);
});

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
	const auth = createAuth(c.env, { baseURL: new URL(c.req.url).origin });
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	// A valid session alone gates (AD-29, open registration — no allowlist to
	// re-check). There is no ban/de-admission tooling (AD-29): the only
	// revocation paths are sign-out and manual session-row deletion, and either
	// takes effect within the ≤5-min cookieCache TTL (AD-33 §6).
	if (!session) {
		return c.json({ error: 'unauthorized' }, 401);
	}
	c.set('userId', session.user.id);
	c.set('userEmail', session.user.email);
	await next();
});

/**
 * Zod response schema for GET /api/me (AR-26: Zod at every boundary). The
 * route proves the requireAuth seam end-to-end: 401 without a session, the
 * session's own user id with one.
 */
const meResponseSchema = z.object({
	id: z.string(),
	email: z.string(),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

export const meRoute = new Hono<AuthEnv>();

meRoute.get('/me', requireAuth, (c) => {
	const body = meResponseSchema.parse({
		id: c.get('userId'),
		email: c.get('userEmail'),
	} satisfies MeResponse);
	return c.json(body, 200);
});
