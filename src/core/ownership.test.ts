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
		).toEqual({
			owned: true,
			ownedVia: 'purchase',
			ownershipType: 'physical',
			boughtOn: TODAY,
		});
	});

	// FR-9 amended (2026-07-11): a PS+ claim is owned but NOT bought — no
	// bought_on stamp, and the source flag is what a future subscription-
	// cancel flow keys un-owning on (hazard: claims-only, never purchases).
	it('owning via membership flags the source and NEVER stamps bought_on', () => {
		expect(
			applyOwnershipChange({
				next: { owned: true, ownershipType: 'digital' },
				current: NOT_OWNED,
				today: TODAY,
				via: 'membership',
			}),
		).toEqual({
			owned: true,
			ownedVia: 'membership',
			ownershipType: 'digital',
		});
	});

	// The downgrade hazard (2026-07-23, claimed-via-PS+ correction): flipping a
	// recorded purchase back to a claim must leave the stamped date alone —
	// write-once stands in BOTH directions, and a membership write never emits
	// a bought_on key at all.
	it('correcting a purchase to a claim flips the source, bought_on untouched', () => {
		const patch = applyOwnershipChange({
			next: { owned: true },
			current: {
				owned: true,
				ownershipType: 'digital',
				boughtOn: '2023-12-25',
			},
			today: TODAY,
			via: 'membership',
		});
		expect(patch).toEqual({ owned: true, ownedVia: 'membership' });
		expect(patch).not.toHaveProperty('boughtOn');
	});

	it('a later purchase upgrades a claim: source flips, bought_on stamps once', () => {
		expect(
			applyOwnershipChange({
				next: { owned: true },
				current: { owned: true, ownershipType: 'digital', boughtOn: null },
				today: TODAY,
				via: 'purchase',
			}),
		).toEqual({ owned: true, ownedVia: 'purchase', boughtOn: TODAY });
	});

	// The named hazard: an earlier purchase date survives re-owning.
	it('never overwrites bought_on when re-owning after an un-own', () => {
		const patch = applyOwnershipChange({
			next: { owned: true },
			current: { owned: false, ownershipType: null, boughtOn: '2024-01-01' },
			today: TODAY,
		});
		expect(patch).toEqual({
			owned: true,
			ownedVia: 'purchase',
			ownershipType: 'physical',
		});
		expect(patch).not.toHaveProperty('boughtOn');
	});

	it('preserves an already-set type when owning — no reset to physical', () => {
		expect(
			applyOwnershipChange({
				next: { owned: true },
				current: { owned: false, ownershipType: 'digital', boughtOn: null },
				today: TODAY,
			}),
		).toEqual({ owned: true, ownedVia: 'purchase', boughtOn: TODAY });
	});

	it('uses the requested type when owning with one', () => {
		expect(
			applyOwnershipChange({
				next: { owned: true, ownershipType: 'digital' },
				current: NOT_OWNED,
				today: TODAY,
			}),
		).toEqual({
			owned: true,
			ownedVia: 'purchase',
			ownershipType: 'digital',
			boughtOn: TODAY,
		});
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
		expect(patch).toEqual({
			owned: false,
			ownershipType: null,
			ownedVia: null,
		});
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
