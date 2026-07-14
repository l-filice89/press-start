/**
 * PS+ catalog genre sweep (Story 7.1, AD-26/28).
 *
 * Genre is NOT on the product record — it exists only as a store category facet,
 * reachable by one filtered re-query per key (`filterBy: ["productGenres:HORROR"]`).
 * So it is a SEPARATE, CHUNKED pass, never folded back into the membership
 * fetch: one flaky genre query must not be able to take down the snapshot, and
 * the page count grows with both the catalog and the facet list — neither of
 * which we control.
 *
 * THE KEY LIST IS DISCOVERED, NEVER HARDCODED. de-de names 19 keys, en-us names
 * 20 (it adds `MUSIC/RHYTHM`) — probed live 2026-07-14. A pinned enum would
 * silently drop a whole genre for any region carrying one we never saw (the
 * Story 9.3 `npServiceName` failure, exactly). Keys are also not
 * identifier-safe: `MUSIC/RHYTHM` filters correctly only inside the URL-encoded
 * `filterBy` variable, which is where the provider keeps it.
 *
 * AND IT IS DISCOVERED ONCE (review, M2): the list is FROZEN into the persisted
 * sweep state at the start of the sweep and every continuation walks THAT list.
 * Re-discovering per chunk walks a shifting list under a keyset cursor — a key
 * that appears mid-sweep and sorts BEFORE the cursor is never swept at all.
 *
 * WHO DRIVES IT (review, M1): the CRON, one chunk per run, right after a
 * successful membership pass — 7 runs a month converge a ~5-chunk sweep within
 * days and re-drive any chunk that failed. The HTTP endpoint stays for 7.2's
 * client loop and for "do it now"; both share the same persisted cursor.
 *
 * GENERATION-STAMPED (AD-28): the sweep carries the generation the snapshot was
 * written under (authoritative, from the sweep state — never sniffed off an
 * arbitrary catalog row). A refresh landing mid-sweep mints a NEW generation and
 * prunes, so a client cursor from the old one is INVALID: the continuation is
 * refused (`stale-generation`) and the client starts over.
 *
 * A per-key failure is a SKIP, not an abort: the cursor still advances, exactly
 * as the platinum backfill steps past a title PSN cannot answer for. A failed
 * sweep leaves the membership snapshot valid and partially tagged — it never
 * blocks it.
 */
import { createPsnProvider } from '../providers';
import {
	listCatalogProductIds,
	PS_PLUS_TIER,
	setCatalogGenres,
} from '../repositories';
import type { Db } from '../repositories/db';
import {
	getPsnNpsso,
	getPsnRegion,
	getPsPlusSweepState,
	setPsPlusSweepState,
} from './settings';

/**
 * Genre keys per invocation. The Workers free tier allows 50 subrequests and D1
 * binding calls count too — and on the CRON path this chunk SHARES its
 * invocation with the membership pass (33 of 50, see `psplus.ts`). Honest worst
 * case for one chunk:
 *   external: 1 facet probe (only on the first chunk of a sweep) +
 *             3 keys × ceil(count/100) pages (ACTION is the biggest at 240 → 3;
 *             most keys → 1) ≈ 10
 *   D1:       state read 1 · region read 1 · snapshot product ids 1 ·
 *             state write 1 · genre writes, `setCatalogGenres` runs its OWN
 *             batch per key at 50 statements a call: ceil((1 delete + 240
 *             inserts)/50) = 5 worst-case per key = 15 across the chunk
 *             (+ auth 3 + lock 2 on the HTTP path, which the cron does not pay
 *             twice)
 *   total  ≈ 29 alone, and 33 + 29 = 62 would BUST the shared cron budget — so
 *   the chunk is sized for the shared case: 3 keys ≈ 29 - (auth 3 + lock 2) = 24
 *   on the cron path, i.e. the cron run peaks around 33 + 24 - (auth 3, paid
 *   once, and the lock, already claimed) ≈ 49. That is the real margin, and it is
 *   thin — hence 3, not the 4 the first draft claimed on arithmetic that missed
 *   `setCatalogGenres`'s per-key batching entirely. A 20-key region is then 7
 *   chunks: 7 cron runs a month, so it converges in one cycle.
 */
const CHUNK_SIZE = 3;

export interface GenreSweepResult {
	/** The snapshot generation these tags belong to — the continuation presents it back. */
	generation: string;
	/** Keys swept in this chunk. */
	keys: string[];
	/** Tags written this chunk. */
	tagged: number;
	/** Keys the store would not answer for; the cursor stepped past them. */
	skipped: { key: string; reason: string }[];
	/**
	 * Products a genre query named that the snapshot does not (yet) hold — they
	 * entered the store after the last membership pass, and their tags land after
	 * the next one (review, M4). Not an error.
	 */
	notInSnapshot: number;
	/** Pass back to continue; null = the last chunk (the client loop stops). */
	nextCursor: string | null;
}

export type GenreSweepOutcome =
	| { ok: true; result: GenreSweepResult }
	| { ok: false; reason: 'no-region' | 'no-catalog' | 'stale-generation' }
	| { ok: false; reason: 'provider' };

export async function runGenreSweep(
	db: Db,
	userId: string,
	env: { PSN_REGION?: string; PSN_NPSSO?: string },
	{ cursor, generation }: { cursor?: string; generation?: string } = {},
): Promise<GenreSweepOutcome> {
	const region = await getPsnRegion(db, userId, env);
	if (!region) return { ok: false, reason: 'no-region' };

	// The AUTHORITATIVE state (review, M5): generation, frozen key list, cursor.
	// Never re-derived by sniffing an unordered catalog row.
	const state = await getPsPlusSweepState(db, userId);
	// Nothing to tag: the membership pass has never run for this region.
	if (!state || state.region !== region)
		return { ok: false, reason: 'no-catalog' };
	// A refresh landed mid-sweep: the products moved, so a client cursor from the
	// old generation is meaningless.
	if (cursor && generation !== state.generation)
		return { ok: false, reason: 'stale-generation' };

	const scope = { region, tier: PS_PLUS_TIER };
	const provider = createPsnProvider({
		getNpsso: () => getPsnNpsso(db, userId, env),
	});

	// Discover ONCE per sweep, then freeze (M2). Continuations walk the frozen list.
	let keys = state.keys;
	if (keys.length === 0) {
		try {
			keys = (await provider.fetchPsPlusCatalogGenreKeys(region)).sort();
		} catch (error) {
			// The facet probe is the one call this chunk cannot work without.
			console.error('ps+ genre sweep: facet discovery failed', error);
			return { ok: false, reason: 'provider' };
		}
		// A 200 whose `productGenres` facet is missing or empty is a TOTAL failure
		// of the sweep, not a completed one (review, M3): reporting "0 keys, 0
		// tagged, done" would leave the catalog permanently untagged and call it
		// success.
		if (keys.length === 0) {
			console.error('ps+ genre sweep: the response named ZERO facet keys');
			return { ok: false, reason: 'provider' };
		}
	}

	// Keyset cursor over the FROZEN, sorted key list. A caller-supplied cursor
	// (7.2's client loop) wins; otherwise resume where the last chunk left off.
	const from = cursor ?? state.cursor ?? undefined;
	const pending = from ? keys.filter((key) => key > from) : keys;
	const chunk = pending.slice(0, CHUNK_SIZE);

	const result: GenreSweepResult = {
		generation: state.generation,
		keys: chunk,
		tagged: 0,
		skipped: [],
		notInSnapshot: 0,
		nextCursor: pending.length > chunk.length ? chunk[chunk.length - 1] : null,
	};

	// One read, not one per key: the FK is composite (region, tier, product_id),
	// so a tag for a product the snapshot does not hold kills the whole key (M4).
	const known = new Set(await listCatalogProductIds(db, scope));

	for (const key of chunk) {
		try {
			const products = await provider.fetchPsPlusExtraCatalogByGenre(
				region,
				key,
			);
			const ids = products
				.map((product) => product.productId)
				.filter((id) => known.has(id));
			result.notInSnapshot += products.length - ids.length;
			await setCatalogGenres(db, scope, key, ids);
			result.tagged += ids.length;
		} catch (error) {
			// One key the store will not answer for is a SKIP. Aborting would strand
			// every key behind it on every re-run — and the key keeps its previous
			// tags, because `setCatalogGenres` never ran for it.
			console.error('ps+ genre sweep skipped a key', key, error);
			result.skipped.push({
				key,
				reason: `PlayStation did not answer as expected: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
			});
		}
	}

	// Persist the cursor + the frozen list so the CRON can drive the next chunk
	// with no client at all (M1/M2).
	await setPsPlusSweepState(db, userId, {
		...state,
		keys,
		cursor: result.nextCursor,
		skipped: [
			...new Set([...state.skipped, ...result.skipped.map((s) => s.key)]),
		],
		done: result.nextCursor === null,
	});

	return { ok: true, result };
}
