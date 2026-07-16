/**
 * Time-to-beat display rounding (Story 10.3, VR-8): IGDB stores SECONDS; the
 * UI speaks hours. Rounded to the nearest hour — an under-an-hour figure says
 * so rather than fabricating "0h" (a zero would read as "no time at all").
 */
export function formatTtbHours(seconds: number): string {
	if (seconds < 3600) return '<1h';
	return `${Math.round(seconds / 3600)}h`;
}
