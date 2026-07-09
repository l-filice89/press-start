import { describe, expect, it } from 'vitest';
import { applyOwnershipChange } from './ownership';

/**
 * The first named hazard of Story 2.4: `bought_on` is stamped once, write-once
 * — re-owning never overwrites it (FR-44). Asserted here directly rather than
 * inferred from a passing suite.
 */

const TODAY = '2026-07-09';
const NOT_OWNED = { owned: false, ownershipType: null, boughtOn: null };

describe('applyOwnershipChange', () => {
	it('marks owned the first time: physical default + bought_on stamped today', () => {
		expect(
			applyOwnershipChange({
				next: { owned: true },
				current: NOT_OWNED,
				today: TODAY,
			}),
		).toEqual({ owned: true, ownershipType: 'physical', boughtOn: TODAY });
	});

	// The named hazard: an earlier purchase date survives re-owning.
	it('never overwrites bought_on when re-owning after an un-own', () => {
		const patch = applyOwnershipChange({
			next: { owned: true },
			current: { owned: false, ownershipType: null, boughtOn: '2024-01-01' },
			today: TODAY,
		});
		expect(patch).toEqual({ owned: true, ownershipType: 'physical' });
		expect(patch).not.toHaveProperty('boughtOn');
	});

	it('preserves an already-set type when owning — no reset to physical', () => {
		expect(
			applyOwnershipChange({
				next: { owned: true },
				current: { owned: false, ownershipType: 'digital', boughtOn: null },
				today: TODAY,
			}),
		).toEqual({ owned: true, boughtOn: TODAY });
	});

	it('uses the requested type when owning with one', () => {
		expect(
			applyOwnershipChange({
				next: { owned: true, ownershipType: 'digital' },
				current: NOT_OWNED,
				today: TODAY,
			}),
		).toEqual({ owned: true, ownershipType: 'digital', boughtOn: TODAY });
	});

	it('un-owning flips the flag, clears the type, and never touches any date', () => {
		const patch = applyOwnershipChange({
			next: { owned: false },
			current: {
				owned: true,
				ownershipType: 'digital',
				boughtOn: '2024-01-01',
			},
			today: TODAY,
		});
		expect(patch).toEqual({ owned: false, ownershipType: null });
		expect(patch).not.toHaveProperty('boughtOn');
	});

	it('a bare type switch on an owned game changes only the type', () => {
		expect(
			applyOwnershipChange({
				next: { ownershipType: 'digital' },
				current: {
					owned: true,
					ownershipType: 'physical',
					boughtOn: '2024-01-01',
				},
				today: TODAY,
			}),
		).toEqual({ ownershipType: 'digital' });
	});

	it('refuses a type without ownership — the type belongs to an owned game', () => {
		expect(
			applyOwnershipChange({
				next: { ownershipType: 'digital' },
				current: NOT_OWNED,
				today: TODAY,
			}),
		).toBe('invalid');
	});

	it('refuses a type sent alongside un-owning', () => {
		expect(
			applyOwnershipChange({
				next: { owned: false, ownershipType: 'digital' },
				current: { owned: true, ownershipType: 'physical', boughtOn: null },
				today: TODAY,
			}),
		).toBe('invalid');
	});
});
