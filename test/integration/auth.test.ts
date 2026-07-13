import {
	applyD1Migrations,
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { createAuth } from '../../src/services/auth';
import worker from '../../worker/index';
import {
	ALLOWED_EMAIL,
	appFetch,
	BASE,
	establishSession,
	requestMagicLink,
} from './session';

/**
 * Story 1.3 integration tests (FR-47/FR-48, AR-13): the full magic-link
 * flow against real workerd + local D1. The email side uses the AD-5
 * provider seam — a capturing fake injected into `createAuth` — so the
 * magic-link URL can be followed without any real email service.
 */

describe('magic-link auth & user scoping (integration, real workerd + local D1)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
	});

	it('rejects an unauthenticated /api/me with 401 JSON', async () => {
		const response = await appFetch('/api/me');
		expect(response.status).toBe(401);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ error: 'unauthorized' });
	});

	it('sends a magic link for the allowed email', async () => {
		const { response, sent } = await requestMagicLink(ALLOWED_EMAIL);
		expect(response.status).toBe(200);
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe(ALLOWED_EMAIL);
		expect(sent[0].url).toContain('/api/auth/magic-link/verify?token=');
	});

	it('silently skips non-allowlisted emails — same response, no email, no user row', async () => {
		const stranger = 'stranger@example.com';
		const { response, sent } = await requestMagicLink(stranger);
		expect(response.status).toBe(200);
		expect(sent).toHaveLength(0);

		const rows = await createDb(env.DB)
			.select()
			.from(user)
			.where(eq(user.email, stranger));
		expect(rows).toHaveLength(0);
	});

	it('routes the sign-in request through the worker for the allowed email', async () => {
		const response = await appFetch('/api/auth/sign-in/magic-link', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: BASE },
			body: JSON.stringify({ email: ALLOWED_EMAIL, callbackURL: '/' }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: true });
	});

	it('gates non-allowlisted sign-ins at the route: same response, no verification-token residue', async () => {
		const stranger = 'intruder@example.com';
		const response = await appFetch('/api/auth/sign-in/magic-link', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: BASE },
			body: JSON.stringify({ email: stranger, callbackURL: '/' }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: true });

		// better-auth writes the magic-link token to `verification` BEFORE the
		// send callback runs, so only the route-level gate prevents strangers
		// from growing the table — assert no residue at all.
		const { results } = await env.DB.prepare(
			"SELECT value FROM verification WHERE value LIKE '%intruder@example.com%'",
		).all();
		expect(results).toHaveLength(0);
	});

	it('gates a malformed sign-in body without a 500', async () => {
		const response = await appFetch('/api/auth/sign-in/magic-link', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: BASE },
			body: 'not-json',
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: true });
	});

	it('establishes a session from the emailed link and scopes /api/me to that user (AD-13 seam)', async () => {
		const cookie = await establishSession();

		const response = await appFetch('/api/me', { headers: { cookie } });
		expect(response.status).toBe(200);
		const body = await response.json<{ id: string; email: string }>();
		expect(body.email).toBe(ALLOWED_EMAIL);

		const rows = await createDb(env.DB)
			.select()
			.from(user)
			.where(eq(user.email, ALLOWED_EMAIL));
		expect(rows).toHaveLength(1);
		expect(body.id).toBe(rows[0].id);
	});

	it('rejects an invalid/expired token with an error redirect and no session', async () => {
		const response = await appFetch(
			'/api/auth/magic-link/verify?token=not-a-real-token&callbackURL=%2F',
			{ headers: { Origin: BASE } },
		);
		expect(response.status).toBe(302);
		const location = response.headers.get('location') ?? '';
		expect(location).toContain('error=INVALID_TOKEN');
		expect(response.headers.getSetCookie().join('')).not.toContain(
			'better-auth.session_token=',
		);
	});

	it('revokes the session on sign-out', async () => {
		const cookie = await establishSession();

		const signOut = await appFetch('/api/auth/sign-out', {
			method: 'POST',
			headers: {
				cookie,
				Origin: BASE,
				'Content-Type': 'application/json',
			},
			body: '{}',
		});
		expect(signOut.status).toBe(200);

		const me = await appFetch('/api/me', { headers: { cookie } });
		expect(me.status).toBe(401);
	});

	it('adds no sharing/roles/tenancy tables — only auth + the Story 1.4 domain model (AR-13)', async () => {
		const { results } = await env.DB.prepare(
			`SELECT name FROM sqlite_master
			 WHERE type = 'table'
			   AND name NOT LIKE 'sqlite_%'
			   AND name NOT LIKE '\\_cf%' ESCAPE '\\'
			   AND name != 'd1_migrations'
			 ORDER BY name`,
		).all<{ name: string }>();
		// auth's four tables, plus Story 1.4's six domain tables, the
		// Story 1.1 `meta` placeholder, and `setting` (Epic 2 retro timezone
		// policy) — and nothing else (no roles/sharing tables).
		expect(results.map((row) => row.name)).toEqual([
			'account',
			'external_link',
			'game',
			'game_genre',
			'game_tracking',
			'genre',
			'import_straggler',
			'meta',
			'session',
			'setting',
			'user',
			'verification',
		]);
	});
});

/**
 * Story 8.1 (B1a): Google sits alongside magic link, and the FR-48 allowlist
 * governs the OAuth path too. Google's consent screen can't be driven here (no
 * creds, no browser), so these tests hit the exact seam the callback uses:
 * better-auth's `internalAdapter.createOAuthUser` runs the same
 * `databaseHooks.user.create.before` gate that a real callback runs, and it is
 * the ONLY thing standing between a stranger's Google account and a user row.
 */
describe('Google OAuth allowlist gate (Story 8.1 / B1a)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
	});

	const oauthAccount = (id: string) => ({
		providerId: 'google',
		accountId: id,
		accessToken: 'test-token',
	});

	async function createOAuthUser(email: string, accountId: string) {
		const auth = createAuth(env, { baseURL: BASE });
		const ctx = await auth.$context;
		return ctx.internalAdapter.createOAuthUser(
			{ email, name: 'OAuth User', emailVerified: true },
			oauthAccount(accountId),
		);
	}

	/**
	 * HAZARD (caught in review): better-auth's `handleOAuthUserInfo` CATCHES an
	 * APIError from the create hook and returns `{ error: e.message }`; the
	 * callback then redirects to `?error=${message.split(' ').join('_')}`. The
	 * `code` never reaches the browser — the MESSAGE does. So the message must
	 * BE the code, or `Login.tsx` shows the wrong copy for a rejected sign-in.
	 * This test is the contract; it goes red if the message ever becomes prose.
	 */
	it('rejects with the exact code the login screen matches (message IS the wire)', async () => {
		const error = await createOAuthUser(
			'wire-contract@example.com',
			'google-wire',
		).catch((e: Error) => e);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe('ACCESS_DENIED');
		// What the browser would actually land on.
		expect(`/?error=${(error as Error).message.split(' ').join('_')}`).toBe(
			'/?error=ACCESS_DENIED',
		);
	});

	it('rejects an unverified email even when it matches the allowlist', async () => {
		// The allowlist compares a provider-supplied string; an unverified one is
		// an unproven claim to that address.
		const auth = createAuth(env, { baseURL: BASE });
		const ctx = await auth.$context;
		await expect(
			ctx.internalAdapter.createOAuthUser(
				{ email: ALLOWED_EMAIL, name: 'Unverified', emailVerified: false },
				oauthAccount('google-unverified'),
			),
		).rejects.toThrow(/ACCESS_DENIED/);
	});

	it('rejects a non-allowlisted Google account — no user row, no account row', async () => {
		const stranger = 'someone-else@gmail.com';

		await expect(createOAuthUser(stranger, 'google-stranger')).rejects.toThrow(
			/ACCESS_DENIED/,
		);

		const users = await createDb(env.DB)
			.select()
			.from(user)
			.where(eq(user.email, stranger));
		expect(users).toHaveLength(0);
		const { results } = await env.DB.prepare(
			"SELECT id FROM account WHERE account_id = 'google-stranger'",
		).all();
		expect(results).toHaveLength(0);
	});

	it('admits the allowlisted Google account (the gate is not a blanket no)', async () => {
		// A real callback only reaches createOAuthUser when no user exists yet
		// (an existing one is looked up and linked instead) — the magic-link
		// tests above already signed this email up, so clear it to hit signup.
		await env.DB.prepare('DELETE FROM user WHERE email = ?')
			.bind(ALLOWED_EMAIL.toLowerCase())
			.run();

		const result = await createOAuthUser(ALLOWED_EMAIL, 'google-owner');
		expect(result.user.email).toBe(ALLOWED_EMAIL.toLowerCase());

		const users = await createDb(env.DB)
			.select()
			.from(user)
			.where(eq(user.email, ALLOWED_EMAIL.toLowerCase()));
		expect(users.length).toBeGreaterThan(0);
	});

	it('fails closed when the allowlist is unset — nobody, not everybody', async () => {
		const auth = createAuth(
			{ ...env, AUTH_ALLOWED_EMAIL: '' } as unknown as Env,
			{ baseURL: BASE },
		);
		const ctx = await auth.$context;
		await expect(
			ctx.internalAdapter.createOAuthUser(
				{
					email: ALLOWED_EMAIL,
					name: 'OAuth User',
					emailVerified: true,
				},
				oauthAccount('google-noallowlist'),
			),
		).rejects.toThrow(/ACCESS_DENIED/);
	});

	it('strands a session whose user is no longer allowlisted (401 on every protected route)', async () => {
		const cookie = await establishSession();
		// Sanity: the session works while the allowlist admits it.
		const ok = await appFetch('/api/me', { headers: { cookie } });
		expect(ok.status).toBe(200);

		// The allowlist changes; the old user row (and its live session) outlives
		// it. requireAuth must refuse it rather than leave a stale key in play.
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			new Request(`${BASE}/api/me`, { headers: { cookie } }),
			{
				...env,
				AUTH_ALLOWED_EMAIL: 'someone-new@example.com',
			} as unknown as Env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'unauthorized' });
	});
});
