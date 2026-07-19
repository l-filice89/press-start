/**
 * PS+ leaving sweep (Story 10.4, VR-6 rework).
 *
 * Sony publishes the departure instant per PRODUCT, not per catalog: the
 * PS_PLUS-branded offer in a concept's pricing carries `endTime` (epoch ms)
 * exactly when the game is scheduled to leave, and null while it is staying —
 * distribution probed live over 11 games 2026-07-16 (artifact
 * psn-leaving-endtime-probe-2026-07-16.md). So this is a SEPARATE, CHUNKED
 * pass over the FLAGGED tracked games only (~39 of 491 products — the shelf
 * warns about games Luca tracks, nobody else's), never folded into the
 * membership fetch.
 *
 * WHO DRIVES IT: the cron, one chunk per invocation, third in the rotation
 * (genre sweep pending → genre; else leaving pending → leaving; else the
 * membership pass — see `runScheduledPsPlusCheck`). Every membership pass
 * resets this sweep's cursor: dates appear and vanish with the store's monthly
 * announcements even when the catalog membership itself is unchanged, so a
 * "cursor survives while the catalog is still" rule (the genre sweep's) would
 * refresh dates only when a game arrives or leaves — precisely backwards.
 *
 * PER-GAME FAIL-CLOSED: a game whose reply is refused or malformed keeps its
 * stored date and is stepped past (a poison product must not stall the sweep
 * forever — it retries on the NEXT sweep); a chunk where EVERY game failed is
 * a store outage, keeps the cursor, and retries next fire. A failure never
 * lights the FR-40 banner — the membership snapshot is valid either way
 * (AD-28 sibling).
 *
 * Subrequest ledger (AD-15: 50 per invocation, D1 binding calls count), the
 * chunk has the invocation to itself, each cost paid once:
 *   external: ≤ 2 per game (concept resolve + pricing; 1 once the concept id
 *             is cached on the game row) × chunk 15 = ≤ 30.
 *   D1, CRON: findUserByEmail 1 · lock claim 1 · genre-state read (rotation) 1
 *             · leaving-state read (rotation) 1 + (sweep's own) 1 · region
 *             read 1 · library read 1 · catalog title→product read 1 · fence
 *             (holdsPsnLock) 1 · batched leaving write 1 · library-version
 *             rotate (8.6 ETag) 1 · stale-concept
 *             clear ≤1 · state write 1 · lock release 1 = 14.
 *   total ≈ 30 + 14 = 44 of 50 worst case; steady state (concepts cached) ≈ 29.
 *   The score refresh NEVER stacks on a sweep invocation (worker/index.ts
 *   skips it whenever the rotation spent fan-out).
 * 39 flagged games = 3 chunks; the cron fires 28× a month
 * (`0 9,21 15-28 * *`), so membership + a ~5-chunk genre sweep + leaving
 * chunks + retries all converge inside one window.
 */
import { normalizeTitle } from '../core';
import { createPsnProvider } from '../providers';
import {
	clearLedgerConceptIds,
	listCatalogTitleProducts,
	listLedgerForProducts,
	listRegionTrackedGames,
	PS_PLUS_TIER,
	setLeavingOnLedger,
} from '../repositories';
import type { Db } from '../repositories/db';
import { bumpAllLibraryVersions } from './library-version';
import { holdsRegionLock } from './psn-lock';
import { getPsPlusLeavingState, setPsPlusLeavingState } from './settings';

const LEAVING_CHUNK_SIZE = 15;

export type LeavingSweepOutcome =
	| { ok: true; result: { swept: number; failed: number; done: boolean } }
	| { ok: false; reason: 'no-region' | 'no-state' | 'provider' | 'conflict' };

export async function runLeavingSweep(
	db: Db,
	// Region-first (Story 8.4): per-region op, region-ledger state and lock.
	region: string | null,
	{ lockToken }: { lockToken?: string } = {},
): Promise<LeavingSweepOutcome> {
	if (!region) return { ok: false, reason: 'no-region' };

	const state = await getPsPlusLeavingState(db, region);
	// No pending sweep: the membership pass has not (re)armed one for this
	// region. The rotation checks `done` before calling, but the state is the
	// authority, not the caller.
	if (!state || state.done || state.region !== region)
		return { ok: false, reason: 'no-state' };

	// Deterministic order + keyset cursor, exactly like the genre sweep's frozen
	// key list: the id ordering cannot shift under the cursor mid-sweep.
	// The target universe is PER-REGION now (Story 8.4): distinct games tracked
	// by ANY user of this region; membership = the three-leg product resolution
	// below (the same legs as the 8.3 derivation).
	const flagged = (await listRegionTrackedGames(db, region)).sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	);
	// Sorted before the Maps so a duplicate key (two catalog products, one
	// normalized name / np id — observed live) resolves to the SAME product
	// every sweep instead of flapping with query order. Three lookup legs
	// (deferred-work 2026-07-19), mirroring the 8.3 membership derivation:
	// product link > np-title link > normalized title — a catalog-added game is
	// IGDB-retitled on add, so the title leg alone silently skipped it forever.
	const catalogProducts = (
		await listCatalogTitleProducts(db, { region, tier: PS_PLUS_TIER })
	).sort((a, b) => (a.productId < b.productId ? -1 : 1));
	const byTitle = new Map(
		catalogProducts.map((row) => [row.titleNormalized, row] as const),
	);
	const byProductId = new Map(
		catalogProducts.map((row) => [row.productId, row] as const),
	);
	const byNpTitleId = new Map(
		catalogProducts.flatMap((row) =>
			row.npTitleId ? [[row.npTitleId, row] as const] : [],
		),
	);
	const resolveProduct = (row: {
		title: string;
		psnProductIds: string[];
		npTitleIds: string[];
	}) =>
		row.psnProductIds.map((id) => byProductId.get(id)).find(Boolean) ??
		row.npTitleIds.map((id) => byNpTitleId.get(id)).find(Boolean) ??
		// Joined on the RECOMPUTED key, exactly like the flag pass (review, M: a
		// stored title_normalized predating a normalizeTitle change would be
		// flagged yet silently never swept).
		byTitle.get(normalizeTitle(row.title));

	const pending = flagged.filter(
		(row) => state.cursor === null || row.id > state.cursor,
	);
	const scope = { region, tier: PS_PLUS_TIER };
	if (pending.length === 0) {
		await setPsPlusLeavingState(db, region, { ...state, done: true });
		return { ok: true, result: { swept: 0, failed: 0, done: true } };
	}
	const chunk = pending.slice(0, LEAVING_CHUNK_SIZE);

	const provider = createPsnProvider();
	// Concept cache now lives on the LEDGER (region, product) — Story 8.3.
	const chunkProducts = chunk
		.map((row) => resolveProduct(row)?.productId)
		.filter((v): v is string => Boolean(v));
	const ledger = await listLedgerForProducts(db, scope, chunkProducts);
	const updates: {
		productId: string;
		npTitleId: string | null;
		titleNormalized: string;
		leavingOn: string | null;
		psnConceptId: string;
	}[] = [];
	// Games whose CACHED concept id just failed (review: a remapped/delisted
	// concept would otherwise fail identically forever) — the cache is dropped
	// so the retry re-resolves from the product id.
	const staleConcepts: string[] = [];
	let failed = 0;
	let queried = 0;
	for (const row of chunk) {
		// A flagged game absent from all three snapshot legs is mid-transition
		// (the next membership pass clears its flag, which also clears any
		// leaving date) — stepped past, never an error.
		const product = resolveProduct(row);
		if (!product) continue;
		const { productId, npTitleId } = product;
		queried++;
		const cachedConcept = ledger.get(productId)?.psnConceptId ?? null;
		try {
			const answer = await provider.fetchPsPlusOfferEnd(
				region,
				productId,
				cachedConcept,
			);
			updates.push({
				productId,
				// Thread the catalog's np id (review, M3): a game linked only via
				// 'PSN' must find its date through the np-key derivation leg.
				npTitleId,
				// The CATALOG's normalized title, not the game's (deferred-work
				// 2026-07-19): the ledger row describes the product, and a
				// link-resolved game carries a drifted title anyway.
				titleNormalized: product.titleNormalized,
				leavingOn: answer.leavingOn,
				psnConceptId: answer.conceptId,
			});
		} catch (error) {
			failed++;
			if (cachedConcept) staleConcepts.push(productId);
			console.error(
				`ps+ leaving sweep: ${row.title} (${productId}) failed — keeping stored date`,
				error,
			);
		}
	}

	// Every queried game failed = the store is refusing us wholesale. Keep the
	// cursor so THIS chunk retries next fire — advancing would trade a transient
	// outage for a month of missing dates. But only ONCE (review: livelock
	// guard) — a chunk that fails wholesale twice in a row is a poison product,
	// not an outage, and pinning the rotation on it would starve the membership
	// pass forever. The second failure invalidates any cached concept ids and
	// steps the cursor past the chunk; its games retry on the next re-arm.
	if (queried > 0 && failed === queried) {
		if ((state.attempts ?? 0) < 1) {
			await setPsPlusLeavingState(db, region, {
				...state,
				attempts: (state.attempts ?? 0) + 1,
			});
			return { ok: false, reason: 'provider' };
		}
		await clearLedgerConceptIds(db, scope, staleConcepts);
		const done = pending.length <= chunk.length;
		await setPsPlusLeavingState(db, region, {
			...state,
			cursor: chunk[chunk.length - 1].id,
			attempts: 0,
			done,
		});
		console.warn(
			`ps+ leaving sweep: stepping past a twice-failed chunk of ${queried}`,
		);
		return { ok: true, result: { swept: 0, failed, done } };
	}

	// The fence (same as the membership pass and genre sweep): a chunk that
	// stalled past the lock TTL may have been preempted — it writes nothing.
	if (lockToken && !(await holdsRegionLock(db, region, lockToken))) {
		console.error('ps+ leaving sweep: lock lost — refusing to write');
		return { ok: false, reason: 'conflict' };
	}

	await setLeavingOnLedger(db, scope, updates);
	// Shared region facts changed → every user's shelf ETag rotates (8.6).
	if (updates.length > 0) await bumpAllLibraryVersions(db);
	// Failed cached concepts re-resolve on the next sweep (one extra batched
	// statement only when something actually failed).
	await clearLedgerConceptIds(db, scope, staleConcepts);
	const done = pending.length <= chunk.length;
	await setPsPlusLeavingState(db, region, {
		...state,
		cursor: chunk[chunk.length - 1].id,
		attempts: 0,
		done,
	});
	return { ok: true, result: { swept: updates.length, failed, done } };
}
