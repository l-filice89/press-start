/**
 * Per-user key-value settings (spine: `USER ||--o{ SETTING`). First tenant is
 * `timezone` (Epic 2 retro policy); Epic 5 adds region/PS+ keys. User-scoped
 * like all tracking access (AD-13).
 */
import { and, eq } from 'drizzle-orm';
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
