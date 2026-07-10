/**
 * Pure PSN-sync reconciliation (Story 4.2, FR-33/34). I/O-free (AD-3): given
 * the provider's purchased-list entries and a prebuilt matching index, it
 * produces an explicit, additive-only *plan* — games to create, existing
 * games to ensure owned, links/facts to add — and performs no writes (the
 * service's job). Mirrors `seed-reconcile`'s plan-then-execute shape, but
 * with SYNC semantics: membership claims (PS+ etc.) are SKIPPED before
 * matching (FR-9/33), where the seed imported them as owned.
 *
 * Matching (FR-34/AD-9/18/20): stored PSN external-id links first, then
 * normalized title with PS4/PS5 collapse. An external id resolving to a
 * different game than the title match is a CONFLICT — flagged, never merged.
 */

import { normalizeTitle } from './title-normalizer';

/** The provider fields sync needs (structural subset of `PsnGame` — core
 * imports nothing from `providers/`, AD-3). */
export interface SyncEntry {
	name: string;
	platform: string;
	/** `'NONE'` = purchase; anything else is a membership claim (FR-9). */
	membership: string | null;
	titleId: string | null;
	imageUrl: string | null;
	storeUrl: string | null;
}

/** Matching index, built by the service from `repositories/` reads. */
export interface SyncIndex {
	/** PSN `external_id` → `game.id` for every stored PSN link. */
	linkedGameIdByExternalId: Record<string, string>;
	/** `title_normalized` → every game sharing it (AD-18: non-unique). */
	gamesByNormalizedTitle: Record<
		string,
		{ gameId: string; psnExternalIds: string[] }[]
	>;
}

export interface SyncCreate {
	title: string;
	titleNormalized: string;
	coverUrl: string | null;
	storeUrl: string | null;
	externalIds: string[];
}

/** An existing game a purchase entry matched: ensure owned + backfill. */
export interface SyncMatch {
	gameId: string;
	/** The PSN entry's display name — names the game in failure reports. */
	title: string;
	/** Group ids not yet linked to the game. */
	externalIdsToAdd: string[];
	/** PSN facts for NULL-only backfill (never overwrite, FR-33/35). */
	coverUrl: string | null;
	storeUrl: string | null;
}

export interface SyncConflict {
	title: string;
	/** Why the entry was flagged instead of merged. */
	reason: string;
}

export interface SyncPlan {
	creates: SyncCreate[];
	matches: SyncMatch[];
	skippedMembership: number;
	conflicts: SyncConflict[];
}

/** One PS4/PS5-collapsed group of purchase entries. */
interface EntryGroup {
	titleNormalized: string;
	entries: SyncEntry[];
	externalIds: string[];
}

/** PS5 facts win within a group (the collapse keeps the PS5 identity, AD-9). */
function preferred(group: EntryGroup): SyncEntry {
	return group.entries.find((e) => e.platform === 'PS5') ?? group.entries[0];
}

export function planSync(entries: SyncEntry[], index: SyncIndex): SyncPlan {
	const plan: SyncPlan = {
		creates: [],
		matches: [],
		skippedMembership: 0,
		conflicts: [],
	};

	// Membership skip happens BEFORE matching: a claim never creates, never
	// flips, and a claim matching a tracked game must leave it untouched.
	const purchases: SyncEntry[] = [];
	for (const entry of entries) {
		// Anything but an explicit purchase marker is a claim — including an
		// empty string; only `null` (field absent upstream) and `'NONE'` pass.
		if (entry.membership !== null && entry.membership !== 'NONE') {
			plan.skippedMembership++;
		} else {
			purchases.push(entry);
		}
	}

	// PS4/PS5 collapse: group purchases by normalized title; ALL the group's
	// titleIds become links on the one game. Each titleId claims exactly one
	// group (`seenIds`): a duplicate under a second name would otherwise plan
	// two inserts of the same unique `(source, external_id)` and abort the
	// execute mid-write.
	const groups = new Map<string, EntryGroup>();
	const seenIds = new Set<string>();
	for (const entry of purchases) {
		if (!entry.name.trim()) continue; // a nameless entry can't match or title a game
		const titleNormalized = normalizeTitle(entry.name);
		let group = groups.get(titleNormalized);
		if (!group) {
			group = { titleNormalized, entries: [], externalIds: [] };
			groups.set(titleNormalized, group);
		}
		group.entries.push(entry);
		if (entry.titleId && !seenIds.has(entry.titleId)) {
			seenIds.add(entry.titleId);
			group.externalIds.push(entry.titleId);
		}
	}

	for (const group of groups.values()) {
		const facts = preferred(group);

		// 1) Stored external-id links win (AD-20 identity).
		const linked = new Set(
			group.externalIds
				.map((id) => index.linkedGameIdByExternalId[id])
				.filter((gameId): gameId is string => gameId !== undefined),
		);
		if (linked.size > 1) {
			plan.conflicts.push({
				title: facts.name,
				reason: `its PSN ids are linked to ${linked.size} different games (PS4/PS5 pair split across games)`,
			});
			continue;
		}
		if (linked.size === 1) {
			const gameId = [...linked][0];
			// FR-34's defining conflict: the stored id resolves to one game
			// while the title matches a DIFFERENT one — flagged, never merged.
			const titleCandidates =
				index.gamesByNormalizedTitle[group.titleNormalized] ?? [];
			if (
				titleCandidates.length > 0 &&
				!titleCandidates.some((c) => c.gameId === gameId)
			) {
				plan.conflicts.push({
					title: facts.name,
					reason:
						'its stored PSN id resolves to a different game than its title match — not merged',
				});
				continue;
			}
			plan.matches.push({
				gameId,
				title: facts.name,
				externalIdsToAdd: group.externalIds.filter(
					(id) => index.linkedGameIdByExternalId[id] === undefined,
				),
				coverUrl: facts.imageUrl,
				storeUrl: facts.storeUrl,
			});
			continue;
		}

		// 2) Normalized-title match. A candidate already carrying a DIFFERENT
		// PSN id is a different game that happens to share the name (AD-18) —
		// flagged, never merged (FR-34).
		const candidates = index.gamesByNormalizedTitle[group.titleNormalized];
		if (candidates?.length) {
			// Merge ONLY the unambiguous case: exactly one same-title game and
			// it carries no PSN id. Any claimed candidate (different id) or a
			// multi-candidate spread is the FR-34 "same name, same game?"
			// situation — flagged, never guessed.
			if (
				candidates.length === 1 &&
				candidates[0].psnExternalIds.length === 0
			) {
				plan.matches.push({
					gameId: candidates[0].gameId,
					title: facts.name,
					externalIdsToAdd: group.externalIds,
					coverUrl: facts.imageUrl,
					storeUrl: facts.storeUrl,
				});
			} else if (candidates.length === 1) {
				plan.conflicts.push({
					title: facts.name,
					reason:
						'a game with this title already carries a different PSN id — not merged',
				});
			} else {
				plan.conflicts.push({
					title: facts.name,
					reason: `${candidates.length} existing games share this title — ambiguous match`,
				});
			}
			continue;
		}

		// 3) Nothing matched: a new game (FR-33 defaults; the service adds
		// tracking and links).
		plan.creates.push({
			title: facts.name,
			titleNormalized: group.titleNormalized,
			coverUrl: facts.imageUrl,
			storeUrl: facts.storeUrl,
			externalIds: group.externalIds,
		});
	}

	return plan;
}
