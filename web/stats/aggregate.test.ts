import { describe, expect, it } from 'vitest';
import type { ShelfGame } from '../shelf/api';
import { availableStatsYears, summarizeStats } from './aggregate';

function game(overrides: Partial<ShelfGame> & { id: string }): ShelfGame {
	return {
		title: overrides.id,
		coverUrl: null,
		storeUrl: null,
		playStatus: 'Not started',
		effectiveState: 'Not started',
		owned: false,
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

describe('stats aggregation', () => {
	it('counts lifetime and selected-year lifecycle dates without timezone conversion', () => {
		const games = [
			game({
				id: 'one',
				owned: true,
				wishlistedOn: '2025-12-31',
				boughtOn: '2026-01-01',
				startedOn: '2026-01-31',
				completedOn: '2026-02-01',
				platinumOn: '2026-02-02',
				genres: ['RPG', 'rpg', 'Adventure'],
			}),
			game({ id: 'two', completedOn: '2025-08-01', genres: ['RPG'] }),
		];
		const result = summarizeStats(games, 2026);

		expect(result.allTime).toEqual({
			tracked: 2,
			owned: 1,
			completed: 2,
			platinum: 1,
		});
		expect(result.year).toMatchObject({
			boughtOn: 1,
			startedOn: 1,
			completedOn: 1,
			platinumOn: 1,
			wishlistedOn: 0,
			totalDated: 4,
		});
		expect(result.months[0]).toMatchObject({
			started: 1,
			completed: 0,
			platinum: 0,
		});
		expect(result.months[1]).toMatchObject({
			started: 0,
			completed: 1,
			platinum: 1,
		});
		expect(result.genres).toEqual([
			{ name: 'Adventure', count: 1 },
			{ name: 'RPG', count: 1 },
		]);
	});

	it('sorts top completed genres by count, then base name, and caps at five', () => {
		const games = [
			game({
				id: 'a',
				completedOn: '2026-01-01',
				genres: ['RPG', 'Action', 'Puzzle'],
			}),
			game({
				id: 'b',
				completedOn: '2026-03-01',
				genres: ['RPG', 'Adventure', 'Horror'],
			}),
			game({
				id: 'c',
				completedOn: '2026-04-01',
				genres: ['Racing', 'Strategy'],
			}),
		];
		expect(summarizeStats(games, 2026).genres).toEqual([
			{ name: 'RPG', count: 2 },
			{ name: 'Action', count: 1 },
			{ name: 'Adventure', count: 1 },
			{ name: 'Horror', count: 1 },
			{ name: 'Puzzle', count: 1 },
		]);
	});

	it('offers current and valid recorded years descending, ignoring malformed dates', () => {
		const games = [
			game({
				id: 'a',
				startedOn: '2024-02-29',
				completedOn: '2025-02-29',
				boughtOn: 'not-a-date',
				wishlistedOn: '2023-13-01',
			}),
		];
		expect(availableStatsYears(games, 2026)).toEqual([2026, 2024]);
	});
});
