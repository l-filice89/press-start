/**
 * Trophy derivation (Story 9.2, AR-3/AR-8) — I/O-free. The PSN trophy sync
 * PERSISTS raw earned/defined counts per tier on `game_tracking`; the
 * completion % and the letter grade are FUNCTIONS of those counts, computed
 * here on every read. Nothing derived is ever stored (no second source of
 * truth), and PSN's own weighted `progress` field is deliberately not used —
 * it disagrees with the count-based number (Tales of Arise: 6 of 59 earned,
 * PSN says 7, count-based says 10) and persisting it would be exactly the
 * duplicate the architecture forbids.
 */
import { normalizeTitle } from './title-normalizer';

/** Earned or defined trophies by tier — the shape PSN sends and D1 stores. */
export interface TrophyTierCounts {
	bronze: number;
	silver: number;
	gold: number;
	platinum: number;
}

export const TROPHY_GRADES = ['S', 'A', 'B', 'C', 'D'] as const;
export type TrophyGrade = (typeof TROPHY_GRADES)[number];

/**
 * The ONE place the bands live (AR-3) — a chosen convention, not a captured
 * requirement, so retuning is a one-line change here. S = a completed set.
 */
export const TROPHY_GRADE_BANDS = [
	{ min: 100, grade: 'S' },
	{ min: 75, grade: 'A' },
	{ min: 50, grade: 'B' },
	{ min: 25, grade: 'C' },
	{ min: 0, grade: 'D' },
] as const satisfies readonly { min: number; grade: TrophyGrade }[];

const TROPHY_TITLE_SUFFIX = /\s+trophies\s*$/i;

/**
 * The join key from a PSN trophy title back to a library game. The captured
 * payload carries NO titleId/conceptId — the name is the only join — and
 * PS4-era trophy titles are named "<Game> Trophies" ("Ultimate Chicken Horse
 * Trophies") while PS5 ones are named plainly ("Tales of Arise"). Strip that
 * trailing word, then hand off to the shared normalizer (™, editions, the
 * PS4/PS5 collapse). The strip stays trophy-local: pushing it into
 * `normalizeTitle` would corrupt library matching for a game legitimately
 * ending in "Trophies".
 */
export function trophyTitleToMatchKey(trophyTitleName: string): string {
	return normalizeTitle(trophyTitleName.replace(TROPHY_TITLE_SUFFIX, ''));
}

export function totalTrophies(counts: TrophyTierCounts): number {
	return counts.bronze + counts.silver + counts.gold + counts.platinum;
}

/**
 * Count-based completion, 0-100 — or `null` when the game defines no trophies
 * at all. `null` is the no-data signal the UI keys off: a game without trophy
 * data shows NOTHING, never a fake `0%` (a real 0-of-59 does show `0% · D`).
 *
 * FLOOR, not round: 199 of 200 is 99.5%, and rounding it would print a
 * `100% · S` on an unfinished set — the one number a trophy hunter would call
 * a lie. CLAMPED at both ends: PSN's own earned/defined counts can disagree
 * (its counts skew across trophy-group changes), and `earned > defined` would
 * otherwise print a `113% · S`.
 */
export function completionPercent(
	earned: number,
	defined: number,
): number | null {
	if (!Number.isFinite(defined) || defined <= 0) return null;
	return Math.min(100, Math.floor((Math.max(earned, 0) / defined) * 100));
}

export function trophyGrade(percent: number): TrophyGrade {
	// Bands are ordered high→low; the first floor the percent clears wins.
	return (
		TROPHY_GRADE_BANDS.find((band) => percent >= band.min) ??
		TROPHY_GRADE_BANDS[TROPHY_GRADE_BANDS.length - 1]
	).grade;
}
