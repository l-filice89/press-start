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
import { holdsRegionLock } from './psn-lock';
import { getPsPlusSweepState, setPsPlusSweepState } from './settings';

/**
 * Genre keys per invocation. The Workers free tier allows 50 subrequests and D1
 * binding calls count too (AD-15). A sweep chunk now has the invocation to ITSELF
 * — the cron never runs it beside the membership pass (Epic 7 cross-story review,
 * H3) — so this is the whole ledger, each cost paid ONCE:
 *   external: 1 facet probe (first chunk of a sweep only) +
 *             per key ceil(count/100) pages. The chunk's keys can name at most
 *             the whole catalog (~490), so ≤ 4 + 5 = 9 → ≤ 10 with the probe.
 *   D1, CRON: findUserByEmail 1 · lock claim 1 · cron sweep-state read 1 ·
 *             region read 1 · state read 1 · fence (holdsPsnLock) 1 · snapshot
 *             product ids 1 · state re-read 1 + write 1 · lock release 1 = 10,
 *             plus the genre writes: `setCatalogGenres` runs its OWN batch per
 *             key at 50 statements a call, ceil((1 delete + n inserts)/50), and
 *             the chunk's n's sum to ≤ 490 → ≤ 4 + 10 = 14.
 *   total (cron) ≈ 10 external + 24 D1 = 34 of 50, worst case; a typical chunk of
 *   small keys is ~20. The HTTP path swaps findUserByEmail for the auth
 *   middleware (3) and pays one more lock call: ~37.
 * A 20-key region is 5 chunks; the cron fires 28× a month, so a refresh + a full
 * sweep converge inside one monthly window.
 */
const CHUNK_SIZE = 4;

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
	// Region-first (Story 8.4): the sweep is a per-region op; state and the
	// single-flight lock live on the region ledger.
	region: string | null,
	{
		cursor,
		generation,
		lockToken,
	}: { cursor?: string; generation?: string; lockToken?: string } = {},
): Promise<GenreSweepOutcome> {
	if (!region) return { ok: false, reason: 'no-region' };

	// The AUTHORITATIVE state (review, M5): generation, frozen key list, cursor.
	// Never re-derived by sniffing an unordered catalog row.
	const state = await getPsPlusSweepState(db, region);
	// Nothing to tag: the membership pass has never run for this region.
	if (!state || state.region !== region)
		return { ok: false, reason: 'no-catalog' };
	// A refresh landed mid-sweep: the products moved, so a caller's generation from
	// the old one is meaningless. Checked on EVERY chunk, the FIRST included (Epic 7
	// cross-story review, M2) — gating it on `cursor` let a client that had been
	// through a refresh restart the sweep against a generation that no longer
	// exists and never hear about it.
	if (generation && generation !== state.generation)
		return { ok: false, reason: 'stale-generation' };

	// THE FENCE (review, M2), the same one `runPsPlusCheck` was given: the 2-minute
	// lock TTL is PREEMPTION. A chunk that stalls past it can have the lock taken
	// over by the cron, which prunes and mints a new generation — and the stalled
	// chunk, waking up, would overwrite the state with its own stale generation +
	// cursor, naming a snapshot that no longer exists.
	if (lockToken && !(await holdsRegionLock(db, region, lockToken))) {
		console.error(
			'ps+ genre sweep: lock lost — refusing to tag or write state',
		);
		return { ok: false, reason: 'stale-generation' };
	}

	const scope = { region, tier: PS_PLUS_TIER };
	const provider = createPsnProvider();

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

	// The last key this chunk actually FINISHED (tagged or deliberately skipped).
	// The cursor is persisted from THIS, not from the chunk's plan (review, M2/H3):
	// a chunk that dies unexpectedly mid-key (a blown subrequest budget, a D1
	// hiccup) used to write no state at all, so the cursor never advanced and every
	// later run re-walked the same keys and died in the same place, forever.
	let done: string | undefined;

	try {
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
			done = key;
		}
	} finally {
		await persistProgress(db, region, state.generation, {
			keys,
			cursor: done ?? from ?? null,
			// `done` only when the chunk walked its whole plan to the end of the list.
			complete: done === keys[keys.length - 1],
			skipped: result.skipped.map((s) => s.key),
		}).catch((error: unknown) =>
			console.error('ps+ genre sweep: could not persist progress', error),
		);
	}

	return { ok: true, result };
}

/**
 * Write the sweep's progress, re-reading the state IMMEDIATELY BEFORE the write
 * (review, M2). The state read at the top of the chunk is minutes old by now: a
 * refresh may have landed, pruned, and minted a new generation, and spreading the
 * stale row back would stamp the state with a generation that no longer exists —
 * the next continuation is then refused against a generation that is itself dead,
 * and the facet list freezes on a discarded snapshot. A moved generation means
 * this chunk's cursor belongs to nothing: drop it, write nothing.
 */
async function persistProgress(
	db: Db,
	region: string,
	generation: string,
	{
		keys,
		cursor,
		complete,
		skipped,
	}: {
		keys: string[];
		cursor: string | null;
		complete: boolean;
		skipped: string[];
	},
): Promise<void> {
	const fresh = await getPsPlusSweepState(db, region);
	if (!fresh || fresh.generation !== generation) {
		console.warn(
			'ps+ genre sweep: the snapshot moved under this chunk — discarding its cursor',
		);
		return;
	}
	await setPsPlusSweepState(db, region, {
		...fresh,
		keys,
		cursor: complete ? null : cursor,
		skipped: [...new Set([...fresh.skipped, ...skipped])],
		done: complete,
	});
}
