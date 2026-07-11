import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { normalizeTitle } from '../../src/core';
import {
	getStragglerById,
	getTracking,
	insertGame,
	insertStraggler,
	insertTrackingIfAbsent,
	listExternalLinks,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { game } from '../../src/schema/catalog';
import { searchGamesForResolve } from '../../src/services';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

/**
 * Story 6.2 integration tests: the straggler-resolution write path through the
 * real Worker. The named hazard (FR-29/AR-9: a resolved match writes a PERMANENT
 * `external_link('IGDB', id)` so a later add/seed/sync never re-adds a duplicate)
 * is asserted red-then-green — after resolving, a fresh add-by-name carrying the
 * same igdbId returns the SAME game (409), never a second row. IGDB itself is
 * never called from the resolve POST (the client passes the chosen candidate);
 * the search seam is exercised with fakes.
 */

const db = () => createDb(env.DB);

function post(path: string, body: unknown, cookie?: string) {
	return appFetch(path, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify(body),
	});
}

async function gameById(id: string) {
	const [row] = await db().select().from(game).where(eq(game.id, id)).limit(1);
	return row;
}

let sessionCookie: string;
let sessionUser: string;

describe('straggler resolution (Story 6.2, through the route)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		sessionCookie = await establishSession();
		const [row] = await db()
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, ALLOWED_EMAIL))
			.limit(1);
		sessionUser = row.id;
	});

	it('lists both kinds: import staging rows and name-only unenriched games', async () => {
		await insertStraggler(db(), {
			sourceTitle: 'Import Straggler A',
			notionPayload: JSON.stringify({ Title: 'Import Straggler A' }),
		});
		const g = await insertGame(db(), {
			title: 'Name Only A',
			titleNormalized: normalizeTitle('Name Only A'),
			unenriched: true,
		});
		await insertTrackingIfAbsent(db(), sessionUser, g.id, {
			owned: false,
			playStatus: 'Not started',
			wishlistedOn: '2026-07-11',
		});

		const res = await appFetch('/api/stragglers', {
			headers: { cookie: sessionCookie },
		});
		expect(res.status).toBe(200);
		const { stragglers } = (await res.json()) as {
			stragglers: { id: string; kind: string; title: string }[];
		};
		expect(stragglers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'import',
					title: 'Import Straggler A',
				}),
				expect.objectContaining({
					kind: 'unenriched',
					id: g.id,
					title: 'Name Only A',
				}),
			]),
		);
	});

	it('resolves an import straggler: carries the Notion payload, links IGDB, deletes the staging row', async () => {
		const straggler = await insertStraggler(db(), {
			sourceTitle: 'Celeste',
			notionPayload: JSON.stringify({
				Title: 'Celeste',
				Status: 'Playing',
				Owned: 'Yes',
				'Date started': 'March 3, 2021',
			}),
		});

		const res = await post(
			'/api/stragglers/resolve',
			{
				id: straggler.id,
				kind: 'import',
				igdbId: 'igdb-celeste',
				name: 'Celeste',
				coverUrl: 'https://images.igdb.com/x.jpg',
				releaseDate: '2018-01-25',
				genres: ['Platformer'],
			},
			sessionCookie,
		);
		expect(res.status).toBe(200);
		const { gameId } = (await res.json()) as { gameId: string };

		// Notion payload carried onto tracking.
		const tracking = await getTracking(db(), sessionUser, gameId);
		expect(tracking).toMatchObject({
			owned: true,
			ownershipType: 'physical',
			playStatus: 'Playing',
			startedOn: '2021-03-03',
		});
		// Facts enriched, IGDB linked, staging row gone.
		expect((await gameById(gameId))?.unenriched).toBeFalsy();
		const links = await listExternalLinks(db(), gameId);
		expect(links).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ source: 'IGDB', externalId: 'igdb-celeste' }),
			]),
		);
		expect(await getStragglerById(db(), straggler.id)).toBeUndefined();

		// PERMANENT LINK (FR-29 hazard): a later add-by-name with the same igdbId
		// resolves to the SAME game — never a duplicate row.
		const dup = await post(
			'/api/games',
			{ title: 'Celeste', igdbId: 'igdb-celeste' },
			sessionCookie,
		);
		expect(dup.status).toBe(409);
		expect(((await dup.json()) as { gameId: string }).gameId).toBe(gameId);
	});

	it('resolves an unenriched game: attaches the link + facts, clears the flag, leaves tracking alone', async () => {
		const g = await insertGame(db(), {
			title: 'Name Only B',
			titleNormalized: normalizeTitle('Name Only B'),
			unenriched: true,
		});
		await insertTrackingIfAbsent(db(), sessionUser, g.id, {
			owned: false,
			playStatus: 'Not started',
			wishlistedOn: '2026-07-10',
		});

		const res = await post(
			'/api/stragglers/resolve',
			{
				id: g.id,
				kind: 'unenriched',
				igdbId: 'igdb-nameonly-b',
				coverUrl: 'https://images.igdb.com/b.jpg',
				releaseDate: '2019-06-01',
				genres: ['Adventure'],
			},
			sessionCookie,
		);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { gameId: string }).gameId).toBe(g.id);

		const row = await gameById(g.id);
		expect(row?.unenriched).toBeFalsy();
		expect(row?.coverUrl).toBe('https://images.igdb.com/b.jpg');
		expect(row?.releaseDate).toBe('2019-06-01');
		// Tracking the user already set is untouched.
		expect(await getTracking(db(), sessionUser, g.id)).toMatchObject({
			owned: false,
			wishlistedOn: '2026-07-10',
		});
	});

	it('resolving an import straggler onto an existing name-only game enriches + de-flags it (no orphan)', async () => {
		// A pre-existing name-only game the user already tracks…
		const g = await insertGame(db(), {
			title: 'Hollow Knight',
			titleNormalized: normalizeTitle('Hollow Knight'),
			unenriched: true,
		});
		await insertTrackingIfAbsent(db(), sessionUser, g.id, {
			owned: false,
			playStatus: 'Not started',
		});
		// …and an import straggler that resolves to the SAME title.
		const straggler = await insertStraggler(db(), {
			sourceTitle: 'Hollow Knight',
			notionPayload: JSON.stringify({
				Title: 'Hollow Knight',
				Status: 'Paused',
			}),
		});

		const res = await post(
			'/api/stragglers/resolve',
			{
				id: straggler.id,
				kind: 'import',
				igdbId: 'igdb-hk',
				name: 'Hollow Knight',
				coverUrl: 'https://images.igdb.com/hk.jpg',
				releaseDate: '2017-02-24',
				genres: ['Metroidvania'],
			},
			sessionCookie,
		);
		expect(res.status).toBe(200);
		const { gameId } = (await res.json()) as { gameId: string };
		// Matched the existing row, did not create a second one, and cleared the flag.
		expect(gameId).toBe(g.id);
		const row = await gameById(g.id);
		expect(row?.unenriched).toBeFalsy();
		expect(row?.coverUrl).toBe('https://images.igdb.com/hk.jpg');
		expect(await getStragglerById(db(), straggler.id)).toBeUndefined();
	});

	it('resolving an unenriched game corrects a name-only typo to the chosen match', async () => {
		const g = await insertGame(db(), {
			title: 'Caleste',
			titleNormalized: normalizeTitle('Caleste'),
			unenriched: true,
		});
		await insertTrackingIfAbsent(db(), sessionUser, g.id, {
			owned: false,
			playStatus: 'Not started',
		});

		const res = await post(
			'/api/stragglers/resolve',
			{
				id: g.id,
				kind: 'unenriched',
				igdbId: 'igdb-celeste-2',
				name: 'Celeste',
				releaseDate: '2018-01-25',
			},
			sessionCookie,
		);
		expect(res.status).toBe(200);
		expect((await gameById(g.id))?.title).toBe('Celeste');
	});

	it('rejects bad bodies (400), unknown stragglers (404), and unauthenticated calls (401)', async () => {
		const bad = await post(
			'/api/stragglers/resolve',
			{ id: 'x', kind: 'nope', igdbId: '' },
			sessionCookie,
		);
		expect(bad.status).toBe(400);

		const missing = await post(
			'/api/stragglers/resolve',
			{ id: 'does-not-exist', kind: 'import', igdbId: 'igdb-z' },
			sessionCookie,
		);
		expect(missing.status).toBe(404);

		const anon = await post('/api/stragglers/resolve', {
			id: 'x',
			kind: 'import',
			igdbId: 'y',
		});
		expect(anon.status).toBe(401);

		const anonList = await appFetch('/api/stragglers');
		expect(anonList.status).toBe(401);
	});

	it('search endpoint degrades to an empty list without IGDB creds (200, not 5xx)', async () => {
		const res = await appFetch('/api/games/search?title=Celeste', {
			headers: { cookie: sessionCookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ candidates: [] });
	});
});

describe('searchGamesForResolve (service seam, fake IGDB)', () => {
	const candidate = {
		igdbId: '1',
		name: 'Hades',
		coverUrl: null,
		releaseDate: '2020-09-17',
		genres: ['Roguelike'],
	};

	it('passes the provider candidates through', async () => {
		expect(
			await searchGamesForResolve(
				{ searchCandidates: async () => [candidate] },
				'Hades',
			),
		).toEqual([candidate]);
	});

	it('degrades to [] when the provider throws (NFR-4)', async () => {
		expect(
			await searchGamesForResolve(
				{
					searchCandidates: async () => {
						throw new Error('IGDB down');
					},
				},
				'Hades',
			),
		).toEqual([]);
	});

	it('returns [] when no provider is configured', async () => {
		expect(await searchGamesForResolve(null, 'Hades')).toEqual([]);
	});
});
