/**
 * Import-straggler persistence (AD-4). AD-22 kind (a): rows that couldn't be
 * matched to a `game` during import (carry the raw Notion payload as JSON
 * text); not yet games. Anything the importer can't place lands here rather
 * than being guessed (FR-28/30).
 */
import { eq } from 'drizzle-orm';
import { importStraggler } from '../schema/catalog';
import type { Db } from './db';

/** Record an unmatched import row. */
export async function insertStraggler(
	db: Db,
	straggler: { sourceTitle: string; notionPayload?: string | null },
) {
	const [row] = await db.insert(importStraggler).values(straggler).returning();
	return row;
}

/** Every recorded straggler. */
export async function listStragglers(db: Db) {
	return db.select().from(importStraggler);
}

/** A single staging row by id, or undefined. */
export async function getStragglerById(db: Db, id: string) {
	const [row] = await db
		.select()
		.from(importStraggler)
		.where(eq(importStraggler.id, id))
		.limit(1);
	return row;
}

/** Drop a staging row once it has been resolved onto a real game. */
export async function deleteStraggler(db: Db, id: string) {
	await db.delete(importStraggler).where(eq(importStraggler.id, id));
}
