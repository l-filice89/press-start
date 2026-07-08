/**
 * Pure seed reconciliation (Story 1.6, FR-26/27/30). I/O-free (AD-3):
 * given the two parsed CSVs it produces an import *plan* — the games to
 * create (with their PS links, ownership, and Notion-derived tracking) and
 * the stragglers to record — but performs no enrichment or DB writes (those
 * are the service's job). Title matching is the single `core/` normalizer
 * (AD-9); genres/covers/release dates are NOT decided here (IGDB, in the
 * service).
 */

import { mapNotionStatus, parseNotionDate } from './notion-status';
import { normalizeTitle } from './title-normalizer';
import type { PlayStatus } from './types';

export type OwnershipType = 'physical' | 'digital';

/**
 * One reconciled game before enrichment. `source` records where it came from:
 * a `notion`-only candidate has no PS link and only becomes a real game if
 * IGDB resolves it (else it degrades to a straggler in the service).
 */
export interface GameCandidate {
	canonicalTitle: string;
	normalizedTitle: string;
	/** PSN `title_id`s → `external_link` rows (PS4 + PS5 collapse to one game). */
	psLinks: string[];
	/** PlayStation Store cover, used before an IGDB fallback (cover source order). */
	psCoverUrl: string | null;
	psStoreUrl: string | null;
	owned: boolean;
	ownershipType: OwnershipType | null;
	playStatus: PlayStatus | null;
	completedOn: string | null;
	startedOn: string | null;
	source: 'ps' | 'both' | 'notion';
	/** Raw Notion row (JSON) when a Notion source contributed — else null. */
	notionPayload: string | null;
}

export interface StragglerRow {
	sourceTitle: string;
	notionPayload: string;
}

export interface SeedPlan {
	candidates: GameCandidate[];
	stragglers: StragglerRow[];
	/** PS+ claim rows excluded from the import (FR-26, reported in the summary). */
	skippedMembership: number;
}

export interface SeedInput {
	psRows: Record<string, string>[];
	notionRows: Record<string, string>[];
}

/**
 * A PS row is membership-sourced (a PS+ claim, excluded) when its `membership`
 * column is a non-empty value other than `NONE`. `NONE` = purchased/owned.
 */
function isMembershipSourced(membership: string): boolean {
	const value = membership.trim().toUpperCase();
	return value !== '' && value !== 'NONE';
}

function firstNonEmpty(...values: (string | undefined)[]): string | null {
	for (const value of values) {
		if (value?.trim()) return value.trim();
	}
	return null;
}

/** Build the import plan from the two parsed source CSVs. Pure. */
export function buildSeedPlan({ psRows, notionRows }: SeedInput): SeedPlan {
	const byNorm = new Map<string, GameCandidate>();
	const stragglers: StragglerRow[] = [];
	let skippedMembership = 0;

	// --- PS side: group non-excluded rows by normalized title (PS4/PS5 → one) ---
	const psGroups = new Map<string, Record<string, string>[]>();
	for (const row of psRows) {
		if (isMembershipSourced(row.membership ?? '')) {
			skippedMembership++;
			continue;
		}
		const norm = normalizeTitle(row.name ?? '');
		if (!norm) continue; // a nameless row can't be placed
		const group = psGroups.get(norm) ?? [];
		group.push(row);
		psGroups.set(norm, group);
	}

	for (const [norm, rows] of psGroups) {
		const ps5 = rows.find((r) => (r.platform ?? '').toUpperCase() === 'PS5');
		const canonical = ps5 ?? rows[0];
		const psLinks = [
			...new Set(
				rows.map((r) => (r.title_id ?? '').trim()).filter((id) => id !== ''),
			),
		];
		byNorm.set(norm, {
			canonicalTitle: (canonical.name ?? '').trim(),
			normalizedTitle: norm,
			psLinks,
			psCoverUrl: firstNonEmpty(ps5?.image_url, rows[0].image_url),
			psStoreUrl: firstNonEmpty(ps5?.store_url, rows[0].store_url),
			owned: true,
			ownershipType: 'digital',
			playStatus: 'Not started',
			completedOn: null,
			startedOn: null,
			source: 'ps',
			notionPayload: null,
		});
	}

	// --- Notion side: map status/dates, merge onto PS games or add as notion-only ---
	for (const row of notionRows) {
		const title = (row.Title ?? '').trim();
		const norm = normalizeTitle(title);
		const payload = JSON.stringify(row);
		const status = mapNotionStatus(row.Status ?? '');

		if (!status.known || !norm) {
			// Unknown status (or unnameable row): record, never guess (FR-28/30).
			stragglers.push({ sourceTitle: title, notionPayload: payload });
			continue;
		}

		const completedOn = status.completed
			? parseNotionDate(row['Date finished'] ?? '')
			: null;
		const startedOn = parseNotionDate(row['Date started'] ?? '');
		const notionOwned = (row.Owned ?? '').trim().toLowerCase() === 'yes';
		const existing = byNorm.get(norm);

		// A Completed row with no usable finish date can record neither a
		// milestone nor a live status without violating the completion invariant
		// — flag it for manual resolution rather than fabricate a date.
		if (status.completed && completedOn === null) {
			stragglers.push({ sourceTitle: title, notionPayload: payload });
			if (existing) {
				// Keep the (owned) game on the backlog; just merge ownership/dates.
				existing.owned = existing.owned || notionOwned;
				if (existing.ownershipType === null && notionOwned) {
					existing.ownershipType = 'physical';
				}
				existing.startedOn = existing.startedOn ?? startedOn;
				existing.notionPayload = payload;
				if (existing.source === 'ps') existing.source = 'both';
			}
			continue;
		}

		if (existing) {
			existing.source = existing.source === 'notion' ? 'notion' : 'both';
			existing.playStatus = status.playStatus;
			existing.completedOn = completedOn;
			existing.startedOn = startedOn ?? existing.startedOn;
			existing.owned = existing.owned || notionOwned;
			// PS ownership (digital) wins; only fill a type if none was set.
			if (existing.ownershipType === null && notionOwned) {
				existing.ownershipType = 'physical';
			}
			existing.notionPayload = payload;
		} else {
			byNorm.set(norm, {
				canonicalTitle: title,
				normalizedTitle: norm,
				psLinks: [],
				psCoverUrl: null,
				psStoreUrl: null,
				owned: notionOwned,
				ownershipType: notionOwned ? 'physical' : null,
				playStatus: status.playStatus,
				completedOn,
				startedOn,
				source: 'notion',
				notionPayload: payload,
			});
		}
	}

	return {
		candidates: [...byNorm.values()],
		stragglers,
		skippedMembership,
	};
}
