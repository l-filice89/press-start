/**
 * Leaving-date display rules (Story 10.4 + follow-on) — ONE home for every
 * surface that renders `psPlusLeavingOn` (shelf card, detail panel, catalog
 * card, filter predicate), so the gates can never drift apart.
 */

const LEAVING_MONTHS = [
	'JAN',
	'FEB',
	'MAR',
	'APR',
	'MAY',
	'JUN',
	'JUL',
	'AUG',
	'SEP',
	'OCT',
	'NOV',
	'DEC',
];

/**
 * "2026-07-21" → "21 JUL" — a glanceable pill date; sr-only text keeps the
 * full ISO one. Pure string slicing: the value is the store's own UTC date
 * and must not shift a day through a local-zone Date.
 */
export function formatLeavingDate(iso: string): string {
	const month = LEAVING_MONTHS[Number(iso.slice(5, 7)) - 1];
	const day = Number(iso.slice(8, 10));
	// An unparseable month/day falls back to the raw ISO date — wrong-looking
	// beats "LEAVING undefined" or "LEAVING NaN JUL".
	if (!month || !(day >= 1 && day <= 31)) return iso;
	return `${day} ${month}`;
}

/**
 * Whether a leaving warning renders: a date exists, the game is un-owned
 * (FR-38 — ownership makes catalog membership irrelevant), and the date is
 * not past (a game departing inside the cron's blind window keeps its stale
 * date until the next flag pass clears it — weeks of a wrong amber warning
 * otherwise). Lexicographic compare is exact on ISO dates.
 *
 * "Today" is the UTC date — deliberately: the stored value is the store's own
 * UTC departure instant, so the comparison stays in one zone. Consequence for
 * a user west of UTC: the warning drops a few hours before local midnight of
 * the last day — early, never late, and the game is gone that day anyway.
 */
export function showLeaving(
	leavingOn: string | null,
	owned: boolean,
): leavingOn is string {
	return (
		!!leavingOn && !owned && leavingOn >= new Date().toISOString().slice(0, 10)
	);
}
