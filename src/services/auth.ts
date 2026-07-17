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
		// In-code burst damping (8.2 review): better-auth's built-in limiter on a
		// module-scope in-memory store — per-isolate best-effort, NO D1 writes
		// (AD-29/AD-32: a D1-metered limiter hands an attacker a write per hit).
		// The WAF edge rule remains the distributed backstop; this stops one
		// isolate being an email cannon. `AUTH_RATE_LIMIT=off` (.dev.vars) turns
		// it off for tests, which hammer the magic-link route by design.
		// Key the limiter on Cloudflare's own connecting-IP header (8.2 follow-up
		// review): the default `x-forwarded-for` only fails safe as long as CF
		// keeps appending to a client-forged XFF — `cf-connecting-ip` is minted
		// by the edge and cannot be client-supplied.
		advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
		rateLimit: {
			enabled: env.AUTH_RATE_LIMIT !== 'off',
			window: 60,
			max: 60,
			customRules: {
				'/sign-in/magic-link': { window: 60, max: 5 },
			},
		},
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
		// Registration is OPEN (AD-29, signed off 2026-07-17): admission is
		// PROVEN CONTROL OF THE EMAIL, not a list. Magic link proves it by
		// construction; this hook is the OAuth half — it cannot live at the
		// route boundary because the email only exists AFTER better-auth
		// exchanges the authorization code. It runs before the user row is
		// written, so a rejected account leaves NO database residue.
		//
		// The MESSAGE is the wire contract, not the `code`: better-auth's
		// `handleOAuthUserInfo` catches an APIError from this hook and returns
		// `{ error: e.message }`, and the callback then redirects to
		// `?error=${message.split(' ').join('_')}`. So the message IS the code —
		// `EMAIL_NOT_VERIFIED`, no spaces — and `web/Login.tsx` matches it.
		databaseHooks: {
			user: {
				create: {
					before: async (newUser: {
						email: string;
						emailVerified: boolean;
					}) => {
						// An unverified provider-supplied email is an unproven claim to
						// that address — admitting it would let a provider hand us
						// someone's address without the owner ever proving control.
						// Strict boolean: a provider serializing the OIDC claim as the
						// string "false" must not read as verified.
						if (newUser.emailVerified !== true) {
							throw new APIError('FORBIDDEN', {
								code: 'EMAIL_NOT_VERIFIED',
								message: 'EMAIL_NOT_VERIFIED',
							});
						}
					},
				},
			},
		},
		// The account-LINK path is the takeover door (deferred-work, closed by
		// Story 8.2): better-auth links a provider identity into an EXISTING user
		// by email match without the create hook ever running, and a provider in
		// `trustedProviders` links even when the provider says the email is
		// UNVERIFIED. With open registration, anyone can pre-register a victim's
		// address — so no provider is trusted past its own verification: linking
		// requires the provider-verified matching email, nothing less.
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: [],
			},
		},
		plugins: [
			magicLink({
				// Explicit so the email copy's "expires in N minutes" can never
				// silently drift from the real TTL on a library-default change.
				expiresIn: MAGIC_LINK_TTL_MINUTES * 60,
				sendMagicLink: async ({ email, url }) => {
					await emailProvider.sendMagicLinkEmail({ to: email, url });
				},
			}),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
