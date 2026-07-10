import { describe, expect, it } from 'vitest';
import { planSync, type SyncEntry, type SyncIndex } from './sync-reconcile';

/**
 * Pure sync-planner tests (Story 4.2; FR-9 amended 2026-07-11). Hazard rows
 * pinned red-then-green: the plan is additive-only (no delete/un-own shape
 * exists), PS+ claims sync as owned but ALWAYS carry `viaMembership` (the
 * subscription-cancel flow depends on that flag), and an external-id/title
 * disagreement is flagged, never merged (FR-34).
 */

const entry = (over: Partial<SyncEntry> = {}): SyncEntry => ({
	name: 'Astro Bot',
	platform: 'PS5',
	membership: 'NONE',
	titleId: 'PPSA01325_00',
	productId: 'EP9000-PPSA01325_00-GAME',
	entitlementId: 'EP9000-PPSA01325_00-GAME',
	imageUrl: 'https://image.api.playstation.com/astro.png',
	storeUrl: 'https://store.playstation.com/concept/10005478',
	...over,
});

const emptyIndex = (): SyncIndex => ({
	linkedGameIdByExternalId: {},
	gamesByNormalizedTitle: {},
});

describe('planSync', () => {
	it('creates a new game with PSN facts when nothing matches', () => {
		const plan = planSync([entry()], emptyIndex());

		expect(plan.creates).toEqual([
			{
				title: 'Astro Bot',
				titleNormalized: 'astro bot',
				coverUrl: 'https://image.api.playstation.com/astro.png',
				storeUrl: 'https://store.playstation.com/concept/10005478',
				externalIds: ['PPSA01325_00'],
				viaMembership: false,
			},
		]);
		expect(plan.matches).toEqual([]);
		expect(plan.conflicts).toEqual([]);
	});

	it('claims sync as owned but ALWAYS carry viaMembership (hazard FR-9 amended)', () => {
		const index = emptyIndex();
		index.gamesByNormalizedTitle['claimed match'] = [
			{ gameId: 'g1', psnExternalIds: [] },
		];

		const plan = planSync(
			[
				entry({
					name: 'Claimed Match',
					titleId: 'C_00',
					membership: 'PS_PLUS',
				}),
				entry({ name: 'Claimed New', titleId: 'C_01', membership: 'PS_PLUS' }),
			],
			index,
		);

		// Both claims land — one as a match, one as a create — flagged.
		expect(plan.matches).toMatchObject([
			{ gameId: 'g1', title: 'Claimed Match', viaMembership: true },
		]);
		expect(plan.creates).toMatchObject([
			{ title: 'Claimed New', viaMembership: true },
		]);
	});

	it('treats ANY non-NONE membership marker as a claim — even an empty string', () => {
		const plan = planSync([entry({ membership: '' })], emptyIndex());
		expect(plan.creates).toMatchObject([{ viaMembership: true }]);
	});

	it('a purchase anywhere in a PS4/PS5 group outranks its claims', () => {
		const plan = planSync(
			[
				entry({ platform: 'PS4', titleId: 'CUSA_00', membership: 'PS_PLUS' }),
				entry({ platform: 'PS5', titleId: 'PPSA01325_00' }),
			],
			emptyIndex(),
		);
		expect(plan.creates).toMatchObject([{ viaMembership: false }]);
	});

	it('skips WEBMAF web-app companion entitlements — not games (seed parity)', () => {
		const plan = planSync(
			[
				entry({
					name: 'IGN For PlayStation',
					titleId: 'WEBAPP_00',
					productId: 'IP9100-CUSA00003_00-WEBMAF302281APP0',
					entitlementId: null,
				}),
			],
			emptyIndex(),
		);
		expect(plan.skippedWebApps).toBe(1);
		expect(plan.creates).toEqual([]);
	});

	it('flags a stored id resolving to a DIFFERENT game than the title match (FR-34 defining conflict)', () => {
		const index = emptyIndex();
		index.linkedGameIdByExternalId.PPSA01325_00 = 'g-linked';
		index.gamesByNormalizedTitle['astro bot'] = [
			{ gameId: 'g-title', psnExternalIds: [] },
		];

		const plan = planSync([entry()], index);

		expect(plan.conflicts).toHaveLength(1);
		expect(plan.conflicts[0].reason).toMatch(/different game than its title/);
		expect(plan.matches).toEqual([]);
	});

	it('a duplicated titleId under two differently-normalizing names claims only one group', () => {
		const plan = planSync(
			[
				entry({ name: 'Astro Bot' }),
				entry({ name: 'ASTRO BOT — Director’s Cut' }),
			],
			emptyIndex(),
		);

		const allIds = plan.creates.flatMap((c) => c.externalIds);
		// The shared PPSA01325_00 appears exactly once across the whole plan —
		// a second insert would violate the unique (source, external_id) index.
		expect(allIds).toEqual(['PPSA01325_00']);
	});

	it('matches a stored external-id link first, backfilling only missing links', () => {
		const index = emptyIndex();
		index.linkedGameIdByExternalId.CUSA01325_00 = 'g1';

		const plan = planSync(
			[
				entry({ platform: 'PS4', titleId: 'CUSA01325_00' }),
				entry({ platform: 'PS5', titleId: 'PPSA01325_00' }),
			],
			index,
		);

		expect(plan.creates).toEqual([]);
		expect(plan.matches).toEqual([
			{
				gameId: 'g1',
				title: 'Astro Bot',
				viaMembership: false,
				externalIdsToAdd: ['PPSA01325_00'],
				coverUrl: 'https://image.api.playstation.com/astro.png',
				storeUrl: 'https://store.playstation.com/concept/10005478',
			},
		]);
	});

	it('collapses a PS4+PS5 pair to ONE create carrying both ids, PS5 facts preferred', () => {
		const plan = planSync(
			[
				entry({
					platform: 'PS4',
					titleId: 'CUSA01325_00',
					imageUrl: 'https://ps4-cover.png',
					storeUrl: 'https://ps4-store',
				}),
				entry({ platform: 'PS5', titleId: 'PPSA01325_00' }),
			],
			emptyIndex(),
		);

		expect(plan.creates).toHaveLength(1);
		expect(plan.creates[0].externalIds).toEqual([
			'CUSA01325_00',
			'PPSA01325_00',
		]);
		// PS5 facts win the collapse.
		expect(plan.creates[0].coverUrl).toBe(
			'https://image.api.playstation.com/astro.png',
		);
	});

	it('matches by normalized title when the game has no PSN ids yet', () => {
		const index = emptyIndex();
		index.gamesByNormalizedTitle['astro bot'] = [
			{ gameId: 'g1', psnExternalIds: [] },
		];

		const plan = planSync([entry()], index);

		expect(plan.matches).toEqual([
			{
				gameId: 'g1',
				title: 'Astro Bot',
				viaMembership: false,
				externalIdsToAdd: ['PPSA01325_00'],
				coverUrl: 'https://image.api.playstation.com/astro.png',
				storeUrl: 'https://store.playstation.com/concept/10005478',
			},
		]);
		expect(plan.creates).toEqual([]);
	});

	it('flags a title match carrying a DIFFERENT PSN id — never merges (hazard FR-34)', () => {
		const index = emptyIndex();
		index.gamesByNormalizedTitle['astro bot'] = [
			{ gameId: 'g1', psnExternalIds: ['OTHER_ID_00'] },
		];

		const plan = planSync([entry()], index);

		expect(plan.conflicts).toHaveLength(1);
		expect(plan.conflicts[0].title).toBe('Astro Bot');
		// Nothing merged, nothing created for the conflicted entry.
		expect(plan.matches).toEqual([]);
		expect(plan.creates).toEqual([]);
	});

	it('flags an ambiguous title match (several unclaimed same-title games)', () => {
		const index = emptyIndex();
		index.gamesByNormalizedTitle['astro bot'] = [
			{ gameId: 'g1', psnExternalIds: [] },
			{ gameId: 'g2', psnExternalIds: [] },
		];

		const plan = planSync([entry()], index);

		expect(plan.conflicts).toHaveLength(1);
		expect(plan.matches).toEqual([]);
		expect(plan.creates).toEqual([]);
	});

	it('flags a PS4/PS5 pair whose stored links point at two different games', () => {
		const index = emptyIndex();
		index.linkedGameIdByExternalId.CUSA01325_00 = 'g1';
		index.linkedGameIdByExternalId.PPSA01325_00 = 'g2';

		const plan = planSync(
			[
				entry({ platform: 'PS4', titleId: 'CUSA01325_00' }),
				entry({ platform: 'PS5', titleId: 'PPSA01325_00' }),
			],
			index,
		);

		expect(plan.conflicts).toHaveLength(1);
		expect(plan.matches).toEqual([]);
	});

	it('is idempotent: a fully-linked library re-syncs to an empty plan', () => {
		const index = emptyIndex();
		index.linkedGameIdByExternalId.PPSA01325_00 = 'g1';

		const plan = planSync([entry()], index);

		expect(plan.creates).toEqual([]);
		expect(plan.conflicts).toEqual([]);
		expect(plan.matches).toEqual([
			{
				gameId: 'g1',
				title: 'Astro Bot',
				viaMembership: false,
				externalIdsToAdd: [],
				coverUrl: 'https://image.api.playstation.com/astro.png',
				storeUrl: 'https://store.playstation.com/concept/10005478',
			},
		]);
	});

	it('the plan shape is additive-only — no delete/un-own op exists (hazard FR-33/AD-10)', () => {
		const plan = planSync([entry()], emptyIndex());
		// Structural pin: the planner cannot express destruction. If a
		// remove/unown/delete key ever appears, this fails and FR-33 is at risk.
		expect(Object.keys(plan).sort()).toEqual([
			'conflicts',
			'creates',
			'matches',
			'skippedWebApps',
		]);
	});

	it('ignores nameless entries (cannot match or title a game)', () => {
		const plan = planSync([entry({ name: '  ' })], emptyIndex());
		expect(plan.creates).toEqual([]);
		expect(plan.matches).toEqual([]);
		expect(plan.conflicts).toEqual([]);
	});
});
