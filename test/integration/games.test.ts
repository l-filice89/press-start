import { applyD1Migrations, env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { normalizeTitle } from '../../src/core';
import {
	addExternalLink,
	getTracking,
	insertGame,
	insertTrackingIfAbsent,
	listExternalLinks,
	listGenresForGame,
	setDiscarded,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { game, gameTracking, genre } from '../../src/schema/catalog';
import { previewAddGame } from '../../src/services';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

/**
 * Story 6.1 integration tests: the add-by-name write path through the real
 * Worker with a real session. The named hazard (FR-42/AR-9: saving must never
 * create a second `game` row for an already-tracked title — guarded by IGDB
 * external link, then the shared normalized-title key) is asserted on ROW
 * COUNTS, not just the 409 status. The IGDB preview is tested at the service
 * seam with fakes (no external calls in tests); POST /api/games itself never
 * calls IGDB — enrichment arrives in the body from the preview.
 */

const db = () => createDb(env.DB);

function postGame(body: unknown, cookie?: string) {
	return appFetch('/api/games', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify(body),
	});
}

async function gameRowsByNormalizedTitle(title: string) {
	return db()
		.select()
		.from(game)
		.where(eq(game.titleNormalized, normalizeTitle(title)));
}

let sessionCookie: string;
let sessionUser: string;

describe('add a game by name (Story 6.1, through the route)', () => {
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

	it('creates an enriched game with FR-43 wishlist defaults and auto-created genres', async () => {
		const res = await postGame(
			{
				title: 'Hades',
				igdbId: '1113',
				coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/x.jpg',
				releaseDate: '2020-09-17',
				genres: ['Roguelike', 'Action'],
			},
			sessionCookie,
		);
		expect(res.status).toBe(201);
		const { gameId } = (await res.json()) as { gameId: string };

		const [row] = await db().select().from(game).where(eq(game.id, gameId));
		expect(row.title).toBe('Hades');
		expect(row.unenriched).toBe(false);
		expect(row.releaseDate).toBe('2020-09-17');

		const links = await listExternalLinks(db(), gameId);
		expect(links).toEqual([
			expect.objectContaining({ source: 'IGDB', externalId: '1113' }),
		]);

		// FR-43: not owned = wishlisted (stamped), status Not started.
		const tracking = await getTracking(db(), sessionUser, gameId);
		expect(tracking).toMatchObject({
			owned: false,
			playStatus: 'Not started',
			boughtOn: null,
		});
		expect(tracking?.wishlistedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		// FR-24: unknown genres auto-created exactly once and linked.
		for (const name of ['Roguelike', 'Action']) {
			const rows = await db()
				.select()
				.from(genre)
				.where(sql`lower(${genre.name}) = lower(${name})`);
			expect(rows).toHaveLength(1);
		}
	});

	it('"Add as owned" stamps bought_on and owned_via purchase (FR-43)', async () => {
		const res = await postGame(
			{ title: 'Owned By Name', owned: true },
			sessionCookie,
		);
		expect(res.status).toBe(201);
		const { gameId } = (await res.json()) as { gameId: string };

		const tracking = await getTracking(db(), sessionUser, gameId);
		expect(tracking).toMatchObject({
			owned: true,
			ownershipType: 'digital',
			ownedVia: 'purchase',
			playStatus: 'Not started',
			wishlistedOn: null,
		});
		expect(tracking?.boughtOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('a name-only add (no igdbId) lands unenriched with no external link (NFR-4)', async () => {
		const res = await postGame({ title: 'Obscure Indie Gem' }, sessionCookie);
		expect(res.status).toBe(201);
		const { gameId } = (await res.json()) as { gameId: string };

		const [row] = await db().select().from(game).where(eq(game.id, gameId));
		expect(row.unenriched).toBe(true);
		expect(row.releaseDate).toBeNull();
		expect(await listExternalLinks(db(), gameId)).toEqual([]);
	});

	it('HAZARD FR-42/AR-9: re-adding by IGDB id answers 409 with the existing id — no second row', async () => {
		const first = await postGame(
			{ title: 'Celeste', igdbId: '26226' },
			sessionCookie,
		);
		expect(first.status).toBe(201);
		const { gameId } = (await first.json()) as { gameId: string };

		const again = await postGame(
			{ title: 'Celeste', igdbId: '26226' },
			sessionCookie,
		);
		expect(again.status).toBe(409);
		expect(await again.json()).toEqual({ error: 'duplicate', gameId });
		expect(await gameRowsByNormalizedTitle('Celeste')).toHaveLength(1);
	});

	it('HAZARD FR-42/AR-9: a glyph/edition variant of a tracked title answers 409 — no second row', async () => {
		const first = await postGame({ title: 'Heavy Rain' }, sessionCookie);
		expect(first.status).toBe(201);
		const { gameId } = (await first.json()) as { gameId: string };

		// Same normalized key: trademark glyph + edition suffix + case noise.
		const again = await postGame(
			{ title: 'HEAVY RAIN™ Remastered' },
			sessionCookie,
		);
		expect(again.status).toBe(409);
		expect(await again.json()).toEqual({ error: 'duplicate', gameId });
		expect(await gameRowsByNormalizedTitle('Heavy Rain')).toHaveLength(1);
	});

	it('an existing catalog game this user never tracked attaches tracking, no new row', async () => {
		// Simulate a shared-catalog game (e.g. from a prior sync) without tracking.
		const catalogGame = await insertGame(db(), {
			title: 'Shared Catalog Game',
			titleNormalized: normalizeTitle('Shared Catalog Game'),
			unenriched: true,
		});
		await addExternalLink(db(), {
			gameId: catalogGame.id,
			source: 'PSN',
			externalId: 'CUSA-SHARED',
		});

		const res = await postGame(
			{ title: 'Shared Catalog Game', igdbId: '424242' },
			sessionCookie,
		);
		expect(res.status).toBe(201);
		expect(((await res.json()) as { gameId: string }).gameId).toBe(
			catalogGame.id,
		);
		expect(await gameRowsByNormalizedTitle('Shared Catalog Game')).toHaveLength(
			1,
		);
		// The learned IGDB identity is anchored permanently (AD-20).
		const links = await listExternalLinks(db(), catalogGame.id);
		expect(links).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ source: 'IGDB', externalId: '424242' }),
			]),
		);
		expect(await getTracking(db(), sessionUser, catalogGame.id)).toMatchObject({
			owned: false,
			playStatus: 'Not started',
		});
	});

	it('DISAMBIGUATION (retro item 3): tracking dominates facts — revive the tombstone, never attach a 2nd tracked row', async () => {
		// Two rows share a normalized title (AD-18). The UNTRACKED row is inserted
		// first (lower rowid) AND its facts (title + release date) exactly match the
		// add input; the user's own row is a discarded tombstone whose facts DON'T
		// match. An additive score would tie (untracked facts=2 vs tombstone base=2)
		// and hand the pick to the DB-first untracked row — attaching a 2nd tracked
		// row and burying the tombstone (FR-42 breach). Tracking must dominate.
		const norm = normalizeTitle('Twin Titles');
		const untracked = await insertGame(db(), {
			title: 'Twin Titles',
			titleNormalized: norm,
			releaseDate: '2010-02-23',
			unenriched: true,
		});
		const mine = await insertGame(db(), {
			title: 'Twin Titles Deluxe',
			titleNormalized: norm,
			releaseDate: '2016-03-01',
			unenriched: true,
		});
		await insertTrackingIfAbsent(db(), sessionUser, mine.id, {
			owned: false,
			playStatus: 'Not started',
		});
		await setDiscarded(db(), sessionUser, mine.id, true);

		// Input facts match the untracked row exactly.
		const res = await postGame(
			{ title: 'Twin Titles', releaseDate: '2010-02-23' },
			sessionCookie,
		);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'duplicate', gameId: mine.id });

		// Tombstone revived; the facts-matching untracked row was never tracked.
		expect((await getTracking(db(), sessionUser, mine.id))?.discarded).toBe(
			false,
		);
		expect(await getTracking(db(), sessionUser, untracked.id)).toBeUndefined();
	});

	it('rejects blank/oversized/malformed bodies with 400, writing nothing', async () => {
		const before = await db()
			.select({ n: sql<number>`count(*)` })
			.from(gameTracking);

		for (const body of [
			{ title: '   ' },
			{ title: 'X'.repeat(201) },
			{ title: 'Bad Cover', coverUrl: 'javascript:alert(1)' },
			{ title: 'Bad Date', releaseDate: 'yesterday' },
			{},
			null,
		]) {
			const res = await postGame(body, sessionCookie);
			expect(res.status).toBe(400);
		}

		const after = await db()
			.select({ n: sql<number>`count(*)` })
			.from(gameTracking);
		expect(after[0].n).toBe(before[0].n);
	});

	it('rejects unauthenticated preview and create with 401 (requireAuth seam)', async () => {
		for (const res of [
			await postGame({ title: 'No Cookie' }),
			await appFetch('/api/games/preview?title=Hades'),
		]) {
			expect(res.status).toBe(401);
		}
	});

	it('GET /api/games/preview degrades to unavailable when IGDB creds are absent', async () => {
		const res = await appFetch('/api/games/preview?title=Hades', {
			headers: { cookie: sessionCookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ available: false, candidate: null });
	});
});

describe('rematch a game (PV-4, through the route)', () => {
	const postRematch = (gameId: string, body: unknown, cookie?: string) =>
		appFetch(`/api/games/${gameId}/rematch`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(cookie ? { cookie } : {}),
			},
			body: JSON.stringify(body),
		});

	const igdbIds = async (gameId: string) =>
		(await listExternalLinks(db(), gameId))
			.filter((l) => l.source === 'IGDB')
			.map((l) => l.externalId);

	const genreNames = async (gameId: string) =>
		(await listGenresForGame(db(), gameId)).map((g) => g.name);

	it('swaps the IGDB link, overwrites facts, and REPLACES genres (PV-1 correction)', async () => {
		// A wrong same-name match: the 2004 movie tie-in won over the real game.
		const created = await postGame(
			{ title: 'Spider-Man 2', igdbId: 'tie-in-2004', genres: ['Platform'] },
			sessionCookie,
		);
		expect(created.status).toBe(201);
		const { gameId } = (await created.json()) as { gameId: string };

		const res = await postRematch(
			gameId,
			{
				igdbId: 'insomniac-2023',
				name: "Marvel's Spider-Man 2",
				coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/n.jpg',
				releaseDate: '2023-10-20',
				genres: ['Adventure'],
			},
			sessionCookie,
		);
		expect(res.status).toBe(200);
		expect((await res.json()) as { gameId: string }).toEqual({ gameId });

		const [row] = await db().select().from(game).where(eq(game.id, gameId));
		expect(row.title).toBe("Marvel's Spider-Man 2");
		expect(row.titleNormalized).toBe(normalizeTitle("Marvel's Spider-Man 2"));
		expect(row.releaseDate).toBe('2023-10-20');
		expect(row.coverUrl).toContain('/n.jpg');
		expect(row.unenriched).toBe(false);

		// Old identity dropped, new one anchored (AD-20).
		expect(await igdbIds(gameId)).toEqual(['insomniac-2023']);
		// Genres REPLACED, not unioned — the wrong match's 'Platform' is gone.
		expect(await genreNames(gameId)).toEqual(['Adventure']);
		// Tracking is untouched by a rematch.
		expect(await getTracking(db(), sessionUser, gameId)).toMatchObject({
			playStatus: 'Not started',
		});
	});

	it('rematch to a genre-less candidate REPLACES genres with none (documented wipe)', async () => {
		const created = await postGame(
			{ title: 'Genre Wipe Target', igdbId: 'gw-1', genres: ['Action', 'RPG'] },
			sessionCookie,
		);
		const { gameId } = (await created.json()) as { gameId: string };
		expect(await genreNames(gameId)).toEqual(['Action', 'RPG']);

		// A correct match that happens to carry no genres — replace leaves none.
		const res = await postRematch(
			gameId,
			{ igdbId: 'gw-2', name: 'Genre Wipe Target' },
			sessionCookie,
		);
		expect(res.status).toBe(200);
		expect(await genreNames(gameId)).toEqual([]);
		expect(await igdbIds(gameId)).toEqual(['gw-2']);
	});

	it('CONFLICT: picking an IGDB id already on another game answers 409, writing nothing (AD-20)', async () => {
		const a = await postGame(
			{ title: 'Conflict Game A', igdbId: 'shared-999' },
			sessionCookie,
		);
		const b = await postGame(
			{ title: 'Conflict Game B', igdbId: 'own-888' },
			sessionCookie,
		);
		const aId = ((await a.json()) as { gameId: string }).gameId;
		const bId = ((await b.json()) as { gameId: string }).gameId;

		const res = await postRematch(bId, { igdbId: 'shared-999' }, sessionCookie);
		expect(res.status).toBe(409);

		// No writes: both games keep their original links.
		expect(await igdbIds(aId)).toEqual(['shared-999']);
		expect(await igdbIds(bId)).toEqual(['own-888']);
	});

	it('NOT-FOUND: rematching a game the user does not track answers 404', async () => {
		const res = await postRematch(
			'no-such-game',
			{ igdbId: 'whatever-1' },
			sessionCookie,
		);
		expect(res.status).toBe(404);
	});

	it('rejects an unauthenticated rematch with 401 (requireAuth seam)', async () => {
		const res = await postRematch('any-game', { igdbId: 'x' });
		expect(res.status).toBe(401);
	});

	it('rejects a malformed body with 400 (bad cover), writing nothing', async () => {
		const created = await postGame(
			{ title: 'Rematch Validation', igdbId: 'valid-111' },
			sessionCookie,
		);
		const { gameId } = (await created.json()) as { gameId: string };

		const res = await postRematch(
			gameId,
			{ igdbId: 'valid-222', coverUrl: 'javascript:alert(1)' },
			sessionCookie,
		);
		expect(res.status).toBe(400);
		// The original link stands.
		expect(await igdbIds(gameId)).toEqual(['valid-111']);
	});
});

describe('previewAddGame (service seam, fake IGDB)', () => {
	it('passes a candidate through when the provider answers', async () => {
		const candidate = {
			igdbId: '1',
			name: 'Hades',
			coverUrl: null,
			releaseDate: '2020-09-17',
			genres: ['Roguelike'],
		};
		expect(
			await previewAddGame({ searchCandidate: async () => candidate }, 'Hades'),
		).toEqual({ available: true, candidate });
	});

	it('degrades to unavailable when the provider throws (NFR-4: failures surface as fallback, not 5xx)', async () => {
		expect(
			await previewAddGame(
				{
					searchCandidate: async () => {
						throw new Error('IGDB down');
					},
				},
				'Hades',
			),
		).toEqual({ available: false, candidate: null });
	});

	it('is unavailable with no provider configured', async () => {
		expect(await previewAddGame(null, 'Hades')).toEqual({
			available: false,
			candidate: null,
		});
	});
});
