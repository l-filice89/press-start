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
	return todayInZone(await getUserTimeZone(db, userId), new Date());
}

/**
 * The user's captured IANA zone (null when unset). Read once per run by a
 * caller that stamps MANY dates — the Story 9.3 backfill converts each
 * platinum's UTC instant with `todayInZone(zone, instant)`, the same zone
 * `todayForUser` stamps "today" with.
 */
export async function getUserTimeZone(
	db: Db,
	userId: string,
): Promise<string | null> {
	return (await getSetting(db, userId, TIMEZONE_SETTING_KEY)) ?? null;
}

/** FAB placement (Story 6.3, UX-DR10): `'left'`|`'right'`, absent = `'right'`. */
export const FAB_HANDEDNESS_SETTING_KEY = 'fab_handedness';
export type FabHandedness = 'left' | 'right';

/** This user's FAB handedness; defaults to right-handed when unset. */
export async function readFabHandedness(
	db: Db,
	userId: string,
): Promise<FabHandedness> {
	return (await getSetting(db, userId, FAB_HANDEDNESS_SETTING_KEY)) === 'left'
		? 'left'
		: 'right';
}

/**
 * PSN store region (Story 5.1, AR-18/23): the locale the PS+ Extra catalog is
 * checked against. `SETTING` wins; the `PSN_REGION` Wrangler var only seeds —
 * and the seed is PERSISTED on first read so the button and the cron (5.2)
 * can never diverge on a config change between runs.
 */
export const PSN_REGION_SETTING_KEY = 'psn_region';

/**
 * THE locale-shape rule for `psn_region` — both write paths (the PUT and the
 * env seed below) must agree, or a case-mismatched seed orphans catalog rows
 * keyed by the raw string. Returns the normalized value, or undefined when
 * the shape is wrong.
 */
export function normalizePsnRegion(
	value: string | undefined,
): string | undefined {
	const v = value?.trim().toLowerCase();
	return v && /^[a-z]{2}(-[a-z]{2,4})?-[a-z]{2}$/.test(v) ? v : undefined;
}

export async function getPsnRegion(
	db: Db,
	userId: string,
	env: { PSN_REGION?: string },
): Promise<string | undefined> {
	const stored = await getSetting(db, userId, PSN_REGION_SETTING_KEY);
	if (stored) return stored;
	// A malformed Wrangler var is NOT persisted — behaves as unset rather than
	// storing a value the PUT validator would refuse.
	const seed = normalizePsnRegion(env.PSN_REGION);
	if (!seed) return undefined;
	await setSetting(db, userId, PSN_REGION_SETTING_KEY, seed);
	return seed;
}

/**
 * Scheduled PS+ Extra refresh failure (Story 5.2, FR-40/AR-14). `'failed'`
 * while the last MONTHLY cron run could not refresh the catalog; absent
 * otherwise. Only the stateless cron sets it (a button failure is a toast,
 * 5.1); any successful `runPsPlusCheck` — cron or button — clears it, so the
 * banner self-resolves the moment the catalog is refreshed by any path.
 */
export const PSPLUS_REFRESH_FAILED_SETTING_KEY = 'psplus_refresh_failed';
const PSPLUS_REFRESH_FAILED = 'failed';

export async function markPsPlusRefreshFailed(db: Db, userId: string) {
	await setSetting(
		db,
		userId,
		PSPLUS_REFRESH_FAILED_SETTING_KEY,
		PSPLUS_REFRESH_FAILED,
	);
}

export async function clearPsPlusRefreshFailed(db: Db, userId: string) {
	await deleteSetting(db, userId, PSPLUS_REFRESH_FAILED_SETTING_KEY);
}

export async function isPsPlusRefreshFailed(
	db: Db,
	userId: string,
): Promise<boolean> {
	return (
		(await getSetting(db, userId, PSPLUS_REFRESH_FAILED_SETTING_KEY)) ===
		PSPLUS_REFRESH_FAILED
	);
}

/**
 * Last successful PS+ Extra refresh date (Story 5.3, FR-40/AR-18). Written on
 * every successful `runPsPlusCheck` (button or cron) as `todayForUser` — the
 * same user-zone date source as every tracking stamp — and read by the header
 * "PS+ CATALOG AS OF {date}" readout. A failed run leaves the prior value.
 */
export const PSPLUS_REFRESHED_AT_SETTING_KEY = 'psplus_refreshed_at';

export async function stampPsPlusRefreshedAt(db: Db, userId: string) {
	await setSetting(
		db,
		userId,
		PSPLUS_REFRESHED_AT_SETTING_KEY,
		await todayForUser(db, userId),
	);
}

export async function getPsPlusRefreshedAt(
	db: Db,
	userId: string,
): Promise<string | null> {
	return (
		(await getSetting(db, userId, PSPLUS_REFRESHED_AT_SETTING_KEY)) ?? null
	);
}

/**
 * PS+ CATALOG SWEEP STATE (Story 7.1 review, M1/M2/M5) — one `setting` row, the
 * whole state machine of the catalog ingest:
 *
 * - `generation` is the AUTHORITATIVE snapshot generation. It is NOT re-derived
 *   by sniffing an arbitrary catalog row (an unordered `limit(1)` over 490 rows
 *   answers a different generation depending on the query plan).
 * - `keys` is the facet key list FROZEN at sweep start. Re-discovering it on
 *   every chunk walks a SHIFTING list: a key that appears mid-sweep and sorts
 *   before the cursor would never be swept at all.
 * - `cursor` is the sweep's resume point, kept SERVER-side so the CRON can drive
 *   the next chunk without a client. The cron fires 7× a month (`0 21 15-21 * *`),
 *   so a ~5-chunk sweep converges within days and self-heals after a failure.
 *   The HTTP endpoint still accepts a cursor for 7.2's client-driven loop.
 */
export const PSPLUS_SWEEP_STATE_SETTING_KEY = 'psplus_sweep_state';

export interface PsPlusSweepState {
	region: string;
	generation: string;
	/** Frozen at discovery; empty = not discovered yet. */
	keys: string[];
	/** Last key finished; null = start from the beginning. */
	cursor: string | null;
	/** Keys the store would not answer for — they wait for the next sweep. */
	skipped: string[];
	/** The frozen key list is exhausted. */
	done: boolean;
}

export async function getPsPlusSweepState(
	db: Db,
	userId: string,
): Promise<PsPlusSweepState | null> {
	const raw = await getSetting(db, userId, PSPLUS_SWEEP_STATE_SETTING_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PsPlusSweepState;
	} catch {
		// A corrupt row is not a reason to refuse forever — the next refresh
		// rewrites it.
		return null;
	}
}

export async function setPsPlusSweepState(
	db: Db,
	userId: string,
	state: PsPlusSweepState,
) {
	await setSetting(
		db,
		userId,
		PSPLUS_SWEEP_STATE_SETTING_KEY,
		JSON.stringify(state),
	);
}
