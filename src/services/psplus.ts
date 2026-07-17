/**
 * PS+ Extra catalog ingest (Story 5.1, widened in 7.1 — FR-38/39/50, AD-24/27).
 *
 * ONE fetch feeds BOTH datasets (AD-27): the region's catalog is fetched once,
 * upserted + pruned into `ps_plus_catalog` under a fresh generation, and the
 * `game.ps_plus_extra` flag pass then reads THAT TABLE — never a second fetch.
 * The snapshot is the sole membership truth; the flag is a denormalized cache
 * of it, maintained for EVERY tracked game whose normalized title matches,
 * OWNED ONES INCLUDED (before 7.1 an owned catalog game read `true` in the
 * table and `false` on the flag — the divergence this rewrite closes). The
 * `&& !owned` guards on the CARD, the FILTER PILL and the buy-vs-claim prompt
 * are the DISPLAY rule and stay exactly where they are: the flag is the stored
 * fact, not the badge.
 *
 * Catalog games absent from the library are still never inserted into `game`
 * (availability is not ownership, AD-10) — they live in `ps_plus_catalog` and
 * become games only through 7.3's explicit add.
 *
 * The fetch completes fully before any write, so a wire failure — or a suspect
 * empty catalog — leaves the snapshot AND every flag untouched.
 */

import { normalizeTitle } from '../core';
import {
	createPsnProvider,
	type PsnCatalog,
	PsnStoreRejectionError,
} from '../providers';
import {
	clearDeparturesForProducts,
	getRegionState,
	listCatalogProductIds,
	listDistinctUserRegions,
	listRegionStates,
	markRegionCycleComplete,
	PS_PLUS_TIER,
	pruneCatalogGeneration,
	recordRegionOutcome,
	resetRegionWindow,
	stampDepartures,
	upsertCatalogProducts,
} from '../repositories';
import type { Db } from '../repositories/db';
import { bumpAllLibraryVersions } from './library-version';
import { holdsRegionLock, withRegionLock } from './psn-lock';
import { runGenreSweep } from './psplus-genres';
import { runLeavingSweep } from './psplus-leaving';
import {
	getPsPlusLeavingState,
	getPsPlusSweepState,
	setPsPlusLeavingState,
	setPsPlusSweepState,
} from './settings';

export interface PsPlusCheckResult {
	/** The region the catalog was fetched for. */
	region: string;
	/** Products stored in the snapshot this run. */
	products: number;
	/** Products that LEFT the catalog and were pruned (their genre tags cascaded). */
	pruned: number;
	/** The snapshot generation this run stamped — the genre sweep carries it (AD-28). */
	generation: string;
}

export type PsPlusCheckOutcome =
	| { ok: true; result: PsPlusCheckResult }
	| {
			ok: false;
			// `bad-region` = the store ANSWERED and refused the query (a locale that
			// is no store, like `uk-uk`) — a retry cannot fix it, the region can.
			reason: 'no-region' | 'bad-region' | 'provider' | 'conflict';
	  };

/**
 * How far the accumulated walk may fall short of the store's own `totalCount`
 * before the catalog is refused (review, M1). It absorbs a product ARRIVING
 * mid-walk (page 5's totalCount is 491, the walk carried 490) — not a truncated
 * walk, which is short by hundreds.
 */
const CATALOG_DRIFT_TOLERANCE = 2;

/**
 * Subrequest ledger for one membership pass (AD-15: 50 external + D1 binding
 * calls count too). Counted honestly, every binding call, EACH COST PAID ONCE
 * (the pre-fix ledger subtracted the auth middleware and the lock twice and was
 * off by 5 — Epic 7 cross-story review, H3):
 *   external: 5 catalog pages (490 / 100), 0 auth legs (this endpoint is public)
 *   D1, on the CRON path (8.4: region picker replaces user resolution):
 *             regions+states+window reads ≈3 · region-lock claim 1 · fence
 *             (holdsPsnLock) 1 · timezone read (todayForUser) 1 · pre-run product
 *             ids 1 · snapshot upsert ceil(490/50) = 10 · prune 1 · stale-region
 *             delete 1 · sweep-state read 1 + write 1 · leaving-state re-arm
 *             write 1 (Story 10.4) · title keys 1 · library
 *             read 1 · flag set + clear 2 (the Story 10.2 departure stamp AND
 *             the 10.4 leaving-date clear ride IN these statements — no extra
 *             call) · bookkeeping
 *             (failed-flag clear 1 + stamp, which re-reads the timezone, 2) 3
 *             · post-pass sweep-state read 1 · lock release 1
 *             · library-version rotate (8.6 ETag, when flags changed) 1
 *           = 31 (+ the rotation's genre-state and leaving-state reads that
 *           precede every CRON membership pass: 33)
 *   total (cron) = 5 external + 33 D1 = 38 of 50 (+ the Story 10.1/10.3 score+TTB
 *   refresh ≈11 once per window: worst case ≈49). The 10.4 leaving sweep never
 *   shares an invocation with the membership pass OR the score refresh
 *   (worker/index.ts skips scores on any sweep invocation; sweep ledger:
 *   psplus-leaving.ts, ≤44).
 *   The stale-snapshot guard's waitUntil pass runs in a REQUEST context that
 *   already spent ~5 calls: 34 + 5 ≈ 39 of 50 — fits (8.4).
 * A GENRE-SWEEP CHUNK NO LONGER RIDES ALONG (H3): 34 + a chunk (~25) busts the
 * budget, and the resulting mid-sweep "Too many subrequests" throw was
 * self-perpetuating — see `runScheduledPsPlusCheck`.
 */
export async function runPsPlusCheck(
	db: Db,
	region: string | null,
	lockToken?: string,
): Promise<PsPlusCheckOutcome> {
	// De-usered (Story 8.4): the refresh is a per-region op — the caller
	// resolves the region (cron picker, or the stale-snapshot guard from the
	// user's setting) and the fence is the REGION lock.
	if (!region) return { ok: false, reason: 'no-region' };

	// The catalog endpoint is public — the provider carries no credential at all.
	const provider = createPsnProvider();

	let fetched: PsnCatalog;
	try {
		fetched = await provider.fetchPsPlusExtraCatalog(region);
	} catch (error) {
		// EVERY degenerate response lands here, and all of them are HTTP 200: a
		// null grid on a bad region, and a null grid + `errors` on a bad category
		// id, both carry a GraphQL `errors` array the provider throws on. A 200 is
		// not success. The typed rejection separates "the store refused the query"
		// (fix the region) from an outage/timeout (try again later).
		console.error('ps+ check: catalog fetch failed', error);
		if (error instanceof PsnStoreRejectionError)
			return { ok: false, reason: 'bad-region' };
		return { ok: false, reason: 'provider' };
	}

	// Data-loss guard (AD-27), on the ACCUMULATED count, AFTER pagination — never
	// on a single page. An empty page at offset > 0 with `totalCount: 490` is the
	// legitimate END of the walk (captured: `catalog-page-past-end.json`); an
	// empty RESULT is a bad region, a de-listed catalog or category-id rot. It now
	// guards two datasets, so it stays a hard abort and runs BEFORE any prune or
	// clear: the snapshot and every flag survive a suspect response.
	//
	// AND IT RECONCILES (Story 7.1 review, H1). "Not empty" is not "complete": a
	// walk that got page 0 and then a truncated/empty page yields 100 of 490
	// products, and the prune would delete the other 390 rows and clear their
	// flags. A short walk NEVER prunes.
	//
	// It reconciles what the walk ACCOUNTED FOR, not what it kept (Epic 7
	// cross-story review, M1). EXACT equality bricked the whole feature on two
	// ordinary events: ONE store product with no `id` (the provider drops it, the
	// store still counts it → 489 !== 490 → every refresh and every button click
	// fails identically until a deploy), and a product added or removed BETWEEN
	// page 1 and page 5 of the walk (the last page's totalCount wins). So: skipped
	// products are added back, and a couple of rows of mid-walk drift are tolerated
	// — while a TRUNCATED walk (100 of 490) still fails closed, which is the whole
	// point of the guard.
	const products = fetched.products;
	const accounted = products.length + fetched.skipped;
	if (
		products.length === 0 ||
		accounted + CATALOG_DRIFT_TOLERANCE < fetched.totalCount
	) {
		console.error(
			`ps+ check: refusing a suspect catalog — ${products.length} products (+${fetched.skipped} skipped) against a reported totalCount of ${fetched.totalCount}`,
		);
		// A whole-catalog EMPTY answer is the bad-region/de-listed shape (fix the
		// config); a truncated walk is transient (retry may fix).
		return {
			ok: false,
			reason: products.length === 0 ? 'bad-region' : 'provider',
		};
	}

	// THE FENCE (Story 7.1 review, H3), immediately before the write phase — the
	// fetch above is the slow part, and the lock's TTL is preemption: a cron run
	// can take the lock over mid-fetch and write a whole new snapshot. Pruning
	// "everything that is not MY generation" on top of THAT deletes every row the
	// winner just wrote and clears every flag. A run that no longer holds its lock
	// writes nothing at all: no upsert, no prune, no flag pass.
	if (lockToken && !(await holdsRegionLock(db, region, lockToken))) {
		console.error('ps+ check: lock lost mid-run — refusing to write or prune');
		return { ok: false, reason: 'conflict' };
	}

	// The snapshot: upsert everything this run saw under a fresh generation, then
	// delete whatever the run did NOT see (the departed games; their genre tags
	// cascade). Generation-stamped so a cron prune cannot corrupt an in-flight
	// genre sweep (AD-28).
	const generation = crypto.randomUUID();
	// UTC date (8.4): a per-region shared fact must not carry one user's zone.
	const today = new Date().toISOString().slice(0, 10);
	const scope = { region, tier: PS_PLUS_TIER };
	// What the snapshot held BEFORE this run — the sweep state below only resets
	// when the catalog actually MOVED (see there), and the button summary diffs
	// membership across the refresh (old title keys vs new).
	const before = new Set(await listCatalogProductIds(db, scope));
	await upsertCatalogProducts(
		db,
		scope,
		generation,
		products.map((product) => ({
			...product,
			titleNormalized: normalizeTitle(product.name),
		})),
		today,
	);
	const pruned = await pruneCatalogGeneration(db, scope, generation);
	// deleteCatalogOutsideRegion DIED here (Story 8.3 review, H1): under AD-30,
	// membership IS the region's snapshot — wiping other regions on every check
	// would blank every other user's shelf. Regions now coexist; pruning IDLE
	// regions (snapshot + ledger) is Story 8.4's region-state ledger job.

	// The sweep state (M1/M2/M5): this row carries the AUTHORITATIVE generation.
	//
	// The cursor RESETS only when the catalog actually MOVED (a product arrived or
	// left) — those products need tagging, so the frozen key list and the cursor
	// are dead. When the catalog is UNCHANGED (the common case: the cron fires 28×
	// a month over the same catalog) the cursor SURVIVES, which is the whole
	// reason the cron-driven sweep converges at all — resetting it every run would
	// re-sweep chunk 1 forever and never reach key 20.
	const moved =
		pruned.length > 0 ||
		products.some((product) => !before.has(product.productId));
	const sweep = moved ? null : await getPsPlusSweepState(db, region);
	await setPsPlusSweepState(db, region, {
		region,
		generation,
		keys: sweep?.keys ?? [],
		cursor: sweep?.cursor ?? null,
		skipped: sweep?.skipped ?? [],
		done: sweep?.done ?? false,
	});
	// The LEAVING sweep (Story 10.4) re-arms on EVERY membership pass — unlike
	// the genre cursor above, departure dates move with the store's monthly
	// announcements even while the catalog membership is perfectly still, so
	// "reset only when moved" would refresh dates exactly when they matter least.
	await setPsPlusLeavingState(db, region, {
		region,
		generation,
		cursor: null,
		attempts: 0,
		done: false,
	});

	// THE DEPARTURE LEDGER (Story 8.3, AD-30) replaces the game-column flag
	// pass: membership is now DERIVED per user region at read time, so the only
	// facts this pass owns are departures. The pruned rows ARE the departures —
	// stamp them (leaving date nulled in the same statement, 10.4 rule); every
	// product PRESENT in the new generation clears a prior stamp (DW-13
	// re-entry; the row and its sweep-owned fields survive). Runs strictly
	// after the wipe guard — a degenerate response never mass-stamps.
	// Second fence (review, M6): the write phase is many awaits long, and a run
	// that lost its lock mid-phase must not fabricate DURABLE departure history
	// in the shared ledger (the snapshot self-heals next pass; ledger stamps
	// persist until a DW-13 clear).
	if (lockToken && !(await holdsRegionLock(db, region, lockToken))) {
		console.error('ps+ check: lock lost before ledger writes — stopping');
		return { ok: false, reason: 'conflict' };
	}
	await stampDepartures(db, scope, pruned, today);
	await clearDeparturesForProducts(
		db,
		scope,
		products.map((product) => product.productId),
	);

	// The catalog moved (or departures stamped) → every user's shelf derives a
	// new answer; rotate every ETag (8.6). The old per-user summary and the
	// freshness/failure setting writes died with the manual button (8.4):
	// freshness is the region ledger's last_success, failures are logs.
	if (moved) {
		await bumpAllLibraryVersions(db);
	}

	return {
		ok: true,
		result: {
			region,
			products: products.length,
			pruned: pruned.length,
			generation,
		},
	};
}

/**
 * The Cron Trigger entry, per-region (Story 8.4, AD-31/32). Each fire spends
 * ONE rotation slot on ONE region:
 *   pick region -> (genre sweep pending -> genre chunk) -> (leaving pending ->
 *   leaving chunk) -> membership pass — the same H3 one-slot-per-invocation
 *   rotation as before, now against per-REGION state.
 *
 * REGION PICKER: distinct regions of registered users, minus regions idle
 * >60 days (`last_user_activity`) and regions already cycle-complete this
 * window. Quarantined regions (3+ consecutive failures) sort LAST and retry
 * at most once per window — a poison region can never starve the rotation it
 * would otherwise sort ahead of. The `15-28` window of each calendar month is
 * the rotation unit: a new window resets cycle/failure counters (re-admitting
 * quarantined regions). Failures are PASSIVE (logs + ledger; no banner —
 * users have no action to take).
 */
const IDLE_SKIP_DAYS = 60;
const QUARANTINE_AT = 3;

const isoDaysAgo = (days: number) =>
	new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** The rotation window a date belongs to: `YYYY-MM` (the 15-28 cron only
 * fires inside one calendar month's window). */
const windowOf = (isoDate: string) => isoDate.slice(0, 7);

export async function pickCronRegion(db: Db): Promise<string | null> {
	const regions = await listDistinctUserRegions(db);
	if (regions.length === 0) return null;
	const today = new Date().toISOString().slice(0, 10);
	const window = windowOf(today);
	const states = new Map(
		(await listRegionStates(db)).map((row) => [row.region, row]),
	);
	// A new window re-admits everyone: reset counters lazily on first sight.
	for (const region of regions) {
		const state = states.get(region);
		if (state && state.window !== window) {
			await resetRegionWindow(db, region, window);
			state.window = window;
			state.cycleComplete = false;
			state.failureCount = 0;
		}
	}
	const idleCutoff = isoDaysAgo(IDLE_SKIP_DAYS);
	const candidates = regions.filter((region) => {
		const state = states.get(region);
		if (state?.cycleComplete) return false;
		// Idle skip: no state row yet = a brand-new region (someone set it) —
		// serve it; a row whose activity is stale = skip.
		const activity = state?.lastUserActivity;
		if (activity && activity < idleCutoff) return false;
		return true;
	});
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => {
		const sa = states.get(a);
		const sb = states.get(b);
		const qa = (sa?.failureCount ?? 0) >= QUARANTINE_AT ? 1 : 0;
		const qb = (sb?.failureCount ?? 0) >= QUARANTINE_AT ? 1 : 0;
		if (qa !== qb) return qa - qb; // healthy first
		// Then stalest success first (never-succeeded = stalest of all).
		return (sa?.lastSuccess ?? '') < (sb?.lastSuccess ?? '') ? -1 : 1;
	});
	// Quarantined picks that already burned their one window attempt are
	// SKIPPED, not a bail (review, M6): a sibling that still holds its retry
	// must not be starved by the stalest one having spent its slot.
	for (const pick of candidates) {
		const st = states.get(pick);
		const burned =
			st &&
			st.failureCount >= QUARANTINE_AT &&
			st.lastAttempt &&
			windowOf(st.lastAttempt) === window;
		if (!burned) return pick;
	}
	return null;
}

export async function runScheduledPsPlusCheck(
	db: Db,
	_env: { PSN_REGION?: string },
	// `spentFanOut` = this invocation already paid a sweep chunk's external
	// fan-out (or died mid-chunk) — the caller must NOT stack the score refresh
	// on top (review, H3 sibling: a leaving chunk ~42 + scores ~10 busts 50).
): Promise<{ spentFanOut: boolean }> {
	const region = await pickCronRegion(db);
	if (!region) return { spentFanOut: false };
	let spentFanOut = false;
	const today = new Date().toISOString().slice(0, 10);
	const window = windowOf(today);

	try {
		const held = await withRegionLock(
			db,
			region,
			async (token): Promise<PsPlusCheckOutcome | null> => {
				// A pending sweep OWNS this invocation (H3).
				const state = await getPsPlusSweepState(db, region);
				if (state && !state.done) {
					const sweep = await runGenreSweep(db, region, {
						lockToken: token,
					}).catch((error: unknown) => {
						console.error('ps+ scheduled genre sweep threw', error);
						return null;
					});
					if (sweep?.ok) {
						spentFanOut = true;
						return null;
					}
					spentFanOut = true; // a failed chunk still fanned out
					console.warn('ps+ scheduled genre sweep did not complete a chunk');
				}
				// Leaving sweep third in the rotation — same fall-through rules.
				const leaving = await getPsPlusLeavingState(db, region);
				if (leaving && !leaving.done) {
					const chunk = await runLeavingSweep(db, region, {
						lockToken: token,
					}).catch((error: unknown) => {
						console.error('ps+ scheduled leaving sweep threw', error);
						return null;
					});
					if (
						chunk?.ok &&
						!(chunk.result.swept === 0 && chunk.result.failed === 0)
					) {
						spentFanOut = true;
						return null;
					}
					if (
						!chunk ||
						(!chunk.ok &&
							(chunk.reason === 'provider' || chunk.reason === 'conflict'))
					) {
						console.warn(
							'ps+ scheduled leaving sweep failed mid-chunk — ending the invocation (budget spent)',
						);
						spentFanOut = true;
						return null;
					}
					if (!chunk.ok)
						console.warn(
							'ps+ scheduled leaving sweep could not run — falling through',
						);
				}
				return await runPsPlusCheck(db, region, token);
			},
		);
		if (held.busy) {
			console.warn('ps+ scheduled refresh skipped — the region lock is held');
			return { spentFanOut };
		}
		const outcome = held.result;
		// Sweep invocations are progress, not a membership verdict — no outcome
		// row, but cycle-complete may have just been reached.
		if (!outcome) {
			await maybeMarkCycleComplete(db, region, window);
			return { spentFanOut };
		}
		// `conflict` = a lock-takeover race — a refresh IS running; recording it
		// as a failure would quarantine a healthy region (review, L11).
		if (outcome.ok || outcome.reason !== 'conflict') {
			await recordRegionOutcome(db, region, {
				attemptedOn: today,
				succeeded: outcome.ok,
				window,
			});
		}
		if (outcome.ok) await maybeMarkCycleComplete(db, region, window);
		else console.warn(`ps+ scheduled refresh failed for ${region}`, outcome);
	} catch (error) {
		console.error('ps+ scheduled refresh threw', error);
		await recordRegionOutcome(db, region, {
			attemptedOn: today,
			succeeded: false,
			window,
		});
	}
	return { spentFanOut };
}

/** Cycle-complete = membership succeeded this window AND both sweeps report
 * done (their state rows are re-armed by each membership pass). Sets the flag
 * DIRECTLY — never through a success outcome, which would forge
 * `last_success` on a day nothing was fetched (review, M4). */
async function maybeMarkCycleComplete(db: Db, region: string, window: string) {
	const state = await getRegionState(db, region);
	if (!state?.lastSuccess || windowOf(state.lastSuccess) !== window) return;
	const sweep = await getPsPlusSweepState(db, region);
	const leaving = await getPsPlusLeavingState(db, region);
	if (sweep?.done && leaving?.done) {
		await markRegionCycleComplete(db, region);
	}
}
