import { describe, expect, it } from 'vitest';
import { applyMilestone } from './milestone';
import { MILESTONES } from './types';

/**
 * The named hazards of Story 2.2, asserted directly: a milestone date is
 * write-once (`null` no-op — the first achievement stands, FR-6) and every
 * non-null patch clears `play_status` via this one function (FR-2/FR-5, AR-21).
 */

const TODAY = '2026-07-09';
const CLEAN = { completedOn: null, platinumOn: null };

describe('applyMilestone', () => {
	it('stamps completed_on on the first story completion and clears play status', () => {
		expect(
			applyMilestone({ milestone: 'completed', current: CLEAN, today: TODAY }),
		).toEqual({ completedOn: TODAY, playStatus: null });
	});

	it('stamps platinum_on on the first platinum and clears play status', () => {
		expect(
			applyMilestone({ milestone: 'platinum', current: CLEAN, today: TODAY }),
		).toEqual({ platinumOn: TODAY, playStatus: null });
	});

	it.each(
		MILESTONES,
	)('returns null when %s is already dated — the first achievement stands', (milestone) => {
		expect(
			applyMilestone({
				milestone,
				current: {
					completedOn: milestone === 'completed' ? '2023-05-05' : null,
					platinumOn: milestone === 'platinum' ? '2023-05-05' : null,
				},
				today: TODAY,
			}),
		).toBeNull();
	});

	it('logs platinum after story completion without touching completed_on', () => {
		const patch = applyMilestone({
			milestone: 'platinum',
			current: { completedOn: '2023-05-05', platinumOn: null },
			today: TODAY,
		});
		expect(patch).toEqual({ platinumOn: TODAY, playStatus: null });
		// `completedOn` absent means "don't touch it" — the upsert drops undefined.
		expect(patch && 'completedOn' in patch).toBe(false);
	});

	it.each(
		MILESTONES,
	)('clears play status in every non-null patch (%s)', (milestone) => {
		expect(
			applyMilestone({ milestone, current: CLEAN, today: TODAY }),
		).toMatchObject({ playStatus: null });
	});

	it.each(MILESTONES)('never puts startedOn in the patch (%s)', (milestone) => {
		const patch = applyMilestone({ milestone, current: CLEAN, today: TODAY });
		expect(patch && 'startedOn' in patch).toBe(false);
	});
});
