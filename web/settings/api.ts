import { z } from 'zod';
import { callApi } from '../shelf/api';

/**
 * Client contract for `/api/settings` (Story 4.1). Mirrors the server shape
 * rather than importing across the SPA/Worker program boundary (same policy
 * as `web/shelf/api.ts`, whose `callApi` — status-carrying errors for the
 * query client's 401 routing — is reused here). The PSN cookie itself never
 * appears in this contract — the API reports presence only.
 */

export const settingsSchema = z.object({
	timezone: z.string().nullable(),
	psnCookieSet: z.boolean(),
	psnAuthExpired: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;

export async function fetchSettings(signal?: AbortSignal): Promise<Settings> {
	return settingsSchema.parse(await callApi('/api/settings', { signal }));
}

/** Save a fresh PSN session cookie; the server clears the expired flag. */
export async function savePsnCookie(cookie: string): Promise<void> {
	await callApi('/api/settings/psn-cookie', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ cookie }),
	});
}
