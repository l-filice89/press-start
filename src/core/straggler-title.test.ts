import { describe, expect, it } from 'vitest';
import { isRecordableStragglerTitle } from './straggler-title';

/**
 * HAZARD-TEST: the garbage-title filter is a named invariant — a blank or
 * URL-only source title must never become a straggler (it can't be resolved to
 * a game), while a normal title must. Guards the importer's `recordStraggler`
 * skip.
 */
describe('isRecordableStragglerTitle (hazard: garbage-title filter)', () => {
	it('rejects a blank title', () => {
		expect(isRecordableStragglerTitle('')).toBe(false);
	});

	it('rejects a whitespace-only title', () => {
		expect(isRecordableStragglerTitle('   \t ')).toBe(false);
	});

	it('rejects a bare http/https URL', () => {
		expect(isRecordableStragglerTitle('http://ign.com/x')).toBe(false);
		expect(isRecordableStragglerTitle('https://ign.com/reviews/y')).toBe(false);
	});

	it('accepts a normal title', () => {
		expect(isRecordableStragglerTitle('Celeste')).toBe(true);
	});
});
