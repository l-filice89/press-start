import { describe, expect, it } from 'vitest';
import { mapNotionStatus, parseNotionDate } from './notion-status';

describe('mapNotionStatus (FR-30)', () => {
	it('maps Completed to a milestone (null play status, completed)', () => {
		expect(mapNotionStatus('Completed')).toEqual({
			known: true,
			playStatus: null,
			completed: true,
		});
	});

	it('maps "Up next!" to Up next', () => {
		expect(mapNotionStatus('Up next!')).toEqual({
			known: true,
			playStatus: 'Up next',
			completed: false,
		});
	});

	it('maps Not released to the default Not started', () => {
		expect(mapNotionStatus('Not released')).toEqual({
			known: true,
			playStatus: 'Not started',
			completed: false,
		});
	});

	it('maps Not started / Playing / Paused 1:1', () => {
		expect(
			mapNotionStatus('Not started').known && mapNotionStatus('Not started'),
		).toMatchObject({ playStatus: 'Not started', completed: false });
		expect(mapNotionStatus('Playing')).toMatchObject({ playStatus: 'Playing' });
		expect(mapNotionStatus('Paused')).toMatchObject({ playStatus: 'Paused' });
	});

	it('reports an unknown status rather than guessing', () => {
		expect(mapNotionStatus('Wishlisted')).toEqual({ known: false });
		expect(mapNotionStatus('')).toEqual({ known: false });
	});

	it('tolerates surrounding whitespace', () => {
		expect(mapNotionStatus('  Playing ')).toMatchObject({
			playStatus: 'Playing',
		});
	});
});

describe('parseNotionDate (FR-31/32, AD-8)', () => {
	it('parses "Month D, YYYY" to ISO YYYY-MM-DD, zero-padding the day', () => {
		expect(parseNotionDate('November 4, 2024')).toBe('2024-11-04');
		expect(parseNotionDate('September 25, 2024')).toBe('2024-09-25');
	});

	it('returns null for empty or unrecognized input (never fabricated)', () => {
		expect(parseNotionDate('')).toBeNull();
		expect(parseNotionDate('   ')).toBeNull();
		expect(parseNotionDate('sometime in 2024')).toBeNull();
		expect(parseNotionDate('Smarch 4, 2024')).toBeNull();
	});
});
