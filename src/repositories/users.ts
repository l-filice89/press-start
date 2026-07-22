/**
 * User lookup (AD-4). The seed import (Story 1.6) scopes all tracking rows to
 * Luca's real `user.id` (AD-13), resolved by email — the `user` table is owned
 * by better-auth and populated on his first magic-link sign-in.
 */
import { eq, lte } from 'drizzle-orm';
import { user, verification } from '../schema/auth';
import type { Db } from './db';

/** The single user with this email, or undefined. `email` is unique. */
export async function findUserByEmail(db: Db, email: string) {
	const [row] = await db
		.select()
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	return row;
}

/**
 * The OLDEST registered user — the cron's interim identity (Story 8.2).
 * ponytail: single-tenant bridge after the allowlist died; Story 8.4's
 * per-region model deletes this (the cron then fans out over regions, not a
 * user). Deterministic tiebreak on id for equal timestamps.
 */
export async function findOldestUser(db: Db) {
	const [row] = await db
		.select()
		.from(user)
		.orderBy(user.createdAt, user.id)
		.limit(1);
	return row;
}

/**
 * Sweep expired better-auth `verification` rows (Story 8.2, AD-29): open
 * registration means any stranger's abandoned sign-in writes one; the WAF
 * rate limit slows the growth and this deletes what has expired.
 */
export async function deleteExpiredVerifications(db: Db, now: Date) {
	// lte: a row expiring at the exact sweep instant is expired.
	await db.delete(verification).where(lte(verification.expiresAt, now));
}
