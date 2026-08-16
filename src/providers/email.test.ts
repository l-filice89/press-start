import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ACCOUNT_DELETION_TTL_MINUTES,
	createResendEmailProvider,
} from './email';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('Resend account-deletion email', () => {
	it('sends dedicated five-minute confirmation copy and surfaces rejection', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({
				ok: false,
				status: 503,
				text: async () => 'unavailable',
			});
		vi.stubGlobal('fetch', fetchMock);
		const provider = createResendEmailProvider(
			'resend-secret',
			'Press Start <auth@example.com>',
		);
		const email = {
			to: 'owner@example.com',
			url: 'https://press-start.test/api/auth/delete-user/callback?token=one',
		};

		await provider.sendAccountDeletionEmail(email);
		const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(endpoint).toBe('https://api.resend.com/emails');
		expect(init.headers).toMatchObject({
			Authorization: 'Bearer resend-secret',
			'Content-Type': 'application/json',
		});
		const body = JSON.parse(init.body as string) as {
			from: string;
			to: string[];
			subject: string;
			text: string;
		};
		expect(body).toMatchObject({
			from: 'Press Start <auth@example.com>',
			to: ['owner@example.com'],
			subject: 'PRESS START — confirm account deletion',
		});
		expect(body.text).toContain(email.url);
		expect(body.text).toContain(
			`expires in ${ACCOUNT_DELETION_TTL_MINUTES} minutes`,
		);

		await expect(provider.sendAccountDeletionEmail(email)).rejects.toThrow(
			'Resend rejected the account-deletion email: 503 unavailable',
		);
	});
});
