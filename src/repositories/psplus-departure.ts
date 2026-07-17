/**
 * The region-keyed PS+ departure ledger (Story 8.3, AD-30). Ownership is
 * split and load-bearing: the MEMBERSHIP PASS owns `left_on` (stamped on
 * prune, cleared on re-entry — DW-13; rows are never deleted by presence,
 * because the sweep's fields must survive the pass); the LEAVING SWEEP owns
 * `leaving_on` and `psn_concept_id`. Rows have no FK to `ps_plus_catalog` —
 * a departed product is precisely the one whose catalog row the prune
 * deleted, and this ledger outlives it.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { psPlusDeparture } from '../schema/catalog';
import type { Db } from './db';

const CHUNK = 90; // D1 bind cap headroom beside the fixed binds

type Scope = { region: string; tier?: string };
const TIER = 'extra';

export type DepartureSeed = {
	productId: string;
	npTitleId: string | null;
	titleNormalized: string;
};

/**
 * Stamp departures for pruned products: upsert `{left_on}` per product,
 * NULLing `leaving_on` in the same statement (a departed game's future
 * "leaving" warning is moot — the 10.4 rule carried over). Preserves any
 * cached concept id.
 */
export async function stampDepartures(
	db: Db,
	{ region, tier = TIER }: Scope,
	products: DepartureSeed[],
	leftOn: string,
) {
	if (products.length === 0) return;
	const statements = products.map((p) =>
		db
			.insert(psPlusDeparture)
			.values({
				region,
				tier,
				productId: p.productId,
				npTitleId: p.npTitleId,
				titleNormalized: p.titleNormalized,
				leftOn,
				leavingOn: null,
			})
			.onConflictDoUpdate({
				target: [
					psPlusDeparture.region,
					psPlusDeparture.tier,
					psPlusDeparture.productId,
				],
				// Join keys refresh too (review): a renamed/renumbered product must
				// not leave the ledger probing on stale keys.
				set: {
					leftOn,
					leavingOn: null,
					titleNormalized: p.titleNormalized,
					npTitleId: p.npTitleId,
				},
			}),
	);
	// Chunked (review): a mass departure (a region rotating hundreds of rows)
	// must not exceed D1's per-batch statement ceiling.
	for (let i = 0; i < statements.length; i += CHUNK) {
		const slice = statements.slice(i, i + CHUNK);
		await db.batch(slice as [(typeof slice)[0], ...typeof slice]);
	}
}

/**
 * Re-entry (DW-13): products present in the new generation clear their
 * departure stamp — the row and its sweep-owned fields survive.
 */
export async function clearDeparturesForProducts(
	db: Db,
	{ region, tier = TIER }: Scope,
	productIds: string[],
) {
	if (productIds.length === 0) return;
	const statements = [];
	for (let i = 0; i < productIds.length; i += CHUNK) {
		statements.push(
			db
				.update(psPlusDeparture)
				.set({ leftOn: null })
				.where(
					and(
						eq(psPlusDeparture.region, region),
						eq(psPlusDeparture.tier, tier),
						// Only stamped rows — an already-null left_on is not a write.
						isNotNull(psPlusDeparture.leftOn),
						inArray(psPlusDeparture.productId, productIds.slice(i, i + CHUNK)),
					),
				),
		);
	}
	await db.batch(statements as [(typeof statements)[0], ...typeof statements]);
}

/**
 * Persist one leaving-sweep chunk (10.4 semantics on the ledger): both
 * directions are writes — a null `leavingOn` clears a reprieved product.
 * Upsert, because a product can gain a leaving date before it ever departs.
 */
export async function setLeavingOnLedger(
	db: Db,
	{ region, tier = TIER }: Scope,
	updates: (DepartureSeed & {
		leavingOn: string | null;
		psnConceptId: string;
	})[],
) {
	if (updates.length === 0) return;
	const statements = updates.map((u) =>
		db
			.insert(psPlusDeparture)
			.values({
				region,
				tier,
				productId: u.productId,
				npTitleId: u.npTitleId,
				titleNormalized: u.titleNormalized,
				leftOn: null,
				leavingOn: u.leavingOn,
				psnConceptId: u.psnConceptId,
			})
			.onConflictDoUpdate({
				target: [
					psPlusDeparture.region,
					psPlusDeparture.tier,
					psPlusDeparture.productId,
				],
				set: {
					leavingOn: u.leavingOn,
					psnConceptId: u.psnConceptId,
					titleNormalized: u.titleNormalized,
					npTitleId: u.npTitleId,
				},
			}),
	);
	await db.batch(statements as [(typeof statements)[0], ...typeof statements]);
}

/** Drop cached concept ids that failed a pricing query (10.4 review rule) —
 * the next sweep re-resolves from the product id. `leaving_on` untouched. */
export async function clearLedgerConceptIds(
	db: Db,
	{ region, tier = TIER }: Scope,
	productIds: string[],
) {
	if (productIds.length === 0) return;
	await db
		.update(psPlusDeparture)
		.set({ psnConceptId: null })
		.where(
			and(
				eq(psPlusDeparture.region, region),
				eq(psPlusDeparture.tier, tier),
				inArray(psPlusDeparture.productId, productIds),
			),
		);
}

/** Ledger rows for a page of products — the catalog browse's leaving marks
 * (Story 8.3: the card date reads the ledger directly, not the library). */
export async function listDeparturesForProducts(
	db: Db,
	{ region, tier = TIER }: Scope,
	productIds: string[],
): Promise<
	{ productId: string; leavingOn: string | null; leftOn: string | null }[]
> {
	const out: {
		productId: string;
		leavingOn: string | null;
		leftOn: string | null;
	}[] = [];
	for (let i = 0; i < productIds.length; i += CHUNK) {
		const chunk = productIds.slice(i, i + CHUNK);
		if (chunk.length === 0) continue;
		out.push(
			...(await db
				.select({
					productId: psPlusDeparture.productId,
					leavingOn: psPlusDeparture.leavingOn,
					leftOn: psPlusDeparture.leftOn,
				})
				.from(psPlusDeparture)
				.where(
					and(
						eq(psPlusDeparture.region, region),
						eq(psPlusDeparture.tier, tier),
						inArray(psPlusDeparture.productId, chunk),
					),
				)),
		);
	}
	return out;
}

/** The sweep's own read: ledger rows (concept cache + current dates) for the
 * products it is about to query. */
export async function listLedgerForProducts(
	db: Db,
	scope: Scope,
	productIds: string[],
): Promise<Map<string, { psnConceptId: string | null }>> {
	const { region, tier = TIER } = scope;
	const map = new Map<string, { psnConceptId: string | null }>();
	for (let i = 0; i < productIds.length; i += CHUNK) {
		const chunk = productIds.slice(i, i + CHUNK);
		if (chunk.length === 0) continue;
		for (const row of await db
			.select({
				productId: psPlusDeparture.productId,
				psnConceptId: psPlusDeparture.psnConceptId,
			})
			.from(psPlusDeparture)
			.where(
				and(
					eq(psPlusDeparture.region, region),
					eq(psPlusDeparture.tier, tier),
					inArray(psPlusDeparture.productId, chunk),
				),
			)) {
			map.set(row.productId, { psnConceptId: row.psnConceptId });
		}
	}
	return map;
}
