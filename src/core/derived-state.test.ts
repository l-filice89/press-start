import { describe, expect, it } from 'vitest';
import { computeDerivedStates } from './derived-state';

const REFERENCE_DATE = new Date('2026-07-06T12:00:00Z');

describe('computeDerivedStates (AD-8)', () => {
	it('marks a game released when the release date is today', () => {
		const { released } = computeDerivedStates(
			{ owned: true, releaseDate: '2026-07-06', inPsPlusExtraCatalog: false },
			REFERENCE_DATE,
		);
		expect(released).toBe(true);
	});

	it('marks a game not released when the release date is in the future', () => {
		const { released } = computeDerivedStates(
			{ owned: true, releaseDate: '2026-07-07', inPsPlusExtraCatalog: false },
			REFERENCE_DATE,
		);
		expect(released).toBe(false);
	});

	it('treats a TBA/missing release date as not released', () => {
		const { released } = computeDerivedStates(
			{ owned: true, releaseDate: null, inPsPlusExtraCatalog: false },
			REFERENCE_DATE,
		);
		expect(released).toBe(false);
	});

	it('is wishlisted when not owned', () => {
		const { wishlisted } = computeDerivedStates(
			{ owned: false, releaseDate: null, inPsPlusExtraCatalog: false },
			REFERENCE_DATE,
		);
		expect(wishlisted).toBe(true);
	});

	it('is playable now via ownership', () => {
		const { playableNow } = computeDerivedStates(
			{ owned: true, releaseDate: '2026-07-06', inPsPlusExtraCatalog: false },
			REFERENCE_DATE,
		);
		expect(playableNow).toBe(true);
	});

	it('is playable now via PS+ Extra catalog membership alone', () => {
		const { playableNow } = computeDerivedStates(
			{ owned: false, releaseDate: '2026-07-06', inPsPlusExtraCatalog: true },
			REFERENCE_DATE,
		);
		expect(playableNow).toBe(true);
	});

	it('is not playable when unreleased, even if owned', () => {
		const { playableNow } = computeDerivedStates(
			{ owned: true, releaseDate: '2026-07-07', inPsPlusExtraCatalog: false },
			REFERENCE_DATE,
		);
		expect(playableNow).toBe(false);
	});

	it('is not playable when neither owned nor in the PS+ Extra catalog, even if released', () => {
		const { playableNow } = computeDerivedStates(
			{ owned: false, releaseDate: '2026-07-06', inPsPlusExtraCatalog: false },
			REFERENCE_DATE,
		);
		expect(playableNow).toBe(false);
	});

	it('is not playable when in the PS+ Extra catalog but not yet released', () => {
		const { playableNow } = computeDerivedStates(
			{ owned: false, releaseDate: '2026-07-07', inPsPlusExtraCatalog: true },
			REFERENCE_DATE,
		);
		expect(playableNow).toBe(false);
	});

	it('treats an empty-string release date the same as missing (not released)', () => {
		const { released } = computeDerivedStates(
			{ owned: true, releaseDate: '', inPsPlusExtraCatalog: false },
			REFERENCE_DATE,
		);
		expect(released).toBe(false);
	});

	it('exercises the default referenceDate (today) without throwing', () => {
		expect(
			computeDerivedStates({
				owned: true,
				releaseDate: null,
				inPsPlusExtraCatalog: false,
			}),
		).toEqual({ released: false, wishlisted: false, playableNow: false });
	});
});
