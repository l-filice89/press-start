import { describe, expect, it } from 'vitest';
import {
	mapNotionStatus,
	notionRowToTracking,
	parseNotionDate,
} from './notion-status';

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

describe('notionRowToTracking (Story 6.2, FR-28 payload carry)', () => {
	it('carries a live status + owned + started date', () => {
		expect(
			notionRowToTracking({
				Status: 'Playing',
				Owned: 'Yes',
				'Date started': 'March 3, 2021',
			}),
		).toEqual({
			owned: true,
			ownershipType: 'physical',
			playStatus: 'Playing',
			completedOn: null,
			startedOn: '2021-03-03',
		});
	});

	it('not owned → no ownership type', () => {
		expect(
			notionRowToTracking({ Status: 'Paused', Owned: 'no' }),
		).toMatchObject({
			owned: false,
			ownershipType: null,
			playStatus: 'Paused',
		});
	});

	it('unknown status degrades to Not started on the backlog', () => {
		expect(
			notionRowToTracking({ Status: 'Wishlist', Owned: 'Yes' }),
		).toMatchObject({ playStatus: 'Not started', completedOn: null });
	});

	it('Completed with no finish date → Not started, never a dateless completion (invariant safe)', () => {
		expect(notionRowToTracking({ Status: 'Completed', Owned: 'Yes' })).toEqual({
			owned: true,
			ownershipType: 'physical',
			playStatus: 'Not started',
			completedOn: null,
			startedOn: null,
		});
	});

	it('Completed with a finish date → completedOn set, play status null (milestone)', () => {
		expect(
			notionRowToTracking({
				Status: 'Completed',
				Owned: 'Yes',
				'Date finished': 'January 2, 2022',
			}),
		).toMatchObject({ playStatus: null, completedOn: '2022-01-02' });
	});
});
