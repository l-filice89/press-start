import { describe, expect, it } from 'vitest';
import {
	completionPercent,
	TROPHY_GRADE_BANDS,
	totalTrophies,
	trophyGrade,
	trophyTitleToMatchKey,
} from './trophy';

/**
 * Story 9.2 core rows. The hazards: the PS4 " Trophies" suffix is the ONLY
 * thing standing between a trophy title and its library game (the captured
 * payload carries no id to join on), a game with no defined trophies must read
 * as NO DATA rather than 0%, and a 99.5% set must never print 100%.
 */

describe('trophyTitleToMatchKey', () => {
	it('strips the PS4-era " Trophies" suffix before normalizing (hazard: the name is the only join key)', () => {
		// Both captured spellings must land on the library game's key.
		expect(trophyTitleToMatchKey('Ultimate Chicken Horse Trophies')).toBe(
			'ultimate chicken horse',
		);
		expect(trophyTitleToMatchKey('EA SPORTS FC™ 24 Trophies')).toBe(
			'ea sports fc 24',
		);
		// PS5 entries are named plainly — same key, no suffix to strip.
		expect(trophyTitleToMatchKey('Tales of Arise')).toBe('tales of arise');
	});

	it('reuses the shared normalizer (editions, ™, platform tags collapse)', () => {
		expect(trophyTitleToMatchKey('Hades (PS4 & PS5) Trophies')).toBe(
			trophyTitleToMatchKey('Hades'),
		);
	});

	it('strips only a TRAILING suffix, never a mid-title word', () => {
		expect(trophyTitleToMatchKey('Trophies of War')).toBe('trophies of war');
	});
});

describe('completionPercent', () => {
	it('is count-based, and floors (hazard: 199/200 must never read 100%)', () => {
		expect(completionPercent(199, 200)).toBe(99);
		expect(completionPercent(200, 200)).toBe(100);
		// The captured Tales of Arise row: 6 of 59 — PSN's own weighted
		// `progress` says 7; the count-based number is 10, and it is what we show.
		expect(completionPercent(6, 59)).toBe(10);
	});

	it('returns null when nothing is defined — the no-data signal (hazard: never a fake 0%)', () => {
		expect(completionPercent(0, 0)).toBeNull();
	});

	it('a played-but-none-earned game is real 0% data, not no-data', () => {
		expect(completionPercent(0, 59)).toBe(0);
	});

	it('clamps the CEILING too (hazard: PSN can send earned > defined across a trophy-group change — a 113% · S is a lie)', () => {
		expect(completionPercent(67, 59)).toBe(100);
		expect(completionPercent(1, 0)).toBeNull();
	});
});

describe('trophyGrade', () => {
	it.each([
		[100, 'S'],
		[99, 'A'],
		[75, 'A'],
		[74, 'B'],
		[50, 'B'],
		[49, 'C'],
		[25, 'C'],
		[24, 'D'],
		[0, 'D'],
	])('%d%% is grade %s', (percent, grade) => {
		expect(trophyGrade(percent)).toBe(grade);
	});

	it('the bands are defined in exactly one place and cover every percent (AR-3)', () => {
		expect(TROPHY_GRADE_BANDS[TROPHY_GRADE_BANDS.length - 1].min).toBe(0);
		for (let percent = 0; percent <= 100; percent++) {
			expect(trophyGrade(percent)).toBeTruthy();
		}
	});
});

describe('totalTrophies', () => {
	it('sums the tiers', () => {
		expect(
			totalTrophies({ bronze: 40, silver: 12, gold: 6, platinum: 1 }),
		).toBe(59);
	});
});
