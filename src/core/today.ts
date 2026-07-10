/**
 * "Today" for date stamping (Epic 2 retro timezone policy): the user's IANA
 * zone — captured from the browser into `SETTING` at first login — decides
 * which calendar day a write-once date records. Pure given `now` (AD-3: the
 * caller resolves the clock); an unset or unresolvable zone falls back to UTC
 * (the pre-policy behavior).
 */
export function todayInZone(
	timeZone: string | null | undefined,
	now: Date,
): string {
	if (timeZone) {
		try {
			// `en-CA` formats as YYYY-MM-DD — the core date contract (AD-8).
			return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
		} catch {
			// Unknown zone (stale/corrupt setting) → UTC fallback below.
		}
	}
	return now.toISOString().slice(0, 10);
}

/** True when `timeZone` is an IANA zone Intl can resolve. */
export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-CA', { timeZone });
		return true;
	} catch {
		return false;
	}
}
