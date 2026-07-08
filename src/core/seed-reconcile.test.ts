import { describe, expect, it } from 'vitest';
import { buildSeedPlan } from './seed-reconcile';

function ps(
	overrides: Partial<Record<string, string>> = {},
): Record<string, string> {
	return {
		name: 'Game',
		platform: 'PS5',
		membership: 'NONE',
		title_id: 'PPSA00000_00',
		image_url: 'https://ps/cover.png',
		store_url: 'https://ps/store',
		...overrides,
	};
}

function notion(
	overrides: Partial<Record<string, string>> = {},
): Record<string, string> {
	return {
		Title: 'Game',
		Category: 'Action',
		'Date finished': '',
		'Date started': '',
		Owned: 'No',
		Rating: 'Not yet rated',
		'Release date': '',
		Status: 'Not started',
		...overrides,
	};
}

const find = (plan: ReturnType<typeof buildSeedPlan>, norm: string) =>
	plan.candidates.find((c) => c.normalizedTitle === norm);

describe('buildSeedPlan — PS+ claims import like purchases', () => {
	it('imports a PS+ claim as owned and playable, flagged psPlusExtra (never excluded)', () => {
		const plan = buildSeedPlan({
			psRows: [
				ps({ name: 'Owned Game', title_id: 'A' }),
				ps({ name: 'Claimed Game', membership: 'PS_PLUS', title_id: 'B' }),
			],
			notionRows: [],
		});
		expect(plan.candidates).toHaveLength(2);
		expect(find(plan, 'owned game')).toMatchObject({
			owned: true,
			psPlusExtra: false,
		});
		expect(find(plan, 'claimed game')).toMatchObject({
			owned: true,
			psPlusExtra: true,
		});
	});

	it('flags psPlusExtra false when at least one linked PS row is a genuine purchase', () => {
		const plan = buildSeedPlan({
			psRows: [
				ps({
					name: 'Dual',
					platform: 'PS4',
					membership: 'PS_PLUS',
					title_id: 'CUSA',
				}),
				ps({
					name: 'Dual',
					platform: 'PS5',
					membership: 'NONE',
					title_id: 'PPSA',
				}),
			],
			notionRows: [],
		});
		const c = find(plan, 'dual');
		expect(c?.owned).toBe(true);
		expect(c?.psPlusExtra).toBe(false); // the PS5 row is a real purchase
		expect(c?.psLinks.sort()).toEqual(['CUSA', 'PPSA']); // both link, neither excluded
	});
});

describe('buildSeedPlan — PSN web-app exclusion', () => {
	it('excludes a WEBMAF companion-app entry (e.g. IGN/Multiplayer.it), counts it, and never creates it', () => {
		const plan = buildSeedPlan({
			psRows: [
				ps({ name: 'Owned Game', title_id: 'A' }),
				ps({
					name: 'Multiplayer.it',
					title_id: 'B',
					entitlement_id: 'EP4462-CUSA00454_00-WEBMAF00000MULTI',
				}),
			],
			notionRows: [],
		});
		expect(plan.skippedWebApp).toBe(1);
		expect(plan.candidates).toHaveLength(1);
		expect(find(plan, 'owned game')).toBeDefined();
		expect(find(plan, 'multiplayer.it')).toBeUndefined();
	});
});

describe('buildSeedPlan — PS4/PS5 collapse (FR-27, AD-20)', () => {
	it('collapses PS4+PS5 into one PS5-named game with both title_ids linked', () => {
		const plan = buildSeedPlan({
			psRows: [
				ps({ name: 'Nine Sols', platform: 'PS4', title_id: 'CUSA50688_00' }),
				ps({ name: 'Nine Sols', platform: 'PS5', title_id: 'PPSA25414_00' }),
			],
			notionRows: [],
		});
		expect(plan.candidates).toHaveLength(1);
		const c = find(plan, 'nine sols');
		expect(c?.canonicalTitle).toBe('Nine Sols');
		expect(c?.psLinks.sort()).toEqual(['CUSA50688_00', 'PPSA25414_00']);
		expect(c?.owned).toBe(true);
		expect(c?.ownershipType).toBe('digital');
	});
});

describe('buildSeedPlan — Notion merge & status mapping (FR-30)', () => {
	it('merges Notion Playing + Owned onto a PS game, digital ownership winning', () => {
		const plan = buildSeedPlan({
			psRows: [ps({ name: 'Elden Ring', title_id: 'PPSA' })],
			notionRows: [
				notion({ Title: 'Elden Ring', Status: 'Playing', Owned: 'Yes' }),
			],
		});
		const c = find(plan, 'elden ring');
		expect(c?.source).toBe('both');
		expect(c?.playStatus).toBe('Playing');
		expect(c?.owned).toBe(true);
		expect(c?.ownershipType).toBe('digital');
	});

	it('maps Completed to null status + completed_on from Date finished', () => {
		const plan = buildSeedPlan({
			psRows: [],
			notionRows: [
				notion({
					Title: 'Alan Wake',
					Status: 'Completed',
					'Date finished': 'November 5, 2024',
					'Date started': 'October 1, 2024',
					Owned: 'Yes',
				}),
			],
		});
		const c = find(plan, 'alan wake');
		expect(c?.playStatus).toBeNull();
		expect(c?.completedOn).toBe('2024-11-05');
		expect(c?.startedOn).toBe('2024-10-01');
		expect(c?.ownershipType).toBe('physical');
	});

	it('creates a Notion-only wishlist game (Owned No → not owned)', () => {
		const plan = buildSeedPlan({
			psRows: [],
			notionRows: [
				notion({ Title: 'Hollow Knight Silksong', Status: 'Up next!' }),
			],
		});
		const c = find(plan, 'hollow knight silksong');
		expect(c?.source).toBe('notion');
		expect(c?.playStatus).toBe('Up next');
		expect(c?.owned).toBe(false);
		expect(c?.ownershipType).toBeNull();
		expect(c?.psLinks).toEqual([]);
	});
});

describe('buildSeedPlan — stragglers, never guessed (FR-28/30)', () => {
	it('records an unknown Notion status as a straggler with raw payload', () => {
		const plan = buildSeedPlan({
			psRows: [],
			notionRows: [notion({ Title: 'Mystery', Status: 'Wishlisted' })],
		});
		expect(find(plan, 'mystery')).toBeUndefined();
		expect(plan.stragglers).toHaveLength(1);
		expect(plan.stragglers[0].sourceTitle).toBe('Mystery');
		expect(JSON.parse(plan.stragglers[0].notionPayload).Status).toBe(
			'Wishlisted',
		);
	});

	it('flags a Completed row with no finish date as a straggler', () => {
		const plan = buildSeedPlan({
			psRows: [],
			notionRows: [
				notion({ Title: 'Undated', Status: 'Completed', 'Date finished': '' }),
			],
		});
		expect(find(plan, 'undated')).toBeUndefined();
		expect(plan.stragglers.some((s) => s.sourceTitle === 'Undated')).toBe(true);
	});

	it('keeps an owned PS game on the backlog when Notion Completed lacks a date', () => {
		const plan = buildSeedPlan({
			psRows: [ps({ name: 'Owned Undated', title_id: 'PPSA' })],
			notionRows: [
				notion({
					Title: 'Owned Undated',
					Status: 'Completed',
					'Date finished': '',
				}),
			],
		});
		const c = find(plan, 'owned undated');
		expect(c?.owned).toBe(true);
		expect(c?.playStatus).toBe('Not started'); // invariant-safe, not null
		expect(c?.completedOn).toBeNull();
		expect(plan.stragglers.some((s) => s.sourceTitle === 'Owned Undated')).toBe(
			true,
		);
	});
});

describe('buildSeedPlan — title normalization join', () => {
	it('matches across trademark glyphs / edition suffixes via the core normalizer', () => {
		const plan = buildSeedPlan({
			psRows: [ps({ name: 'HEAVY RAIN™', platform: 'PS4', title_id: 'CUSA' })],
			notionRows: [notion({ Title: 'Heavy Rain', Status: 'Paused' })],
		});
		expect(plan.candidates).toHaveLength(1);
		const c = find(plan, 'heavy rain');
		expect(c?.source).toBe('both');
		expect(c?.playStatus).toBe('Paused');
	});
});
