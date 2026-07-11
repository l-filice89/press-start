import { z } from 'zod';
import { callApi } from '../shelf/api';

/**
 * Client contract for `/api/settings` (Story 4.1). Mirrors the server shape
 * rather than importing across the SPA/Worker program boundary (same policy
 * as `web/shelf/api.ts`, whose `callApi` — status-carrying errors for the
 * query client's 401 routing — is reused here). The PSN cookie itself never
 * appears in this contract — the API reports presence only.
 */

export const syncAttentionItemSchema = z.object({
	title: z.string(),
	reason: z.string(),
});

export type SyncAttentionItem = z.infer<typeof syncAttentionItemSchema>;

export const settingsSchema = z.object({
	timezone: z.string().nullable(),
	psnCookieSet: z.boolean(),
	psnAuthExpired: z.boolean(),
	// Defaulted: a deploy-skewed/cached response without the field must not
	// reject the whole settings payload (timezone + PSN banner ride on it).
	syncAttention: z.array(syncAttentionItemSchema).default([]),
	// Games needing a games-DB match (import stragglers + name-only adds) —
	// feeds the amber "enrich" banner (Story 6.2). Defaulted for the same reason.
	stragglerCount: z.number().default(0),
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

/** Result of a PSN library sync (Story 4.2; 4.3 renders the full summary). */
/** One synced title; `viaMembership` = a PS+ claim, not a purchase. */
export const syncTitleSchema = z.object({
	title: z.string(),
	viaMembership: z.boolean(),
});

export type SyncTitle = z.infer<typeof syncTitleSchema>;

export const syncResultSchema = z.object({
	/** Games created this run — the modal lists them by name. */
	added: z.array(syncTitleSchema),
	/** Games whose `Owned` flag flipped false→true this run. */
	flipped: z.array(syncTitleSchema),
	/** Claimed games found purchased — source upgraded, bought_on stamped. */
	upgraded: z.array(z.string()),
	/** WEBMAF web-app companion entitlements excluded (not games). */
	skippedWebApps: z.number(),
	needsAttention: z.array(syncAttentionItemSchema),
});

export type SyncResult = z.infer<typeof syncResultSchema>;

/** Trigger the in-Worker PSN sync. A 401 means the session cookie expired —
 * the server already lit the attention-banner flag; never auto-retry. */
export async function runSync(): Promise<SyncResult> {
	return syncResultSchema.parse(await callApi('/api/sync', { method: 'POST' }));
}
