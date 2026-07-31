import { describe, expect, it } from 'vitest';
import { formatReleaseDate } from './leaving';

describe('formatReleaseDate', () => {
	it('appends the year for a non-current year', () => {
		expect(formatReleaseDate('2999-01-05')).toBe('5 JAN 2999');
	});

	it('drops the year for the current (UTC) year', () => {
		const year = new Date().toISOString().slice(0, 4);
		expect(formatReleaseDate(`${year}-12-31`)).toBe('31 DEC');
	});

	it('falls back to the raw ISO date on an unparseable month/day', () => {
		expect(formatReleaseDate('2027-13-11')).toBe('2027-13-11');
		expect(formatReleaseDate('2027-03-99')).toBe('2027-03-99');
	});
});
