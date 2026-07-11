/**
 * Settings orchestration (Epic 2 retro timezone policy). `todayForUser` is
 * THE date-stamp source for every tracking write — all four stamp sites
 * (started_on, completed_on/platinum_on, bought_on) compute "today" in the
 * user's captured zone rather than the Worker's UTC clock.
 */
import { todayInZone } from '../core';
import { deleteSetting, getSetting, setSetting } from '../repositories';
import type { Db } from '../repositories/db';

export const TIMEZONE_SETTING_KEY = 'timezone';

/** Today's date (YYYY-MM-DD) in this user's timezone; UTC when unset. */
export async function todayForUser(db: Db, userId: string): Promise<string> {
	const timeZone = await getSetting(db, userId, TIMEZONE_SETTING_KEY);
	return todayInZone(timeZone, new Date());
}

/** Live PlayStation session cookie (Story 4.1, FR-36) — read fresh per call. */
export const PSN_COOKIE_SETTING_KEY = 'psn_cookie';

/** `'expired'` while PSN last rejected the cookie; absent otherwise (AD-14). */
export const PSN_AUTH_SETTING_KEY = 'psn_auth';
export const PSN_AUTH_EXPIRED = 'expired';

/**
 * The cookie the `PsnProvider` sends: the user-saved setting, else the
 * `PSN_SESSION_COOKIE` Wrangler secret as unset-seed (FR-36 — the secret only
 * seeds; a saved setting always wins and takes effect without redeploy).
 */
export async function getPsnCookie(
	db: Db,
	userId: string,
	env: { PSN_SESSION_COOKIE?: string },
): Promise<string | undefined> {
	const stored = await getSetting(db, userId, PSN_COOKIE_SETTING_KEY);
	return stored || env.PSN_SESSION_COOKIE?.trim() || undefined;
}

/**
 * PSN store region (Story 5.1, AR-18/23): the locale the PS+ Extra catalog is
 * checked against. `SETTING` wins; the `PSN_REGION` Wrangler var only seeds —
 * and the seed is PERSISTED on first read so the button and the cron (5.2)
 * can never diverge on a config change between runs.
 */
export const PSN_REGION_SETTING_KEY = 'psn_region';

export async function getPsnRegion(
	db: Db,
	userId: string,
	env: { PSN_REGION?: string },
): Promise<string | undefined> {
	const stored = await getSetting(db, userId, PSN_REGION_SETTING_KEY);
	if (stored) return stored;
	const seed = env.PSN_REGION?.trim();
	if (!seed) return undefined;
	await setSetting(db, userId, PSN_REGION_SETTING_KEY, seed);
	return seed;
}

/** Persist the PSN-rejected state so the banner survives reloads (NFR-4). */
export async function markPsnAuthExpired(db: Db, userId: string) {
	await setSetting(db, userId, PSN_AUTH_SETTING_KEY, PSN_AUTH_EXPIRED);
}

/** A fresh cookie clears the expired flag (the banner's only exit). */
export async function clearPsnAuthExpired(db: Db, userId: string) {
	await deleteSetting(db, userId, PSN_AUTH_SETTING_KEY);
}

/** True while the last PSN call was rejected and no new cookie was saved. */
export async function isPsnAuthExpired(
	db: Db,
	userId: string,
): Promise<boolean> {
	return (
		(await getSetting(db, userId, PSN_AUTH_SETTING_KEY)) === PSN_AUTH_EXPIRED
	);
}

/**
 * Sync needs-attention items (Story 4.3, FR-37/AR-22): persisted per-user as
 * one JSON row so they survive dismissing the summary modal, reloads, and
 * sessions. Written only by a COMPLETED sync — a clean run clears the row
 * (self-resolution); a failed/auth-blocked run leaves it untouched.
 */
export const SYNC_ATTENTION_SETTING_KEY = 'sync_attention';

export interface SyncAttentionItem {
	title: string;
	reason: string;
}

/** Persisted needs-attention items; corrupt/absent JSON reads as empty. */
export async function readSyncAttention(
	db: Db,
	userId: string,
): Promise<SyncAttentionItem[]> {
	const raw = await getSetting(db, userId, SYNC_ATTENTION_SETTING_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) throw new Error('not an array');
		const items = parsed.filter(
			(item): item is SyncAttentionItem =>
				typeof item?.title === 'string' &&
				item.title.trim() !== '' &&
				typeof item?.reason === 'string',
		);
		if (items.length !== parsed.length) {
			console.warn(
				`sync_attention: dropped ${parsed.length - items.length} malformed item(s)`,
			);
		}
		return items;
	} catch (error) {
		// Corrupt storage degrades to "nothing needs attention" (the next
		// completed sync overwrites it) — but never silently.
		console.warn('sync_attention: unreadable row treated as empty', error);
		return [];
	}
}

/** Replace the persisted items; an empty list deletes the row (resolved). */
export async function writeSyncAttention(
	db: Db,
	userId: string,
	items: SyncAttentionItem[],
) {
	if (items.length === 0) {
		await deleteSetting(db, userId, SYNC_ATTENTION_SETTING_KEY);
	} else {
		await setSetting(
			db,
			userId,
			SYNC_ATTENTION_SETTING_KEY,
			JSON.stringify(items),
		);
	}
}
