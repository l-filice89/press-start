import { describe, expect, it } from 'vitest';
import { applyPlayStatusChange } from './status-transition';
import { PLAY_STATUSES } from './types';

/**
 * The named hazard of Story 2.1: `started_on` is stamped once, write-once, and
 * only while no completion milestone exists (FR-44/45, AD-11). Asserted here
 * directly rather than inferred from a passing suite.
 */

const TODAY = '2026-07-09';
const CLEAN = { startedOn: null, completedOn: null, platinumOn: null };

describe('applyPlayStatusChange', () => {
	it('stamps started_on on the first transition to Playing', () => {
		expect(
			applyPlayStatusChange({ next: 'Playing', current: CLEAN, today: TODAY }),
		).toEqual({ playStatus: 'Playing', startedOn: TODAY });
	});

	it('never overwrites an already-recorded started_on', () => {
		const patch = applyPlayStatusChange({
			next: 'Playing',
			current: { ...CLEAN, startedOn: '2024-01-01' },
			today: TODAY,
		});
		expect(patch).toEqual({ playStatus: 'Playing' });
		expect(patch.startedOn).toBeUndefined();
	});

	it('does not stamp started_on on a replay after story completion', () => {
		expect(
			applyPlayStatusChange({
				next: 'Playing',
				current: { ...CLEAN, completedOn: '2023-05-05' },
				today: TODAY,
			}),
		).toEqual({ playStatus: 'Playing' });
	});

	it('does not stamp started_on on a replay after platinum', () => {
		expect(
			applyPlayStatusChange({
				next: 'Playing',
				current: { ...CLEAN, platinumOn: '2023-05-05' },
				today: TODAY,
			}),
		).toEqual({ playStatus: 'Playing' });
	});

	it.each(
		PLAY_STATUSES.filter((s) => s !== 'Playing'),
	)('leaves started_on untouched when the next status is %s', (next) => {
		expect(
			applyPlayStatusChange({ next, current: CLEAN, today: TODAY }),
		).toEqual({ playStatus: next });
	});
});
