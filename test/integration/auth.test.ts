import {
	applyD1Migrations,
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import type { EmailProvider, MagicLinkEmail } from '../../src/providers/email';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { createAuth } from '../../src/services/auth';
import worker from '../../worker/index';

/**
 * Story 1.3 integration tests (FR-47/FR-48, AR-13): the full magic-link
 * flow against real workerd + local D1. The email side uses the AD-5
 * provider seam — a capturing fake injected into `createAuth` — so the
 * magic-link URL can be followed without any real email service.
 */

const BASE = 'http://example.com';
const ALLOWED_EMAIL = env.AUTH_ALLOWED_EMAIL;

function capturingEmailProvider() {
	const sent: MagicLinkEmail[] = [];
	const provider: EmailProvider = {
		async sendMagicLinkEmail(email) {
			sent.push(email);
		},
	};
	return { sent, provider };
}

async function appFetch(path: string, init?: RequestInit) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		new Request(`${BASE}${path}`, init),
		env,
		ctx,
	);
	await waitOnExecutionContext(ctx);
	return response;
}

/** Request a magic link through an auth instance with a capturing email fake. */
async function requestMagicLink(email: string) {
	const { sent, provider } = capturingEmailProvider();
	const auth = createAuth(env, { baseURL: BASE, emailProvider: provider });
	const response = await auth.handler(
		new Request(`${BASE}/api/auth/sign-in/magic-link`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: BASE },
			body: JSON.stringify({ email, callbackURL: '/' }),
		}),
	);
	return { response, sent };
}

/** Follow a captured magic-link URL; returns the session cookie pair. */
async function establishSession() {
	const { response, sent } = await requestMagicLink(ALLOWED_EMAIL);
	expect(response.status).toBe(200);
	expect(sent).toHaveLength(1);

	const auth = createAuth(env, { baseURL: BASE });
	const verifyResponse = await auth.handler(
		new Request(sent[0].url, { headers: { Origin: BASE } }),
	);
	expect(verifyResponse.status).toBe(302);
	expect(verifyResponse.headers.get('location')).toBe(`${BASE}/`);

	const setCookie = verifyResponse.headers.getSetCookie().join('; ');
	// Optional __Secure- prefix: better-auth adds it under an https baseURL.
	const match = setCookie.match(
		/(?:__Secure-)?better-auth\.session_token=[^;]+/,
	);
	expect(match).not.toBeNull();
	return (match as RegExpMatchArray)[0];
}

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

	it('creates only the tables auth needs — no sharing/roles/tenancy (AR-13)', async () => {
		const { results } = await env.DB.prepare(
			`SELECT name FROM sqlite_master
			 WHERE type = 'table'
			   AND name NOT LIKE 'sqlite_%'
			   AND name NOT LIKE '\\_cf%' ESCAPE '\\'
			   AND name != 'd1_migrations'
			 ORDER BY name`,
		).all<{ name: string }>();
		expect(results.map((row) => row.name)).toEqual([
			'account',
			'meta',
			'session',
			'user',
			'verification',
		]);
	});
});
