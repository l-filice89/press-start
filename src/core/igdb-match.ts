/**
 * Pure IGDB match selection (Story 1.6). I/O-free (AD-3): the IGDB provider
 * fetches candidate games by name, then hands their names here to decide
 * which — if any — is a confident match. A non-match returns null so the
 * caller records a straggler / marks the game unenriched rather than
 * guessing (FR-28/30). Confidence = a normalized-title equality using the
 * single shared normalizer (AD-9), so glyphs/editions/articles don't defeat
 * an otherwise-exact match.
 */

import { normalizeTitle } from './title-normalizer';

/**
 * Index of the first candidate whose normalized name equals the normalized
 * query, or null when none match. Returning the first of several normalized
 * duplicates is intentional — IGDB orders by relevance.
 */
export function pickIgdbMatch(
	queryTitle: string,
	candidateNames: string[],
): number | null {
	const target = normalizeTitle(queryTitle);
	if (!target) return null;
	for (let i = 0; i < candidateNames.length; i++) {
		if (normalizeTitle(candidateNames[i]) === target) return i;
	}
	return null;
}
