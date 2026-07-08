import { describe, expect, it } from 'vitest';
import { computeEffectiveState } from './effective-state';
import {
	compareShelf,
	isDefaultShelfVisible,
	orderShelf,
	SHELF_STATE_ORDER,
} from './shelf';
import type { EffectiveState } from './types';

describe('isDefaultShelfVisible', () => {
	it('shows the four live play statuses', () => {
		for (const state of SHELF_STATE_ORDER) {
			expect(isDefaultShelfVisible(state)).toBe(true);
		}
	});

	it('hides completion milestones and Dropped (backlog view)', () => {
		for (const state of [
			'Story completed',
			'Platinum achieved',
			'Dropped',
		] as EffectiveState[]) {
			expect(isDefaultShelfVisible(state)).toBe(false);
		}
	});
});

describe('orderShelf', () => {
	function entry(effectiveState: EffectiveState, title: string) {
		return { effectiveState, title };
	}

	it('orders Playing→Paused→Up next→Not started', () => {
		const ordered = orderShelf([
			entry('Not started', 'a'),
			entry('Up next', 'b'),
			entry('Playing', 'c'),
			entry('Paused', 'd'),
		]);
		expect(ordered.map((e) => e.effectiveState)).toEqual([
			'Playing',
			'Paused',
			'Up next',
			'Not started',
		]);
	});

	it('sorts alphabetically within a state group, case-insensitive', () => {
		const ordered = orderShelf([
			entry('Playing', 'Zelda'),
			entry('Playing', 'apex'),
			entry('Playing', 'Bloodborne'),
		]);
		expect(ordered.map((e) => e.title)).toEqual([
			'apex',
			'Bloodborne',
			'Zelda',
		]);
	});

	it('does not mutate the input array', () => {
		const input = [entry('Not started', 'b'), entry('Playing', 'a')];
		const snapshot = [...input];
		orderShelf(input);
		expect(input).toEqual(snapshot);
	});

	it('derives order from the effective-state function (milestone vs live)', () => {
		// A game with a completion milestone but a live play_status is ordered by
		// its live effective state, not the milestone.
		const playingWithMilestone: EffectiveState = computeEffectiveState({
			playStatus: 'Playing',
			completedOn: '2024-01-01',
			platinumOn: null,
		});
		expect(playingWithMilestone).toBe('Playing');
		expect(isDefaultShelfVisible(playingWithMilestone)).toBe(true);

		const completedOnly: EffectiveState = computeEffectiveState({
			playStatus: null,
			completedOn: '2024-01-01',
			platinumOn: null,
		});
		expect(completedOnly).toBe('Story completed');
		expect(isDefaultShelfVisible(completedOnly)).toBe(false);
	});
});

describe('compareShelf', () => {
	it('returns 0 for equal state + title', () => {
		expect(
			compareShelf(
				{ effectiveState: 'Playing', title: 'X' },
				{ effectiveState: 'Playing', title: 'X' },
			),
		).toBe(0);
	});
});
