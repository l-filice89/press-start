/**
 * PS+ Extra catalog check (Story 5.1, FR-38/39, AR-10/23): fetches the
 * region's PS+ Game Catalog through the provider seam, then sets/clears
 * `game.ps_plus_extra` on tracked, NON-owned games only — both directions,
 * matched by normalized title. Catalog games absent from the library are
 * never inserted (availability is not ownership). The fetch completes fully
 * before any write, so a wire failure — or a suspect empty catalog — leaves
 * every flag untouched. (The set and clear are two statements, not one
 * transaction; a D1 failure between them self-heals on the next run.)
 */

import { normalizeTitle } from '../core';
import { createPsnProvider } from '../providers';
import {
	findUserByEmail,
	listLibraryForUser,
	setPsPlusExtraFlags,
} from '../repositories';
import type { Db } from '../repositories/db';
import {
	clearPsPlusRefreshFailed,
	getPsnCookie,
	getPsnRegion,
	markPsPlusRefreshFailed,
	stampPsPlusRefreshedAt,
} from './settings';

export interface PsPlusCheckResult {
	/** Titles newly flagged as in the catalog this run. */
	flagged: string[];
	/** Titles whose flag was cleared this run (left the catalog). */
	cleared: string[];
	/** Tracked non-owned games examined. */
	checked: number;
	/** The region the catalog was fetched for. */
	region: string;
}

export type PsPlusCheckOutcome =
	| { ok: true; result: PsPlusCheckResult }
	| { ok: false; reason: 'no-region' | 'provider' };

export async function runPsPlusCheck(
	db: Db,
	userId: string,
	env: { PSN_REGION?: string; PSN_SESSION_COOKIE?: string },
): Promise<PsPlusCheckOutcome> {
	const region = await getPsnRegion(db, userId, env);
	if (!region) return { ok: false, reason: 'no-region' };

	const provider = createPsnProvider({
		getCookie: () => getPsnCookie(db, userId, env),
	});

	let catalogNames: string[];
	try {
		catalogNames = await provider.fetchPsPlusExtraCatalog(region);
	} catch (error) {
		console.error('ps+ check: catalog fetch failed', error);
		return { ok: false, reason: 'provider' };
	}

	// Data-loss guard: the real PS+ Extra catalog is hundreds of games. A 200
	// with zero products means a bad region, a de-listed catalog, or category-id
	// rot — NOT "clear every flag". Treat it as a provider failure so the
	// both-directions clear pass never wipes the shelf on a suspect response.
	if (catalogNames.length === 0) {
		console.error(
			'ps+ check: empty catalog on a 200 — treating as provider failure',
		);
		return { ok: false, reason: 'provider' };
	}

	// Drop names that normalize to '' (™/edition-only noise) so they can't
	// collide with a tracked game whose title also normalizes to ''.
	const catalog = new Set(catalogNames.map(normalizeTitle).filter(Boolean));

	// Flag hazard (FR-38/AR-10): only tracked, non-owned rows are candidates —
	// owned games and untracked catalog games are never written.
	const library = await listLibraryForUser(db, userId);
	const candidates = library.filter((row) => !row.owned);

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
		},
	};
}

/**
 * The monthly Cron Trigger entry (Story 5.2, FR-39/40): runs the SAME
 * `runPsPlusCheck` for the single account user statelessly. A failed run (or a
 * throw) persists the `psplus_refresh_failed` flag that lights the attention
 * banner; success clears it inside `runPsPlusCheck`. No user row yet → no-op.
 */
export async function runScheduledPsPlusCheck(
	db: Db,
	env: {
		AUTH_ALLOWED_EMAIL: string;
		PSN_REGION?: string;
		PSN_SESSION_COOKIE?: string;
	},
): Promise<void> {
	// ponytail: single-tenant — resolve THE user by the allowlist email. Loop
	// over users here if AUTH_ALLOWED_EMAIL ever becomes multi-value.
	const user = await findUserByEmail(db, env.AUTH_ALLOWED_EMAIL);
	if (!user) return;

	try {
		const outcome = await runPsPlusCheck(db, user.id, env);
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
