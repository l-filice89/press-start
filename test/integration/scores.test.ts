import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import type {
	IgdbScoreFetch,
	IgdbScores,
	IgdbTimeToBeat,
} from '../../src/providers';
import {
	addExternalLink,
	insertGame,
	setSetting,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { game } from '../../src/schema/catalog';
import { readLibraryVersion } from '../../src/services/library-version';
import {
	runScheduledScoreRefresh,
	runScoreRefresh,
} from '../../src/services/scores';
import {
	clearScoresRefreshFailed,
	getScoresRefreshedAt,
	isScoresRefreshFailed,
	markScoresRefreshFailed,
	SCORES_REFRESHED_AT_SETTING_KEY,
} from '../../src/services/settings';
import { establishSession, TEST_EMAIL } from './session';

/**
 * Story 10.1 integration tests: the scheduled score refresh against real D1.
 * The named hazards (spec I/O matrix) are asserted red-then-green:
 *  - DEGENERATE `200 []` for a non-empty id list → NO writes, existing scores
 *    SURVIVE, the failure flag lights (DEGENERATE-RESPONSE rule).
 *  - a game absent from the IGDB reply keeps its stored scores.
 *  - a provider throw persists the FR-40 flag; a later success clears it.
 * IGDB is faked at the `IgdbScoreFetch` seam (the provider's own wire handling
 * is covered by src/providers/igdb.test.ts with captured payloads).
 */

const db = () => createDb(env.DB);

const HADES_SCORES = {
	criticScore: 93.52941176470588,
	criticScoreCount: 17,
	userScore: 89.47202036710553,
	userScoreCount: 1699,
};

// TTB defaults to an empty reply — a legitimate answer on this endpoint
// (records exist only for games with submissions), so the pre-10.3 score
// tests run unchanged against realistic plumbing.
const fakeFetch = (
	rows: IgdbScores[],
	ttb?: IgdbTimeToBeat[] | (() => Promise<IgdbTimeToBeat[]>),
): IgdbScoreFetch => ({
	fetchScoresByIds: async () => rows,
	fetchTimeToBeatByIds: typeof ttb === 'function' ? ttb : async () => ttb ?? [],
});

async function seedLinkedGame(
	title: string,
	igdbId: string,
	releaseDate?: string | null,
) {
	const row = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
		releaseDate,
	});
	await addExternalLink(db(), {
		gameId: row.id,
		source: 'IGDB',
		externalId: igdbId,
	});
	return row.id;
}

async function releaseDateOf(gameId: string) {
	const [row] = await db()
		.select({ releaseDate: game.releaseDate })
		.from(game)
		.where(eq(game.id, gameId))
		.limit(1);
	return row.releaseDate;
}

async function scoresOf(gameId: string) {
	const [row] = await db()
		.select({
			criticScore: game.criticScore,
			criticScoreCount: game.criticScoreCount,
			userScore: game.userScore,
			userScoreCount: game.userScoreCount,
		})
		.from(game)
		.where(eq(game.id, gameId))
		.limit(1);
	return row;
}

let userId: string;

describe('score refresh (Story 10.1)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		await establishSession();
		const [row] = await db()
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, TEST_EMAIL))
			.limit(1);
		userId = row.id;
	});

	it('persists fetched scores, stamps the date, and clears the failure flag', async () => {
		const gameId = await seedLinkedGame('Hades', '113112');
		await markScoresRefreshFailed(db());

		const outcome = await runScoreRefresh(
			db(),
			userId,
			fakeFetch([{ igdbId: '113112', ...HADES_SCORES }]),
		);

		expect(outcome).toEqual({ ok: true, updated: 1 });
		expect(await scoresOf(gameId)).toEqual(HADES_SCORES);
		expect(await getScoresRefreshedAt(db(), userId)).toMatch(/^\d{4}-\d{2}-/);
		expect(await isScoresRefreshFailed(db(), userId)).toBe(false);
	});

	it('HAZARD (degenerate response): a 200 [] for a non-empty id list writes NOTHING and existing scores survive', async () => {
		const gameId = await seedLinkedGame('Celeste', '26226', '2018-01-25');
		await runScoreRefresh(
			db(),
			userId,
			fakeFetch([{ igdbId: '26226', ...HADES_SCORES }]),
		);

		const outcome = await runScoreRefresh(db(), userId, fakeFetch([]));

		expect(outcome).toEqual({ ok: false, reason: 'provider' });
		// The write-nothing guarantee: yesterday's scores STAND.
		expect(await scoresOf(gameId)).toEqual(HADES_SCORES);
		expect(await releaseDateOf(gameId)).toBe('2018-01-25');
	});

	it('HAZARD (partial response): a game absent from the reply keeps its stored scores', async () => {
		const keptId = await seedLinkedGame('Kept Game', '900001', '2027-01-01');
		const freshId = await seedLinkedGame('Fresh Game', '900002', '2027-02-02');
		await runScoreRefresh(
			db(),
			userId,
			fakeFetch([
				{ igdbId: '900001', ...HADES_SCORES },
				{ igdbId: '900002', ...HADES_SCORES },
			]),
		);

		// Next refresh: IGDB only answers for Fresh Game.
		const fresh = {
			criticScore: 50,
			criticScoreCount: 3,
			userScore: null,
			userScoreCount: null,
		};
		await runScoreRefresh(
			db(),
			userId,
			fakeFetch([{ igdbId: '900002', releaseDate: '2028-03-03', ...fresh }]),
		);

		expect(await scoresOf(keptId)).toEqual(HADES_SCORES); // untouched
		expect(await scoresOf(freshId)).toEqual(fresh); // updated, nulls included
		expect(await releaseDateOf(keptId)).toBe('2027-01-01');
		expect(await releaseDateOf(freshId)).toBe('2028-03-03');
	});

	describe('release date rides the same /games pass', () => {
		it('updates the shared date and rotates every tracking user library version', async () => {
			const gameId = await seedLinkedGame(
				'Rescheduled Game',
				'920001',
				'2027-04-01',
			);
			const now = new Date();
			const [second] = await db()
				.insert(user)
				.values({
					id: crypto.randomUUID(),
					name: 'Release Date Observer',
					email: 'release-date-observer@example.com',
					createdAt: now,
					updatedAt: now,
				})
				.returning({ id: user.id });
			await upsertTracking(db(), userId, gameId);
			await upsertTracking(db(), second.id, gameId);
			const before = await Promise.all([
				readLibraryVersion(db(), userId),
				readLibraryVersion(db(), second.id),
			]);

			const outcome = await runScoreRefresh(
				db(),
				userId,
				fakeFetch([
					{
						igdbId: '920001',
						releaseDate: '2027-09-15',
						...HADES_SCORES,
					},
				]),
			);

			expect(outcome).toEqual({ ok: true, updated: 1 });
			expect(await releaseDateOf(gameId)).toBe('2027-09-15');
			const after = await Promise.all([
				readLibraryVersion(db(), userId),
				readLibraryVersion(db(), second.id),
			]);
			expect(after[0]).not.toBe(before[0]);
			expect(after[1]).not.toBe(before[1]);
		});

		it('clears a stored date when the returned row explicitly carries null', async () => {
			const gameId = await seedLinkedGame(
				'Withdrawn Date',
				'920002',
				'2027-05-01',
			);

			await runScoreRefresh(
				db(),
				userId,
				fakeFetch([{ igdbId: '920002', releaseDate: null, ...HADES_SCORES }]),
			);

			expect(await releaseDateOf(gameId)).toBeNull();
		});

		it('preserves a stored date when the injected seam omits releaseDate', async () => {
			const gameId = await seedLinkedGame(
				'Omitted Date',
				'920003',
				'2027-06-01',
			);

			await runScoreRefresh(
				db(),
				userId,
				fakeFetch([{ igdbId: '920003', ...HADES_SCORES }]),
			);

			expect(await releaseDateOf(gameId)).toBe('2027-06-01');
		});

		it('scheduled entry refreshes a stale release date through the daily trigger path', async () => {
			const gameId = await seedLinkedGame(
				'Scheduled Date',
				'920004',
				'2027-07-01',
			);
			await setSetting(
				db(),
				userId,
				SCORES_REFRESHED_AT_SETTING_KEY,
				'2020-01-01',
			);

			await runScheduledScoreRefresh(db(), {
				fetchScoresByIds: async (ids) => {
					expect(ids).toContain('920004');
					return [
						{
							igdbId: '920004',
							releaseDate: '2027-10-10',
							...HADES_SCORES,
						},
					];
				},
				fetchTimeToBeatByIds: async () => [],
			});

			expect(await releaseDateOf(gameId)).toBe('2027-10-10');
			expect(await getScoresRefreshedAt(db(), userId)).not.toBe('2020-01-01');
		});

		it('scheduled degenerate reply preserves the date, flags failure, and remains retryable', async () => {
			const gameId = await seedLinkedGame(
				'Scheduled Degenerate Date',
				'920005',
				'2027-08-01',
			);
			await setSetting(
				db(),
				userId,
				SCORES_REFRESHED_AT_SETTING_KEY,
				'2020-01-01',
			);
			await clearScoresRefreshFailed(db());

			await runScheduledScoreRefresh(db(), fakeFetch([]));

			expect(await releaseDateOf(gameId)).toBe('2027-08-01');
			expect(await getScoresRefreshedAt(db(), userId)).toBe('2020-01-01');
			expect(await isScoresRefreshFailed(db(), userId)).toBe(true);

			await runScheduledScoreRefresh(
				db(),
				fakeFetch([
					{
						igdbId: '920005',
						releaseDate: '2027-11-11',
						...HADES_SCORES,
					},
				]),
			);

			expect(await releaseDateOf(gameId)).toBe('2027-11-11');
			expect(await isScoresRefreshFailed(db(), userId)).toBe(false);
		});
	});

	describe('time to beat rides the same pass (Story 10.3, VR-8)', () => {
		// Captured probe row 2026-07-16: seconds, keyed by game_id.
		const TTB = {
			ttbStorySeconds: 54000,
			ttbCompleteSeconds: 95400,
			ttbCount: 8,
		};

		async function ttbOf(gameId: string) {
			const [row] = await db()
				.select({
					ttbStorySeconds: game.ttbStorySeconds,
					ttbCompleteSeconds: game.ttbCompleteSeconds,
					ttbCount: game.ttbCount,
				})
				.from(game)
				.where(eq(game.id, gameId))
				.limit(1);
			return row;
		}

		it('persists story/100%/count from the TTB reply in the same refresh', async () => {
			const gameId = await seedLinkedGame('TTB Happy', '910101');
			const outcome = await runScoreRefresh(
				db(),
				userId,
				fakeFetch(
					[{ igdbId: '910101', ...HADES_SCORES }],
					[{ igdbId: '910101', ...TTB }],
				),
			);
			expect(outcome.ok).toBe(true);
			expect(await ttbOf(gameId)).toEqual(TTB);
			expect(await scoresOf(gameId)).toEqual(HADES_SCORES); // one merged write
		});

		it('a game with scores but NO TTB record keeps its stored hours (partial-reply rule)', async () => {
			const gameId = await seedLinkedGame('TTB Kept', '910102');
			await runScoreRefresh(
				db(),
				userId,
				fakeFetch(
					[{ igdbId: '910102', ...HADES_SCORES }],
					[{ igdbId: '910102', ...TTB }],
				),
			);
			// Next pass: scores answered, TTB reply covers a DIFFERENT game only.
			await runScoreRefresh(
				db(),
				userId,
				fakeFetch(
					[{ igdbId: '910102', ...HADES_SCORES }],
					[{ igdbId: '999999', ...TTB }],
				),
			);
			expect(await ttbOf(gameId)).toEqual(TTB); // hours untouched
		});

		it('an EMPTY TTB reply is legitimate (not degenerate): pass succeeds, stored hours survive', async () => {
			// Unlike /games, absence is normal on /game_time_to_beats — a library
			// whose games lack records must NOT loop a banner forever (review).
			const gameId = await seedLinkedGame('TTB Empty Reply', '910103');
			await runScoreRefresh(
				db(),
				userId,
				fakeFetch(
					[{ igdbId: '910103', ...HADES_SCORES }],
					[{ igdbId: '910103', ...TTB }],
				),
			);

			const fresh = { ...HADES_SCORES, criticScore: 70 };
			const outcome = await runScoreRefresh(
				db(),
				userId,
				fakeFetch([{ igdbId: '910103', ...fresh }], []),
			);

			expect(outcome).toEqual({ ok: true, updated: 1 });
			expect(await ttbOf(gameId)).toEqual(TTB); // hours survive untouched
			expect((await scoresOf(gameId)).criticScore).toBe(70); // scores landed
		});

		it('scheduled entry: a TTB throw persists the FR-40 flag (banner chain, not just the outcome)', async () => {
			await seedLinkedGame('TTB Scheduled Throw', '910106');
			await setSetting(
				db(),
				userId,
				SCORES_REFRESHED_AT_SETTING_KEY,
				'2020-01-01',
			);
			await clearScoresRefreshFailed(db());
			await runScheduledScoreRefresh(db(), {
				fetchScoresByIds: async (ids) =>
					ids.map((id) => ({ igdbId: id, ...HADES_SCORES })),
				fetchTimeToBeatByIds: async () => {
					throw new Error('ttb down');
				},
			});
			expect(await isScoresRefreshFailed(db(), userId)).toBe(true);
		});

		it('HAZARD (TTB fetch throws): scores still land, pass fails closed', async () => {
			const gameId = await seedLinkedGame('TTB Throw', '910104');
			const outcome = await runScoreRefresh(
				db(),
				userId,
				fakeFetch([{ igdbId: '910104', ...HADES_SCORES }], async () => {
					throw new Error('ttb down');
				}),
			);
			expect(outcome).toEqual({ ok: false, reason: 'provider' });
			expect(await scoresOf(gameId)).toEqual(HADES_SCORES);
		});

		it('one-value-only: normally without completely persists null for 100% — never a substitute', async () => {
			const gameId = await seedLinkedGame('TTB Story Only', '910105');
			await runScoreRefresh(
				db(),
				userId,
				fakeFetch(
					[{ igdbId: '910105', ...HADES_SCORES }],
					[
						{
							igdbId: '910105',
							ttbStorySeconds: 7200,
							ttbCompleteSeconds: null,
							ttbCount: 3,
						},
					],
				),
			);
			expect(await ttbOf(gameId)).toEqual({
				ttbStorySeconds: 7200,
				ttbCompleteSeconds: null,
				ttbCount: 3,
			});
		});
	});

	it('scheduled entry: a provider throw persists the FR-40 failure flag for EVERY user', async () => {
		// Scores are shared `game` rows — one failed refresh is every user's
		// failure (deferred-work 2026-07-19), including a user with no prior
		// settings rows at all.
		const now = new Date();
		const [second] = await db()
			.insert(user)
			.values({
				id: crypto.randomUUID(),
				name: 'Second User',
				email: 'second-user@example.com',
				createdAt: now,
				updatedAt: now,
			})
			.returning({ id: user.id });
		// Force staleness so the gate doesn't skip the run.
		await setSetting(
			db(),
			userId,
			SCORES_REFRESHED_AT_SETTING_KEY,
			'2020-01-01',
		);
		await runScheduledScoreRefresh(db(), {
			fetchScoresByIds: async () => {
				throw new Error('IGDB down');
			},
			fetchTimeToBeatByIds: async () => [],
		});
		expect(await isScoresRefreshFailed(db(), userId)).toBe(true);
		expect(await isScoresRefreshFailed(db(), second.id)).toBe(true);
	});

	it('scheduled entry: skips while fresh (once-per-window cadence)', async () => {
		let calls = 0;
		// A same-day stamp is fresh — the fetch must not fire at all.
		await setSetting(
			db(),
			userId,
			SCORES_REFRESHED_AT_SETTING_KEY,
			new Date().toISOString().slice(0, 10),
		);
		await runScheduledScoreRefresh(db(), {
			fetchScoresByIds: async () => {
				calls++;
				return [];
			},
			fetchTimeToBeatByIds: async () => [],
		});
		expect(calls).toBe(0);
	});

	it('scheduled entry: missing IGDB creds is a config gap, not a failure (no banner)', async () => {
		await setSetting(
			db(),
			userId,
			SCORES_REFRESHED_AT_SETTING_KEY,
			'2020-01-01',
		);
		// Clear any flag left by earlier rows in this file.
		await clearScoresRefreshFailed(db());
		await runScheduledScoreRefresh(db(), null);
		expect(await isScoresRefreshFailed(db(), userId)).toBe(false);
	});
});
