/**
 * Settings orchestration (Epic 2 retro timezone policy). `todayForUser` is
 * THE date-stamp source for every tracking write — all four stamp sites
 * (started_on, completed_on/platinum_on, bought_on) compute "today" in the
 * user's captured zone rather than the Worker's UTC clock.
 */
import { todayInZone } from '../core';
import { getSetting } from '../repositories';
import type { Db } from '../repositories/db';

export const TIMEZONE_SETTING_KEY = 'timezone';

/** Today's date (YYYY-MM-DD) in this user's timezone; UTC when unset. */
export async function todayForUser(db: Db, userId: string): Promise<string> {
	const timeZone = await getSetting(db, userId, TIMEZONE_SETTING_KEY);
	return todayInZone(timeZone, new Date());
}
