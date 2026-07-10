import { describe, expect, it } from 'vitest';
import { isValidTimeZone, todayInZone } from './today';

// 02:30 UTC on the 10th — still the evening of the 9th in New York. The
// named hazard: a UTC stamp would permanently record tomorrow's date on a
// write-once field for an evening change west of Greenwich.
const NOW = new Date('2026-07-10T02:30:00Z');

describe('todayInZone (timezone stamping policy, Epic 2 retro)', () => {
	it('records the user-local calendar day, not the UTC day', () => {
		expect(todayInZone('America/New_York', NOW)).toBe('2026-07-09');
		expect(todayInZone('Pacific/Auckland', NOW)).toBe('2026-07-10');
	});

	it('falls back to the UTC day when no zone is captured', () => {
		expect(todayInZone(null, NOW)).toBe('2026-07-10');
		expect(todayInZone(undefined, NOW)).toBe('2026-07-10');
	});

	it('falls back to the UTC day on an unresolvable zone', () => {
		expect(todayInZone('Not/AZone', NOW)).toBe('2026-07-10');
	});
});

describe('isValidTimeZone', () => {
	it('accepts IANA zones and rejects junk', () => {
		expect(isValidTimeZone('Europe/Rome')).toBe(true);
		expect(isValidTimeZone('Not/AZone')).toBe(false);
		expect(isValidTimeZone('')).toBe(false);
	});
});
