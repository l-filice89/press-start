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
	summarizeFilterText,
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
		psPlusLeavingOn: null,
		ttbStorySeconds: null,
		ttbCompleteSeconds: null,
		ttbCount: null,
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
		expect(
			isFilterActive(f({ ttb: { metric: 'story', bands: ['lte25'] } })),
		).toBe(true);
	});

	// HAZARD (Story 12.1): the metric toggle is NOT a selection — a non-default
	// metric with zero bands must read as inactive.
	it('the TTB metric alone never activates the filter — bands.length only', () => {
		expect(isFilterActive(f({ ttb: { metric: 'complete', bands: [] } }))).toBe(
			false,
		);
	});

	// DECISION (Story 12.1 review): the metric toggle is FILTER STATE, so
	// "Clear filters" (assigning EMPTY_FILTER) intentionally snaps it back to
	// the story default along with everything else.
	it('EMPTY_FILTER pins the TTB group to the story metric with no bands', () => {
		expect(EMPTY_FILTER.ttb).toEqual({ metric: 'story', bands: [] });
	});
});

describe('Time-to-beat filter (Story 12.1, VR-9)', () => {
	const hours = (h: number) => h * 3600;
	const ttb = (
		bands: ShelfFilter['ttb']['bands'],
		metric: ShelfFilter['ttb']['metric'] = 'story',
	) => f({ ttb: { metric, bands } });

	it('a band matches on selected-metric hours (25h game in ≤25h)', () => {
		const games = [
			game({ id: 't1', ttbStorySeconds: hours(25) }),
			game({ id: 't2', ttbStorySeconds: hours(26) }),
		];
		expect(ids(applyShelfFilter(games, ttb(['lte25'])))).toEqual(['t1']);
	});

	// HAZARD (boundary exactness): bands are half-open — a game at exactly 50h
	// matches 25–50h ONLY; with both neighbours selected it appears once.
	it('a game at exactly 50h matches 25–50h and never 50–75h', () => {
		const boundary = game({ id: 'b', ttbStorySeconds: hours(50) });
		expect(ids(applyShelfFilter([boundary], ttb(['25-50'])))).toEqual(['b']);
		expect(applyShelfFilter([boundary], ttb(['50-75']))).toEqual([]);
		expect(ids(applyShelfFilter([boundary], ttb(['25-50', '50-75'])))).toEqual([
			'b',
		]);
	});

	it('every boundary lands in exactly one band (75h, 100h)', () => {
		const at75 = game({ id: 'x75', ttbStorySeconds: hours(75) });
		const at100 = game({ id: 'x100', ttbStorySeconds: hours(100) });
		expect(ids(applyShelfFilter([at75], ttb(['50-75'])))).toEqual(['x75']);
		expect(applyShelfFilter([at75], ttb(['75-100']))).toEqual([]);
		expect(ids(applyShelfFilter([at100], ttb(['75-100'])))).toEqual(['x100']);
		expect(applyShelfFilter([at100], ttb(['gt100']))).toEqual([]);
	});

	it('ORs within the Time group (≤25h + >100h)', () => {
		const games = [
			game({ id: 's', ttbStorySeconds: hours(10) }),
			game({ id: 'm', ttbStorySeconds: hours(60) }),
			game({ id: 'l', ttbStorySeconds: hours(120) }),
		];
		expect(ids(applyShelfFilter(games, ttb(['lte25', 'gt100'])))).toEqual([
			's',
			'l',
		]);
	});

	it('ANDs against other groups (≤25h + genre RPG)', () => {
		const games = [
			game({ id: 'sr', ttbStorySeconds: hours(10), genres: ['RPG'] }),
			game({ id: 's-', ttbStorySeconds: hours(10), genres: ['Racing'] }),
			game({ id: 'lr', ttbStorySeconds: hours(200), genres: ['RPG'] }),
		];
		expect(
			ids(
				applyShelfFilter(games, {
					...ttb(['lte25']),
					genres: ['RPG'],
				}),
			),
		).toEqual(['sr']);
	});

	it('the metric toggle re-evaluates every selected band', () => {
		const g = game({
			id: 'mt',
			ttbStorySeconds: hours(10),
			ttbCompleteSeconds: hours(40),
		});
		expect(applyShelfFilter([g], ttb(['25-50'], 'story'))).toEqual([]);
		expect(ids(applyShelfFilter([g], ttb(['25-50'], 'complete')))).toEqual([
			'mt',
		]);
	});

	// HAZARD (NFR-4, cross-metric absence): a null SELECTED metric matches only
	// Unknown even when the OTHER metric holds a value — never a numeric band.
	it('a game with only the other metric matches only Unknown', () => {
		const g = game({
			id: 'cm',
			ttbStorySeconds: null,
			ttbCompleteSeconds: hours(55.6),
		});
		expect(applyShelfFilter([g], ttb(['50-75'], 'story'))).toEqual([]);
		expect(applyShelfFilter([g], ttb(['lte25'], 'story'))).toEqual([]);
		expect(ids(applyShelfFilter([g], ttb(['unknown'], 'story')))).toEqual([
			'cm',
		]);
		// Aimed at the metric it DOES carry, it filters as a value again.
		expect(ids(applyShelfFilter([g], ttb(['50-75'], 'complete')))).toEqual([
			'cm',
		]);
	});

	it('Unknown shows only games with a null selected metric', () => {
		const games = [
			game({ id: 'u', ttbStorySeconds: null }),
			game({ id: 'v', ttbStorySeconds: hours(10) }),
		];
		expect(ids(applyShelfFilter(games, ttb(['unknown'])))).toEqual(['u']);
	});

	// HAZARD (0 is a value): zero seconds matches ≤25h — never absence.
	it('0 seconds is a real value: matches ≤25h, not Unknown', () => {
		const g = game({ id: 'z', ttbStorySeconds: 0 });
		expect(ids(applyShelfFilter([g], ttb(['lte25'])))).toEqual(['z']);
		expect(applyShelfFilter([g], ttb(['unknown']))).toEqual([]);
	});

	// HAZARD (review P2): a value that is not an honest duration — undefined
	// (schema drift), NaN — is ABSENCE: it matches Unknown and only Unknown,
	// never a numeric band, and never silently vanishes from every band.
	it('undefined or NaN seconds match only Unknown — never a numeric band, never nothing', () => {
		const drift = game({
			id: 'dr',
			ttbStorySeconds: undefined as unknown as number | null,
		});
		const nan = game({ id: 'nn', ttbStorySeconds: Number.NaN });
		for (const g of [drift, nan]) {
			expect(ids(applyShelfFilter([g], ttb(['unknown'])))).toEqual([g.id]);
			expect(
				applyShelfFilter(
					[g],
					ttb(['lte25', '25-50', '50-75', '75-100', 'gt100']),
				),
			).toEqual([]);
		}
	});

	// HAZARD (review P2): negative seconds must never dishonestly match ≤25h.
	it('negative seconds match only Unknown, never ≤25h', () => {
		const g = game({ id: 'neg', ttbStorySeconds: -3600 });
		expect(applyShelfFilter([g], ttb(['lte25']))).toEqual([]);
		expect(ids(applyShelfFilter([g], ttb(['unknown'])))).toEqual(['neg']);
	});

	it('no bands selected imposes nothing, whatever the toggle position', () => {
		const games = [
			game({ id: 'n1', ttbStorySeconds: null }),
			game({ id: 'n2', ttbStorySeconds: hours(300) }),
		];
		expect(ids(applyShelfFilter(games, ttb([], 'complete')))).toEqual([
			'n1',
			'n2',
		]);
	});

	it('narrates in the summary via literal or/and words, naming the metric', () => {
		expect(summarizeFilterText(ttb(['lte25', 'gt100']))).toBe(
			'Showing ≤25h or >100h story completion games.',
		);
		expect(
			summarizeFilterText({
				...ttb(['25-50', 'unknown']),
				genres: ['RPG'],
				flags: ['owned'],
			}),
		).toBe(
			'Showing RPG, and 25–50h or Unknown story completion, and Owned games.',
		);
	});

	// Retro 12: the sentence must say WHICH hours it filtered on — the same
	// band reads differently under story vs 100% completion.
	it('names 100% completion when the complete metric is active', () => {
		expect(summarizeFilterText(ttb(['lte25'], 'complete'))).toBe(
			'Showing ≤25h 100% completion games.',
		);
		// The group-scoping comma lands on the metric label (the group's last
		// token), not the band, when another AND group follows.
		expect(
			summarizeFilterText({ ...ttb(['lte25'], 'complete'), flags: ['owned'] }),
		).toBe('Showing ≤25h 100% completion, and Owned games.');
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

describe('Leaving soon flag (Story 10.4 follow-on)', () => {
	it('matches exactly the pill set: un-owned with a FUTURE date', () => {
		const games = [
			game({ id: 'l1', psPlusLeavingOn: '2099-07-21', owned: false }),
			game({ id: 'l2', psPlusLeavingOn: '2099-07-21', owned: true }),
			game({ id: 'l3', psPlusLeavingOn: '2020-01-05', owned: false }),
			game({ id: 'l4', psPlusLeavingOn: null, owned: false }),
		];
		const shown = applyShelfFilter(games, {
			...EMPTY_FILTER,
			flags: ['leavingSoon'],
		});
		expect(shown.map((g) => g.id)).toEqual(['l1']);
	});

	it('narrates in the summary', () => {
		expect(
			summarizeFilterText({ ...EMPTY_FILTER, flags: ['leavingSoon'] }),
		).toBe('Showing Leaving soon games.');
	});
});
