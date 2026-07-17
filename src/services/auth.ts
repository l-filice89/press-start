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
import { APIError } from 'better-auth/api';
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

	// Fail loud on a half-applied Google secret (AD-14, the BETTER_AUTH_SECRET
	// rule): silently skipping the provider would leave "Continue with Google"
	// erroring in production with nothing anywhere saying the id or the secret
	// never landed. Neither set = magic link only, which is a valid deployment.
	if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
		throw new Error(
			'Google OAuth is half-configured — set BOTH GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
		);
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
		// Story 8.6 (AD-33 §6): a signed cookie cache skips the per-request D1
		// session read. TTL is capped at 5 minutes — that is the revocation
		// latency bound (a revoked session stays live until the cache expires).
		session: { cookieCache: { enabled: true, maxAge: 300 } },
		// Google (Story 8.1 / B1a) sits ALONGSIDE magic link — neither replaces
		// the other. Registered only when both credentials are present, so dev,
		// e2e and any deploy without them keep working on magic link alone.
		...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
			? {
					socialProviders: {
						google: {
							clientId: env.GOOGLE_CLIENT_ID,
							clientSecret: env.GOOGLE_CLIENT_SECRET,
						},
					},
				}
			: {}),
		// THE allowlist gate for the OAuth path (FR-48 stays intact; dropping the
		// allowlist is Story 8.2). It cannot live at the route boundary the way
		// the magic-link pre-gate does: the email only exists AFTER better-auth
		// exchanges the authorization code. This hook runs inside that exchange,
		// before the user row is written, so a rejected account leaves NO
		// database residue.
		//
		// The MESSAGE is the wire contract, not the `code`: better-auth's
		// `handleOAuthUserInfo` catches an APIError from this hook and returns
		// `{ error: e.message }`, and the callback then redirects to
		// `?error=${message.split(' ').join('_')}`. A prose message would arrive
		// at the login screen as `?error=That_account_is_not_allowed…`. So the
		// message IS the code — `ACCESS_DENIED`, no spaces — and `web/Login.tsx`
		// matches it. `code` is kept for the paths that rethrow the APIError.
		//
		// Scope note: this gates user CREATION. Linking a Google account to an
		// EXISTING user row never runs it — safe today because the allowlist is a
		// single exact email (an unallowed address has no row to link into), but
		// Story 8.2 (real registration) must gate the link path too.
		databaseHooks: {
			user: {
				create: {
					before: async (newUser: {
						email: string;
						emailVerified: boolean;
					}) => {
						// An unverified provider-supplied email is an unproven claim to
						// that address — the allowlist compares a string, so admitting an
						// unverified one would let a provider hand us the owner's address
						// without the owner ever proving control of it.
						if (!isAllowedEmail(newUser.email, env) || !newUser.emailVerified) {
							throw new APIError('FORBIDDEN', {
								code: 'ACCESS_DENIED',
								message: 'ACCESS_DENIED',
							});
						}
					},
				},
			},
		},
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
