import {
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { expect } from 'vitest';
import type { EmailProvider, MagicLinkEmail } from '../../src/providers/email';
import { createAuth } from '../../src/services/auth';
import worker from '../../worker/index';

/**
 * Shared magic-link session plumbing for the integration suites. The email side
 * uses the AD-5 provider seam — a capturing fake injected into `createAuth` —
 * so the magic-link URL can be followed without any real email service.
 */

export const BASE = 'http://example.com';
// Registration is open (Story 8.2, AD-29) — the suite's default identity.
export const TEST_EMAIL = 'owner@press-start.test';

export function capturingEmailProvider() {
	const sent: MagicLinkEmail[] = [];
	const provider: EmailProvider = {
		async sendMagicLinkEmail(email) {
			sent.push(email);
		},
	};
	return { sent, provider };
}

/** Drive a request through the real Worker (routes + SPA fallback). */
export async function appFetch(path: string, init?: RequestInit) {
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
export async function requestMagicLink(email: string) {
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
export async function establishSession(email: string = TEST_EMAIL) {
	const { response, sent } = await requestMagicLink(email);
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
