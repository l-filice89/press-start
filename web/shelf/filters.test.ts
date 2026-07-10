import { describe, expect, it } from 'vitest';
import type { ShelfGame } from './api';
import {
	applyShelfFilter,
	EMPTY_FILTER,
	isFilterActive,
	type ShelfFilter,
	summarizeFilter,
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
		playableNow: true,
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

const f = (partial: Partial<ShelfFilter>): ShelfFilter => ({
	...EMPTY_FILTER,
	...partial,
});

// A server-ordered include=hidden payload: live states first (state → owned →
// alpha per FR-18), hidden states ranked after.
const SHELF: ShelfGame[] = [
	game({ id: 'a', effectiveState: 'Playing', genres: ['RPG'] }),
	game({
		id: 'b',
		effectiveState: 'Playing',
		owned: false,
		wishlisted: true,
		playableNow: false,
		genres: ['Racing'],
	}),
	game({ id: 'c', effectiveState: 'Paused', genres: ['RPG', 'Open world'] }),
	// Owned but unreleased pre-order: released/playableNow false.
	game({
		id: 'd',
		effectiveState: 'Up next',
		released: false,
		playableNow: false,
		genres: [],
	}),
	game({ id: 'e', effectiveState: 'Not started', genres: ['Racing'] }),
	game({ id: 'f', effectiveState: 'Story completed', genres: ['RPG'] }),
	game({ id: 'g', effectiveState: 'Platinum achieved', genres: [] }),
	game({ id: 'h', effectiveState: 'Dropped', genres: ['Racing'] }),
];

const ids = (games: ShelfGame[]) => games.map((g) => g.id);

describe('applyShelfFilter', () => {
	// HAZARD (FR-17/21): the payload now carries hidden states — the empty
	// filter must yield the default visible set, never the whole library.
	it('empty filter yields the default visible set (live statuses only)', () => {
		expect(ids(applyShelfFilter(SHELF, EMPTY_FILTER))).toEqual([
			'a',
			'b',
			'c',
			'd',
			'e',
		]);
	});

	it('state selection shows exactly the selected states (OR within group)', () => {
		const out = applyShelfFilter(SHELF, f({ states: ['Playing', 'Paused'] }));
		expect(ids(out)).toEqual(['a', 'b', 'c']);
	});

	it('a reveal pill ORs its hidden state into the default set (FR-21)', () => {
		const out = applyShelfFilter(SHELF, f({ reveals: ['Dropped'] }));
		expect(ids(out)).toEqual(['a', 'b', 'c', 'd', 'e', 'h']);
	});

	it('a reveal pill extends an explicit state selection', () => {
		const out = applyShelfFilter(
			SHELF,
			f({ states: ['Playing'], reveals: ['Platinum achieved'] }),
		);
		expect(ids(out)).toEqual(['a', 'b', 'g']);
	});

	it('each active flag is its own AND group (FR-20)', () => {
		expect(ids(applyShelfFilter(SHELF, f({ flags: ['owned'] })))).toEqual([
			'a',
			'c',
			'd',
			'e',
		]);
		// playableNow narrows further: the owned-but-unreleased pre-order drops.
		expect(
			ids(applyShelfFilter(SHELF, f({ flags: ['owned', 'playableNow'] }))),
		).toEqual(['a', 'c', 'e']);
		expect(ids(applyShelfFilter(SHELF, f({ flags: ['released'] })))).toEqual([
			'a',
			'b',
			'c',
			'e',
		]);
		expect(ids(applyShelfFilter(SHELF, f({ flags: ['wishlisted'] })))).toEqual([
			'b',
		]);
	});

	it('flags AND against state and genre groups', () => {
		const out = applyShelfFilter(
			SHELF,
			f({ states: ['Playing'], genres: ['RPG'], flags: ['owned'] }),
		);
		expect(ids(out)).toEqual(['a']);
	});

	it('genre selection ORs genres within the group', () => {
		const out = applyShelfFilter(SHELF, f({ genres: ['RPG', 'Racing'] }));
		expect(ids(out)).toEqual(['a', 'b', 'c', 'e']);
	});

	it('genre filtering applies to revealed cards too', () => {
		const out = applyShelfFilter(
			SHELF,
			f({ genres: ['RPG'], reveals: ['Story completed'] }),
		);
		expect(ids(out)).toEqual(['a', 'c', 'f']);
	});

	it('returns empty on zero match, never throws', () => {
		expect(
			applyShelfFilter(SHELF, f({ states: ['Up next'], genres: ['RPG'] })),
		).toEqual([]);
	});

	it('excludes games with no genres when a genre is selected', () => {
		expect(ids(applyShelfFilter(SHELF, f({ genres: ['RPG'] })))).not.toContain(
			'd',
		);
	});

	// HAZARD (FR-18 amendment): filtered views keep the server ordering. The
	// predicate must be a pure order-preserving subset — a re-sort or reorder
	// here would break state → owned → alpha on every filtered/revealed view.
	it('preserves payload order in every filtered view, reveals included', () => {
		const out = applyShelfFilter(
			SHELF,
			f({ states: ['Playing', 'Not started', 'Paused'], reveals: ['Dropped'] }),
		);
		expect(ids(out)).toEqual(['a', 'b', 'c', 'e', 'h']);
		// owned 'a' still precedes wishlisted 'b' — the payload's owned tier held.
		expect(ids(out).indexOf('a')).toBeLessThan(ids(out).indexOf('b'));
	});

	it('does not mutate the input array', () => {
		const input = [...SHELF];
		applyShelfFilter(input, f({ states: ['Paused'] }));
		expect(input).toEqual(SHELF);
	});
});

describe('isFilterActive', () => {
	it('false for the empty filter, true for any selection', () => {
		expect(isFilterActive(EMPTY_FILTER)).toBe(false);
		expect(isFilterActive(f({ states: ['Playing'] }))).toBe(true);
		expect(isFilterActive(f({ genres: ['RPG'] }))).toBe(true);
		expect(isFilterActive(f({ reveals: ['Dropped'] }))).toBe(true);
		expect(isFilterActive(f({ flags: ['owned'] }))).toBe(true);
	});
});

describe('summarizeFilter', () => {
	const sentence = (filter: ShelfFilter) =>
		summarizeFilter(filter)
			.map((p) => p.text)
			.join(' ');

	it('returns no parts for the empty filter', () => {
		expect(summarizeFilter(EMPTY_FILTER)).toEqual([]);
	});

	// HAZARD (UX-DR23): "or"/"and" are literal WORDS in the sentence — color
	// tints are redundant to them, never a replacement.
	it('joins a group with the literal word "or"', () => {
		expect(sentence(f({ states: ['Playing', 'Paused'] }))).toBe(
			'Showing Playing or Paused games.',
		);
		const parts = summarizeFilter(f({ states: ['Playing', 'Paused'] }));
		expect(parts.find((p) => p.connector === 'or')?.text).toBe('or');
	});

	it('reveals narrate inside the state group (they extend it)', () => {
		expect(sentence(f({ states: ['Playing'], reveals: ['Dropped'] }))).toBe(
			'Showing Playing or Dropped games.',
		);
	});

	// HAZARD: with no explicit state selection a reveal extends the DEFAULT
	// set — the sentence must not claim a reveal-only subset.
	it('a reveal with no state selection narrates the full default set', () => {
		expect(sentence(f({ reveals: ['Dropped'] }))).toBe(
			'Showing Not started or Up next or Playing or Paused or Dropped games.',
		);
	});

	it('joins groups with the literal word "and", flags each their own group', () => {
		expect(
			sentence(
				f({
					states: ['Playing'],
					genres: ['RPG', 'Racing'],
					flags: ['owned', 'playableNow'],
				}),
			),
		).toBe(
			'Showing Playing, and RPG or Racing, and Owned, and Playable now games.',
		);
		const parts = summarizeFilter(f({ flags: ['owned', 'playableNow'] }));
		expect(parts.filter((p) => p.connector === 'and')).toHaveLength(1);
	});
});

describe('toggleSelection', () => {
	it('adds a missing value and removes a present one', () => {
		expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b']);
		expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b']);
	});
});
