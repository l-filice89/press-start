export interface DerivedStateInput {
	owned: boolean;
	releaseDate: string | null;
	inPsPlusExtraCatalog: boolean;
}

export interface DerivedState {
	released: boolean;
	wishlisted: boolean;
	playableNow: boolean;
}

function toIsoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/**
 * AD-8: the single implementation of the three derived, never-persisted
 * flags. `releaseDate` is an ISO `YYYY-MM-DD` string or `null` (TBA/missing).
 * Comparison against the reference date is lexicographic on ISO strings
 * rather than `Date` arithmetic, to stay timezone/DST-safe and pure.
 */
export function computeDerivedStates(
	{ owned, releaseDate, inPsPlusExtraCatalog }: DerivedStateInput,
	referenceDate: Date = new Date(),
): DerivedState {
	const referenceIso = toIsoDate(referenceDate);
	// Truthy check (not `!== null`) so an empty string is treated the same as
	// a missing date, consistent with the other core/ functions' convention.
	const released = !!releaseDate && releaseDate <= referenceIso;
	const wishlisted = !owned;
	const playableNow = (owned || inPsPlusExtraCatalog) && released;

	return { released, wishlisted, playableNow };
}
