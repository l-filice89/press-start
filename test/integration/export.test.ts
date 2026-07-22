import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { normalizeTitle, parseCsv } from '../../src/core';
import {
	insertGame,
	insertTrackingIfAbsent,
	linkGameGenre,
	upsertCatalogProducts,
	upsertGenre,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { appFetch, establishSession, TEST_EMAIL } from './session';

/**
 * Story 6.3 CSV export: the whole library downloads as a user-held second copy.
 * Asserts the attachment headers and that every tracked game (with genres +
 * ownership) lands as a CSV row — parsed back with the app's own parseCsv.
 */

const db = () => createDb(env.DB);

// The region the export route resolves (`getPsnRegion` seeds the test env's
// PSN_REGION and persists it). Membership derives from this region's catalog.
const REGION = 'it-it';

/** Put a title in the region's PS+ catalog — the Story 8.3 way a tracked game
 * becomes a member (the flag column is gone; membership derives per region). */
async function seedCatalogRow(name: string) {
	await upsertCatalogProducts(
		db(),
		{ region: REGION },
		'gen-test',
		[
			{
				productId: `p-${normalizeTitle(name).replace(/\s+/g, '-')}`,
				npTitleId: null,
				name,
				titleNormalized: normalizeTitle(name),
				coverUrl: null,
				platforms: ['PS5'],
				storeClassification: null,
				storeUrl: 'https://store.example/x',
			},
		],
		'2026-07-17',
	);
}

let cookie: string;
let userId: string;

describe('CSV export (Story 6.3, through the route)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		cookie = await establishSession();
		const [row] = await db()
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, TEST_EMAIL))
			.limit(1);
		userId = row.id;
	});

	it('requires auth', async () => {
		expect((await appFetch('/api/export.csv')).status).toBe(401);
	});

	it('downloads the full library as a text/csv attachment with genres + ownership', async () => {
		const g = await insertGame(db(), {
			title: 'Warhammer 40,000: Boltgun',
			titleNormalized: normalizeTitle('Warhammer 40,000: Boltgun'),
			releaseDate: '2023-05-23',
		});
		await insertTrackingIfAbsent(db(), userId, g.id, {
			owned: true,
			ownershipType: 'digital',
			ownedVia: 'purchase',
			playStatus: 'Playing',
		});
		const genre = await upsertGenre(db(), 'Shooter');
		await linkGameGenre(db(), g.id, genre.id);

		const res = await appFetch('/api/export.csv', { headers: { cookie } });
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/csv');
		expect(res.headers.get('content-disposition')).toContain('attachment');

		const rows = parseCsv(await res.text());
		const row = rows.find((r) => r.Title === 'Warhammer 40,000: Boltgun');
		expect(row).toBeDefined();
		// Comma-bearing title survived RFC-4180 quoting; ownership + genres present.
		expect(row?.Owned).toBe('yes');
		expect(row?.['Acquired Via']).toBe('purchase');
		expect(row?.Genres).toBe('Shooter');
		expect(row?.['Release Date']).toBe('2023-05-23');
	});

	it('carries only the signed-in user’s games (AD-13)', async () => {
		const now = new Date();
		const [other] = await db()
			.insert(user)
			.values({
				id: crypto.randomUUID(),
				name: 'Someone Else',
				email: 'someone.else@example.com',
				createdAt: now,
				updatedAt: now,
			})
			.returning({ id: user.id });
		const g = await insertGame(db(), {
			title: 'Other User Only Game',
			titleNormalized: normalizeTitle('Other User Only Game'),
		});
		await insertTrackingIfAbsent(db(), other.id, g.id, { owned: true });

		const res = await appFetch('/api/export.csv', { headers: { cookie } });
		const rows = parseCsv(await res.text());
		expect(
			rows.find((r) => r.Title === 'Other User Only Game'),
		).toBeUndefined();
	});

	/**
	 * Story 7.1 flags OWNED catalog games too (`ps_plus_extra` is the stored fact
	 * "in the catalog", not the badge). Every surface renders `psPlusExtra &&
	 * !owned` — the export exported the RAW flag, so this column silently flipped
	 * to `yes` for every owned catalog game (review, H5).
	 */
	it('an OWNED catalog game exports PS+ Extra = no (the same derivation every surface renders)', async () => {
		const g = await insertGame(db(), {
			title: 'Owned And In The Catalog',
			titleNormalized: normalizeTitle('Owned And In The Catalog'),
		});
		await seedCatalogRow('Owned And In The Catalog');
		await insertTrackingIfAbsent(db(), userId, g.id, { owned: true });

		const rows = parseCsv(
			await (await appFetch('/api/export.csv', { headers: { cookie } })).text(),
		);
		const row = rows.find((r) => r.Title === 'Owned And In The Catalog');
		expect(row?.Owned).toBe('yes');
		expect(row?.['PS+ Extra']).toBe('no');
	});

	it('an UNOWNED catalog game still exports PS+ Extra = yes', async () => {
		const g = await insertGame(db(), {
			title: 'Claimable From The Catalog',
			titleNormalized: normalizeTitle('Claimable From The Catalog'),
		});
		await seedCatalogRow('Claimable From The Catalog');
		await insertTrackingIfAbsent(db(), userId, g.id, { owned: false });

		const rows = parseCsv(
			await (await appFetch('/api/export.csv', { headers: { cookie } })).text(),
		);
		expect(
			rows.find((r) => r.Title === 'Claimable From The Catalog')?.['PS+ Extra'],
		).toBe('yes');
	});

	it('neutralizes formula-leading cells so the backup is safe in Excel/Sheets', async () => {
		const g = await insertGame(db(), {
			title: '=cmd|/c calc!A0',
			titleNormalized: normalizeTitle('=cmd|/c calc!A0'),
		});
		await insertTrackingIfAbsent(db(), userId, g.id, { owned: true });

		const res = await appFetch('/api/export.csv', { headers: { cookie } });
		const rows = parseCsv(await res.text());
		// The leading '=' is apostrophe-prefixed — spreadsheets read it as text.
		expect(rows.find((r) => r.Title === "'=cmd|/c calc!A0")).toBeDefined();
		expect(rows.find((r) => r.Title === '=cmd|/c calc!A0')).toBeUndefined();
	});
});
