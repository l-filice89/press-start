import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { normalizeTitle } from '../../src/core';
import {
	addExternalLink,
	deleteCatalogOutsideRegion,
	insertGame,
	setCatalogGenres,
	setSetting,
	upsertCatalogProducts,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { psPlusCatalog, psPlusCatalogGenre, user } from '../../src/schema';
import { PSN_REGION_SETTING_KEY } from '../../src/services/settings';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

/**
 * The catalog BROWSE read (Story 7.2 review) against the real Worker + local D1.
 * Every case here is a defect the reviewers found in the first cut:
 *
 *  M1 — paging duplicated and dropped rows: `compareTitle` is `sensitivity:
 *       'base'` (NieR == NIER, so not a total order) over a SQL query with no
 *       ORDER BY at all, and each page is a separate query + sort.
 *  M2 — SQLite `lower()` is ASCII-only, so "Pokémon" was UNFINDABLE in the
 *       catalog while the shelf's client-side search folded it fine.
 *  M4 — `genre` went straight from the query string into an `inArray()`: 1000
 *       repeats blew past SQLite's bind-variable ceiling (a 500, not a 400), and
 *       `?genre=` (empty) matched nothing and showed NO MATCH on a healthy snapshot.
 *  M6 — the facet counts never joined the snapshot, so a tag whose product is
 *       gone inflated the chip ("26") past what the filter renders ("24").
 *  M7 — the in-library join is keyed on the normalized title, and a title that
 *       normalizes to '' joined unrelated rows: a catalog product reading as
 *       Owned, linked to a WRONG gameId.
 *  L6 — the two sides of that join must normalize with the SAME function.
 */

const db = () => createDb(env.DB);
const REGION = 'it-it';
const scope = { region: REGION };
const GENERATION = 'gen-test';

let cookie: string;
let userId: string;

/** Seed catalog products the way the ingest does — `core/normalizeTitle` (L6). */
async function seedProducts(names: [productId: string, name: string][]) {
	await upsertCatalogProducts(
		db(),
		scope,
		GENERATION,
		names.map(([productId, name]) => ({
			productId,
			npTitleId: null,
			name,
			titleNormalized: normalizeTitle(name),
			coverUrl: null,
			platforms: ['PS5'],
			storeClassification: null,
			storeUrl: `https://store.playstation.com/${REGION}/product/${productId}`,
		})),
		'2026-07-01',
	);
}

type CatalogResponse = {
	total: number;
	snapshotTotal: number;
	nextCursor: number | null;
	generation: string | null;
	games: {
		productId: string;
		name: string;
		inLibrary: boolean;
		owned: boolean;
		gameId: string | null;
	}[];
};

async function browse(query = ''): Promise<CatalogResponse> {
	const response = await appFetch(`/api/ps-plus-catalog${query}`, {
		headers: { cookie },
	});
	expect(response.status).toBe(200);
	return response.json();
}

async function genres(): Promise<{ genres: { key: string; count: number }[] }> {
	const response = await appFetch('/api/ps-plus-catalog/genres', {
		headers: { cookie },
	});
	expect(response.status).toBe(200);
	return response.json();
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	cookie = await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, ALLOWED_EMAIL));
	userId = row.id;
	await setSetting(db(), userId, PSN_REGION_SETTING_KEY, REGION);
});

beforeEach(async () => {
	await db().delete(psPlusCatalogGenre);
	await db().delete(psPlusCatalog);
	await deleteCatalogOutsideRegion(db(), REGION);
});

describe('GET /api/ps-plus-catalog — ordering', () => {
	// HAZARD (M1): two base-equal titles straddling the 60-row page boundary. With
	// a comparator that calls them EQUAL and no SQL order behind it, D1's tie order
	// is unspecified: they can swap between the two page queries, so one row is
	// served twice and the other is never shown at all.
	it('pages a total order — base-equal titles never duplicate or vanish across the boundary', async () => {
		// 59 fillers sort before "N…", so the two NieRs land at offsets 59 and 60.
		const fillers: [string, string][] = Array.from({ length: 59 }, (_, i) => [
			`p-fill-${i}`,
			`Alpha ${String(i).padStart(2, '0')}`,
		]);
		await seedProducts([
			...fillers,
			['p-nier-b', 'NIER'],
			['p-nier-a', 'NieR'],
			['p-zulu', 'Zulu'],
		]);

		const first = await browse();
		const second = await browse('?cursor=60');
		const ids = [...first.games, ...second.games].map((g) => g.productId);

		expect(first.games).toHaveLength(60);
		expect(new Set(ids).size).toBe(ids.length); // no duplicate
		expect(ids).toHaveLength(62); // and nothing lost
		expect(ids).toContain('p-nier-a');
		expect(ids).toContain('p-nier-b');
		// Repeating the same page answers identically — the tiebreak is deterministic.
		expect((await browse('?cursor=60')).games.map((g) => g.productId)).toEqual(
			second.games.map((g) => g.productId),
		);
	});

	it('carries the snapshot generation on every page (the torn-paging signal)', async () => {
		await seedProducts([['p-a', 'Apex Arena']]);
		expect((await browse()).generation).toBe(GENERATION);
	});

	// The store sells a game's PS4 and PS5 editions as SEPARATE products, each with
	// its own product id and np_title_id — so the grid rendered the same game twice
	// (seen live: "A Space for the Unbound", CUSA39157 + PPSA12231), each card
	// offering its own ＋ Add, and adding one left its twin still saying ＋ Add.
	it('collapses a PS4/PS5 edition pair onto ONE card, preferring the PS5 SKU', async () => {
		await upsertCatalogProducts(
			db(),
			scope,
			GENERATION,
			[
				['p-ps4', 'CUSA39157_00', ['PS4']] as const,
				['p-ps5', 'PPSA12231_00', ['PS5']] as const,
			].map(([productId, npTitleId, platforms]) => ({
				productId,
				npTitleId,
				name: 'A Space for the Unbound',
				titleNormalized: normalizeTitle('A Space for the Unbound'),
				coverUrl: null,
				platforms: [...platforms],
				storeClassification: null,
				storeUrl: `https://store.playstation.com/${REGION}/product/${productId}`,
			})),
			'2026-07-01',
		);

		const page = await browse();

		expect(page.total).toBe(1);
		expect(page.games.map((g) => g.productId)).toEqual(['p-ps5']);
		// The snapshot still mirrors the store faithfully — only the VIEW collapses.
		expect(page.snapshotTotal).toBe(2);
	});

	// …and the collapse must NOT eat two DIFFERENT games that merely share a title
	// (NieR / NIER normalize alike; so would a remake carrying its original's name).
	// Disjoint platforms are what make a pair an edition pair — same platform, two
	// cards.
	it('keeps two same-title products on the SAME platform as two cards', async () => {
		await seedProducts([
			['p-one', 'Resident Evil 4'],
			['p-two', 'RESIDENT EVIL 4'],
		]);

		const page = await browse();

		expect(page.total).toBe(2);
		expect(page.games.map((g) => g.productId).sort()).toEqual([
			'p-one',
			'p-two',
		]);
	});
});

describe('GET /api/ps-plus-catalog — search', () => {
	// HAZARD (M2): `lower()` in SQLite is ASCII-only — "POKÉMON" lowercases to
	// "poké mon" with the É untouched, so the ASCII term never matched.
	it('finds a non-ASCII title (the shelf folds it; the catalog must too)', async () => {
		await seedProducts([
			['p-pkmn', 'Pokémon Legends: Arceus'],
			['p-okami', 'Ōkami HD'],
			['p-apex', 'Apex Arena'],
		]);

		expect((await browse('?q=pokemon')).games.map((g) => g.name)).toEqual([
			'Pokémon Legends: Arceus',
		]);
		expect((await browse('?q=okami')).games.map((g) => g.name)).toEqual([
			'Ōkami HD',
		]);
		// …and the accented spelling still finds it, folded the same way.
		expect((await browse('?q=Pokémon')).games.map((g) => g.name)).toEqual([
			'Pokémon Legends: Arceus',
		]);
	});
});

describe('GET /api/ps-plus-catalog — genre is user input at a trust boundary', () => {
	// HAZARD (M4): unbounded repeats went straight into an `inArray()`.
	it('refuses an over-long genre list with a 400 (never a 500 from SQLite)', async () => {
		await seedProducts([['p-a', 'Apex Arena']]);
		// 1000 DISTINCT keys — duplicates are deduped away, so this is the shape that
		// actually reached `inArray()` with 1000 bind variables.
		const query = Array.from({ length: 1000 }, (_, i) => `genre=KEY_${i}`).join(
			'&',
		);
		const response = await appFetch(`/api/ps-plus-catalog?${query}`, {
			headers: { cookie },
		});
		expect(response.status).toBe(400);
	});

	it('refuses an over-long genre KEY with a 400', async () => {
		const response = await appFetch(
			`/api/ps-plus-catalog?genre=${'A'.repeat(200)}`,
			{ headers: { cookie } },
		);
		expect(response.status).toBe(400);
	});

	// HAZARD (M4): `?genre=` produced `['']`, which passed the length check, matched
	// no tag row, and rendered NO MATCH over a perfectly healthy snapshot.
	it('an EMPTY ?genre= is no filter at all, not a filter that matches nothing', async () => {
		await seedProducts([
			['p-a', 'Apex Arena'],
			['p-c', 'Crow Country'],
		]);
		const page = await browse('?genre=');
		expect(page.total).toBe(2);
		expect(page.games).toHaveLength(2);
	});

	it('filters on the facet keys (OR within the group) and dedupes repeats', async () => {
		await seedProducts([
			['p-a', 'Apex Arena'],
			['p-c', 'Crow Country'],
			['p-z', 'Zephyr Quiet'],
		]);
		await setCatalogGenres(db(), scope, 'HORROR', ['p-c', 'p-z']);
		await setCatalogGenres(db(), scope, 'ACTION', ['p-a']);

		const page = await browse('?genre=HORROR&genre=HORROR');
		expect(page.games.map((g) => g.name)).toEqual([
			'Crow Country',
			'Zephyr Quiet',
		]);
	});
});

describe('GET /api/ps-plus-catalog/genres — facet counts', () => {
	// HAZARD (M6): the count read the tag table alone, so a tag whose product is no
	// longer in the snapshot inflated the chip past what the filter can render.
	it('counts only tags whose product is still IN the snapshot', async () => {
		await seedProducts([
			['p-c', 'Crow Country'],
			['p-z', 'Zephyr Quiet'],
		]);
		await setCatalogGenres(db(), scope, 'HORROR', ['p-c', 'p-z']);
		// The product leaves the catalog (a prune) — its tag row is left behind.
		await db().delete(psPlusCatalog).where(eq(psPlusCatalog.productId, 'p-z'));

		const horror = (await genres()).genres.find((g) => g.key === 'HORROR');
		const filtered = await browse('?genre=HORROR');
		// The chip and the grid agree — the whole point of the number.
		expect(horror?.count).toBe(filtered.total);
		expect(horror?.count).toBe(1);
	});
});

describe('GET /api/ps-plus-catalog — the in-library join', () => {
	// HAZARD (M7): "Remastered" IS an edition suffix, so the title normalizes to ''
	// — and with '' as a map key, every other ''-keyed row reads as In library /
	// Owned and links to a WRONG gameId.
	it('never joins on an EMPTY normalized title', async () => {
		const ghost = await insertGame(db(), {
			title: 'Remastered',
			titleNormalized: normalizeTitle('Remastered'),
		});
		expect(ghost.titleNormalized).toBe(''); // the premise of the hazard
		await upsertTracking(db(), userId, ghost.id, { owned: true });

		await seedProducts([
			['p-remaster', 'Remaster'],
			['p-apex', 'Apex Arena'],
		]);
		const page = await browse();
		for (const row of page.games) {
			expect(row.inLibrary).toBe(false);
			expect(row.owned).toBe(false);
			expect(row.gameId).toBeNull();
		}
	});

	// HAZARD (Story 7.3 review, H3 / M4): the marker joined on the normalized title
	// ALONE — but the add re-seeds the title from the IGDB candidate, so the stored
	// title routinely differs from the store's name, the keys diverge, and the card
	// of a game the user just added still read `＋ Add`. Forever: every re-add 409s
	// and bounces to the detail. The PSN_PRODUCT link 7.3 writes is the stable
	// identity, and the marker resolves through it FIRST. The e2e tier cannot see
	// this (no IGDB creds there, so the titles match by construction) — it lives here.
	it('marks a game In library through the PSN_PRODUCT LINK when the stored title DIVERGED from the catalog name', async () => {
		const added = await insertGame(db(), {
			// What IGDB called it on save — NOT what the store calls it.
			title: 'Ghostrunner: Complete Edition',
			titleNormalized: normalizeTitle('Ghostrunner: Complete Edition'),
		});
		await upsertTracking(db(), userId, added.id, { owned: false });
		await addExternalLink(db(), {
			gameId: added.id,
			source: 'PSN_PRODUCT',
			externalId: 'p-ghost',
		});
		await seedProducts([['p-ghost', 'Ghost Runner']]);

		const [row] = (await browse()).games;
		expect(row.inLibrary).toBe(true);
		expect(row.owned).toBe(false);
		expect(row.gameId).toBe(added.id);
	});

	// L6: the marker exists ONLY because both sides key on the same normalizer —
	// the library side (`services/games`, `insertGame` callers) and the catalog
	// side (`services/psplus`) both call `core/normalizeTitle`. A non-ASCII title
	// proves it end to end: a lookalike key (`toLowerCase()`) would not match here.
	it('marks a tracked non-ASCII game In library through the shared normalizer', async () => {
		// The library spells it WITHOUT the accent; the store spells it with one.
		// Only a shared, diacritic-folding normalizer makes the two the same key.
		const tracked = await insertGame(db(), {
			title: 'Pokemon Legends: Arceus',
			titleNormalized: normalizeTitle('Pokemon Legends: Arceus'),
		});
		await upsertTracking(db(), userId, tracked.id, { owned: false });
		await seedProducts([['p-pkmn', 'Pokémon Legends: Arceus']]);

		const [row] = (await browse()).games;
		expect(row.inLibrary).toBe(true);
		expect(row.owned).toBe(false);
		expect(row.gameId).toBe(tracked.id);
	});
});
