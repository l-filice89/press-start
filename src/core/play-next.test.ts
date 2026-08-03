import { describe, expect, it } from 'vitest';
import {
	EMPTY_PLAY_NEXT_INTENT,
	getPlayNextSuggestions,
	isFinishThem,
	isPlayNextEligible,
	type PlayNextCandidate,
} from './play-next';

const TODAY = '2026-08-02';

function game(
	id: string,
	overrides: Partial<PlayNextCandidate> = {},
): PlayNextCandidate {
	return {
		id,
		title: `Game ${id}`,
		coverUrl: null,
		playStatus: 'Not started',
		owned: true,
		psPlusExtra: false,
		hasCompleted: false,
		hasPlatinum: false,
		platinumOn: null,
		releaseDate: '2020-01-01',
		genres: [],
		criticScore: null,
		criticScoreCount: null,
		userScore: null,
		userScoreCount: null,
		psPlusLeavingOn: null,
		ttbStorySeconds: null,
		boughtOn: null,
		wishlistedOn: null,
		wishlisted: false,
		...overrides,
	};
}

describe('Play Next eligibility', () => {
	it('excludes raw terminal/progress states, platinum, inaccessible, and known future releases', () => {
		for (const candidate of [
			game('playing', { playStatus: 'Playing' }),
			game('dropped', { playStatus: 'Dropped' }),
			game('platinum', { hasPlatinum: true }),
			game('platinum-date', { platinumOn: '2025-01-01' }),
			game('future', { releaseDate: '2026-08-03' }),
			game('wishlist', { owned: false }),
		]) {
			expect(isPlayNextEligible(candidate, TODAY)).toBe(false);
		}
	});

	it('keeps released and unknown/TBA owned or current PS+ games', () => {
		expect(isPlayNextEligible(game('released'), TODAY)).toBe(true);
		expect(isPlayNextEligible(game('tba', { releaseDate: null }), TODAY)).toBe(
			true,
		);
		expect(
			isPlayNextEligible(
				game('plus', { owned: false, psPlusExtra: true }),
				TODAY,
			),
		).toBe(true);
	});

	it('classifies Paused and completed-without-platinum as Finish them', () => {
		expect(isFinishThem(game('paused', { playStatus: 'Paused' }))).toBe(true);
		expect(isFinishThem(game('complete', { hasCompleted: true }))).toBe(true);
		expect(isFinishThem(game('plain'))).toBe(false);
	});
});

describe('Play Next scoring and selection', () => {
	it('returns at most three, never duplicates, and leaves input untouched', () => {
		const input = [game('c'), game('a'), game('b'), game('d')];
		const snapshot = structuredClone(input);
		const result = getPlayNextSuggestions(input, {
			referenceIso: TODAY,
			visitSeed: 'visit',
		});
		expect(result).toHaveLength(3);
		expect(new Set(result.map((item) => item.game.id))).toHaveProperty(
			'size',
			3,
		);
		expect(input).toEqual(snapshot);
	});

	it('returns honest smaller and empty slates', () => {
		expect(
			getPlayNextSuggestions([game('a'), game('b')], {
				referenceIso: TODAY,
				visitSeed: 'visit',
			}),
		).toHaveLength(2);
		expect(
			getPlayNextSuggestions([game('playing', { playStatus: 'Playing' })], {
				referenceIso: TODAY,
				visitSeed: 'visit',
			}),
		).toEqual([]);
	});

	it('is stable for one seed and varies exact ties across seeds', () => {
		const input = ['a', 'b', 'c', 'd', 'e'].map((id) => game(id));
		const once = getPlayNextSuggestions(input, {
			referenceIso: TODAY,
			visitSeed: 'same',
		}).map((item) => item.game.id);
		const twice = getPlayNextSuggestions([...input].reverse(), {
			referenceIso: TODAY,
			visitSeed: 'same',
		}).map((item) => item.game.id);
		expect(twice).toEqual(once);
		const orders = new Set(
			Array.from({ length: 20 }, (_, index) =>
				getPlayNextSuggestions(input, {
					referenceIso: TODAY,
					visitSeed: `seed-${index}`,
				})
					.map((item) => item.game.id)
					.join(','),
			),
		);
		expect(orders.size).toBeGreaterThan(1);
	});

	it('treats missing enrichment as neutral and makes no unsupported claim', () => {
		const suggestion = getPlayNextSuggestions([game('bare')], {
			referenceIso: TODAY,
			visitSeed: 'visit',
		})[0];
		expect(suggestion.factors).toEqual([{ code: 'owned-access', points: 4 }]);
		expect(suggestion.primaryReason).toBe('WILDCARD');
		expect(suggestion.explanation).toBe(
			'A varied eligible pick from your Shelf.',
		);
	});

	it('records ordered additive factors and uses primary-reason precedence', () => {
		const suggestion = getPlayNextSuggestions(
			[
				game('anchor', { playStatus: 'Playing', genres: ['RPG'] }),
				game('pick', {
					playStatus: 'Paused',
					psPlusExtra: true,
					psPlusLeavingOn: '2026-08-10',
					genres: ['RPG'],
					ttbStorySeconds: 9 * 3600,
					criticScore: 88,
					criticScoreCount: 20,
					boughtOn: '2024-01-01',
				}),
			],
			{ referenceIso: TODAY, visitSeed: 'visit' },
		)[0];
		expect(suggestion.primaryReason).toBe('FINISH THEM');
		expect(suggestion.total).toBe(
			suggestion.factors.reduce((sum, factor) => sum + factor.points, 0),
		);
		expect(suggestion.factors.map((factor) => factor.code)).toEqual([
			'finish-them',
			'last-chance-14',
			'forgotten-730',
			'quick-win-10',
			'critic-confidence',
			'familiar-genre',
			'ps-plus-access',
			'owned-access',
		]);
	});

	it('pins every date, duration, and confidence scoring boundary', () => {
		const daysFromToday = (days: number) =>
			new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86_400_000)
				.toISOString()
				.slice(0, 10);
		const codes = (candidate: PlayNextCandidate) =>
			getPlayNextSuggestions([candidate], {
				referenceIso: TODAY,
				visitSeed: 'boundaries',
			})[0].factors.map((factor) => factor.code);

		for (const [days, expected] of [
			[-1, null],
			[0, 'last-chance-14'],
			[14, 'last-chance-14'],
			[15, 'last-chance-30'],
			[30, 'last-chance-30'],
			[31, null],
		] as const) {
			const factors = codes(
				game(`leave-${days}`, {
					psPlusExtra: true,
					psPlusLeavingOn: daysFromToday(days),
				}),
			);
			expect(factors.filter((code) => code.startsWith('last-chance'))).toEqual(
				expected ? [expected] : [],
			);
		}

		for (const [days, expected] of [
			[179, null],
			[180, 'forgotten-180'],
			[364, 'forgotten-180'],
			[365, 'forgotten-365'],
			[729, 'forgotten-365'],
			[730, 'forgotten-730'],
		] as const) {
			const factors = codes(
				game(`age-${days}`, { boughtOn: daysFromToday(-days) }),
			);
			expect(factors.filter((code) => code.startsWith('forgotten'))).toEqual(
				expected ? [expected] : [],
			);
		}

		for (const [seconds, expected] of [
			[-1, null],
			[Number.NaN, null],
			[0, 'quick-win-10'],
			[10 * 3600, 'quick-win-10'],
			[10 * 3600 + 1, 'quick-win-20'],
			[20 * 3600, 'quick-win-20'],
			[20 * 3600 + 1, null],
		] as const) {
			const factors = codes(
				game(`ttb-${String(seconds)}`, { ttbStorySeconds: seconds }),
			);
			expect(factors.filter((code) => code.startsWith('quick-win'))).toEqual(
				expected ? [expected] : [],
			);
		}

		expect(
			codes(game('critic-low-count', { criticScore: 80, criticScoreCount: 9 })),
		).not.toContain('critic-confidence');
		expect(
			codes(game('critic-boundary', { criticScore: 80, criticScoreCount: 10 })),
		).toContain('critic-confidence');
		expect(
			codes(game('user-low-count', { userScore: 80, userScoreCount: 19 })),
		).not.toContain('user-confidence');
		expect(
			codes(game('user-boundary', { userScore: 80, userScoreCount: 20 })),
		).toContain('user-confidence');
	});

	it('uses fixed primary-reason precedence and exact known-fact explanations', () => {
		const pick = (
			candidate: PlayNextCandidate,
			anchors: PlayNextCandidate[] = [],
		) =>
			getPlayNextSuggestions([...anchors, candidate], {
				referenceIso: TODAY,
				visitSeed: 'reasons',
			}).find((item) => item.game.id === candidate.id);
		const cases: Array<[PlayNextCandidate, string, string]> = [
			[
				game('finish', { playStatus: 'Paused', ttbStorySeconds: 3600 }),
				'FINISH THEM',
				'You already made progress here. Returning now could turn it into a finish.',
			],
			[
				game('last', {
					playStatus: 'Up next',
					psPlusExtra: true,
					psPlusLeavingOn: '2026-08-10',
				}),
				'LAST CHANCE',
				'It leaves PS+ on 2026-08-10, so waiting could remove your current access.',
			],
			[
				game('up-next', { playStatus: 'Up next' }),
				'UP NEXT',
				'You marked this Up next, so it is ready to move from intention to play.',
			],
			[
				game('quick', { ttbStorySeconds: 3600 }),
				'QUICK WIN',
				'Its known story estimate is about 1 hours.',
			],
			[
				game('safe', { criticScore: 80, criticScoreCount: 10 }),
				'SAFE BET',
				'Its critic score is 80 from 10 ratings.',
			],
			[
				game('forgotten', { boughtOn: '2024-01-01' }),
				'FORGOTTEN',
				'It has waited on your Shelf since 2024-01-01.',
			],
			[
				game('available', { owned: false, psPlusExtra: true }),
				'AVAILABLE NOW',
				'It is available through your current PS+ Extra access.',
			],
			[game('wildcard'), 'WILDCARD', 'A varied eligible pick from your Shelf.'],
		];
		for (const [candidate, reason, explanation] of cases) {
			const suggestion = pick(candidate);
			expect(suggestion?.primaryReason).toBe(reason);
			expect(suggestion?.explanation).toBe(explanation);
		}
		const familiar = pick(game('familiar', { genres: ['i'] }), [
			game('anchor-i', { playStatus: 'Playing', genres: ['I'] }),
		]);
		expect(familiar?.primaryReason).toBe('FAMILIAR');
		expect(familiar?.explanation).toBe(
			'Its i genre matches games already active on your Shelf.',
		);
	});

	it('SAFE BET never cites a higher score whose sample count did not qualify', () => {
		const suggestion = getPlayNextSuggestions(
			[
				game('scores', {
					criticScore: 85,
					criticScoreCount: 10,
					userScore: 99,
					userScoreCount: 2,
				}),
			],
			{ referenceIso: TODAY, visitSeed: 'visit' },
		)[0];
		expect(suggestion.primaryReason).toBe('SAFE BET');
		expect(suggestion.explanation).toBe(
			'Its critic score is 85 from 10 ratings.',
		);
	});

	it('caps Finish them at one card', () => {
		const result = getPlayNextSuggestions(
			[
				game('paused-a', { playStatus: 'Paused' }),
				game('paused-b', { playStatus: 'Paused' }),
				game('complete', { hasCompleted: true }),
				game('plain-a'),
				game('plain-b'),
			],
			{ referenceIso: TODAY, visitSeed: 'visit' },
		);
		expect(result.filter((item) => item.finishThem)).toHaveLength(1);
		expect(result).toHaveLength(3);
	});

	it('deduplicates repeated ids, sanitizes limits, and reports cap-limited slates', () => {
		const duplicate = [game('same'), game('same'), game('other')];
		expect(
			getPlayNextSuggestions(duplicate, {
				referenceIso: TODAY,
				visitSeed: 'visit',
				limit: 9,
			}).map((item) => item.game.id),
		).toHaveLength(2);
		expect(
			getPlayNextSuggestions(duplicate, {
				referenceIso: TODAY,
				visitSeed: 'visit',
				limit: -1,
			}),
		).toEqual([]);
		expect(
			getPlayNextSuggestions(duplicate, {
				referenceIso: TODAY,
				visitSeed: 'visit',
				limit: Number.NaN,
			}),
		).toHaveLength(2);
		expect(
			getPlayNextSuggestions(
				['a', 'b', 'c'].map((id) => game(id, { playStatus: 'Paused' })),
				{ referenceIso: TODAY, visitSeed: 'visit' },
			),
		).toHaveLength(1);
	});

	it('avoids a third near-identical reason+genre when an alternative exists', () => {
		const result = getPlayNextSuggestions(
			[
				game('rpg-a', { genres: ['RPG'], ttbStorySeconds: 5 * 3600 }),
				game('rpg-b', { genres: ['RPG'], ttbStorySeconds: 6 * 3600 }),
				game('rpg-c', { genres: ['RPG'], ttbStorySeconds: 7 * 3600 }),
				game('action', { genres: ['Action'] }),
			],
			{ referenceIso: TODAY, visitSeed: 'visit' },
		);
		expect(result.map((item) => item.game.id)).toContain('action');
	});

	it('combines active intent groups with AND and appends factors in fixed order', () => {
		const result = getPlayNextSuggestions(
			[
				game('anchor', { playStatus: 'Playing', genres: ['RPG'] }),
				game('exact', {
					genres: ['RPG'],
					ttbStorySeconds: 20 * 3600,
					boughtOn: '2025-01-01',
					criticScore: 80,
					criticScoreCount: 10,
					playStatus: 'Up next',
				}),
				game('partial', {
					genres: ['RPG'],
					ttbStorySeconds: 21 * 3600,
					boughtOn: '2025-01-01',
					criticScore: 80,
					criticScoreCount: 10,
					playStatus: 'Up next',
				}),
			],
			{
				referenceIso: TODAY,
				visitSeed: 'intent',
				intent: {
					genre: 'Familiar',
					time: 'Quick win',
					backlogAge: 'Forgotten',
					priority: 'Follow my list',
					progress: null,
					includeWishlist: false,
				},
			},
		);
		expect(result[0].game.id).toBe('exact');
		expect(result[0].intentDistance).toBe(0);
		expect(result[0].closestMatch).toBe(false);
		expect(
			result[0].factors
				.filter((factor) => factor.code.startsWith('intent-'))
				.map((factor) => factor.code),
		).toEqual([
			'intent-genre',
			'intent-time',
			'intent-backlog-age',
			'intent-priority',
		]);
		expect(result.find((item) => item.game.id === 'partial')).toMatchObject({
			intentDistance: 1,
			closestMatch: true,
		});
	});

	it('sorts intent distance before additive score and diversity adjustments', () => {
		const result = getPlayNextSuggestions(
			[
				game('exact', { ttbStorySeconds: 20 * 3600 }),
				game('partial-high', {
					playStatus: 'Paused',
					psPlusExtra: true,
					psPlusLeavingOn: '2026-08-03',
					boughtOn: '2020-01-01',
					criticScore: 99,
					criticScoreCount: 99,
				}),
			],
			{
				referenceIso: TODAY,
				visitSeed: 'lexicographic-hazard',
				intent: { ...EMPTY_PLAY_NEXT_INTENT, time: 'Quick win' },
			},
		);
		expect(result.map((item) => item.game.id)).toEqual([
			'exact',
			'partial-high',
		]);
	});

	it('treats missing facts as matching neither remaining intent side and never trusts malformed confidence', () => {
		const bare = game('bare');
		const malformed = game('malformed', {
			criticScore: 101,
			criticScoreCount: 0,
			userScore: -1,
			userScoreCount: 20,
		});
		for (const intent of [
			{ ...EMPTY_PLAY_NEXT_INTENT, genre: 'Different' as const },
			{ ...EMPTY_PLAY_NEXT_INTENT, backlogAge: 'Fresh' as const },
			{ ...EMPTY_PLAY_NEXT_INTENT, backlogAge: 'Forgotten' as const },
		]) {
			const suggestion = getPlayNextSuggestions([bare], {
				referenceIso: TODAY,
				visitSeed: 'missing',
				intent,
			})[0];
			expect(suggestion.intentDistance).toBe(1);
			expect(
				suggestion.factors.some((factor) => factor.code.startsWith('intent-')),
			).toBe(false);
		}
		const malformedSuggestion = getPlayNextSuggestions([malformed], {
			referenceIso: TODAY,
			visitSeed: 'malformed',
		})[0];
		expect(malformedSuggestion.primaryReason).not.toBe('SAFE BET');
		expect(malformedSuggestion.factors).not.toContainEqual(
			expect.objectContaining({ code: 'critic-confidence' }),
		);
		for (const malformedDate of ['2026-02-31', '2026-02-01junk']) {
			const dated = game(`date-${malformedDate}`, {
				boughtOn: malformedDate,
				psPlusExtra: true,
				psPlusLeavingOn: malformedDate,
			});
			for (const intent of [
				{ ...EMPTY_PLAY_NEXT_INTENT, backlogAge: 'Fresh' as const },
				{ ...EMPTY_PLAY_NEXT_INTENT, backlogAge: 'Forgotten' as const },
				{ ...EMPTY_PLAY_NEXT_INTENT, priority: 'Last chance' as const },
			]) {
				const result = getPlayNextSuggestions([dated], {
					referenceIso: TODAY,
					visitSeed: malformedDate,
					intent,
				})[0];
				expect(result.intentDistance).toBe(1);
				expect(
					result.factors.some((factor) => factor.code.startsWith('intent-')),
				).toBe(false);
			}
		}
	});

	it('admits only actual inaccessible wishlist games when requested', () => {
		const games = [
			game('wishlist', { owned: false, wishlisted: true }),
			game('not-wishlist', { owned: false }),
			game('plus', { owned: false, psPlusExtra: true }),
			game('owned'),
		];
		expect(
			getPlayNextSuggestions(games, {
				referenceIso: TODAY,
				visitSeed: 'off',
			}).map((item) => item.game.id),
		).toEqual(expect.arrayContaining(['plus', 'owned']));
		const enabled = getPlayNextSuggestions(games, {
			referenceIso: TODAY,
			visitSeed: 'on',
			intent: { ...EMPTY_PLAY_NEXT_INTENT, includeWishlist: true },
		});
		expect(enabled.find((item) => item.game.id === 'wishlist')?.accessTag).toBe(
			'DISCOVER',
		);
		expect(enabled.map((item) => item.game.id)).not.toContain('not-wishlist');
	});

	it('removes the Finish them cap only for explicit Finish them', () => {
		const result = getPlayNextSuggestions(
			['a', 'b', 'c'].map((id) => game(id, { playStatus: 'Paused' })),
			{
				referenceIso: TODAY,
				visitSeed: 'finish',
				intent: { ...EMPTY_PLAY_NEXT_INTENT, progress: 'Finish them' },
			},
		);
		expect(result).toHaveLength(3);
		expect(result.every((item) => !item.closestMatch)).toBe(true);
	});

	it('excludes visit-seen ids without mutating candidates or the exclusion set', () => {
		const input = ['a', 'b', 'c', 'd', 'e'].map((id) => game(id));
		const snapshot = structuredClone(input);
		const excluded = new Set(['a', 'c']);
		const result = getPlayNextSuggestions(input, {
			referenceIso: TODAY,
			visitSeed: 'excluded',
			excludedGameIds: excluded,
		});
		expect(result.map((item) => item.game.id)).not.toContain('a');
		expect(result.map((item) => item.game.id)).not.toContain('c');
		expect(result).toHaveLength(3);
		expect(input).toEqual(snapshot);
		expect([...excluded]).toEqual(['a', 'c']);
	});

	it('derives Familiar anchors from the full snapshot before exclusions', () => {
		const result = getPlayNextSuggestions(
			[
				game('seen-anchor', { playStatus: 'Playing', genres: ['RPG'] }),
				game('familiar', { genres: ['rpg'] }),
				game('different', { genres: ['Action'] }),
			],
			{
				referenceIso: TODAY,
				visitSeed: 'full-anchor-hazard',
				intent: { ...EMPTY_PLAY_NEXT_INTENT, genre: 'Familiar' },
				excludedGameIds: new Set(['seen-anchor']),
			},
		);
		expect(result[0]).toMatchObject({
			game: { id: 'familiar' },
			intentDistance: 0,
		});
		expect(result[1]).toMatchObject({
			game: { id: 'different' },
			intentDistance: 1,
		});
	});

	it('keeps exclusion deterministic and applies the Finish cap afterward', () => {
		const input = [
			game('seen'),
			game('paused-a', { playStatus: 'Paused' }),
			game('paused-b', { playStatus: 'Paused' }),
			game('plain-a'),
			game('plain-b'),
		];
		const options = {
			referenceIso: TODAY,
			visitSeed: 'exclude-finish',
			excludedGameIds: new Set(['seen']),
		};
		const once = getPlayNextSuggestions(input, options);
		const twice = getPlayNextSuggestions([...input].reverse(), options);
		expect(twice.map((item) => item.game.id)).toEqual(
			once.map((item) => item.game.id),
		);
		expect(once.filter((item) => item.finishThem)).toHaveLength(1);
		expect(once.map((item) => item.game.id)).not.toContain('seen');
	});
});
