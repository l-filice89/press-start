import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { createAuth, isAllowedEmail } from '../services/auth';

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

/**
 * Allowlist gate ahead of better-auth: the library writes a live
 * verification token to D1 *before* it calls `sendMagicLink`, so gating only
 * inside the send callback would let any unauthenticated request grow the
 * `verification` table. Short-circuiting here means non-allowlisted sign-in
 * requests leave no database residue at all, while returning better-auth's
 * exact success shape (no account enumeration).
 */
authRoute.post('/auth/sign-in/magic-link', async (c, next) => {
	const body = await c.req.raw
		.clone()
		.json()
		.catch(() => null);
	const email =
		body && typeof body === 'object' && 'email' in body
			? String((body as { email: unknown }).email)
			: '';
	if (!isAllowedEmail(email, c.env)) {
		return c.json({ status: true }, 200);
	}
	await next();
});

authRoute.on(['GET', 'POST'], '/auth/*', (c) => {
	const auth = createAuth(c.env, { baseURL: new URL(c.req.url).origin });
	return auth.handler(c.req.raw);
});

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
	const auth = createAuth(c.env, { baseURL: new URL(c.req.url).origin });
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
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
