/**
 * Settings orchestration (Epic 2 retro timezone policy). `todayForUser` is
 * THE date-stamp source for every tracking write — all four stamp sites
 * (started_on, completed_on/platinum_on, bought_on) compute "today" in the
 * user's captured zone rather than the Worker's UTC clock.
 */
import { todayInZone } from '../core';
import {
	deleteSettingForAllUsers,
	getRegionState,
	getSetting,
	setRegionLeavingState,
	setRegionSweepState,
	setSetting,
	setSettingForAllUsers,
} from '../repositories';
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
 * Regional freshness (Story 8.4): the "PS+ CATALOG AS OF {date}" readout reads
 * the region ledger's `last_success` — a per-region fact, not a per-user one.
 * The failure banner machinery died with the manual button (AD-31: refresh
 * failures are passive; users have no action to take).
 */
export async function getPsPlusRefreshedAt(
	db: Db,
	region: string | null,
): Promise<string | null> {
	if (!region) return null;
	return (await getRegionState(db, region))?.lastSuccess ?? null;
}

/**
 * IGDB score refresh bookkeeping (Story 10.1, FR-40/AR-14 posture — the exact
 * shape of the PS+ pair above). `scores_refreshed_at` is stamped on every
 * successful refresh and gates the refresh cadence. `scores_refresh_failed`
 * lights the attention banner; any successful refresh clears it.
 *
 * The FLAG is all-users (deferred-work 2026-07-19): scores live on the shared
 * `game` rows, so one refresh outcome is every user's outcome — writing it for
 * the driving user only left every other user's FR-40 banner blind. The STAMP
 * stays keyed to the driving user: it is cron cadence bookkeeping, read back by
 * the same scheduler that wrote it.
 */
export const SCORES_REFRESH_FAILED_SETTING_KEY = 'scores_refresh_failed';
const SCORES_REFRESH_FAILED = 'failed';

export async function markScoresRefreshFailed(db: Db) {
	await setSettingForAllUsers(
		db,
		SCORES_REFRESH_FAILED_SETTING_KEY,
		SCORES_REFRESH_FAILED,
	);
}

export async function clearScoresRefreshFailed(db: Db) {
	await deleteSettingForAllUsers(db, SCORES_REFRESH_FAILED_SETTING_KEY);
}

export async function isScoresRefreshFailed(
	db: Db,
	userId: string,
): Promise<boolean> {
	return (
		(await getSetting(db, userId, SCORES_REFRESH_FAILED_SETTING_KEY)) ===
		SCORES_REFRESH_FAILED
	);
}

export const SCORES_REFRESHED_AT_SETTING_KEY = 'scores_refreshed_at';

export async function stampScoresRefreshedAt(db: Db, userId: string) {
	await setSetting(
		db,
		userId,
		SCORES_REFRESHED_AT_SETTING_KEY,
		await todayForUser(db, userId),
	);
}

export async function getScoresRefreshedAt(
	db: Db,
	userId: string,
): Promise<string | null> {
	return (
		(await getSetting(db, userId, SCORES_REFRESHED_AT_SETTING_KEY)) ?? null
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
 *   the next chunk without a client. The cron fires 28× a month (`0 9,21 15-28 * *`),
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

// Story 8.4: sweep state lives on the REGION ledger (a userless cron cannot
// key state by user). Same JSON shape, same semantics — only the home moved.
export async function getPsPlusSweepState(
	db: Db,
	region: string,
): Promise<PsPlusSweepState | null> {
	const raw = (await getRegionState(db, region))?.sweepState;
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
	region: string,
	state: PsPlusSweepState,
) {
	await setRegionSweepState(db, region, JSON.stringify(state));
}

/**
 * Leaving-sweep resume state (Story 10.4) — the genre sweep's shape adapted to
 * a GAME-id cursor: generation-keyed so a fresh membership snapshot restarts
 * it, cursor kept server-side so the cron drives chunks without a client. A
 * corrupt row parses to null and the next refresh rewrites it, same as above.
 */
export const PSPLUS_LEAVING_STATE_SETTING_KEY = 'psplus_leaving_state';

export interface PsPlusLeavingState {
	region: string;
	generation: string;
	/** Last game id finished; null = start from the beginning. */
	cursor: string | null;
	/**
	 * Wholesale failures of the CURRENT chunk (review: livelock guard). The
	 * second consecutive one steps the cursor PAST the chunk — a poison product
	 * must not pin the rotation forever; its games retry next re-arm.
	 */
	attempts: number;
	done: boolean;
}

// Story 8.4: region-homed like the sweep state above.
export async function getPsPlusLeavingState(
	db: Db,
	region: string,
): Promise<PsPlusLeavingState | null> {
	const raw = (await getRegionState(db, region))?.leavingState;
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PsPlusLeavingState;
	} catch {
		return null;
	}
}

export async function setPsPlusLeavingState(
	db: Db,
	region: string,
	state: PsPlusLeavingState,
) {
	await setRegionLeavingState(db, region, JSON.stringify(state));
}
