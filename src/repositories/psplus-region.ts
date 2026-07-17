/**
 * The region-state ledger (Story 8.4, AD-31): retry/quarantine bookkeeping,
 * cycle-complete, activity, and the per-region sweep/leaving state homes. One
 * row per (region, tier); rows are tiny and permanent.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { psPlusRegionState, setting } from '../schema/catalog';
import type { Db } from './db';

const TIER = 'extra';

export type RegionState = typeof psPlusRegionState.$inferSelect;

export async function getRegionState(
	db: Db,
	region: string,
): Promise<RegionState | null> {
	const [row] = await db
		.select()
		.from(psPlusRegionState)
		.where(
			and(
				eq(psPlusRegionState.region, region),
				eq(psPlusRegionState.tier, TIER),
			),
		)
		.limit(1);
	return row ?? null;
}

export async function listRegionStates(db: Db): Promise<RegionState[]> {
	return db
		.select()
		.from(psPlusRegionState)
		.where(eq(psPlusRegionState.tier, TIER));
}

/** Every distinct region registered users have set — the cron's fan-out set.
 * Defensively re-validated (review): a malformed stored value must not mint a
 * ledger row or drive a store fetch with a bad locale. */
const REGION_SHAPE = /^[a-z]{2}(-[a-z]{2,4})?-[a-z]{2}$/;
export async function listDistinctUserRegions(db: Db): Promise<string[]> {
	const rows = await db
		.selectDistinct({ value: setting.value })
		.from(setting)
		.where(and(eq(setting.key, 'psn_region'), ne(setting.value, '')));
	return rows.map((r) => r.value).filter((v) => REGION_SHAPE.test(v));
}

/** Ensure a ledger row exists (no-op if present). */
export async function ensureRegionState(db: Db, region: string) {
	await db
		.insert(psPlusRegionState)
		.values({ region, tier: TIER })
		.onConflictDoNothing();
}

/**
 * Stamp user activity for the idle-skip — date-gated so it costs at most one
 * write per region per day (AD-32).
 */
export async function touchRegionActivity(
	db: Db,
	region: string,
	today: string,
) {
	await db
		.insert(psPlusRegionState)
		.values({ region, tier: TIER, lastUserActivity: today })
		.onConflictDoUpdate({
			target: [psPlusRegionState.region, psPlusRegionState.tier],
			set: { lastUserActivity: today },
			setWhere: sql`COALESCE(${psPlusRegionState.lastUserActivity}, '') != ${today}`,
		});
}

/**
 * Record a slot outcome. CROSSING A WINDOW RESETS THE WINDOW-SCOPED COUNTERS
 * in the same statement (review, H3): the picker's lazy reset only fires on
 * `state.window !== window`, so an outcome that merely stamped the new window
 * (e.g. the shelf guard on day 3) would otherwise carry June's cycle-complete
 * and quarantine into July unreset.
 */
export async function recordRegionOutcome(
	db: Db,
	region: string,
	outcome: {
		attemptedOn: string;
		succeeded: boolean;
		window: string;
	},
) {
	await ensureRegionState(db, region);
	const crossed = sql`CASE WHEN COALESCE(${psPlusRegionState.window}, '') != ${outcome.window} THEN 1 ELSE 0 END`;
	await db
		.update(psPlusRegionState)
		.set({
			lastAttempt: outcome.attemptedOn,
			window: outcome.window,
			cycleComplete: sql`CASE WHEN ${crossed} = 1 THEN 0 ELSE ${psPlusRegionState.cycleComplete} END`,
			...(outcome.succeeded
				? { lastSuccess: outcome.attemptedOn, failureCount: 0 }
				: {
						failureCount: sql`CASE WHEN ${crossed} = 1 THEN 1 ELSE ${psPlusRegionState.failureCount} + 1 END`,
					}),
		})
		.where(
			and(
				eq(psPlusRegionState.region, region),
				eq(psPlusRegionState.tier, TIER),
			),
		);
}

/** Set cycle-complete WITHOUT laundering it through a success outcome
 * (review, M4): sweep-only invocations must not forge `last_success`. */
export async function markRegionCycleComplete(db: Db, region: string) {
	await db
		.update(psPlusRegionState)
		.set({ cycleComplete: true })
		.where(
			and(
				eq(psPlusRegionState.region, region),
				eq(psPlusRegionState.tier, TIER),
			),
		);
}

/** A new rotation window opened: reset the counters that belong to a window. */
export async function resetRegionWindow(
	db: Db,
	region: string,
	window: string,
) {
	await ensureRegionState(db, region);
	await db
		.update(psPlusRegionState)
		.set({ window, cycleComplete: false, failureCount: 0 })
		.where(
			and(
				eq(psPlusRegionState.region, region),
				eq(psPlusRegionState.tier, TIER),
			),
		);
}

export async function setRegionSweepState(
	db: Db,
	region: string,
	json: string | null,
) {
	await ensureRegionState(db, region);
	await db
		.update(psPlusRegionState)
		.set({ sweepState: json })
		.where(
			and(
				eq(psPlusRegionState.region, region),
				eq(psPlusRegionState.tier, TIER),
			),
		);
}

export async function setRegionLeavingState(
	db: Db,
	region: string,
	json: string | null,
) {
	await ensureRegionState(db, region);
	await db
		.update(psPlusRegionState)
		.set({ leavingState: json })
		.where(
			and(
				eq(psPlusRegionState.region, region),
				eq(psPlusRegionState.tier, TIER),
			),
		);
}

/**
 * Region-lock CAS (Story 8.4): claim when free or expired (the stored value
 * STARTS with epoch-ms expiry, same format discipline as `acquireLock` — do
 * not point this at a non-lock value). One UPDATE, checked by RETURNING.
 */
export async function claimRegionLock(
	db: Db,
	region: string,
	token: string,
	now: number,
): Promise<boolean> {
	const rows = await db
		.update(psPlusRegionState)
		.set({ lock: token })
		.where(
			and(
				eq(psPlusRegionState.region, region),
				eq(psPlusRegionState.tier, TIER),
				sql`(${psPlusRegionState.lock} IS NULL OR CAST(${psPlusRegionState.lock} AS INTEGER) < ${now})`,
			),
		)
		.returning({ region: psPlusRegionState.region });
	return rows.length > 0;
}

/** Release only the caller's own lock (token match). */
export async function releaseRegionLock(db: Db, region: string, token: string) {
	await db
		.update(psPlusRegionState)
		.set({ lock: null })
		.where(
			and(
				eq(psPlusRegionState.region, region),
				eq(psPlusRegionState.tier, TIER),
				eq(psPlusRegionState.lock, token),
			),
		);
}
