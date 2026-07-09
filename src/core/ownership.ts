import type { OwnershipType } from './types';

/** The fields an ownership change reads and may write. */
export interface OwnershipChangeInput {
	/** The requested change — at least one key (the route enforces that). */
	next: { owned?: boolean; ownershipType?: OwnershipType };
	current: {
		owned: boolean;
		ownershipType: OwnershipType | null;
		boughtOn: string | null;
	};
	/** Today as an ISO `YYYY-MM-DD` string — injected, since `core/` is I/O-free (AD-3). */
	today: string;
}

/** The fields an ownership change writes. An omitted key means "don't touch it". */
export interface OwnershipChangePatch {
	owned?: boolean;
	ownershipType?: OwnershipType | null;
	boughtOn?: string;
}

/**
 * AR-13/FR-44: the single write-side function for the ownership flag and type.
 * Owning stamps `bought_on` ONLY when it is null — write-once, re-owning never
 * overwrites it — and defaults the type to `physical` only when neither the
 * request nor the row carries one. Un-owning flips the flag and clears the
 * type but never touches any date. A bare type switch (no `owned` key) — or a
 * type sent alongside un-owning — belongs to an owned game only: `'invalid'`
 * (the route answers 400).
 */
export function applyOwnershipChange({
	next,
	current,
	today,
}: OwnershipChangeInput): OwnershipChangePatch | 'invalid' {
	if (next.owned === false) {
		// A type on an un-own contradicts "type belongs to an owned game".
		if (next.ownershipType !== undefined) return 'invalid';
		return { owned: false, ownershipType: null };
	}

	if (next.owned === true) {
		const patch: OwnershipChangePatch = { owned: true };
		if (next.ownershipType) {
			patch.ownershipType = next.ownershipType;
		} else if (!current.ownershipType) {
			patch.ownershipType = 'physical';
		}
		// Write-once (FR-44): stamped only while null — an earlier purchase date
		// survives every un-own/re-own cycle.
		if (current.boughtOn == null) patch.boughtOn = today;
		return patch;
	}

	// No `owned` key: a bare type switch, legal only on an owned game.
	if (!current.owned) return 'invalid';
	return { ownershipType: next.ownershipType };
}
