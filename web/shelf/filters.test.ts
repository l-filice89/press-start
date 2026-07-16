import { describe, expect, it } from 'vitest';
import type { ShelfGame } from './api';
import {
	applyShelfFilter,
	EMPTY_FILTER,
	foldForSearch,
	isFilterActive,
	matchesTitleQuery,
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
		ownedVia: null,
		releaseDate: null,
		genres: [],
		criticScore: null,
		criticScoreCount: null,
		userScore: null,
		userScoreCount: null,
		psPlusLeftOn: null,
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

	// HAZARD (FR-4/FR-21 amended 2026-07-10): a reveal is an EXCLUSIVE view —
	// only the revealed hidden state shows, never the default set around it.
	it('a reveal pill shows only its hidden state (exclusive view, FR-21)', () => {
		const out = applyShelfFilter(SHELF, f({ reveals: ['Dropped'] }));
		expect(ids(out)).toEqual(['h']);
	});

	it('multiple reveal pills OR among themselves', () => {
		const out = applyShelfFilter(
			SHELF,
			f({ reveals: ['Story completed', 'Platinum achieved'] }),
		);
		expect(ids(out)).toEqual(['f', 'g']);
	});

	// HAZARD: the handlers keep states/reveals mutually exclusive, but the pure
	// layer must hold the contract even against an inconsistent filter object.
	it('reveals replace the state group even if states are non-empty', () => {
		const out = applyShelfFilter(
			SHELF,
			f({ states: ['Playing'], reveals: ['Platinum achieved'] }),
		);
		expect(ids(out)).toEqual(['g']);
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

	it('PS+ flag matches the badge set: in-catalog AND not owned', () => {
		const shelf = [
			game({ id: 'p', psPlusExtra: true, owned: false }), // badge shows
			game({ id: 'q', psPlusExtra: true, owned: true }), // owned → no badge
			game({ id: 'r', psPlusExtra: false, owned: false }), // not in catalog
		];
		expect(ids(applyShelfFilter(shelf, f({ flags: ['psPlusExtra'] })))).toEqual(
			['p'],
		);
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

	// HAZARD (FR-20 amended): Genre and Flags still AND with an exclusive
	// reveal view — Completed + RPG + Owned = only completed, owned RPGs.
	it('genre and flag selections AND with an exclusive reveal view', () => {
		expect(
			ids(
				applyShelfFilter(
					SHELF,
					f({ genres: ['RPG'], reveals: ['Story completed'] }),
				),
			),
		).toEqual(['f']);
		expect(
			ids(
				applyShelfFilter(
					SHELF,
					f({
						genres: ['RPG'],
						flags: ['owned'],
						reveals: ['Story completed'],
					}),
				),
			),
		).toEqual(['f']);
		// The flag can empty the reveal view: no wishlisted Story-completed games.
		expect(
			applyShelfFilter(
				SHELF,
				f({ flags: ['wishlisted'], reveals: ['Story completed'] }),
			),
		).toEqual([]);
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
			f({ states: ['Playing', 'Not started', 'Paused'] }),
		);
		expect(ids(out)).toEqual(['a', 'b', 'c', 'e']);
		// owned 'a' still precedes wishlisted 'b' — the payload's owned tier held.
		expect(ids(out).indexOf('a')).toBeLessThan(ids(out).indexOf('b'));
		// Reveal views subset in payload order too (hidden states rank after).
		expect(
			ids(
				applyShelfFilter(SHELF, f({ reveals: ['Story completed', 'Dropped'] })),
			),
		).toEqual(['f', 'h']);
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

	// HAZARD (FR-21 amended): an exclusive reveal view is stated literally —
	// no live-status enumeration alongside it, exactly the subset shown.
	it('a reveal view narrates literally, no live-status enumeration', () => {
		expect(sentence(f({ reveals: ['Story completed'] }))).toBe(
			'Showing Story completed games.',
		);
		expect(
			sentence(f({ reveals: ['Story completed', 'Platinum achieved'] })),
		).toBe('Showing Story completed or Platinum achieved games.');
	});

	it('reveals silence any lingering state terms (exclusive view)', () => {
		expect(sentence(f({ states: ['Playing'], reveals: ['Dropped'] }))).toBe(
			'Showing Dropped games.',
		);
	});

	it('genre and flag groups AND onto a reveal view in the sentence', () => {
		expect(
			sentence(
				f({ reveals: ['Story completed'], genres: ['RPG'], flags: ['owned'] }),
			),
		).toBe('Showing Story completed, and RPG, and Owned games.');
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

// HAZARD (Story 6.5 AC1): the AC names a "normalized, case/diacritic-insensitive
// substring" match. These assert each named invariant on `matchesTitleQuery`
// directly — not merely that the predicate returns something.
describe('matchesTitleQuery', () => {
	it('is case-insensitive', () => {
		expect(matchesTitleQuery('Bloodborne', 'BLOOD')).toBe(true);
		expect(matchesTitleQuery('BLOODBORNE', 'blood')).toBe(true);
	});

	it('is diacritic-insensitive both directions ("pokemon" ↔ "Pokémon")', () => {
		// Folded query drops its accents to match a plain title…
		expect(matchesTitleQuery('Pokemon Scarlet', 'pokémon')).toBe(true);
		// …and a plain query matches an accented title.
		expect(matchesTitleQuery('Pokémon Scarlet', 'pokemon')).toBe(true);
		expect(matchesTitleQuery('Ōkami', 'okami')).toBe(true);
	});

	it('matches a substring in the middle of the title, not just a prefix', () => {
		expect(matchesTitleQuery('The Last of Us', 'last')).toBe(true);
		expect(matchesTitleQuery('God of War', 'of')).toBe(true);
	});

	it('folds internal whitespace runs before comparing', () => {
		// A double space in the needle still matches a single-spaced title.
		expect(matchesTitleQuery('God of War', 'god of  war')).toBe(true);
		// …and a multi-spaced title is matched by a normal needle.
		expect(matchesTitleQuery('God   of   War', 'god of war')).toBe(true);
	});

	it('an empty or whitespace-only query matches every title', () => {
		expect(matchesTitleQuery('Anything At All', '')).toBe(true);
		expect(matchesTitleQuery('Anything At All', '   ')).toBe(true);
	});

	it('returns false when the normalized needle is genuinely absent', () => {
		expect(matchesTitleQuery('Bloodborne', 'zelda')).toBe(false);
	});
});

describe('foldForSearch', () => {
	it('lowercases, strips diacritics, and collapses/trims whitespace', () => {
		expect(foldForSearch('  Pokémon   Scarlet ')).toBe('pokemon scarlet');
		expect(foldForSearch('ÀÉÎÕÜ')).toBe('aeiou');
	});
});

describe('toggleSelection', () => {
	it('adds a missing value and removes a present one', () => {
		expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b']);
		expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b']);
	});
});
