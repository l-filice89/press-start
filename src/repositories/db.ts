/**
 * Single Drizzle construction point — the persistence seam (AD-4). Every
 * consumer of the database (repositories, better-auth's adapter) receives its
 * Drizzle instance from here; nothing else constructs one or issues raw D1
 * queries.
 *
 * `Db` is the shared async SQLite base rather than the concrete D1 type, so
 * BOTH the Worker's `drizzle-orm/d1` instance (via `createDb`) AND the Story
 * 1.6 seed script's `drizzle-orm/sqlite-proxy` instance (over the D1 HTTP API)
 * satisfy the repository functions — the same schema + repository code writes
 * D1 from either driver.
 */
import { drizzle } from 'drizzle-orm/d1';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from '../schema';

export function createDb(d1: D1Database) {
	return drizzle(d1, { schema });
}

/** Common async-SQLite surface shared by the D1 and D1-HTTP-proxy drivers. */
export type Db = BaseSQLiteDatabase<'async', unknown, typeof schema>;
