import { describe, expect, it } from 'vitest';
import { applyDateEdits } from './date-edit';

/**
 * The second named hazard of Story 2.4: a date edit that would clear the last
 * milestone of a status-less game is refused with the `'invariant'` signal
 * (FR-3/AR-12) — asserted here directly rather than inferred from a suite.
 */

const CLEAN = {
	playStatus: 'Playing' as const,
	completedOn: null,
	platinumOn: null,
};

describe('applyDateEdits', () => {
	it('corrects a date verbatim', () => {
		expect(
			applyDateEdits({ edits: { startedOn: '2024-03-01' }, current: CLEAN }),
		).toEqual({ startedOn: '2024-03-01' });
	});

	it('clears a non-milestone date', () => {
		expect(
			applyDateEdits({ edits: { boughtOn: null }, current: CLEAN }),
		).toEqual({ boughtOn: null });
	});

	// The named hazard: the last milestone of a status-less game may not go.
	it('refuses to clear the last milestone of a status-less game', () => {
		expect(
			applyDateEdits({
				edits: { completedOn: null },
				current: {
					playStatus: null,
					completedOn: '2024-06-01',
					platinumOn: null,
				},
			}),
		).toBe('invariant');
	});

	it('clears one of two milestones while the other stands', () => {
		expect(
			applyDateEdits({
				edits: { platinumOn: null },
				current: {
					playStatus: null,
					completedOn: '2024-06-01',
					platinumOn: '2024-07-01',
				},
			}),
		).toEqual({ platinumOn: null });
	});

	it('judges a multi-field body as a whole: clear one milestone, set the other', () => {
		expect(
			applyDateEdits({
				edits: { completedOn: null, platinumOn: '2024-07-01' },
				current: {
					playStatus: null,
					completedOn: '2024-06-01',
					platinumOn: null,
				},
			}),
		).toEqual({ completedOn: null, platinumOn: '2024-07-01' });
	});

	it('refuses clearing both milestones of a status-less game in one body', () => {
		expect(
			applyDateEdits({
				edits: { completedOn: null, platinumOn: null },
				current: {
					playStatus: null,
					completedOn: '2024-06-01',
					platinumOn: '2024-07-01',
				},
			}),
		).toBe('invariant');
	});

	it('allows clearing the last milestone when a play status stands', () => {
		expect(
			applyDateEdits({
				edits: { completedOn: null },
				current: {
					playStatus: 'Playing',
					completedOn: '2024-06-01',
					platinumOn: null,
				},
			}),
		).toEqual({ completedOn: null });
	});

	it('sets a milestone date manually without touching play_status', () => {
		const patch = applyDateEdits({
			edits: { completedOn: '2024-06-01' },
			current: CLEAN,
		});
		expect(patch).toEqual({ completedOn: '2024-06-01' });
		expect(patch).not.toHaveProperty('playStatus');
	});

	it.each([
		'junk',
		'2024-13-99',
		'2024-00-10',
		'2024-02-30',
		'2023-02-29',
		'24-01-01',
	])('rejects the malformed or impossible date %s', (value) => {
		expect(
			applyDateEdits({ edits: { startedOn: value }, current: CLEAN }),
		).toBe('invalid');
	});

	it('accepts a leap-day date in a leap year', () => {
		expect(
			applyDateEdits({ edits: { startedOn: '2024-02-29' }, current: CLEAN }),
		).toEqual({ startedOn: '2024-02-29' });
	});

	it('ignores undefined fields rather than writing them', () => {
		expect(
			applyDateEdits({
				edits: { startedOn: '2024-01-01', boughtOn: undefined },
				current: CLEAN,
			}),
		).toEqual({ startedOn: '2024-01-01' });
	});
});
