/**
 * Email provider port (AD-5): the magic-link email is a third-party call, so
 * it goes through this seam and only this seam. Production uses Resend (a
 * plain fetch, workerd-safe); without a `RESEND_API_KEY` secret the console
 * adapter logs the link instead, which keeps local dev (`wrangler tail` /
 * terminal) and tests fully working with no credentials. Swapping vendors
 * (Cloudflare Email Routing, SES, ...) touches only this file.
 */

export interface MagicLinkEmail {
	to: string;
	url: string;
}

export interface EmailProvider {
	sendMagicLinkEmail(email: MagicLinkEmail): Promise<void>;
}

/**
 * Magic-link lifetime. Single source of truth for both the real TTL
 * (`services/auth.ts` passes it to better-auth as `expiresIn`) and the
 * email copy below — they can't drift apart.
 */
export const MAGIC_LINK_TTL_MINUTES = 5;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;

export function createResendEmailProvider(
	apiKey: string,
	from: string,
): EmailProvider {
	return {
		async sendMagicLinkEmail({ to, url }) {
			const response = await fetch(RESEND_ENDPOINT, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					from,
					to: [to],
					subject: 'PRESS START — your sign-in link',
					text: `Follow this link to sign in:\n\n${url}\n\nThe link expires in ${MAGIC_LINK_TTL_MINUTES} minutes. If you didn't request it, ignore this email.`,
				}),
				// A hung email API must fail the sign-in request visibly (AD-14),
				// not stall it until the Worker's own limits kill it.
				signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
			});
			if (!response.ok) {
				// Surface, never silently retry (AD-14). better-auth turns this
				// into a failed sign-in request the UI can show.
				throw new Error(
					`Resend rejected the magic-link email: ${response.status} ${await response.text()}`,
				);
			}
		},
	};
}

export function createConsoleEmailProvider(): EmailProvider {
	return {
		async sendMagicLinkEmail({ to, url }) {
			console.log(`[auth] magic link for ${to}: ${url}`);
		},
	};
}

export function createEmailProvider(env: Env): EmailProvider {
	if (env.RESEND_API_KEY) {
		if (!env.AUTH_EMAIL_FROM) {
			// Fail loud at selection time (AD-14) instead of letting Resend
			// reject every send with an opaque missing-"from" error.
			throw new Error('AUTH_EMAIL_FROM must be set when RESEND_API_KEY is');
		}
		return createResendEmailProvider(env.RESEND_API_KEY, env.AUTH_EMAIL_FROM);
	}
	return createConsoleEmailProvider();
}
