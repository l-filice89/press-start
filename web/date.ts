/**
 * Format a stored `YYYY-MM-DD` date for display in the viewer's locale
 * (Italian → "11 lug 2026", en-US → "Jul 11, 2026"), so an ISO date is never
 * misread month-first (e.g. 2026-07-11 read as 7 November). Parsed as a LOCAL
 * date via the numeric constructor — never `new Date(iso)`, which is UTC
 * midnight and can shift the day one back in negative-offset zones.
 */
export function formatDisplayDate(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso; // unexpected shape → pass through unformatted
	return new Date(y, m - 1, d).toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});
}
