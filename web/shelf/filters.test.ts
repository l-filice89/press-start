import { describe, expect, it } from 'vitest';
import type { ShelfGame } from './api';
import {
	applyShelfFilter,
	EMPTY_FILTER,
	isFilterActive,
	toggleSelection,
} from './filters';

/** Minimal ShelfGame — only the fields the filter predicate reads matter. */
function game(overrides: Partial<ShelfGame> & { id: string }): ShelfGame {
	return {
		title: overrides.id,
		coverUrl: null,
		storeUrl: null,
		playStatus: 'Playing',
		effectiveState: 'Playing',
		owned: true,
		released: true,
		wishlisted: false,
		psPlusExtra: false,
		hasCompleted: false,
		hasPlatinum: false,
		completedOn: null,
		platinumOn: null,
		startedOn: null,
		boughtOn: null,
		wishlistedOn: null,
		ownershipType: null,
		releaseDate: null,
		genres: [],
		...overrides,
	};
}

// A server-ordered payload: state priority → owned → alpha (FR-18).
const SHELF: ShelfGame[] = [
	game({ id: 'a', effectiveState: 'Playing', genres: ['RPG'] }),
	game({
		id: 'b',
		effectiveState: 'Playing',
		owned: false,
		genres: ['Racing'],
	}),
	game({ id: 'c', effectiveState: 'Paused', genres: ['RPG', 'Open world'] }),
	game({ id: 'd', effectiveState: 'Up next', genres: [] }),
	game({ id: 'e', effectiveState: 'Not started', genres: ['Racing'] }),
];

const ids = (games: ShelfGame[]) => games.map((g) => g.id);

describe('applyShelfFilter', () => {
	it('empty filter returns the payload unchanged (default visible set)', () => {
		expect(applyShelfFilter(SHELF, EMPTY_FILTER)).toEqual(SHELF);
	});

	it('state selection shows exactly the selected states (OR within group)', () => {
		const out = applyShelfFilter(SHELF, {
			states: ['Playing', 'Paused'],
			genres: [],
		});
		expect(ids(out)).toEqual(['a', 'b', 'c']);
	});

	it('genre selection ORs genres within the group', () => {
		const out = applyShelfFilter(SHELF, {
			states: [],
			genres: ['RPG', 'Racing'],
		});
		expect(ids(out)).toEqual(['a', 'b', 'c', 'e']);
	});

	it('ANDs across groups: state pick AND genre pick', () => {
		const out = applyShelfFilter(SHELF, {
			states: ['Playing'],
			genres: ['RPG'],
		});
		expect(ids(out)).toEqual(['a']);
	});

	it('returns empty on zero match, never throws', () => {
		const out = applyShelfFilter(SHELF, {
			states: ['Up next'],
			genres: ['RPG'],
		});
		expect(out).toEqual([]);
	});

	it('excludes games with no genres when a genre is selected', () => {
		const out = applyShelfFilter(SHELF, { states: [], genres: ['RPG'] });
		expect(ids(out)).not.toContain('d');
	});

	// HAZARD (FR-18 amendment): filtered views keep the server ordering. The
	// predicate must be a pure order-preserving subset — a re-sort or reorder
	// here would break state → owned → alpha on every filtered view.
	it('preserves payload order in every filtered view', () => {
		const out = applyShelfFilter(SHELF, {
			states: ['Playing', 'Not started', 'Paused'],
			genres: [],
		});
		expect(ids(out)).toEqual(['a', 'b', 'c', 'e']);
		// owned 'a' still precedes wishlisted 'b' — the payload's owned tier held.
		expect(ids(out).indexOf('a')).toBeLessThan(ids(out).indexOf('b'));
	});

	it('does not mutate the input array', () => {
		const input = [...SHELF];
		applyShelfFilter(input, { states: ['Paused'], genres: [] });
		expect(input).toEqual(SHELF);
	});
});

describe('isFilterActive', () => {
	it('false for the empty filter, true for any selection', () => {
		expect(isFilterActive(EMPTY_FILTER)).toBe(false);
		expect(isFilterActive({ states: ['Playing'], genres: [] })).toBe(true);
		expect(isFilterActive({ states: [], genres: ['RPG'] })).toBe(true);
	});
});

describe('toggleSelection', () => {
	it('adds a missing value and removes a present one', () => {
		expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b']);
		expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b']);
	});
});
