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
import { createPsnProvider, type PsnCatalog } from '../providers';
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
import { holdsPsnLock, withPsnLock } from './psn-lock';
import { runGenreSweep } from './psplus-genres';
import {
	clearPsPlusRefreshFailed,
	getPsnNpsso,
	getPsnRegion,
	getPsPlusSweepState,
	markPsPlusRefreshFailed,
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
	| { ok: false; reason: 'no-region' | 'provider' | 'conflict' };

/**
 * Subrequest ledger for one membership pass (AD-15: 50 external + D1 binding
 * calls count too). Counted honestly, every binding call:
 *   external: 5 catalog pages (490 / 100), 0 auth legs (this endpoint is public)
 *   D1:       auth middleware 3 · region read 1 · lock claim + fence + release 3 ·
 *             timezone read (todayForUser) 1 · snapshot upsert ceil(490/50) = 10 ·
 *             prune 1 · stale-region delete 1 · title keys 1 · library read 1 ·
 *             flag set + clear 2 · sweep-state write 1 · bookkeeping (failed-flag
 *             clear 1 + stamp, which re-reads the timezone, 2) 3
 *   total  = 5 external + 28 D1 = 33 of 50.
 * The cron path adds one genre-sweep chunk on top — see `runScheduledPsPlusCheck`.
 */
export async function runPsPlusCheck(
	db: Db,
	userId: string,
	env: { PSN_REGION?: string; PSN_NPSSO?: string },
	lockToken?: string,
): Promise<PsPlusCheckOutcome> {
	const region = await getPsnRegion(db, userId, env);
	if (!region) return { ok: false, reason: 'no-region' };

	// The catalog endpoint is public — the provider needs no credential for it,
	// but the seam is one adapter, so the getter rides along unused.
	const provider = createPsnProvider({
		getNpsso: () => getPsnNpsso(db, userId, env),
	});

	let fetched: PsnCatalog;
	try {
		fetched = await provider.fetchPsPlusExtraCatalog(region);
	} catch (error) {
		// EVERY degenerate response lands here, and all of them are HTTP 200: a
		// null grid on a bad region, and a null grid + `errors` on a bad category
		// id, both carry a GraphQL `errors` array the provider throws on. A 200 is
		// not success.
		console.error('ps+ check: catalog fetch failed', error);
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
	// flags. EXACT match or fail closed — the store's own `totalCount` rides every
	// page, so there is no tolerance to justify: a short walk NEVER prunes.
	const products = fetched.products;
	if (products.length === 0 || products.length !== fetched.totalCount) {
		console.error(
			`ps+ check: refusing a suspect catalog — ${products.length} products against a reported totalCount of ${fetched.totalCount}`,
		);
		return { ok: false, reason: 'provider' };
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
	// are dead. When the catalog is UNCHANGED (the common case: the cron fires 7×
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

	// The flag pass reads the TABLE, not the fetch (AD-27) — one source of truth,
	// so the shelf pill and the catalog grid can never give opposite answers.
	// Titles that normalize to '' (™/edition-only noise) are dropped so they
	// can't collide with a tracked game whose title also normalizes to ''.
	const catalog = new Set(
		(await listCatalogTitleKeys(db, scope)).filter(Boolean),
	);

	// EVERY tracked game is a candidate — owned included (AD-27). The old
	// `!row.owned` filter is what left owned catalog games permanently unflagged.
	const candidates = await listLibraryForUser(db, userId);

	const toFlag = candidates.filter(
		(row) => !row.psPlusExtra && catalog.has(normalizeTitle(row.title)),
	);
	const toClear = candidates.filter(
		(row) => row.psPlusExtra && !catalog.has(normalizeTitle(row.title)),
	);

	await setPsPlusExtraFlags(
		db,
		toFlag.map((row) => row.id),
		true,
	);
	await setPsPlusExtraFlags(
		db,
		toClear.map((row) => row.id),
		false,
	);

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
			flagged: toFlag.map((row) => row.title),
			cleared: toClear.map((row) => row.title),
			checked: candidates.length,
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
 * filter against nothing. One chunk per cron run, INSIDE the same lock (the
 * refresh's fan-out is over by then, so the budgets do not overlap): the cron
 * fires 7× a month (`0 21 15-21 * *`), so a ~5-chunk sweep converges within days
 * of the refresh and self-heals a chunk that failed. A sweep failure is NOT a
 * refresh failure — the membership snapshot is valid and complete either way
 * (AD-28), so it never lights the banner.
 *
 * Subrequest ledger, cron run: the membership pass (33, above) + one sweep chunk
 * (its own ledger in `psplus-genres.ts`) share ONE invocation. The sweep chunk is
 * sized for the SHARED budget: see CHUNK_SIZE there.
 */
export async function runScheduledPsPlusCheck(
	db: Db,
	env: {
		AUTH_ALLOWED_EMAIL: string;
		PSN_REGION?: string;
		PSN_NPSSO?: string;
	},
): Promise<void> {
	// ponytail: single-tenant — resolve THE user by the allowlist email. Loop
	// over users here if AUTH_ALLOWED_EMAIL ever becomes multi-value.
	const user = await findUserByEmail(db, env.AUTH_ALLOWED_EMAIL);
	if (!user) return;

	try {
		const held = await withPsnLock(
			db,
			user.id,
			'catalog-refresh',
			async (token) => {
				const outcome = await runPsPlusCheck(db, user.id, env, token);
				if (!outcome.ok) return outcome;
				// One sweep chunk, resumed from the persisted cursor — unless the sweep
				// already finished this snapshot (then there is nothing to advance).
				// Genre tags are a 7.2 nicety on top of a valid snapshot: a failing
				// sweep must never turn a good refresh into a failed one.
				const state = await getPsPlusSweepState(db, user.id);
				if (state?.done) return outcome;
				const sweep = await runGenreSweep(db, user.id, env).catch(
					(error: unknown) => {
						console.error('ps+ scheduled genre sweep threw', error);
						return null;
					},
				);
				if (!sweep?.ok)
					console.warn('ps+ scheduled genre sweep did not complete a chunk');
				return outcome;
			},
		);
		if (held.busy) {
			console.warn('ps+ scheduled refresh skipped — a PSN op holds the lock');
			return;
		}
		const outcome = held.result;
		// Only a genuine provider failure (a retry may fix) lights the banner.
		// `no-region` is a deploy/config gap, not a transient refresh failure:
		// the banner tells the user to run the button, but the button hits the
		// same no-region wall — lighting it would be a permanent dead-end.
		if (!outcome.ok && outcome.reason === 'provider') {
			await markPsPlusRefreshFailed(db, user.id);
		}
	} catch (error) {
		console.error('ps+ scheduled refresh threw', error);
		await markPsPlusRefreshFailed(db, user.id);
	}
}
