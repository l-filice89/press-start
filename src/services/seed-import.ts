/**
 * Seed import orchestration (Story 1.6). Driver-agnostic: it takes any
 * repository `Db` (the Worker's D1 driver in tests, the script's D1-HTTP proxy
 * in production) plus an `IgdbProvider`, parses the two CSVs via `core/`,
 * reconciles them into a plan (`core/buildSeedPlan`), enriches each game from
 * IGDB, and applies the result through the `repositories/` seam (AD-4). All
 * substantive decisions are pure `core/`; this layer is the async glue and is
 * integration-tested against real D1 with a fake IGDB provider. No UI/Worker
 * surface (AR-20).
 */

import { parseCsv } from '../core/csv';
import { buildSeedPlan } from '../core/seed-reconcile';
import type { IgdbProvider } from '../providers/igdb';
import {
	addExternalLink,
	findGameByExternalLink,
	findGamesByNormalizedTitle,
	findUserByEmail,
	insertGame,
	insertStraggler,
	linkGameGenre,
	listStragglers,
	upsertGenre,
	upsertTracking,
} from '../repositories';
import type { Db } from '../repositories/db';

export interface SeedSummary {
	gamesCreated: number;
	/** Already present (resolved by external link) on a re-run — reused, not duplicated. */
	gamesExisting: number;
	tracked: number;
	genresLinked: number;
	stragglers: number;
	/** PSN "web app" entries excluded from the import (e.g. IGN/Multiplayer.it companion apps). */
	skippedWebApp: number;
	/** Games created without an IGDB match (name-only, PS-owned). */
	unenriched: number;
}

export interface RunSeedImportArgs {
	db: Db;
	igdb: IgdbProvider;
	psCsv: string;
	notionCsv: string;
	userEmail: string;
}

export async function runSeedImport({
	db,
	igdb,
	psCsv,
	notionCsv,
	userEmail,
}: RunSeedImportArgs): Promise<SeedSummary> {
	const userRow = await findUserByEmail(db, userEmail);
	if (!userRow) {
		throw new Error(
			`No user found for "${userEmail}". Sign in once with a magic link to create your user, then re-run the seed.`,
		);
	}
	const userId = userRow.id;

	const plan = buildSeedPlan({
		psRows: parseCsv(psCsv),
		notionRows: parseCsv(notionCsv),
	});

	const summary: SeedSummary = {
		gamesCreated: 0,
		gamesExisting: 0,
		tracked: 0,
		genresLinked: 0,
		stragglers: 0,
		skippedWebApp: plan.skippedWebApp,
		unenriched: 0,
	};

	// Re-run idempotency for stragglers: a straggler already recorded under the
	// same source title is not re-inserted (source titles are unique per import).
	const knownStragglers = new Set(
		(await listStragglers(db)).map((s) => s.sourceTitle),
	);
	async function recordStraggler(
		sourceTitle: string,
		notionPayload: string | null,
	): Promise<void> {
		if (knownStragglers.has(sourceTitle)) return;
		await insertStraggler(db, { sourceTitle, notionPayload });
		knownStragglers.add(sourceTitle);
		summary.stragglers++;
	}

	// Reconcile-time stragglers (unknown status / undated completion).
	for (const straggler of plan.stragglers) {
		await recordStraggler(straggler.sourceTitle, straggler.notionPayload);
	}

	for (const candidate of plan.candidates) {
		// Re-run idempotency: a PS candidate already present resolves by link.
		let gameId: string | undefined;
		for (const externalId of candidate.psLinks) {
			const found = await findGameByExternalLink(db, 'PSN', externalId);
			if (found) {
				gameId = found.id;
				break;
			}
		}

		// Notion-only games carry no external link — their cross-run identity is
		// the normalized-title match key (AD-9), so a re-run resolves the existing
		// game by title instead of recreating it.
		if (gameId === undefined && candidate.psLinks.length === 0) {
			const [existing] = await findGamesByNormalizedTitle(
				db,
				candidate.normalizedTitle,
			);
			if (existing) gameId = existing.id;
		}

		if (gameId === undefined) {
			const enrichment = await igdb.enrich(candidate.canonicalTitle);

			// Notion-only + no IGDB match → never guessed: straggler, no game.
			if (enrichment === null && candidate.psLinks.length === 0) {
				await recordStraggler(
					candidate.canonicalTitle,
					candidate.notionPayload,
				);
				continue;
			}

			const unenriched = enrichment === null; // PS-owned but IGDB-unresolved
			const created = await insertGame(db, {
				title: candidate.canonicalTitle,
				titleNormalized: candidate.normalizedTitle,
				releaseDate: enrichment?.releaseDate ?? null,
				// PlayStation Store cover first, IGDB cover as fallback.
				coverUrl: candidate.psCoverUrl ?? enrichment?.coverUrl ?? null,
				storeUrl: candidate.psStoreUrl ?? null,
				unenriched,
				psPlusExtra: candidate.psPlusExtra,
			});
			gameId = created.id;
			summary.gamesCreated++;
			if (unenriched) summary.unenriched++;

			for (const externalId of candidate.psLinks) {
				await addExternalLink(db, { gameId, source: 'PSN', externalId });
			}

			// Genres come exclusively from IGDB (FR-23); auto-created, idempotent.
			if (enrichment) {
				for (const name of enrichment.genres) {
					const genre = await upsertGenre(db, name);
					await linkGameGenre(db, gameId, genre.id);
					summary.genresLinked++;
				}
			}
		} else {
			summary.gamesExisting++;
			// Recover any links a prior partial run left unattached.
			for (const externalId of candidate.psLinks) {
				const found = await findGameByExternalLink(db, 'PSN', externalId);
				if (!found)
					await addExternalLink(db, { gameId, source: 'PSN', externalId });
			}
		}

		// Per-user tracking, invariant-safe play status (AD-13, FR-3).
		const playStatus =
			candidate.playStatus ?? (candidate.completedOn ? null : 'Not started');
		await upsertTracking(db, userId, gameId, {
			playStatus,
			completedOn: candidate.completedOn,
			startedOn: candidate.startedOn,
			owned: candidate.owned,
			ownershipType: candidate.ownershipType,
			// FR-9 amended (2026-07-11): claims are owned but flagged by source
			// so a future subscription-cancel flow un-owns claims, never
			// purchases. `candidate.psPlusExtra` is the seed's claim marker.
			ownedVia: candidate.owned
				? candidate.psPlusExtra
					? 'membership'
					: 'purchase'
				: undefined,
		});
		summary.tracked++;
	}

	return summary;
}
