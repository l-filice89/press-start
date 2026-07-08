/**
 * User lookup (AD-4). The seed import (Story 1.6) scopes all tracking rows to
 * Luca's real `user.id` (AD-13), resolved by email — the `user` table is owned
 * by better-auth and populated on his first magic-link sign-in.
 */
import { eq } from 'drizzle-orm';
import { user } from '../schema/auth';
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
