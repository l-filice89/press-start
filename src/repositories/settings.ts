/**
 * Per-user key-value settings (spine: `USER ||--o{ SETTING`). First tenant is
 * `timezone` (Epic 2 retro policy); Epic 5 adds region/PS+ keys. User-scoped
 * like all tracking access (AD-13).
 */
import { and, eq, sql } from 'drizzle-orm';
import { setting } from '../schema/catalog';
import type { Db } from './db';

/** One setting value for this user, or undefined. */
export async function getSetting(db: Db, userId: string, key: string) {
	const [row] = await db
		.select()
		.from(setting)
		.where(and(eq(setting.userId, userId), eq(setting.key, key)))
		.limit(1);
	return row?.value;
}

/**
 * Write a setting. `onlyIfUnset` is the first-login capture path: it never
 * overwrites a value the user may have edited (INSERT OR IGNORE, so the race
 * between two capture calls is harmless).
 */
/** Remove a setting row entirely ("unset", distinct from an empty value). */
export async function deleteSetting(db: Db, userId: string, key: string) {
	await db
		.delete(setting)
		.where(and(eq(setting.userId, userId), eq(setting.key, key)));
}

/**
 * Claim a per-user lock row ATOMICALLY (Story 9.5). One statement, because the
 * obvious read-then-write acquire ("is it free? then take it") is exactly the
 * race a lock exists to close — two tabs both read "free" and both sync.
 *
 * SQLite's upsert does it: the row is INSERTed when no lock is held, and the
 * DO UPDATE branch fires ONLY when the stored lock has expired. `value` starts
 * with the expiry in epoch millis, so `CAST(value AS INTEGER)` reads it (SQLite
 * takes the leading integer and ignores the `:op:uuid` tail). A held, unexpired
 * lock therefore updates nothing — and `RETURNING` gives back no row, which is
 * how the loser learns it lost.
 *
 * `heldToken` is the RENEWAL path: a caller that already owns the lock presents
 * the exact value it holds and takes it again (a fresh expiry). It is checked in
 * the SAME statement — a renewal that presents someone else's token, or a stale
 * one, loses exactly like a fresh claim would.
 *
 * NOTE the value format is load-bearing: `cast(… as integer)` is only an expiry
 * check because every value written through here STARTS with epoch millis. Do
 * not point this at an ordinary setting key — a normal string casts to 0, i.e.
 * "expired", and would be clobbered on the spot. `psn-lock.ts` is the one caller.
 */
export async function acquireLock(
	db: Db,
	userId: string,
	key: string,
	value: string,
	now: number,
	heldToken?: string,
): Promise<boolean> {
	const expired = sql`cast(${setting.value} as integer) < ${now}`;
	const rows = await db
		.insert(setting)
		.values({ userId, key, value })
		.onConflictDoUpdate({
			target: [setting.userId, setting.key],
			set: { value },
			setWhere: heldToken
				? sql`(${expired}) or ${setting.value} = ${heldToken}`
				: expired,
		})
		.returning({ value: setting.value });
	return rows.length > 0;
}

/** Release a lock — only if this caller still holds it (its exact token). */
export async function releaseLock(
	db: Db,
	userId: string,
	key: string,
	value: string,
) {
	await db
		.delete(setting)
		.where(
			and(
				eq(setting.userId, userId),
				eq(setting.key, key),
				eq(setting.value, value),
			),
		);
}

/**
 * Rewrite EVERY user's row for one key in a single UPDATE (Story 8.6): the
 * shared-`game`-fact writers (PS+ flags, leaving sweep, score refresh) must
 * invalidate every user's shelf ETag, and the `setting` FK to `user` rules out
 * one global row without a migration. Rows that don't exist yet are fine — the
 * version read lazily initializes, which is fresh by construction.
 */
export async function updateSettingForAllUsers(
	db: Db,
	key: string,
	value: string,
) {
	await db.update(setting).set({ value }).where(eq(setting.key, key));
}

export async function setSetting(
	db: Db,
	userId: string,
	key: string,
	value: string,
	{ onlyIfUnset = false } = {},
) {
	const insert = db.insert(setting).values({ userId, key, value });
	if (onlyIfUnset) {
		await insert.onConflictDoNothing();
	} else {
		await insert.onConflictDoUpdate({
			target: [setting.userId, setting.key],
			set: { value },
		});
	}
}
