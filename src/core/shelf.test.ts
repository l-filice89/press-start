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
		for (const state of [
			'Playing',
			'Paused',
			'Up next',
			'Not started',
		] as EffectiveState[]) {
			expect(isDefaultShelfVisible(state)).toBe(true);
		}
	});

	// HAZARD (Story 3.2): `SHELF_STATE_ORDER` now ranks the hidden states for
	// reveal ordering — visibility must NOT widen because ordering did.
	it('hides completion milestones and Dropped even though they rank in SHELF_STATE_ORDER', () => {
		for (const state of [
			'Story completed',
			'Platinum achieved',
			'Dropped',
		] as EffectiveState[]) {
			expect(SHELF_STATE_ORDER).toContain(state);
			expect(isDefaultShelfVisible(state)).toBe(false);
		}
	});
});

describe('orderShelf', () => {
	function entry(effectiveState: EffectiveState, title: string, owned = false) {
		return { effectiveState, owned, title };
	}

	it('orders Playing→Paused→Up next→Not started regardless of ownership', () => {
		const ordered = orderShelf([
			entry('Not started', 'a', true),
			entry('Up next', 'b', false),
			entry('Playing', 'c', false),
			entry('Paused', 'd', true),
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

	it('sorts owned before un-owned within a state group (ownership beats title)', () => {
		const ordered = orderShelf([
			entry('Playing', 'Apex', false),
			entry('Playing', 'Zelda', true),
		]);
		expect(ordered.map((e) => e.title)).toEqual(['Zelda', 'Apex']);
	});

	it('applies the ownership tier in every state group, not just the top one', () => {
		const ordered = orderShelf([
			entry('Not started', 'Apex', false),
			entry('Not started', 'Zelda', true),
		]);
		expect(ordered.map((e) => e.title)).toEqual(['Zelda', 'Apex']);
	});

	it('state priority still beats ownership', () => {
		const ordered = orderShelf([
			entry('Paused', 'a', true),
			entry('Playing', 'b', false),
		]);
		expect(ordered.map((e) => e.title)).toEqual(['b', 'a']);
	});

	it('ranks hidden states after every live state: milestones, then Dropped (Story 3.2)', () => {
		const ordered = orderShelf([
			entry('Dropped', 'a', true),
			entry('Platinum achieved', 'b', true),
			entry('Story completed', 'c', true),
			entry('Not started', 'd', false),
			entry('Playing', 'e', false),
		]);
		expect(ordered.map((e) => e.effectiveState)).toEqual([
			'Playing',
			'Not started',
			'Story completed',
			'Platinum achieved',
			'Dropped',
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
	it('returns 0 for equal state + ownership + title', () => {
		for (const owned of [true, false]) {
			expect(
				compareShelf(
					{ effectiveState: 'Playing', owned, title: 'X' },
					{ effectiveState: 'Playing', owned, title: 'X' },
				),
			).toBe(0);
		}
	});

	it('is antisymmetric on the ownership tier', () => {
		const ownedGame = {
			effectiveState: 'Playing',
			owned: true,
			title: 'X',
		} as const;
		const wishlisted = {
			effectiveState: 'Playing',
			owned: false,
			title: 'X',
		} as const;
		expect(compareShelf(ownedGame, wishlisted)).toBe(
			-compareShelf(wishlisted, ownedGame),
		);
		expect(compareShelf(ownedGame, wishlisted)).toBeLessThan(0);
	});
});
