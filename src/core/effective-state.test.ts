import { describe, expect, it } from 'vitest';
import { computeEffectiveState } from './effective-state';

describe('computeEffectiveState (AD-7)', () => {
	it('returns the play status when set', () => {
		expect(
			computeEffectiveState({
				playStatus: 'Playing',
				completedOn: null,
				platinumOn: null,
			}),
		).toBe('Playing');
	});

	it('prefers platinum over completed when both milestones are set', () => {
		expect(
			computeEffectiveState({
				playStatus: null,
				completedOn: '2025-01-01',
				platinumOn: '2026-01-01',
			}),
		).toBe('Platinum achieved');
	});

	it('returns story completed when only completedOn is set', () => {
		expect(
			computeEffectiveState({
				playStatus: null,
				completedOn: '2025-01-01',
				platinumOn: null,
			}),
		).toBe('Story completed');
	});

	it('falls back to Not started when no status and no milestone (invariant-violating input)', () => {
		expect(
			computeEffectiveState({
				playStatus: null,
				completedOn: null,
				platinumOn: null,
			}),
		).toBe('Not started');
	});

	it('prefers the play status over a simultaneously-set milestone', () => {
		expect(
			computeEffectiveState({
				playStatus: 'Playing',
				completedOn: null,
				platinumOn: '2026-01-01',
			}),
		).toBe('Playing');
	});
});
