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
