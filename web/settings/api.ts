import { z } from 'zod';
import { callApi } from '../shelf/api';

/**
 * Client contract for `/api/settings` (Story 4.1). Mirrors the server shape
 * rather than importing across the SPA/Worker program boundary (same policy
 * as `web/shelf/api.ts`, whose `callApi` — status-carrying errors for the
 * query client's 401 routing — is reused here). The PSN NPSSO token itself
 * never appears in this contract — the API reports presence only.
 */

export const syncAttentionItemSchema = z.object({
	title: z.string(),
	reason: z.string(),
});

export type SyncAttentionItem = z.infer<typeof syncAttentionItemSchema>;

export const settingsSchema = z.object({
	timezone: z.string().nullable(),
	psnNpssoSet: z.boolean(),
	psnAuthExpired: z.boolean(),
	// Defaulted: a deploy-skewed/cached response without the field must not
	// reject the whole settings payload (timezone + PSN banner ride on it).
	syncAttention: z.array(syncAttentionItemSchema).default([]),
	// Story 5.2: the last monthly PS+ Extra cron refresh failed. Defaulted for
	// the same deploy-skew reason as syncAttention.
	psPlusRefreshFailed: z.boolean().default(false),
	// Story 5.3: date (YYYY-MM-DD, user zone) of the last successful refresh,
	// null until the first one. Feeds the header "PS+ CATALOG AS OF" readout.
	psPlusRefreshedAt: z.string().nullable().default(null),
	// Games needing a games-DB match (import stragglers + name-only adds) —
	// feeds the amber "enrich" banner (Story 6.2). Defaulted for the same reason.
	stragglerCount: z.number().default(0),
	// FAB placement (Story 6.3, UX-DR10). Defaulted so a cached response is safe.
	fabHandedness: z.enum(['left', 'right']).default('right'),
	// Owned PS+ claims (Story 6.4): names + gates the "I cancelled PS+" action.
	// Defaulted for the same deploy-skew reason as the fields above.
	psPlusClaimCount: z.number().default(0),
});

export type Settings = z.infer<typeof settingsSchema>;

export async function fetchSettings(signal?: AbortSignal): Promise<Settings> {
	return settingsSchema.parse(await callApi('/api/settings', { signal }));
}

/** Move the FAB to the left/right hand (Story 6.3, UX-DR10). */
export async function saveFabHandedness(
	handedness: 'left' | 'right',
): Promise<void> {
	await callApi('/api/settings/fab-handedness', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ handedness }),
	});
}

/**
 * "I cancelled PS+" (Story 6.4 AC4): un-own every PS+ claim, purchases
 * untouched. Resolves to the count actually un-owned.
 */
export async function cancelPsPlus(): Promise<{ unowned: number }> {
	const body = await callApi('/api/settings/cancel-ps-plus', {
		method: 'POST',
	});
	return z.object({ unowned: z.number() }).parse(body);
}

/** Save a fresh PSN NPSSO token; the server clears the expired flag. */
export async function savePsnNpsso(npsso: string): Promise<void> {
	await callApi('/api/settings/psn-npsso', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ npsso }),
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

/** Trigger the in-Worker PSN sync. A 401 means the NPSSO token expired —
 * the server already lit the attention-banner flag; never auto-retry. */
export async function runSync(): Promise<SyncResult> {
	return syncResultSchema.parse(await callApi('/api/sync', { method: 'POST' }));
}

/** Result of a PSN trophy sync (Story 9.2). */
export const trophySyncResultSchema = z.object({
	/** Games whose trophy counts this run wrote. */
	updated: z.array(z.string()),
	/** Trophy titles with no library game (a demo, an unowned game) — not an error. */
	unmatched: z.array(z.string()),
	/** Ambiguous names: nothing was written, and they are named. */
	needsAttention: z.array(syncAttentionItemSchema),
});

export type TrophySyncResult = z.infer<typeof trophySyncResultSchema>;

/** Trigger the in-Worker trophy sync. A 401 means the NPSSO expired — the
 * server already lit the banner flag; never auto-retry (AD-14). */
export async function runTrophySync(): Promise<TrophySyncResult> {
	return trophySyncResultSchema.parse(
		await callApi('/api/sync/trophies', { method: 'POST' }),
	);
}

/** One chunk of the platinum-date backfill (Story 9.3). */
export const platinumBackfillResultSchema = z.object({
	/** Games whose `platinum_on` this chunk recovered, with the date written.
	 *  `gameId` is the only stable key — titles COLLIDE in this app. */
	filled: z.array(
		z.object({ gameId: z.string(), title: z.string(), date: z.string() }),
	),
	/** Titles PSN could not date (delisted, no date on record) — named, not lost.
	 *  `code` is what the summary branches on, never the prose. */
	skipped: z.array(
		syncAttentionItemSchema.extend({
			code: z.enum(['not-found', 'no-date']),
		}),
	),
	/** Non-null = there are more candidates: re-post with it (the chunk loop). */
	nextCursor: z.string().nullable(),
	/** False = the trophy sync has never run — there is nothing to recover FROM. */
	hasTrophyData: z.boolean(),
});

export type PlatinumBackfillResult = z.infer<
	typeof platinumBackfillResultSchema
>;

/**
 * One chunk of the one-off backfill. The run is chunked because the fan-out is
 * one PSN call per platinum title (53 on the probed account) and a Worker
 * invocation gets 50 subrequests — the caller LOOPS on `nextCursor`. A 401
 * means the NPSSO expired: stop, never retry (AD-14).
 */
export async function runPlatinumBackfill(
	cursor: string | null,
): Promise<PlatinumBackfillResult> {
	const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
	return platinumBackfillResultSchema.parse(
		await callApi(`/api/backfill/platinum-dates${query}`, { method: 'POST' }),
	);
}

/**
 * A FAILED chunk still wrote rows — `platinum_on` is write-once, nothing rolls
 * back — and the server reports them in the error body. Null when the failure
 * carried no report (a refusal, a 401 before the first title).
 */
export function backfillPartial(error: unknown): PlatinumBackfillResult | null {
	const body = (error as { body?: { partial?: unknown } } | undefined)?.body;
	const parsed = platinumBackfillResultSchema.safeParse(body?.partial);
	return parsed.success ? parsed.data : null;
}

/** Result of a PS+ Extra catalog check (Story 5.1, FR-38). */
export const psPlusCheckResultSchema = z.object({
	/** Titles newly flagged as in the catalog this run. */
	flagged: z.array(z.string()),
	/** Titles whose flag was cleared (left the catalog). */
	cleared: z.array(z.string()),
	/** Tracked non-owned games examined. */
	checked: z.number(),
	region: z.string(),
});

export type PsPlusCheckResult = z.infer<typeof psPlusCheckResultSchema>;

/** Trigger the in-Worker PS+ Extra catalog check. */
export async function runPsPlusCheck(): Promise<PsPlusCheckResult> {
	return psPlusCheckResultSchema.parse(
		await callApi('/api/ps-plus-check', { method: 'POST' }),
	);
}
