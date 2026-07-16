import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import type { IgdbScoreFetch, IgdbScores } from '../../src/providers';
import {
	addExternalLink,
	insertGame,
	setSetting,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { game } from '../../src/schema/catalog';
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
import { ALLOWED_EMAIL, establishSession } from './session';

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

const fakeFetch = (rows: IgdbScores[]): IgdbScoreFetch => ({
	fetchScoresByIds: async () => rows,
});

async function seedLinkedGame(title: string, igdbId: string) {
	const row = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
	});
	await addExternalLink(db(), {
		gameId: row.id,
		source: 'IGDB',
		externalId: igdbId,
	});
	return row.id;
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
			.where(eq(user.email, ALLOWED_EMAIL))
			.limit(1);
		userId = row.id;
	});

	it('persists fetched scores, stamps the date, and clears the failure flag', async () => {
		const gameId = await seedLinkedGame('Hades', '113112');
		await markScoresRefreshFailed(db(), userId);

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
		const gameId = await seedLinkedGame('Celeste', '26226');
		await runScoreRefresh(
			db(),
			userId,
			fakeFetch([{ igdbId: '26226', ...HADES_SCORES }]),
		);

		const outcome = await runScoreRefresh(db(), userId, fakeFetch([]));

		expect(outcome).toEqual({ ok: false, reason: 'provider' });
		// The write-nothing guarantee: yesterday's scores STAND.
		expect(await scoresOf(gameId)).toEqual(HADES_SCORES);
	});

	it('HAZARD (partial response): a game absent from the reply keeps its stored scores', async () => {
		const keptId = await seedLinkedGame('Kept Game', '900001');
		const freshId = await seedLinkedGame('Fresh Game', '900002');
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
			fakeFetch([{ igdbId: '900002', ...fresh }]),
		);

		expect(await scoresOf(keptId)).toEqual(HADES_SCORES); // untouched
		expect(await scoresOf(freshId)).toEqual(fresh); // updated, nulls included
	});

	it('scheduled entry: a provider throw persists the FR-40 failure flag', async () => {
		// Force staleness so the gate doesn't skip the run.
		await setSetting(
			db(),
			userId,
			SCORES_REFRESHED_AT_SETTING_KEY,
			'2020-01-01',
		);
		await runScheduledScoreRefresh(
			db(),
			{ AUTH_ALLOWED_EMAIL: ALLOWED_EMAIL },
			{
				fetchScoresByIds: async () => {
					throw new Error('IGDB down');
				},
			},
		);
		expect(await isScoresRefreshFailed(db(), userId)).toBe(true);
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
		await runScheduledScoreRefresh(
			db(),
			{ AUTH_ALLOWED_EMAIL: ALLOWED_EMAIL },
			{
				fetchScoresByIds: async () => {
					calls++;
					return [];
				},
			},
		);
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
		await clearScoresRefreshFailed(db(), userId);
		await runScheduledScoreRefresh(
			db(),
			{ AUTH_ALLOWED_EMAIL: ALLOWED_EMAIL },
			null,
		);
		expect(await isScoresRefreshFailed(db(), userId)).toBe(false);
	});
});
