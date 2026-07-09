import { wouldViolateCompletionInvariant } from './completion-invariant';
import type { PlayStatus } from './types';

/**
 * The five manually-editable lifecycle dates (FR-45). A runtime tuple so the
 * dates route's Zod body keys off this single source (AD-3).
 */
export const LIFECYCLE_DATE_FIELDS = [
	'wishlistedOn',
	'boughtOn',
	'startedOn',
	'completedOn',
	'platinumOn',
] as const;

export type LifecycleDateField = (typeof LIFECYCLE_DATE_FIELDS)[number];

/** A partial per-field edit: a `YYYY-MM-DD` string sets, `null` clears. */
export type DateEdits = Partial<Record<LifecycleDateField, string | null>>;

export interface DateEditsInput {
	edits: DateEdits;
	current: {
		playStatus: PlayStatus | null;
		completedOn: string | null;
		platinumOn: string | null;
	};
}

/** Strict calendar validity, no `Date` (core/ is clock-free, AD-3). */
function isValidIsoDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12 || day < 1) return false;
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [
		31,
		leap ? 29 : 28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31,
	][month - 1];
	return day <= daysInMonth;
}

/**
 * FR-45/AR-13: the single write-side function for manual date corrections — a
 * deliberate override that may set or clear ANY of the five dates and never
 * touches `play_status` (no milestone-logging reconciliation runs here).
 * Validates every provided field as strict `YYYY-MM-DD` or null (`'invalid'` →
 * 400), then judges the invariant on the MERGED result (edits over current),
 * so a multi-field body clearing one milestone while setting the other is
 * legal — but an edit leaving a status-less game with no milestone is refused
 * (`'invariant'` → the same 409 as 2.3's clear, FR-3/AR-12).
 */
export function applyDateEdits({
	edits,
	current,
}: DateEditsInput): DateEdits | 'invalid' | 'invariant' {
	const patch: DateEdits = {};
	for (const field of LIFECYCLE_DATE_FIELDS) {
		const value = edits[field];
		if (value === undefined) continue;
		if (value !== null && !isValidIsoDate(value)) return 'invalid';
		patch[field] = value;
	}

	const merged = { ...current, ...patch };
	if (
		wouldViolateCompletionInvariant({
			playStatus: current.playStatus,
			completedOn: merged.completedOn,
			platinumOn: merged.platinumOn,
		})
	) {
		return 'invariant';
	}

	return patch;
}
