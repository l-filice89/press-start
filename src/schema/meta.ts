/**
 * Drizzle schema — Story 1.1 walking skeleton.
 *
 * This is intentionally a single, minimal table that exists only to prove the
 * D1 + Drizzle + drizzle-kit migration pipeline end-to-end (generate ->
 * `wrangler d1 migrations apply` -> deploy). Real domain entities (GAME,
 * GAME_TRACKING, GENRE, EXTERNAL_LINK, SETTING, ...) land in Story 1.4 per the
 * architecture spine's Structural Seed — do not add them here.
 */
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const meta = sqliteTable('meta', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
});
