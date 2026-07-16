import { describe, expect, it } from 'vitest';
import { scoreGrade } from './score-grade';

// Bucket edges are the named hazard (Story 10.5): ≤60 red, 61–74 amber,
// ≥75 green, applied to the ROUNDED value the user sees.
describe('scoreGrade', () => {
	it('pins the exact bucket boundaries', () => {
		expect(scoreGrade(60)).toBe('low');
		expect(scoreGrade(61)).toBe('mid');
		expect(scoreGrade(74)).toBe('mid');
		expect(scoreGrade(75)).toBe('high');
	});

	it('grades the rounded value the user sees, not the raw float', () => {
		expect(scoreGrade(74.6)).toBe('high'); // displays as 75
		expect(scoreGrade(60.4)).toBe('low'); // displays as 60
		expect(scoreGrade(60.5)).toBe('mid'); // displays as 61
	});

	it('treats 0 as a real (red) score', () => {
		expect(scoreGrade(0)).toBe('low');
	});

	it('never grades a non-finite value green', () => {
		expect(scoreGrade(Number.NaN)).toBe('low');
		expect(scoreGrade(Number.POSITIVE_INFINITY)).toBe('low');
	});
});
