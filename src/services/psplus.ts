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
	deleteCatalogOutsideRegion,
	findUserByEmail,
	listCatalogProductIds,
	listCatalogTitleKeys,
	listLibraryForUser,
	PS_PLUS_TIER,
	pruneCatalogGeneration,
	setPsPlusExtraFlags,
	upsertCatalogProducts,
} from '../repositories';
import type { Db } from '../repositories/db';
import { bumpAllLibraryVersions } from './library-version';
import { holdsPsnLock, withPsnLock } from './psn-lock';
import { runGenreSweep } from './psplus-genres';
import { runLeavingSweep } from './psplus-leaving';
import {
	clearPsPlusRefreshFailed,
	getPsnRegion,
	getPsPlusLeavingState,
	getPsPlusSweepState,
	markPsPlusRefreshFailed,
	setPsPlusLeavingState,
	setPsPlusSweepState,
	stampPsPlusRefreshedAt,
	todayForUser,
} from './settings';

export interface PsPlusCheckResult {
	/** Titles newly flagged as in the catalog this run. */
	flagged: string[];
	/** Titles whose flag was cleared this run (left the catalog). */
	cleared: string[];
	/** Tracked games examined — ALL of them now, owned included (AD-27). */
	checked: number;
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
 *   D1, on the CRON path:
 *             findUserByEmail 1 · lock claim 1 · region read 1 · fence
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
 *   The HTTP button pays the auth middleware (3) on top instead of
 *   findUserByEmail (1), and none of the rotation reads: 37 of 50.
 * A GENRE-SWEEP CHUNK NO LONGER RIDES ALONG (H3): 34 + a chunk (~25) busts the
 * budget, and the resulting mid-sweep "Too many subrequests" throw was
 * self-perpetuating — see `runScheduledPsPlusCheck`.
 */
export async function runPsPlusCheck(
	db: Db,
	userId: string,
	env: { PSN_REGION?: string },
	lockToken?: string,
): Promise<PsPlusCheckOutcome> {
	const region = await getPsnRegion(db, userId, env);
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
	if (lockToken && !(await holdsPsnLock(db, userId, lockToken))) {
		console.error('ps+ check: lock lost mid-run — refusing to write or prune');
		return { ok: false, reason: 'conflict' };
	}

	// The snapshot: upsert everything this run saw under a fresh generation, then
	// delete whatever the run did NOT see (the departed games; their genre tags
	// cascade). Generation-stamped so a cron prune cannot corrupt an in-flight
	// genre sweep (AD-28).
	const generation = crypto.randomUUID();
	const today = await todayForUser(db, userId);
	const scope = { region, tier: PS_PLUS_TIER };
	// What the snapshot held BEFORE this run — the sweep state below only resets
	// when the catalog actually MOVED (see there).
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
	// A changed PSN_REGION leaves the old region's rows behind forever otherwise —
	// the prune above is region-scoped (Story 7.1 review, M6).
	await deleteCatalogOutsideRegion(db, region);

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
	const sweep = moved ? null : await getPsPlusSweepState(db, userId);
	await setPsPlusSweepState(db, userId, {
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
	await setPsPlusLeavingState(db, userId, {
		region,
		generation,
		cursor: null,
		attempts: 0,
		done: false,
	});

	// The flag pass reads the TABLE, not the fetch (AD-27) — one source of truth,
	// so the shelf pill and the catalog grid can never give opposite answers.
	// Titles that normalize to '' (™/edition-only noise) are dropped so they
	// can't collide with a tracked game whose title also normalizes to ''.
	const catalog = new Set(
		(await listCatalogTitleKeys(db, scope)).filter(Boolean),
	);

	// EVERY tracked game is a candidate — owned included (AD-27), DISCARDED
	// included (DW-12): the flag lives on the shared game row and describes
	// catalog membership, not user visibility, so a pass that skips tombstones
	// froze a discarded game's flag forever — stale the moment it was revived.
	// The old `!row.owned` filter is what left owned catalog games permanently
	// unflagged. The check's READOUT below still reports visible games only —
	// "Flagged: <a game you deleted>" is noise.
	const candidates = await listLibraryForUser(db, userId, {
		includeDiscarded: true,
	});

	const toFlag = candidates.filter(
		(row) => !row.psPlusExtra && catalog.has(normalizeTitle(row.title)),
	);
	const toClear = candidates.filter(
		(row) => row.psPlusExtra && !catalog.has(normalizeTitle(row.title)),
	);

	// Story 10.2 (VR-6): the flag transition IS the departure diff, and the
	// stamp rides IN the flag statement (atomic per chunk — review): a set
	// NULLs `ps_plus_left_on` so a pruned-then-readded title can never read as
	// a fresh departure (DW-13); a clear stamps the run's user-zone date. Runs
	// strictly after the wipe guard above — a degenerate response never
	// mass-stamps.
	await setPsPlusExtraFlags(
		db,
		toFlag.map((row) => row.id),
		true,
	);
	await setPsPlusExtraFlags(
		db,
		toClear.map((row) => row.id),
		false,
		today,
	);
	// Shared `game` facts changed → every user's shelf ETag rotates (8.6).
	if (toFlag.length > 0 || toClear.length > 0) {
		await bumpAllLibraryVersions(db);
	}

	// Post-write bookkeeping (5.2 failed-flag clear + 5.3 freshness stamp) is
	// non-critical: the flags above already applied, so a write failure here
	// must NOT flip a genuine success to failed (which would light the cron
	// banner and 502 the button). Same posture as sync.ts's attention persist.
	try {
		// A successful refresh — by ANY trigger — resolves a prior failed-cron
		// notice (Story 5.2, AR-14): the button is thus also a resolution path.
		await clearPsPlusRefreshFailed(db, userId);
		// Record freshness for the header "PS+ CATALOG AS OF {date}" readout (5.3).
		await stampPsPlusRefreshedAt(db, userId);
	} catch (error) {
		console.error('ps+ check: post-success bookkeeping write failed', error);
	}

	return {
		ok: true,
		result: {
			flagged: toFlag.filter((row) => !row.discarded).map((row) => row.title),
			cleared: toClear.filter((row) => !row.discarded).map((row) => row.title),
			checked: candidates.filter((row) => !row.discarded).length,
			region,
			products: products.length,
			pruned: pruned.length,
			generation,
		},
	};
}

/**
 * The monthly Cron Trigger entry (Story 5.2, FR-39/40): runs the SAME
 * `runPsPlusCheck` for the single account user statelessly. A failed run (or a
 * throw) persists the `psplus_refresh_failed` flag that lights the attention
 * banner; success clears it inside `runPsPlusCheck`. No user row yet → no-op.
 *
 * THE CRON TAKES THE LOCK TOO (Story 7.1). The cron and the button fan out to
 * the same store host for the same account and now write the same snapshot, so
 * they are one op, not two: a cron landing while the user has the button (or a
 * genre sweep) running would double the fan-out and race the prune. Busy is NOT
 * a failure — a refresh IS in progress — so it never lights the banner.
 *
 * THE CRON ALSO DRIVES THE GENRE SWEEP (Story 7.1 review, M1). Nothing else
 * would: the chunk endpoint exists for 7.2's client loop, and with no caller
 * `ps_plus_catalog_genre` would simply stay EMPTY in production and 7.2 would
 * filter against nothing.
 *
 * ONE OR THE OTHER PER INVOCATION, NEVER BOTH (Epic 7 cross-story review, H3).
 * The membership pass alone is 34 of the 50 subrequests a Worker invocation gets
 * (AD-15), and a sweep chunk is ~25 more: run together they THROW "Too many
 * subrequests" mid-sweep, which never persists the cursor — so every cron run for
 * the rest of the month re-swept the same first keys, died in the same place, and
 * left most genre chips at 0 permanently. So a cron run with a sweep still
 * pending drives ONLY the sweep chunk; the membership pass runs when the sweep is
 * done (or when it cannot run at all). The cron fires 28× a month
 * (`0 9,21 15-28 * *`) and a 20-key region is 5 chunks, so a refresh + a full sweep
 * still converge inside one monthly window.
 *
 * A sweep failure is NOT a refresh failure — the membership snapshot is valid and
 * complete either way (AD-28), so it never lights the banner.
 */
export async function runScheduledPsPlusCheck(
	db: Db,
	env: {
		AUTH_ALLOWED_EMAIL: string;
		PSN_REGION?: string;
	},
	// `spentFanOut` = this invocation already paid a sweep chunk's external
	// fan-out (or died mid-chunk) — the caller must NOT stack the score refresh
	// on top (review, H3 sibling: a leaving chunk ≈42 + scores ≈10 busts 50).
): Promise<{ spentFanOut: boolean }> {
	// ponytail: single-tenant — resolve THE user by the allowlist email. Loop
	// over users here if AUTH_ALLOWED_EMAIL ever becomes multi-value.
	const user = await findUserByEmail(db, env.AUTH_ALLOWED_EMAIL);
	if (!user) return { spentFanOut: false };
	let spentFanOut = false;

	try {
		const held = await withPsnLock(
			db,
			user.id,
			'catalog-refresh',
			async (token): Promise<PsPlusCheckOutcome | null> => {
				// A pending sweep OWNS this invocation (H3). `null` = no membership pass
				// ran, so there is nothing to light (or clear) the banner with.
				const state = await getPsPlusSweepState(db, user.id);
				if (state && !state.done) {
					const sweep = await runGenreSweep(db, user.id, env, {
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
					// A sweep that cannot run AT ALL (no catalog, a stale/steamrolled
					// state, a dead facet probe) must not starve the membership pass
					// forever — it fails within a handful of calls, so the pass still
					// fits. A per-KEY failure is not this: that is an `ok` chunk.
					console.warn('ps+ scheduled genre sweep did not complete a chunk');
				}
				// Third in the rotation (Story 10.4): a pending LEAVING sweep owns
				// the invocation once the genre sweep is done — same H3 rule, a
				// chunk (≤41 subrequests) cannot share the invocation with the
				// membership pass (34). Fall-through discipline differs from the
				// genre sweep's: a `provider`/`conflict` failure (or a throw) has
				// already BURNED up to a chunk's worth of subrequests, so running
				// the membership pass on top would bust the 50 cap mid-write —
				// the invocation ends and the next fire retries. Only the cheap,
				// immediate refusals (`no-state`, `no-region` — a couple of D1
				// reads, no fan-out) fall through to the membership pass.
				const leaving = await getPsPlusLeavingState(db, user.id);
				if (leaving && !leaving.done) {
					const chunk = await runLeavingSweep(db, user.id, env, {
						lockToken: token,
					}).catch((error: unknown) => {
						console.error('ps+ scheduled leaving sweep threw', error);
						return null;
					});
					// An EMPTY chunk (no game was actually queried — zero external
					// fan-out, whatever the cursor did) hands the invocation on to
					// the membership pass instead of burning a cron fire on
					// bookkeeping (review: a chunk of all-unmatched titles is empty
					// too, not only the final no-pending one).
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
				return await runPsPlusCheck(db, user.id, env, token);
			},
		);
		if (held.busy) {
			console.warn('ps+ scheduled refresh skipped — a PSN op holds the lock');
			return { spentFanOut };
		}
		const outcome = held.result;
		// A sweep invocation — no membership verdict to act on.
		if (!outcome) return { spentFanOut };
		// Only a genuine provider failure (a retry may fix) lights the banner.
		// `no-region` and `bad-region` are config gaps, not transient refresh
		// failures: the banner tells the user to run the button, but the button
		// hits the same wall — lighting it would be a permanent dead-end.
		if (!outcome.ok && outcome.reason === 'provider') {
			await markPsPlusRefreshFailed(db, user.id);
		}
	} catch (error) {
		console.error('ps+ scheduled refresh threw', error);
		await markPsPlusRefreshFailed(db, user.id);
	}
	return { spentFanOut };
}
