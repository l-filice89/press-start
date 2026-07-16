import './score-grade.css';

/**
 * Score color grading (Story 10.5): one bucket rule for every rendered score —
 * card, detail panel, candidate rows. Buckets apply to the ROUNDED value the
 * user sees (a displayed 75 is always green), per Luca 2026-07-16:
 * ≤60 red, 61–74 amber, ≥75 green. Presentation-only: the number stays
 * rendered and sr-only text is untouched (never color-only).
 */
export type ScoreGrade = 'low' | 'mid' | 'high';

export function scoreGrade(score: number): ScoreGrade {
	const shown = Math.round(score);
	// Domain is IGDB's 0–100 scale (zod passes the wire values through
	// unclamped). A non-finite value must not fall through to the best grade.
	if (!Number.isFinite(shown)) return 'low';
	if (shown <= 60) return 'low';
	if (shown <= 74) return 'mid';
	return 'high';
}
