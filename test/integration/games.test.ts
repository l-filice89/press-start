import { applyD1Migrations, env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { normalizeTitle } from '../../src/core';
import {
	addExternalLink,
	findCatalogProduct,
	getTracking,
	insertGame,
	insertTrackingIfAbsent,
	listExternalLinks,
	listGenresForGame,
	PS_PLUS_TIER,
	setDiscarded,
	upsertCatalogProducts,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { psPlusCatalog, user } from '../../src/schema';
import { game, gameTracking, genre } from '../../src/schema/catalog';
import { addGame, previewAddGame } from '../../src/services';
import { browseCatalog } from '../../src/services/psplus-browse';
import { appFetch, establishSession, TEST_EMAIL } from './session';

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
			.where(eq(user.email, TEST_EMAIL))
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

	it('persists candidate scores on an IGDB-anchored add, but REFUSES them on a name-only add (Story 10.1 anchor gate — the bypass path)', async () => {
		// Anchored: scores ride the candidate and persist.
		const anchored = await postGame(
			{
				title: 'Scored Anchored Add',
				igdbId: '910001',
				criticScore: 88.5,
				criticScoreCount: 12,
				userScore: 91.2,
				userScoreCount: 340,
			},
			sessionCookie,
		);
		expect(anchored.status).toBe(201);
		const anchoredId = ((await anchored.json()) as { gameId: string }).gameId;
		const [anchoredRow] = await db()
			.select()
			.from(game)
			.where(eq(game.id, anchoredId));
		expect(anchoredRow).toMatchObject({
			criticScore: 88.5,
			criticScoreCount: 12,
			userScore: 91.2,
			userScoreCount: 340,
		});

		// The bypass: a name-only add has NO IGDB identity, so the refresh could
		// never correct a fabricated value — the scores must not persist.
		const nameOnly = await postGame(
			{
				title: 'Fabricated Name Only',
				criticScore: 100,
				criticScoreCount: 999999,
			},
			sessionCookie,
		);
		expect(nameOnly.status).toBe(201);
		const nameOnlyId = ((await nameOnly.json()) as { gameId: string }).gameId;
		const [nameOnlyRow] = await db()
			.select()
			.from(game)
			.where(eq(game.id, nameOnlyId));
		expect(nameOnlyRow).toMatchObject({
			criticScore: null,
			criticScoreCount: null,
			userScore: null,
			userScoreCount: null,
		});
	});

	it('a count never persists without its score (orphan-count guard)', async () => {
		const res = await postGame(
			{
				title: 'Orphan Count Add',
				igdbId: '910002',
				criticScoreCount: 55,
				userScore: 70,
			},
			sessionCookie,
		);
		expect(res.status).toBe(201);
		const gameId = ((await res.json()) as { gameId: string }).gameId;
		const [row] = await db().select().from(game).where(eq(game.id, gameId));
		expect(row).toMatchObject({
			criticScore: null,
			criticScoreCount: null, // orphan dropped
			userScore: 70,
			userScoreCount: null,
		});
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

	it('scores: explicit nulls CLEAR the old match, but a payload with NO score fields PRESERVES them (Story 10.1)', async () => {
		const created = await postGame(
			{
				title: 'Score Preserve',
				igdbId: 'score-orig',
				criticScore: 80,
				criticScoreCount: 10,
				userScore: 85,
				userScoreCount: 100,
			},
			sessionCookie,
		);
		const { gameId } = (await created.json()) as { gameId: string };

		// An older/hand-rolled payload omitting the fields means "unknown" —
		// unknown must not erase data.
		const omit = await postRematch(
			gameId,
			{ igdbId: 'score-keep', name: 'Score Preserve' },
			sessionCookie,
		);
		expect(omit.status).toBe(200);
		let [row] = await db().select().from(game).where(eq(game.id, gameId));
		expect(row).toMatchObject({ criticScore: 80, userScore: 85 });

		// The real client always echoes the candidate: explicit nulls mean the
		// NEW pick is unscored, and the wrong game's numbers must not survive.
		const clear = await postRematch(
			gameId,
			{
				igdbId: 'score-clear',
				name: 'Score Preserve',
				criticScore: null,
				criticScoreCount: null,
				userScore: null,
				userScoreCount: null,
			},
			sessionCookie,
		);
		expect(clear.status).toBe(200);
		[row] = await db().select().from(game).where(eq(game.id, gameId));
		expect(row).toMatchObject({
			criticScore: null,
			criticScoreCount: null,
			userScore: null,
			userScoreCount: null,
		});
	});

	it('time-to-beat: an identity-changing rematch CLEARS stored hours, a same-id re-pick keeps them (Story 10.3, follow-up review)', async () => {
		// HAZARD: TTB arrives only via cron, so a rematch that leaves the old
		// match's hours standing keeps the WRONG game's figures forever — the
		// partial-reply rule never corrects an id absent from the TTB response.
		const created = await postGame(
			{ title: 'TTB Rematch', igdbId: 'ttb-orig' },
			sessionCookie,
		);
		const { gameId } = (await created.json()) as { gameId: string };
		await db()
			.update(game)
			.set({ ttbStorySeconds: 180000, ttbCompleteSeconds: 300000, ttbCount: 5 })
			.where(eq(game.id, gameId));

		// Same-id re-pick: still the right game — hours survive.
		const repick = await postRematch(
			gameId,
			{ igdbId: 'ttb-orig', name: 'TTB Rematch' },
			sessionCookie,
		);
		expect(repick.status).toBe(200);
		let [row] = await db().select().from(game).where(eq(game.id, gameId));
		expect(row).toMatchObject({ ttbStorySeconds: 180000, ttbCount: 5 });

		// New identity: the hours were the old match's — cleared, refilled by
		// the next cron pass.
		const swap = await postRematch(
			gameId,
			{ igdbId: 'ttb-new', name: 'TTB Rematch' },
			sessionCookie,
		);
		expect(swap.status).toBe(200);
		[row] = await db().select().from(game).where(eq(game.id, gameId));
		expect(row).toMatchObject({
			ttbStorySeconds: null,
			ttbCompleteSeconds: null,
			ttbCount: null,
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
			criticScore: null,
			criticScoreCount: null,
			userScore: null,
			userScoreCount: null,
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

/**
 * Story 7.3 — adding a game FROM THE CATALOG. The hazards are all identity
 * hazards (AD-20/AD-18/FR-42), so they are asserted on rows and links, not on
 * status codes alone:
 *  - the store `product_id` lands in its OWN namespace (`PSN_PRODUCT`), never in
 *    `PSN` (which is `np_title_id` only) — mixing them makes an already-synced
 *    game miss on link, match on title, and (AD-18's clash rule) become a
 *    MANDATORY duplicate;
 *  - a discarded game is revived, not duplicated;
 *  - the add writes the NOT-OWNED default: browsing the catalog is not claiming
 *    it, and the app never observes whether a PS Store claim succeeded;
 *  - a product pruned since the card rendered writes no dangling reference.
 */
describe('add a game FROM THE CATALOG (Story 7.3, AD-20)', () => {
	const REGION = 'it-it';
	const productScope = { region: REGION, tier: PS_PLUS_TIER };

	async function seedProduct(
		productId: string,
		name: string,
		npTitleId: string | null = null,
	) {
		await upsertCatalogProducts(
			db(),
			productScope,
			'gen-7-3',
			[
				{
					productId,
					npTitleId,
					name,
					titleNormalized: normalizeTitle(name),
					coverUrl: 'https://image.api.playstation.com/cover.png',
					platforms: ['PS5'],
					storeClassification: null,
					storeUrl: `https://store.playstation.com/${REGION}/product/${productId}`,
				},
			],
			'2026-07-14T00:00:00.000Z',
		);
	}

	const linksOf = async (gameId: string) =>
		(await listExternalLinks(db(), gameId)).map((l) => ({
			source: l.source,
			externalId: l.externalId,
		}));

	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		sessionCookie ??= await establishSession();
		const [row] = await db()
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, TEST_EMAIL))
			.limit(1);
		sessionUser = row.id;
	});

	it('writes the not-owned default + a PSN_PRODUCT link (never owned_via/bought_on)', async () => {
		await seedProduct('EP-CATALOG-ADD-1', 'Crow Country');
		const res = await postGame(
			{ title: 'Crow Country', psnProductId: 'EP-CATALOG-ADD-1' },
			sessionCookie,
		);
		expect(res.status).toBe(201);
		const { gameId } = (await res.json()) as { gameId: string };

		// Browsing is NOT claiming: wishlisted, Not started, no ownership at all.
		const tracking = await getTracking(db(), sessionUser, gameId);
		expect(tracking).toMatchObject({
			owned: false,
			playStatus: 'Not started',
			boughtOn: null,
			ownedVia: null,
			ownershipType: null,
		});
		expect(tracking?.wishlistedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		// AD-20: the product id is a PSN_PRODUCT id. It is NOT an np_title_id.
		expect(await linksOf(gameId)).toEqual([
			{ source: 'PSN_PRODUCT', externalId: 'EP-CATALOG-ADD-1' },
		]);

		// The store URL comes off the catalog row (the client never sends one).
		const [row] = await db().select().from(game).where(eq(game.id, gameId));
		expect(row.storeUrl).toBe(
			`https://store.playstation.com/${REGION}/product/EP-CATALOG-ADD-1`,
		);
	});

	it('HAZARD AD-20: an already-SYNCED game (PSN np_title_id linked) added from the catalog matches — no duplicate', async () => {
		// The exact construction the namespace exists to prevent: something
		// wrote EXTERNAL_LINK('PSN', np_title_id); the catalog knows a store
		// product_id. If the product id were written as source 'PSN', this add would
		// MISS on link, MATCH on normalized title, and AD-18 would force a 2nd row.
		const synced = await insertGame(db(), {
			title: 'Synced Shooter',
			titleNormalized: normalizeTitle('Synced Shooter'),
		});
		await addExternalLink(db(), {
			gameId: synced.id,
			source: 'PSN',
			externalId: 'CUSA12345_00',
		});
		await insertTrackingIfAbsent(db(), sessionUser, synced.id, {
			owned: true,
			playStatus: 'Not started',
		});
		await seedProduct('EP-SYNCED-1', 'Synced Shooter');

		const res = await postGame(
			{ title: 'Synced Shooter', psnProductId: 'EP-SYNCED-1' },
			sessionCookie,
		);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'duplicate', gameId: synced.id });
		expect(await gameRowsByNormalizedTitle('Synced Shooter')).toHaveLength(1);

		// Both ids coexist, each in its own namespace — and the product id is NOWHERE
		// under 'PSN'.
		const links = await linksOf(synced.id);
		expect(links).toEqual(
			expect.arrayContaining([
				{ source: 'PSN', externalId: 'CUSA12345_00' },
				{ source: 'PSN_PRODUCT', externalId: 'EP-SYNCED-1' },
			]),
		);
		expect(links).not.toContainEqual({
			source: 'PSN',
			externalId: 'EP-SYNCED-1',
		});
		// The add did not touch ownership either way.
		expect(await getTracking(db(), sessionUser, synced.id)).toMatchObject({
			owned: true,
		});
	});

	it('HAZARD: a DISCARDED game added from the catalog is REVIVED, never duplicated', async () => {
		const created = await postGame(
			{ title: 'Tombstoned Catalog Game' },
			sessionCookie,
		);
		expect(created.status).toBe(201);
		const { gameId } = (await created.json()) as { gameId: string };
		await setDiscarded(db(), sessionUser, gameId, true);

		await seedProduct('EP-REVIVE-1', 'Tombstoned Catalog Game');
		const res = await postGame(
			{ title: 'Tombstoned Catalog Game', psnProductId: 'EP-REVIVE-1' },
			sessionCookie,
		);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'duplicate', gameId });

		expect((await getTracking(db(), sessionUser, gameId))?.discarded).toBe(
			false,
		);
		expect(
			await gameRowsByNormalizedTitle('Tombstoned Catalog Game'),
		).toHaveLength(1);
		expect(await linksOf(gameId)).toContainEqual({
			source: 'PSN_PRODUCT',
			externalId: 'EP-REVIVE-1',
		});
	});

	it('a product PRUNED from the catalog since render adds on the title alone — no dangling reference', async () => {
		// Never seeded (or pruned by the cron between render and Save).
		const res = await postGame(
			{ title: 'Rotated Out Game', psnProductId: 'EP-GONE-1' },
			sessionCookie,
		);
		expect(res.status).toBe(201);
		const { gameId } = (await res.json()) as { gameId: string };

		expect(await linksOf(gameId)).toEqual([]);
		const [row] = await db().select().from(game).where(eq(game.id, gameId));
		expect(row.storeUrl).toBeNull();
	});

	// HAZARD (review, H1): the dialog offered "I own this game" on a CATALOG add,
	// and ticking it wrote owned_via:'purchase' + today's bought_on for a PS+ EXTRA
	// title — a purchase that never happened, on a date that means nothing. A PS+
	// title is owned ONLY via owned_via:'membership', and ONLY once a SYNC observes
	// the entitlement (Story 6.4). The server refuses it whatever the UI does.
	it('REFUSES owned:true on an add that carries a psnProductId (400, nothing written)', async () => {
		await seedProduct('EP-OWNED-REFUSE-1', 'Never Owned By Browsing');
		const res = await postGame(
			{
				title: 'Never Owned By Browsing',
				psnProductId: 'EP-OWNED-REFUSE-1',
				owned: true,
			},
			sessionCookie,
		);
		expect(res.status).toBe(400);
		expect(
			await gameRowsByNormalizedTitle('Never Owned By Browsing'),
		).toHaveLength(0);
	});

	// HAZARD (review, H2): the PSN_PRODUCT lookup used to be gated on the catalog
	// row still existing (`if (!existing && product)`), so a PRUNED product skipped
	// the link lookup entirely — and with the title since diverged (the add re-seeds
	// it from the IGDB candidate), the title lookup missed too and a SECOND game row
	// was inserted. The link is the IDENTITY; it does not expire with the snapshot.
	it('HAZARD AD-20: a PRUNED catalog row still resolves the PSN_PRODUCT link — a diverged title does NOT duplicate', async () => {
		await seedProduct('EP-PRUNED-ID-1', 'Ghost Runner');
		const first = await postGame(
			{ title: 'Ghost Runner', psnProductId: 'EP-PRUNED-ID-1' },
			sessionCookie,
		);
		expect(first.status).toBe(201);
		const { gameId } = (await first.json()) as { gameId: string };

		// The cron prunes the product…
		await db()
			.delete(psPlusCatalog)
			.where(eq(psPlusCatalog.productId, 'EP-PRUNED-ID-1'));
		expect(await findCatalogProduct(db(), 'EP-PRUNED-ID-1')).toBeUndefined();

		// …and the user re-adds from a stale card whose title no longer matches the
		// stored one (IGDB renamed it on the first save).
		const again = await postGame(
			{
				title: 'Ghostrunner: Complete Edition',
				psnProductId: 'EP-PRUNED-ID-1',
			},
			sessionCookie,
		);
		expect(again.status).toBe(409);
		expect(await again.json()).toEqual({ error: 'duplicate', gameId });
		expect(
			await gameRowsByNormalizedTitle('Ghostrunner: Complete Edition'),
		).toHaveLength(0);
	});

	// HAZARD (review, H4): the add threw the catalog row's np_title_id away,
	// leaving only the normalized title as the game's PSN identity. The id is
	// anchored in its own namespace now. (The sync-planner half of this pin went
	// with `listGamesWithPsnLinks` — Epic 11 story 11.2; the anchoring itself is
	// what future matching resolves through.)
	it('HAZARD: the catalog np_title_id is anchored as PSN, in its own namespace', async () => {
		await seedProduct('EP-NPTITLE-1', 'Stellar Blade', 'CUSA-STELLAR_00');
		const res = await postGame(
			{ title: 'Stellar Blade', psnProductId: 'EP-NPTITLE-1' },
			sessionCookie,
		);
		expect(res.status).toBe(201);
		const { gameId } = (await res.json()) as { gameId: string };

		// The np_title_id lives in 'PSN' — that IS its namespace (AD-20 forbids the
		// PRODUCT id there, not this) — and the product id in 'PSN_PRODUCT'.
		expect(await linksOf(gameId)).toEqual(
			expect.arrayContaining([
				{ source: 'PSN', externalId: 'CUSA-STELLAR_00' },
				{ source: 'PSN_PRODUCT', externalId: 'EP-NPTITLE-1' },
			]),
		);
	});

	// (review, M2): every EXISTING-game branch anchored the link but never wrote the
	// store URL — and `Claim now` keys off the store URL, so the claim path stayed
	// dead for exactly the games that were already on the shelf (seed import, a
	// name-only add, a sync with no store URL).
	it('BACKFILLS the store URL (and cover) onto an EXISTING game — the claim path is not dead for them', async () => {
		const existing = await insertGame(db(), {
			title: 'Name Only Game',
			titleNormalized: normalizeTitle('Name Only Game'),
			unenriched: true,
		});
		await insertTrackingIfAbsent(db(), sessionUser, existing.id, {
			owned: false,
			playStatus: 'Not started',
		});
		await seedProduct('EP-BACKFILL-1', 'Name Only Game');

		const res = await postGame(
			{ title: 'Name Only Game', psnProductId: 'EP-BACKFILL-1' },
			sessionCookie,
		);
		expect(res.status).toBe(409); // already tracked → routes to its detail

		const [row] = await db()
			.select()
			.from(game)
			.where(eq(game.id, existing.id));
		expect(row.storeUrl).toBe(
			`https://store.playstation.com/${REGION}/product/EP-BACKFILL-1`,
		);
		expect(row.coverUrl).toBe('https://image.api.playstation.com/cover.png');
		expect(await linksOf(existing.id)).toContainEqual({
			source: 'PSN_PRODUCT',
			externalId: 'EP-BACKFILL-1',
		});
	});

	// (review, M1): a product id already anchored on a DIFFERENT game was treated as
	// SUCCESS — the add reported created/duplicate for game A while the product
	// stayed anchored on game B, and NOTHING said so. Mirror rematchGame's posture:
	// never write, and surface the clash. The silence IS the defect, so the test
	// asserts on the signal as well as on the (unchanged) link rows.
	it('never re-anchors a product id that belongs to a DIFFERENT game — and SAYS so', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await seedProduct('EP-CLASH-1', 'Clash Product');
		const owner = await postGame(
			{ title: 'Clash Product', psnProductId: 'EP-CLASH-1' },
			sessionCookie,
		);
		const ownerId = ((await owner.json()) as { gameId: string }).gameId;

		// A DIFFERENT game (resolved by its IGDB id) carrying the same product id.
		const other = await postGame(
			{ title: 'Other Game', igdbId: 'igdb-clash-1' },
			sessionCookie,
		);
		const otherId = ((await other.json()) as { gameId: string }).gameId;

		const res = await postGame(
			{
				title: 'Other Game',
				igdbId: 'igdb-clash-1',
				psnProductId: 'EP-CLASH-1',
			},
			sessionCookie,
		);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'duplicate', gameId: otherId });

		// The link never moved, and no second one was written.
		expect(await linksOf(otherId)).not.toContainEqual({
			source: 'PSN_PRODUCT',
			externalId: 'EP-CLASH-1',
		});
		expect(await linksOf(ownerId)).toContainEqual({
			source: 'PSN_PRODUCT',
			externalId: 'EP-CLASH-1',
		});
		// …and the identity split did not happen in silence.
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(`PSN_PRODUCT EP-CLASH-1 already anchors game`),
		);
		warn.mockRestore();
	});

	// (review, M3): two POSTs with the same NEW product id both inserted a game row,
	// and the second anchor hit UNIQUE(source, external_id) → 500, leaving an
	// unlinked duplicate behind. The anchor is idempotent now and the loser
	// converges on the winner's game.
	it('two CONCURRENT adds of the same product converge on ONE game (no 500, no orphan)', async () => {
		await seedProduct('EP-RACE-1', 'Race Condition Game');
		const input = {
			title: 'Race Condition Game',
			psnProductId: 'EP-RACE-1',
		};
		const [a, b] = await Promise.all([
			addGame(db(), sessionUser, input, '2026-07-14'),
			addGame(db(), sessionUser, input, '2026-07-14'),
		]);
		expect(a).not.toBe('invalid');
		expect(b).not.toBe('invalid');
		const ids = [a, b].map((o) => (o as { gameId: string }).gameId);
		expect(ids[0]).toBe(ids[1]);
		expect(await gameRowsByNormalizedTitle('Race Condition Game')).toHaveLength(
			1,
		);
		expect(await linksOf(ids[0])).toContainEqual({
			source: 'PSN_PRODUCT',
			externalId: 'EP-RACE-1',
		});
	});

	/**
	 * HAZARD (Epic 7 cross-story review, H1) — the seam no per-story review could
	 * see. A game exists under PSN's own title ("…Ragnarök Edition") with an
	 * `EXTERNAL_LINK('PSN', np_title_id)`; the CATALOG carries the same
	 * np_title_id under the store's title ("…Valhalla"). The two do NOT
	 * normalize alike, so the add missed on the product link AND on the title,
	 * minted a second, un-owned row — and the grid then read that stub as
	 * `In library` for a game the user OWNS, forever. (The row shape here was
	 * historically written by the Epic 4 library sync, deleted in Epic 11; the
	 * catalog add itself anchors the same link, so the seam is still live.)
	 */
	it('HAZARD H1: a PSN-linked owned game whose stored title diverges is not duplicated by a catalog add — and its card reads Owned', async () => {
		const PSN_TITLE = 'Assassin’s Creed Valhalla Ragnarök Edition';
		const STORE_NAME = 'Assassin’s Creed Valhalla';
		const NP_TITLE_ID = 'PPSA01667_00';

		const synced = await insertGame(db(), {
			title: PSN_TITLE,
			titleNormalized: normalizeTitle(PSN_TITLE),
			unenriched: true,
		});
		await addExternalLink(db(), {
			gameId: synced.id,
			source: 'PSN',
			externalId: NP_TITLE_ID,
		});
		// The entitlement was OBSERVED: owned via membership (Story 6.4).
		await insertTrackingIfAbsent(db(), sessionUser, synced.id, {
			owned: true,
			ownershipType: 'digital',
			ownedVia: 'membership',
			playStatus: 'Not started',
		});
		// The REAL normalizer: the two titles are NOT the same key — that is the whole
		// premise of the defect, so it is asserted, not assumed.
		expect(normalizeTitle(PSN_TITLE)).not.toBe(normalizeTitle(STORE_NAME));

		await seedProduct('EP-H1-VALHALLA', STORE_NAME, NP_TITLE_ID);
		const res = await postGame(
			{ title: STORE_NAME, psnProductId: 'EP-H1-VALHALLA' },
			sessionCookie,
		);

		// It IS the synced game — no second row, ever.
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'duplicate', gameId: synced.id });
		expect(await gameRowsByNormalizedTitle(STORE_NAME)).toHaveLength(0);
		expect(await linksOf(synced.id)).toContainEqual({
			source: 'PSN_PRODUCT',
			externalId: 'EP-H1-VALHALLA',
		});

		// …and the card reads OWNED (not `In library`, not `＋ Add`).
		const page = await browseCatalog(
			db(),
			sessionUser,
			{ PSN_REGION: REGION },
			{ search: 'Valhalla' },
		);
		expect(
			page.games.find((row) => row.productId === 'EP-H1-VALHALLA'),
		).toMatchObject({ inLibrary: true, owned: true, gameId: synced.id });
	});

	it('re-adding the same product resolves to the same game (the PSN_PRODUCT link is the identity)', async () => {
		await seedProduct('EP-REPEAT-1', 'Repeat Product Game');
		const first = await postGame(
			{ title: 'Repeat Product Game', psnProductId: 'EP-REPEAT-1' },
			sessionCookie,
		);
		const { gameId } = (await first.json()) as { gameId: string };

		// Same product, a title the store since re-worded: the LINK still resolves it.
		const again = await postGame(
			{ title: 'Repeat Product Game: Deluxe Cut', psnProductId: 'EP-REPEAT-1' },
			sessionCookie,
		);
		expect(again.status).toBe(409);
		expect(await again.json()).toEqual({ error: 'duplicate', gameId });
	});
});
