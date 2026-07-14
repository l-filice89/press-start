/**
 * PS+ catalog snapshot persistence (Story 7.1, AD-24/26/28). The snapshot is
 * region+tier-scoped and generation-stamped: the membership pass upserts every
 * product under a fresh generation, then PRUNES whatever the run did not touch
 * — the table is the current catalog, not an ever-growing log. Genre tags
 * cascade with their product (schema FK), so a prune leaves no orphans.
 *
 * Every write here is BATCHED. A per-row loop over ~490 products would be ~490
 * D1 BINDING calls, and binding calls count against the Workers subrequest cap
 * (50 on the free tier, AD-15) — the same reason `setTrophyCountsBatch` exists.
 */

import { and, eq, ne } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { psPlusCatalog, psPlusCatalogGenre } from '../schema/catalog';
import type { Db } from './db';

/** The only tier 7.1 ingests; Premium's Classics catalog layers on later (AD-24). */
export const PS_PLUS_TIER = 'extra';

/** Statements per `db.batch` call — see the file header. */
const BATCH_SIZE = 50;

/** One catalog product as the ingest hands it over (provider record + the match key). */
export type CatalogProductWrite = {
	productId: string;
	npTitleId: string | null;
	name: string;
	titleNormalized: string;
	coverUrl: string | null;
	platforms: string[];
	storeClassification: string | null;
	storeUrl: string;
};

type Scope = { region: string; tier?: string };

async function runBatch<T extends BatchItem<'sqlite'>>(
	db: Db,
	statements: T[],
): Promise<void> {
	for (let i = 0; i < statements.length; i += BATCH_SIZE) {
		const chunk = statements.slice(i, i + BATCH_SIZE);
		await db.batch(chunk as [T, ...T[]]);
	}
}

/**
 * Upsert this run's products under `generation`. `first_seen_at` is written
 * once (the insert) and never touched again — a game that has sat in the
 * catalog since March keeps its March date; `last_seen_at` and `generation`
 * move every run.
 */
export async function upsertCatalogProducts(
	db: Db,
	{ region, tier = PS_PLUS_TIER }: Scope,
	generation: string,
	products: CatalogProductWrite[],
	now: string,
): Promise<void> {
	const statements = products.map((product) => {
		const row = {
			region,
			tier,
			productId: product.productId,
			npTitleId: product.npTitleId,
			name: product.name,
			titleNormalized: product.titleNormalized,
			coverUrl: product.coverUrl,
			platforms: JSON.stringify(product.platforms),
			storeClassification: product.storeClassification,
			storeUrl: product.storeUrl,
			generation,
			firstSeenAt: now,
			lastSeenAt: now,
		};
		const { firstSeenAt: _firstSeen, ...update } = row;
		return db
			.insert(psPlusCatalog)
			.values(row)
			.onConflictDoUpdate({
				target: [
					psPlusCatalog.region,
					psPlusCatalog.tier,
					psPlusCatalog.productId,
				],
				set: update,
			});
	});
	await runBatch(db, statements);
}

/**
 * Delete every row of this region+tier that is NOT of `generation` — the games
 * that left the catalog this run. Their genre tags cascade away with them.
 * Returns the pruned product ids (the caller reports them).
 *
 * ONE statement, so it costs one binding call whatever the catalog's size. The
 * caller must run the empty-catalog guard BEFORE this (AD-27): the prune is
 * exactly the write that would wipe the snapshot on a degenerate 200.
 */
export async function pruneCatalogGeneration(
	db: Db,
	{ region, tier = PS_PLUS_TIER }: Scope,
	generation: string,
): Promise<string[]> {
	const rows = await db
		.delete(psPlusCatalog)
		.where(
			and(
				eq(psPlusCatalog.region, region),
				eq(psPlusCatalog.tier, tier),
				ne(psPlusCatalog.generation, generation),
			),
		)
		.returning({ productId: psPlusCatalog.productId });
	return rows.map((row) => row.productId);
}

/**
 * The snapshot's normalized titles — the SOLE membership truth the flag pass
 * reads (AD-27). It reads the TABLE, never a second fetch.
 */
export async function listCatalogTitleKeys(
	db: Db,
	{ region, tier = PS_PLUS_TIER }: Scope,
): Promise<string[]> {
	const rows = await db
		.select({ titleNormalized: psPlusCatalog.titleNormalized })
		.from(psPlusCatalog)
		.where(and(eq(psPlusCatalog.region, region), eq(psPlusCatalog.tier, tier)));
	return rows.map((row) => row.titleNormalized);
}

/**
 * Every product id currently in the snapshot — the sweep filters its tag writes
 * through this (Story 7.1 review, M4): a genre-filtered query can name a product
 * that entered the store AFTER the last membership pass, and inserting its tag
 * violates the composite FK and kills the whole key. It is not an error, just an
 * arrival: the next membership pass brings it into the snapshot and the sweep
 * after that tags it.
 */
export async function listCatalogProductIds(
	db: Db,
	{ region, tier = PS_PLUS_TIER }: Scope,
): Promise<string[]> {
	const rows = await db
		.select({ productId: psPlusCatalog.productId })
		.from(psPlusCatalog)
		.where(and(eq(psPlusCatalog.region, region), eq(psPlusCatalog.tier, tier)));
	return rows.map((row) => row.productId);
}

/**
 * Delete every snapshot row belonging to a region OTHER than the active one
 * (Story 7.1 review, M6). The prune is region-scoped, so flipping `PSN_REGION`
 * would otherwise strand the old region's ~490 rows forever — and 7.2's grid
 * reads by region, so they are invisible garbage that never dies.
 */
export async function deleteCatalogOutsideRegion(
	db: Db,
	region: string,
): Promise<void> {
	await db.delete(psPlusCatalog).where(ne(psPlusCatalog.region, region));
}

/**
 * Set the tag set of ONE genre facet key: delete this key's rows, insert the
 * ones the store just named — in the SAME batch, so it is one transaction.
 *
 * DELETE-THEN-INSERT, not insert-if-absent (Story 7.1 review, H4). A pure
 * `onConflictDoNothing` never prunes: a product the store RE-CLASSIFIES (ACTION
 * → BRAWLER) keeps its product row (the upsert refreshes it, nothing cascades)
 * and therefore keeps its stale ACTION tag forever — 7.2's genre filter would
 * keep returning it under a genre it left. Scoping the delete to the ONE key
 * being swept is what keeps a failed/skipped key's existing tags alive (AD-28:
 * a partial sweep never invalidates what is already tagged).
 */
export async function setCatalogGenres(
	db: Db,
	{ region, tier = PS_PLUS_TIER }: Scope,
	genreKey: string,
	productIds: string[],
): Promise<void> {
	const scoped = and(
		eq(psPlusCatalogGenre.region, region),
		eq(psPlusCatalogGenre.tier, tier),
		eq(psPlusCatalogGenre.genreKey, genreKey),
	);
	const statements: BatchItem<'sqlite'>[] = [
		db.delete(psPlusCatalogGenre).where(scoped),
		...productIds.map((productId) =>
			db
				.insert(psPlusCatalogGenre)
				.values({ region, tier, productId, genreKey })
				.onConflictDoNothing(),
		),
	];
	await runBatch(db, statements);
}

/** Every genre tag of a region+tier (7.2 reads it; the tests assert on it). */
export async function listCatalogGenres(
	db: Db,
	{ region, tier = PS_PLUS_TIER }: Scope,
): Promise<{ productId: string; genreKey: string }[]> {
	return db
		.select({
			productId: psPlusCatalogGenre.productId,
			genreKey: psPlusCatalogGenre.genreKey,
		})
		.from(psPlusCatalogGenre)
		.where(
			and(
				eq(psPlusCatalogGenre.region, region),
				eq(psPlusCatalogGenre.tier, tier),
			),
		);
}

/** The stored snapshot (7.2's grid reads this; 7.1's tests assert on it). */
export async function listCatalogProducts(
	db: Db,
	{ region, tier = PS_PLUS_TIER }: Scope,
) {
	return db
		.select()
		.from(psPlusCatalog)
		.where(and(eq(psPlusCatalog.region, region), eq(psPlusCatalog.tier, tier)));
}
