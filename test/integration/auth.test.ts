import { applyD1Migrations, env } from 'cloudflare:test';
import { handleOAuthUserInfo } from 'better-auth/oauth2';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
	deleteExpiredVerifications,
	insertGame,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { createAuth } from '../../src/services/auth';
import {
	appFetch,
	BASE,
	establishSession,
	requestMagicLink,
	TEST_EMAIL,
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
		const { response, sent } = await requestMagicLink(TEST_EMAIL);
		expect(response.status).toBe(200);
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe(TEST_EMAIL);
		expect(sent[0].url).toContain('/api/auth/magic-link/verify?token=');
	});

	it('sends a magic link to ANY address — registration is open (Story 8.2, AD-29)', async () => {
		const stranger = 'stranger@example.com';
		const { response, sent } = await requestMagicLink(stranger);
		expect(response.status).toBe(200);
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe(stranger);

		// No user row yet — a link REQUEST proves nothing; following it does.
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
			body: JSON.stringify({ email: TEST_EMAIL, callbackURL: '/' }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: true });
	});

	it('a stranger sign-in writes a verification row — bounded residue, swept once expired (AD-29)', async () => {
		const stranger = 'intruder@example.com';
		const response = await appFetch('/api/auth/sign-in/magic-link', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: BASE },
			body: JSON.stringify({ email: stranger, callbackURL: '/' }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: true });

		// The residue is EXPECTED under open registration (the pre-gate died);
		// the WAF rate limit bounds the growth, and the TTL sweep deletes what
		// expires — proven here by expiring the row and running the sweep, while
		// a live row survives it.
		const { results } = await env.DB.prepare(
			"SELECT id FROM verification WHERE value LIKE '%intruder@example.com%'",
		).all<{ id: string }>();
		expect(results.length).toBeGreaterThan(0);

		await env.DB.prepare('UPDATE verification SET expires_at = 0 WHERE id = ?')
			.bind(results[0].id)
			.run();
		await requestMagicLink('still-live@example.com');
		await deleteExpiredVerifications(createDb(env.DB), new Date());
		const swept = await env.DB.prepare(
			'SELECT id FROM verification WHERE id = ?',
		)
			.bind(results[0].id)
			.all();
		expect(swept.results).toHaveLength(0);
		const live = await env.DB.prepare(
			"SELECT id FROM verification WHERE value LIKE '%still-live@example.com%'",
		).all();
		expect(live.results.length).toBeGreaterThan(0);
	});

	it('a malformed sign-in body is refused without a 500', async () => {
		const response = await appFetch('/api/auth/sign-in/magic-link', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: BASE },
			body: 'not-json',
		});
		// The pre-gate that used to swallow this died with the allowlist —
		// better-auth's own body validation answers now.
		expect(response.status).toBe(400);
	});

	it('establishes a session from the emailed link and scopes /api/me to that user (AD-13 seam)', async () => {
		const cookie = await establishSession();

		const response = await appFetch('/api/me', { headers: { cookie } });
		expect(response.status).toBe(200);
		const body = await response.json<{ id: string; email: string }>();
		expect(body.email).toBe(TEST_EMAIL);

		const rows = await createDb(env.DB)
			.select()
			.from(user)
			.where(eq(user.email, TEST_EMAIL));
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
		// Story 1.1 `meta` placeholder, `setting` (Epic 2 retro timezone policy)
		// and Story 7.1's two catalog-snapshot tables (AD-24/26 — a THIRD owner
		// class: no `user_id`, no tracking) — and nothing else (no roles/sharing).
		expect(results.map((row) => row.name)).toEqual([
			'account',
			'external_link',
			'game',
			'game_genre',
			'game_tracking',
			'genre',
			'import_straggler',
			'meta',
			'ps_plus_catalog',
			'ps_plus_catalog_genre',
			'session',
			'setting',
			'user',
			'verification',
		]);
	});
});

/**
 * Stories 8.1 + 8.2: Google sits alongside magic link, and admission is
 * PROVEN EMAIL CONTROL (AD-29, open registration). Google's consent screen
 * can't be driven here (no creds, no browser), so these tests hit the exact
 * seams the callback uses: `internalAdapter.createOAuthUser` runs the same
 * `databaseHooks.user.create.before` hook a real callback runs, and
 * `handleOAuthUserInfo` is the LINK path itself (better-auth's own module).
 */
describe('open registration & the verified-email rule (Story 8.2 / B1b)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
	});

	const oauthAccount = (id: string) => ({
		providerId: 'google',
		accountId: id,
		accessToken: 'test-token',
	});

	async function createOAuthUser(
		email: string,
		accountId: string,
		emailVerified = true,
	) {
		const auth = createAuth(env, { baseURL: BASE });
		const ctx = await auth.$context;
		return ctx.internalAdapter.createOAuthUser(
			{ email, name: 'OAuth User', emailVerified },
			oauthAccount(accountId),
		);
	}

	/**
	 * HAZARD (8.1 review, still the contract): better-auth's
	 * `handleOAuthUserInfo` CATCHES an APIError from the create hook and
	 * returns `{ error: e.message }`; the callback then redirects to
	 * `?error=${message.split(' ').join('_')}`. The `code` never reaches the
	 * browser — the MESSAGE does. So the message must BE the code, or
	 * `Login.tsx` shows the wrong copy. Red if it ever becomes prose.
	 */
	it('rejects an UNVERIFIED email with the exact code the login screen matches', async () => {
		const error = await createOAuthUser(
			'wire-contract@example.com',
			'google-wire',
			false,
		).catch((e: Error) => e);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe('EMAIL_NOT_VERIFIED');
		expect(`/?error=${(error as Error).message.split(' ').join('_')}`).toBe(
			'/?error=EMAIL_NOT_VERIFIED',
		);

		// …and no residue: no user row, no account row.
		const users = await createDb(env.DB)
			.select()
			.from(user)
			.where(eq(user.email, 'wire-contract@example.com'));
		expect(users).toHaveLength(0);
		const { results } = await env.DB.prepare(
			"SELECT id FROM account WHERE account_id = 'google-wire'",
		).all();
		expect(results).toHaveLength(0);
	});

	it('admits ANY verified Google account — registration is open', async () => {
		const stranger = 'total-stranger@gmail.com';
		const result = await createOAuthUser(stranger, 'google-stranger');
		expect(result.user.email).toBe(stranger);

		const users = await createDb(env.DB)
			.select()
			.from(user)
			.where(eq(user.email, stranger));
		expect(users).toHaveLength(1);
	});

	it('two registered users are scoped server-side: own shelf, own /api/me, no cross-user writes', async () => {
		const cookieA = await establishSession();
		const cookieB = await establishSession('second-user@press-start.test');

		const meA = await appFetch('/api/me', { headers: { cookie: cookieA } });
		const meB = await appFetch('/api/me', { headers: { cookie: cookieB } });
		const a = await meA.json<{ id: string; email: string }>();
		const b = await meB.json<{ id: string; email: string }>();
		expect(a.email).toBe(TEST_EMAIL);
		expect(b.email).toBe('second-user@press-start.test');
		expect(a.id).not.toBe(b.id);

		// Seed one game for A, none for B.
		const db = createDb(env.DB);
		const g = await insertGame(db, {
			title: 'Scoped Game',
			titleNormalized: 'scoped game',
		});
		await upsertTracking(db, a.id, g.id, {
			owned: true,
			playStatus: 'Playing',
		});

		const shelfA = await appFetch('/api/shelf?include=hidden', {
			headers: { cookie: cookieA },
		});
		const shelfB = await appFetch('/api/shelf?include=hidden', {
			headers: { cookie: cookieB },
		});
		const gamesA = (await shelfA.json<{ games: { id: string }[] }>()).games;
		const gamesB = (await shelfB.json<{ games: { id: string }[] }>()).games;
		expect(gamesA.some((row) => row.id === g.id)).toBe(true);
		expect(gamesB.some((row) => row.id === g.id)).toBe(false);

		// B cannot write A's tracking: the row simply isn't B's (404), and A's
		// state is untouched — server-side scoping, not UI hiding (AD-13).
		const attack = await appFetch(`/api/games/${g.id}/play-status`, {
			method: 'PATCH',
			headers: {
				cookie: cookieB,
				'Content-Type': 'application/json',
				Origin: BASE,
			},
			body: JSON.stringify({ playStatus: 'Dropped' }),
		});
		expect(attack.status).toBe(404);
		const after = await appFetch(`/api/games/${g.id}`, {
			headers: { cookie: cookieA },
		});
		expect(
			(await after.json<{ game: { playStatus: string } }>()).game.playStatus,
		).toBe('Playing');
	});

	/**
	 * THE LINK PATH (deferred-work: OAuth link gate — the takeover door).
	 * better-auth links a provider identity into an EXISTING user by email
	 * match without the create hook running. With open registration anyone can
	 * pre-register a victim's address, so linking must demand the provider-
	 * verified matching email — `trustedProviders` is empty (a trusted
	 * provider would link even unverified). This drives better-auth's own
	 * `handleOAuthUserInfo` (the exact callback seam) both ways.
	 */
	it('LINK path: an UNVERIFIED matching email is refused; a verified one links (TEST-THE-BYPASS)', async () => {
		const victim = 'link-victim@press-start.test';
		await establishSession(victim); // the existing account

		const auth = createAuth(env, { baseURL: BASE });
		const ctx = await auth.$context;
		const endpointCtx = { context: ctx } as unknown as Parameters<
			typeof handleOAuthUserInfo
		>[0];

		const refused = await handleOAuthUserInfo(endpointCtx, {
			userInfo: {
				id: 'prov-1',
				email: victim,
				emailVerified: false,
				name: 'Attacker Provider',
			} as Parameters<typeof handleOAuthUserInfo>[1]['userInfo'],
			account: oauthAccount('google-link-attack'),
		});
		// Pin the refusal literal: a different refusal reason (or a library
		// change) should be a visible event, not silently absorbed.
		expect(refused.error).toBe('account not linked');
		const attacked = await env.DB.prepare(
			// linkAccount stores userInfo.id as account_id — query the id a
			// REGRESSED link would actually write, or this assert can never fail.
			"SELECT id FROM account WHERE account_id = 'prov-1'",
		).all();
		expect(attacked.results).toHaveLength(0);

		const linked = await handleOAuthUserInfo(endpointCtx, {
			userInfo: {
				id: 'prov-2',
				email: victim,
				emailVerified: true,
				name: 'Real Owner',
			} as Parameters<typeof handleOAuthUserInfo>[1]['userInfo'],
			account: oauthAccount('google-link-real'),
		});
		expect(linked.error).toBeNull();
		const real = await env.DB.prepare(
			"SELECT id FROM account WHERE account_id = 'prov-2'", // linkAccount stores userInfo.id, not opts.account.accountId
		).all();
		expect(real.results).toHaveLength(1);
	});
});
