/**
 * better-auth composition (FR-47): magic-link only — no passwords, no social
 * providers, no roles/sharing/tenancy (AR-13). The instance is created
 * per-request because D1 and secret bindings only exist per-request on
 * Workers; `baseURL` is derived from the incoming request's origin by the
 * caller so dev, preview, and production all work without per-env config.
 * That derivation trusts the Host header — safe here because Cloudflare only
 * routes requests whose Host matches the Worker's own hostname/zone, so a
 * poisoned Host never reaches this code in production.
 *
 * better-auth's Drizzle adapter owns the four auth tables directly
 * (library-owned, like migration metadata); the Drizzle client itself still
 * comes from the one `repositories/` construction point (AD-4).
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import {
	createEmailProvider,
	type EmailProvider,
	MAGIC_LINK_TTL_MINUTES,
} from '../providers/email';
import { createDb } from '../repositories/db';
import * as schema from '../schema';

export interface CreateAuthOptions {
	/** App origin, e.g. `new URL(request.url).origin`. */
	baseURL: string;
	/** Test seam: inject a capturing provider; defaults to env-based selection. */
	emailProvider?: EmailProvider;
}

/**
 * Single-user allowlist (FR-48 "the app is mine today"): only
 * AUTH_ALLOWED_EMAIL may sign in. An unset/empty allowlist means nobody —
 * fail closed. Enforced at the route boundary (before better-auth writes a
 * verification token, see `routes/auth.ts`) and again in `sendMagicLink`
 * as defense-in-depth.
 */
export function isAllowedEmail(email: string, env: Env): boolean {
	return (
		Boolean(env.AUTH_ALLOWED_EMAIL) &&
		email.toLowerCase() === env.AUTH_ALLOWED_EMAIL.toLowerCase()
	);
}

export function createAuth(env: Env, options: CreateAuthOptions) {
	if (!env.BETTER_AUTH_SECRET) {
		// Fail loud (AD-14): without a secret better-auth falls back to a
		// built-in default, making session cookies forgeable. Set it via
		// `wrangler secret put BETTER_AUTH_SECRET` (prod) or `.dev.vars` (dev).
		throw new Error('BETTER_AUTH_SECRET is not set — refusing to serve auth');
	}

	const emailProvider = options.emailProvider ?? createEmailProvider(env);

	return betterAuth({
		baseURL: options.baseURL,
		basePath: '/api/auth',
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [options.baseURL],
		database: drizzleAdapter(createDb(env.DB), {
			provider: 'sqlite',
			schema,
		}),
		telemetry: { enabled: false },
		plugins: [
			magicLink({
				// Explicit so the email copy's "expires in N minutes" can never
				// silently drift from the real TTL on a library-default change.
				expiresIn: MAGIC_LINK_TTL_MINUTES * 60,
				sendMagicLink: async ({ email, url }) => {
					// Defense-in-depth re-check of the route-level gate: even if a
					// non-allowlisted request reached this far, no email leaves.
					if (!isAllowedEmail(email, env)) {
						return;
					}
					await emailProvider.sendMagicLinkEmail({ to: email, url });
				},
			}),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
