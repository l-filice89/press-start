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
 *             (holdsPsnLock) 1 · batched leaving write 1 · stale-concept
 *             clear ≤1 · state write 1 · lock release 1 = 13.
 *   total ≈ 30 + 13 = 43 of 50 worst case; steady state (concepts cached) ≈ 28.
 *   The score refresh NEVER stacks on a sweep invocation (worker/index.ts
 *   skips it whenever the rotation spent fan-out).
 * 39 flagged games = 3 chunks; the cron fires 14× a month
 * (`0 9,21 15-21 * *`), so membership + a ~5-chunk genre sweep + leaving
 * chunks + retries all converge inside one window.
 */
import { normalizeTitle } from '../core';
import { createPsnProvider } from '../providers';
import {
	clearPsnConceptIds,
	listCatalogTitleProducts,
	listLibraryForUser,
	PS_PLUS_TIER,
	setPsPlusLeaving,
} from '../repositories';
import type { Db } from '../repositories/db';
import { holdsPsnLock } from './psn-lock';
import {
	getPsnRegion,
	getPsPlusLeavingState,
	setPsPlusLeavingState,
} from './settings';

const LEAVING_CHUNK_SIZE = 15;

export type LeavingSweepOutcome =
	| { ok: true; result: { swept: number; failed: number; done: boolean } }
	| { ok: false; reason: 'no-region' | 'no-state' | 'provider' | 'conflict' };

export async function runLeavingSweep(
	db: Db,
	userId: string,
	env: { PSN_REGION?: string },
	{ lockToken }: { lockToken?: string } = {},
): Promise<LeavingSweepOutcome> {
	const region = await getPsnRegion(db, userId, env);
	if (!region) return { ok: false, reason: 'no-region' };

	const state = await getPsPlusLeavingState(db, userId);
	// No pending sweep: the membership pass has not (re)armed one for this
	// region. The rotation checks `done` before calling, but the state is the
	// authority, not the caller.
	if (!state || state.done || state.region !== region)
		return { ok: false, reason: 'no-state' };

	// Deterministic order + keyset cursor, exactly like the genre sweep's frozen
	// key list: the id ordering cannot shift under the cursor mid-sweep.
	const flagged = (
		await listLibraryForUser(db, userId, { includeDiscarded: true })
	)
		.filter((row) => row.psPlusExtra)
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	// Sorted before the Map so a duplicate title key (two catalog products,
	// one normalized name — observed live) resolves to the SAME product every
	// sweep instead of flapping with query order.
	const products = new Map(
		(await listCatalogTitleProducts(db, { region, tier: PS_PLUS_TIER }))
			.sort((a, b) => (a.productId < b.productId ? -1 : 1))
			.map((row) => [row.titleNormalized, row.productId] as const),
	);

	const pending = flagged.filter(
		(row) => state.cursor === null || row.id > state.cursor,
	);
	if (pending.length === 0) {
		await setPsPlusLeavingState(db, userId, { ...state, done: true });
		return { ok: true, result: { swept: 0, failed: 0, done: true } };
	}
	const chunk = pending.slice(0, LEAVING_CHUNK_SIZE);

	const provider = createPsnProvider();
	const updates: {
		gameId: string;
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
		// A flagged game absent from the snapshot join is mid-transition (the next
		// membership pass clears its flag, which also clears any leaving date) —
		// stepped past, never an error. Joined on the RECOMPUTED key, exactly
		// like the flag pass (review, M: a stored title_normalized predating a
		// normalizeTitle change would be flagged yet silently never swept).
		const productId = products.get(normalizeTitle(row.title));
		if (!productId) continue;
		queried++;
		try {
			const answer = await provider.fetchPsPlusOfferEnd(
				region,
				productId,
				row.psnConceptId,
			);
			updates.push({
				gameId: row.id,
				leavingOn: answer.leavingOn,
				psnConceptId: answer.conceptId,
			});
		} catch (error) {
			failed++;
			if (row.psnConceptId) staleConcepts.push(row.id);
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
			await setPsPlusLeavingState(db, userId, {
				...state,
				attempts: (state.attempts ?? 0) + 1,
			});
			return { ok: false, reason: 'provider' };
		}
		await clearPsnConceptIds(db, staleConcepts);
		const done = pending.length <= chunk.length;
		await setPsPlusLeavingState(db, userId, {
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
	if (lockToken && !(await holdsPsnLock(db, userId, lockToken))) {
		console.error('ps+ leaving sweep: lock lost — refusing to write');
		return { ok: false, reason: 'conflict' };
	}

	await setPsPlusLeaving(db, updates);
	// Failed cached concepts re-resolve on the next sweep (one extra batched
	// statement only when something actually failed).
	await clearPsnConceptIds(db, staleConcepts);
	const done = pending.length <= chunk.length;
	await setPsPlusLeavingState(db, userId, {
		...state,
		cursor: chunk[chunk.length - 1].id,
		attempts: 0,
		done,
	});
	return { ok: true, result: { swept: updates.length, failed, done } };
}
