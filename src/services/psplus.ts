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
import { listLibraryForUser, setPsPlusExtraFlags } from '../repositories';
import type { Db } from '../repositories/db';
import { getPsnCookie, getPsnRegion } from './settings';

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
