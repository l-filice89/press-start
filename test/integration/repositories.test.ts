import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
	addExternalLink,
	findGameByExternalLink,
	findGamesByNormalizedTitle,
	getTracking,
	insertGame,
	insertStraggler,
	linkGameGenre,
	listExternalLinks,
	listGenresForGame,
	listStragglers,
	listTrackingForUser,
	upsertGenre,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';

/**
 * Story 1.4 integration tests (AR-4/15/16/17/18/19/20/22): the repository seam
 * against real workerd + local D1. Every scenario in the spec's I/O &
 * Edge-Case Matrix has a case here. `isolatedStorage` (pool default) forks each
 * test from the post-`beforeAll` baseline, so the seeded users are visible
 * everywhere while per-test writes don't leak across tests.
 */

const db = () => createDb(env.DB);

/** Seed a valid `user` row so FK-scoped tracking has a real owner (AD-13/17). */
async function seedUser(email: string) {
	const id = crypto.randomUUID();
	const now = new Date();
	await db().insert(user).values({
		id,
		name: email,
		email,
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
	return id;
}

let userA: string;
let userB: string;

describe('catalog + tracking repositories (integration, real workerd + local D1)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		userA = await seedUser('a@example.com');
		userB = await seedUser('b@example.com');
	});

	it('inserts a game with generated id and default flags', async () => {
		const row = await insertGame(db(), {
			title: 'Bloodborne',
			titleNormalized: 'bloodborne',
		});
		expect(row.id).toBeTruthy();
		expect(row.title).toBe('Bloodborne');
		expect(row.psPlusExtra).toBe(false);
		expect(row.unenriched).toBe(false);
	});

	it('lets two games share a normalized title — no uniqueness (AR-18)', async () => {
		await insertGame(db(), { title: 'Twin A', titleNormalized: 'shared-key' });
		await insertGame(db(), { title: 'Twin B', titleNormalized: 'shared-key' });
		const rows = await findGamesByNormalizedTitle(db(), 'shared-key');
		expect(rows).toHaveLength(2);
	});

	it('resolves both a PS4 and a PS5 link to one game (AD-20)', async () => {
		const game = await insertGame(db(), {
			title: 'Ghost of Tsushima',
			titleNormalized: 'ghost of tsushima',
		});
		await addExternalLink(db(), {
			gameId: game.id,
			source: 'PSN',
			externalId: 'ps4-got',
		});
		await addExternalLink(db(), {
			gameId: game.id,
			source: 'PSN',
			externalId: 'ps5-got',
		});

		expect((await findGameByExternalLink(db(), 'PSN', 'ps4-got'))?.id).toBe(
			game.id,
		);
		expect((await findGameByExternalLink(db(), 'PSN', 'ps5-got'))?.id).toBe(
			game.id,
		);
		expect(await listExternalLinks(db(), game.id)).toHaveLength(2);
	});

	it('returns undefined for an unknown external link', async () => {
		expect(await findGameByExternalLink(db(), 'IGDB', 'nope')).toBeUndefined();
	});

	it('rejects a duplicate (source, external_id) identity (AD-18/20)', async () => {
		const g1 = await insertGame(db(), { title: 'G1', titleNormalized: 'g1' });
		const g2 = await insertGame(db(), { title: 'G2', titleNormalized: 'g2' });
		await addExternalLink(db(), {
			gameId: g1.id,
			source: 'PSN',
			externalId: 'shared-id',
		});
		await expect(
			addExternalLink(db(), {
				gameId: g2.id,
				source: 'PSN',
				externalId: 'shared-id',
			}),
		).rejects.toThrow();
	});

	it('auto-creates a genre once, idempotently by name (FR-23)', async () => {
		const first = await upsertGenre(db(), 'Action');
		const second = await upsertGenre(db(), 'Action');
		expect(second.id).toBe(first.id);
	});

	it('links a game to a genre idempotently', async () => {
		const game = await insertGame(db(), {
			title: 'Hades',
			titleNormalized: 'hades',
		});
		const genre = await upsertGenre(db(), 'Roguelike');
		await linkGameGenre(db(), game.id, genre.id);
		await linkGameGenre(db(), game.id, genre.id);
		const genres = await listGenresForGame(db(), game.id);
		expect(genres).toHaveLength(1);
		expect(genres[0].name).toBe('Roguelike');
	});

	it('scopes tracking per user — two users, two rows (AD-13/17)', async () => {
		const game = await insertGame(db(), {
			title: 'Elden Ring',
			titleNormalized: 'elden ring',
		});
		await upsertTracking(db(), userA, game.id, { playStatus: 'Playing' });
		await upsertTracking(db(), userB, game.id, { playStatus: 'Paused' });

		expect((await getTracking(db(), userA, game.id))?.playStatus).toBe(
			'Playing',
		);
		expect((await getTracking(db(), userB, game.id))?.playStatus).toBe(
			'Paused',
		);
		const forA = await listTrackingForUser(db(), userA);
		expect(forA.some((row) => row.gameId === game.id)).toBe(true);
		expect(forA.every((row) => row.userId === userA)).toBe(true);
		// The scope must actively exclude user B's row for this same game.
		expect(forA.some((row) => row.userId === userB)).toBe(false);
	});

	it('narrow-SET merge does not clobber untouched columns', async () => {
		const game = await insertGame(db(), {
			title: 'Sekiro',
			titleNormalized: 'sekiro',
		});
		await upsertTracking(db(), userA, game.id, { playStatus: 'Playing' });
		// A later patch touching only ownership must leave play_status intact.
		await upsertTracking(db(), userA, game.id, {
			owned: true,
			ownershipType: 'physical',
		});

		const row = await getTracking(db(), userA, game.id);
		expect(row?.playStatus).toBe('Playing');
		expect(row?.owned).toBe(true);
		expect(row?.ownershipType).toBe('physical');
	});

	it('upsertTracking tolerates an all-undefined patch (no empty SET error)', async () => {
		const game = await insertGame(db(), {
			title: 'Nioh',
			titleNormalized: 'nioh',
		});
		await upsertTracking(db(), userA, game.id, { playStatus: 'Playing' });
		// All values undefined → must not build a degenerate SET; row untouched.
		const row = await upsertTracking(db(), userA, game.id, {
			playStatus: undefined,
		});
		expect(row?.playStatus).toBe('Playing');
	});

	it('re-upserts the same (user, game) in place — one row, updated', async () => {
		const game = await insertGame(db(), {
			title: 'Returnal',
			titleNormalized: 'returnal',
		});
		await upsertTracking(db(), userA, game.id, { playStatus: 'Playing' });
		await upsertTracking(db(), userA, game.id, { playStatus: 'Paused' });

		expect((await getTracking(db(), userA, game.id))?.playStatus).toBe(
			'Paused',
		);
		const rows = (await listTrackingForUser(db(), userA)).filter(
			(row) => row.gameId === game.id,
		);
		expect(rows).toHaveLength(1);
	});

	it('records and lists an import straggler (AD-22a)', async () => {
		await insertStraggler(db(), {
			sourceTitle: 'Some Unmatched Title',
			notionPayload: '{"Status":"Playing"}',
		});
		const stragglers = await listStragglers(db());
		expect(
			stragglers.some((s) => s.sourceTitle === 'Some Unmatched Title'),
		).toBe(true);
	});

	it('keeps title_normalized non-unique at the index level (AR-18)', async () => {
		const { results } = await env.DB.prepare("PRAGMA index_list('game')").all<{
			name: string;
			unique: number;
		}>();
		const idx = results.find((r) => r.name === 'game_title_normalized_idx');
		expect(idx).toBeDefined();
		expect(idx?.unique).toBe(0);
	});

	it('creates the six domain tables and no later-epic tables (entity-as-needed)', async () => {
		const { results } = await env.DB.prepare(
			`SELECT name FROM sqlite_master
			 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
			 ORDER BY name`,
		).all<{ name: string }>();
		const names = results.map((r) => r.name);
		for (const table of [
			'game',
			'game_tracking',
			'genre',
			'game_genre',
			'external_link',
			'import_straggler',
		]) {
			expect(names).toContain(table);
		}
		expect(names).not.toContain('setting');
	});
});
