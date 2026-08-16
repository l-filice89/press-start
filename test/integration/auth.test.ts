import { applyD1Migrations, env } from 'cloudflare:test';
import { handleOAuthUserInfo } from 'better-auth/oauth2';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
	deleteExpiredVerifications,
	insertGame,
	recordRegionOutcome,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { createAuth } from '../../src/services/auth';
import {
	appFetch,
	BASE,
	establishSession,
	requestAccountDeletion,
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
			// Story 8.3's region-keyed departure ledger (AD-30) — per-region shared
			// data, no user_id: still no roles/sharing/tenancy.
			'ps_plus_departure',
			// Story 8.4's region-state ledger (AD-31) — same owner class.
			'ps_plus_region_state',
			'session',
			'setting',
			'user',
			'verification',
		]);
	});
});

describe('permanent account deletion (verified better-auth flow)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
	});

	async function userIdFor(cookie: string) {
		const response = await appFetch('/api/me', { headers: { cookie } });
		expect(response.status).toBe(200);
		return (await response.json<{ id: string }>()).id;
	}

	async function followDeletionLink(url: string, cookie: string) {
		return createAuth(env, { baseURL: BASE }).handler(
			new Request(url, { headers: { cookie, Origin: BASE } }),
		);
	}

	it('keeps data before verification, then deletes only private rows and every database session', async () => {
		const email = 'delete-owner@press-start.test';
		const otherEmail = 'delete-neighbor@press-start.test';
		const cookie = await establishSession(email);
		const secondCookie = await establishSession(email);
		const otherCookie = await establishSession(otherEmail);
		const userId = await userIdFor(cookie);
		const otherUserId = await userIdFor(otherCookie);
		const db = createDb(env.DB);
		const sharedGame = await insertGame(db, {
			title: 'Deletion Shared Fact',
			titleNormalized: 'deletion shared fact',
		});
		await upsertTracking(db, userId, sharedGame.id, {
			owned: true,
			playStatus: 'Playing',
		});
		await upsertTracking(db, otherUserId, sharedGame.id, {
			owned: true,
			playStatus: 'Paused',
		});
		await env.DB.prepare(
			'INSERT INTO setting (user_id, key, value) VALUES (?, ?, ?)',
		)
			.bind(userId, 'deletion-test', 'private')
			.run();
		await env.DB.prepare(
			`INSERT INTO account
			 (id, account_id, provider_id, user_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				'deletion-account-row',
				'deletion-provider-id',
				'google',
				userId,
				Date.now(),
				Date.now(),
			)
			.run();

		const requestedAt = Date.now();
		const { response, deletionSent } = await requestAccountDeletion(cookie);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			message: 'Verification email sent',
		});
		expect(deletionSent).toHaveLength(1);
		expect(deletionSent[0].to).toBe(email);
		expect(deletionSent[0].url).toContain(
			'/api/auth/delete-user/callback?token=',
		);
		const deletionToken = await env.DB.prepare(
			"SELECT expires_at FROM verification WHERE value = ? AND identifier LIKE 'delete-account-%'",
		)
			.bind(userId)
			.first<{ expires_at: number }>();
		expect(deletionToken).not.toBeNull();
		expect(
			(deletionToken as { expires_at: number }).expires_at - requestedAt,
		).toBeGreaterThanOrEqual(295_000);
		expect(
			(deletionToken as { expires_at: number }).expires_at - requestedAt,
		).toBeLessThanOrEqual(305_000);
		for (const table of [
			'user',
			'account',
			'session',
			'game_tracking',
			'setting',
		]) {
			const before = await env.DB.prepare(
				`SELECT 1 FROM ${table} WHERE ${table === 'user' ? 'id' : 'user_id'} = ?`,
			)
				.bind(userId)
				.all();
			expect(before.results.length).toBeGreaterThan(0);
		}

		const callback = await followDeletionLink(deletionSent[0].url, cookie);
		expect(callback.status).toBe(302);
		expect(callback.headers.get('location')).toBe('/');
		expect(callback.headers.getSetCookie().join(';')).toContain(
			'better-auth.session_token=',
		);
		for (const table of [
			'user',
			'account',
			'session',
			'game_tracking',
			'setting',
		]) {
			const after = await env.DB.prepare(
				`SELECT 1 FROM ${table} WHERE ${table === 'user' ? 'id' : 'user_id'} = ?`,
			)
				.bind(userId)
				.all();
			expect(after.results).toHaveLength(0);
		}
		const game = await env.DB.prepare('SELECT id FROM game WHERE id = ?')
			.bind(sharedGame.id)
			.all();
		expect(game.results).toHaveLength(1);
		const neighbor = await env.DB.prepare('SELECT id FROM user WHERE id = ?')
			.bind(otherUserId)
			.all();
		expect(neighbor.results).toHaveLength(1);
		const neighborTracking = await env.DB.prepare(
			'SELECT game_id FROM game_tracking WHERE user_id = ? AND game_id = ?',
		)
			.bind(otherUserId, sharedGame.id)
			.all();
		expect(neighborTracking.results).toHaveLength(1);
		for (const oldCookie of [cookie, secondCookie]) {
			const staleSession = await appFetch('/api/me', {
				headers: { cookie: oldCookie },
			});
			// Signed cookie cache may remain authoritative for at most 300 seconds;
			// the database session rows above are gone immediately.
			expect([200, 401]).toContain(staleSession.status);
		}
	});

	it('refuses expired, wrong-user, and replayed deletion tokens without cross-user deletion', async () => {
		const victimCookie = await establishSession(
			'delete-bypass@press-start.test',
		);
		const attackerCookie = await establishSession(
			'delete-attacker@press-start.test',
		);
		const victimId = await userIdFor(victimCookie);
		const attackerId = await userIdFor(attackerCookie);

		const expired = await requestAccountDeletion(victimCookie);
		await env.DB.prepare(
			"UPDATE verification SET expires_at = 0 WHERE value = ? AND identifier LIKE 'delete-account-%'",
		)
			.bind(victimId)
			.run();
		expect(
			(await followDeletionLink(expired.deletionSent[0].url, victimCookie))
				.status,
		).toBe(404);

		const wrongUser = await requestAccountDeletion(victimCookie);
		expect(
			(await followDeletionLink(wrongUser.deletionSent[0].url, attackerCookie))
				.status,
		).toBe(404);
		for (const id of [victimId, attackerId]) {
			const row = await env.DB.prepare('SELECT id FROM user WHERE id = ?')
				.bind(id)
				.all();
			expect(row.results).toHaveLength(1);
		}

		const valid = await requestAccountDeletion(victimCookie);
		expect(
			(await followDeletionLink(valid.deletionSent[0].url, victimCookie))
				.status,
		).toBe(302);
		expect(
			(await followDeletionLink(valid.deletionSent[0].url, victimCookie))
				.status,
		).toBe(404);
		const attacker = await env.DB.prepare('SELECT id FROM user WHERE id = ?')
			.bind(attackerId)
			.all();
		expect(attacker.results).toHaveLength(1);
	});

	it('preserves private data when email delivery or the deletion write fails', async () => {
		const email = 'delete-failure@press-start.test';
		const cookie = await establishSession(email);
		const userId = await userIdFor(cookie);
		let rejectNextEmail = true;
		const provider = {
			async sendMagicLinkEmail() {},
			async sendAccountDeletionEmail() {
				if (rejectNextEmail) {
					rejectNextEmail = false;
					throw new Error('captured email outage');
				}
			},
		};
		const auth = createAuth(env, { baseURL: BASE, emailProvider: provider });
		const deletionRequest = () =>
			auth.handler(
				new Request(`${BASE}/api/auth/delete-user`, {
					method: 'POST',
					headers: {
						cookie,
						Origin: BASE,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ callbackURL: '/' }),
				}),
			);
		const failedSend = await deletionRequest();
		expect(failedSend.status).toBe(500);
		expect(
			(
				await env.DB.prepare('SELECT id FROM user WHERE id = ?')
					.bind(userId)
					.all()
			).results,
		).toHaveLength(1);
		expect((await deletionRequest()).status).toBe(200);

		const db = createDb(env.DB);
		const privateGame = await insertGame(db, {
			title: 'Deletion Failure Private Tracking',
			titleNormalized: 'deletion failure private tracking',
		});
		await upsertTracking(db, userId, privateGame.id, {
			owned: true,
			playStatus: 'Playing',
		});
		await env.DB.prepare(
			'INSERT INTO setting (user_id, key, value) VALUES (?, ?, ?)',
		)
			.bind(userId, 'deletion-failure-setting', 'survives')
			.run();
		await env.DB.prepare(
			`INSERT INTO account
			 (id, account_id, provider_id, user_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				'deletion-failure-account',
				'deletion-failure-provider',
				'google',
				userId,
				Date.now(),
				Date.now(),
			)
			.run();

		const requested = await requestAccountDeletion(cookie);
		await env.DB.prepare(
			`CREATE TRIGGER deletion_failure_test BEFORE DELETE ON user
			 BEGIN SELECT RAISE(ABORT, 'captured deletion failure'); END`,
		).run();
		try {
			const failedDelete = await followDeletionLink(
				requested.deletionSent[0].url,
				cookie,
			);
			expect(failedDelete.status).toBe(500);
		} finally {
			await env.DB.prepare('DROP TRIGGER deletion_failure_test').run();
		}
		for (const table of [
			'user',
			'session',
			'account',
			'game_tracking',
			'setting',
		]) {
			const rows = await env.DB.prepare(
				`SELECT 1 FROM ${table} WHERE ${table === 'user' ? 'id' : 'user_id'} = ?`,
			)
				.bind(userId)
				.all();
			expect(
				rows.results.length,
				`${table} survives failed deletion`,
			).toBeGreaterThan(0);
		}
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
		// Story 8.4: /api/shelf's waitUntil stale-snapshot guard would otherwise
		// hit the REAL store (nothing stubs fetch here) — a fresh ledger row for
		// the env-seeded region keeps it dormant.
		await recordRegionOutcome(createDb(env.DB), 'it-it', {
			attemptedOn: new Date().toISOString().slice(0, 10),
			succeeded: true,
			window: new Date().toISOString().slice(0, 7),
		});
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
