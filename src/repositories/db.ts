/**
 * Single Drizzle construction point — the persistence seam (AD-4). Every
 * consumer of the database (repositories in Story 1.4+, better-auth's
 * adapter today) receives its Drizzle instance from here; nothing else
 * constructs one or issues raw D1 queries.
 */
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../schema';

export function createDb(d1: D1Database) {
	return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
