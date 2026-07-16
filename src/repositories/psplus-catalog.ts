/**
 * PS+ catalog snapshot persistence (Story 7.1, AD-24/26/28). The snapshot is
 * region+tier-scoped and generation-stamped: the membership pass upserts every
 * product under a fresh generation, then PRUNES whatever the run did not touch
 * — the table is the current catalog, not an ever-growing log. Genre tags
 * cascade with their product (schema FK), so a prune leaves no orphans.
 *
 * Every write here is BATCHED. A per-row loop over ~490 products would be ~490
 * D1 BINDING calls, and binding calls count against the Workers subrequest cap
 * (50 on the free tier, AD-15).
 */

import { and, count, eq, inArray, ne, sql } from 'drizzle-orm';
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
 *
 * DW-13 (decided, Story 10.2): `first_seen_at` means "first seen since the
 * LAST PRUNE", not "first ever seen" — a pruned-then-readded title comes back
 * as a fresh INSERT, so the date restamps. That is accepted and documented,
 * not fixed: nothing reads the column, and the 10.2 departure warning
 * deliberately derives from the game-level flag transition instead (re-entry
 * NULLs `game.ps_plus_left_on`), so a returning game can never misread as a
 * new arrival. Any future consumer of catalog HISTORY must not treat this
 * column as "first ever seen".
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
 * Title-key → product-id pairs for the whole snapshot (Story 10.4) — the
 * leaving sweep joins flagged games to their store products on the SAME
 * normalized key the flag pass matches on, so the two can never disagree.
 */
export async function listCatalogTitleProducts(
	db: Db,
	{ region, tier = PS_PLUS_TIER }: Scope,
): Promise<{ titleNormalized: string; productId: string }[]> {
	return db
		.select({
			titleNormalized: psPlusCatalog.titleNormalized,
			productId: psPlusCatalog.productId,
		})
		.from(psPlusCatalog)
		.where(and(eq(psPlusCatalog.region, region), eq(psPlusCatalog.tier, tier)));
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

/** One catalog row as the browse destination renders it (Story 7.2). */
export type CatalogBrowseRow = {
	productId: string;
	/** The sync's identity for the game (`EXTERNAL_LINK('PSN', …)`) — the marker
	 * joins on it, so a SYNCED game whose PSN title differs from the store's name
	 * still reads Owned (Epic 7 cross-story review, H1). */
	npTitleId: string | null;
	name: string;
	titleNormalized: string;
	coverUrl: string | null;
	storeUrl: string | null;
	/** JSON array text as stored, e.g. `["PS4","PS5"]`. The browse view collapses a
	 * PS4/PS5 edition PAIR onto one card, and disjoint platforms are what
	 * distinguish that pair from two different games that merely share a title
	 * (NieR / NIER). */
	platforms: string | null;
};

/** LIKE wildcards in a user-typed term are literal characters, not syntax. */
const escapeLike = (term: string) =>
	term.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * The catalog browse read (Story 7.2, AD-6 — repositories only, nothing
 * external on render). Narrows the region+tier snapshot by genre facet keys (OR
 * within the group, AD-26) and a case/diacritic-insensitive title substring.
 *
 * SEARCH matches `title_normalized`, never `lower(name)` (review, M2): SQLite's
 * `lower()` is ASCII-ONLY, so "Pokémon", "Ōkami" and "YŌTEI" were unfindable in
 * the catalog while the shelf's client-side search folded them correctly — one
 * input, two destinations, two different rules. The column already holds the
 * AD-9 `normalizeTitle` key, so the caller folds the TERM with the same
 * function and the two surfaces answer alike.
 *
 * ORDER BY is deterministic (review, M1): the service still materializes the
 * A–Z order with `core/compareTitle` (AD-7), but that comparator is `sensitivity:
 * 'base'` — NieR and NIER compare EQUAL — and paging is an offset over a
 * per-request sort. With no SQL order at all, D1's tie order is unspecified, so
 * two base-equal titles straddling a page boundary could swap between requests:
 * one row served twice, one never shown. The SQL order feeds the sort a stable
 * input; the sort's own tiebreak on `productId` closes it.
 */
export async function listCatalogForBrowse(
	db: Db,
	{ region, tier = PS_PLUS_TIER }: Scope,
	{
		genreKeys,
		searchNormalized,
	}: { genreKeys?: string[]; searchNormalized?: string } = {},
): Promise<CatalogBrowseRow[]> {
	const scoped = [
		eq(psPlusCatalog.region, region),
		eq(psPlusCatalog.tier, tier),
	];
	if (searchNormalized) {
		scoped.push(
			sql`${psPlusCatalog.titleNormalized} LIKE ${`%${escapeLike(searchNormalized)}%`} ESCAPE '\\'`,
		);
	}
	if (genreKeys && genreKeys.length > 0) {
		scoped.push(
			inArray(
				psPlusCatalog.productId,
				db
					.select({ productId: psPlusCatalogGenre.productId })
					.from(psPlusCatalogGenre)
					.where(
						and(
							eq(psPlusCatalogGenre.region, region),
							eq(psPlusCatalogGenre.tier, tier),
							inArray(psPlusCatalogGenre.genreKey, genreKeys),
						),
					),
			),
		);
	}
	return db
		.select({
			productId: psPlusCatalog.productId,
			npTitleId: psPlusCatalog.npTitleId,
			name: psPlusCatalog.name,
			titleNormalized: psPlusCatalog.titleNormalized,
			coverUrl: psPlusCatalog.coverUrl,
			storeUrl: psPlusCatalog.storeUrl,
			platforms: psPlusCatalog.platforms,
		})
		.from(psPlusCatalog)
		.where(and(...scoped))
		.orderBy(psPlusCatalog.titleNormalized, psPlusCatalog.productId);
}

/**
 * How many products the snapshot holds — the EMPTY CATALOG vs NO MATCH question
 * (review, M5). It used to be `(await listCatalogForBrowse(db, scope)).length`:
 * a FULL table read of ~490 rows on every filtered page, thrown away except for
 * its length. That is a count.
 */
export async function countCatalogProducts(
	db: Db,
	{ region, tier = PS_PLUS_TIER }: Scope,
): Promise<number> {
	const rows = await db
		.select({ total: count() })
		.from(psPlusCatalog)
		.where(and(eq(psPlusCatalog.region, region), eq(psPlusCatalog.tier, tier)));
	return rows[0]?.total ?? 0;
}

/**
 * ONE catalog product by its store id — what the add-from-catalog path (Story
 * 7.3) resolves before it writes anything. The catalog page the user is looking
 * at can be minutes stale (the cron prunes, and the destination refreshes
 * itself), so the product id in the POST body is a CLAIM, not a fact: a product
 * pruned since render resolves to `undefined` and the add proceeds on the title
 * alone, never writing a `PSN_PRODUCT` link (or a store URL) for a product the
 * catalog no longer has.
 *
 * Deliberately NOT region-scoped: a store product id is globally unique, and the
 * add does not care which region's snapshot carried it — the row is only read
 * for its facts.
 */
export async function findCatalogProduct(
	db: Db,
	productId: string,
): Promise<
	| {
			productId: string;
			/** The PSN title id, when the store gave one — the add anchors it as
			 * `EXTERNAL_LINK('PSN', np_title_id)` so a later library sync MATCHES the
			 * game instead of creating a second row off a diverged title (7.3 H4). */
			npTitleId: string | null;
			storeUrl: string | null;
			coverUrl: string | null;
	  }
	| undefined
> {
	const [row] = await db
		.select({
			productId: psPlusCatalog.productId,
			npTitleId: psPlusCatalog.npTitleId,
			storeUrl: psPlusCatalog.storeUrl,
			coverUrl: psPlusCatalog.coverUrl,
		})
		.from(psPlusCatalog)
		.where(eq(psPlusCatalog.productId, productId))
		.limit(1);
	return row;
}

/**
 * The snapshot's current generation (Story 7.2 review, M3) — the browse page
 * carries it so the client can tell a torn offset-paged read (a refresh landing
 * between page 1 and page 2) from an intact one. null = the snapshot is empty.
 */
export async function getCatalogGeneration(
	db: Db,
	{ region, tier = PS_PLUS_TIER }: Scope,
): Promise<string | null> {
	const rows = await db
		.select({ generation: psPlusCatalog.generation })
		.from(psPlusCatalog)
		.where(and(eq(psPlusCatalog.region, region), eq(psPlusCatalog.tier, tier)))
		.limit(1);
	return rows[0]?.generation ?? null;
}

// `countCatalogGenreKeys` (a SQL GROUP BY over the tag table) is GONE (DW-11):
// it counted SKUs while the grid counts collapsed cards, so the chip and the
// grid disagreed on any PS4/PS5 edition pair. The facet counts now run through
// `services/psplus-browse.ts`'s own collapse — one pipeline, one answer.
