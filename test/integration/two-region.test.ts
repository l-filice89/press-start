import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
	insertGame,
	PS_PLUS_TIER,
	setLeavingOnLedger,
	setSetting,
	upsertCatalogProducts,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { getShelf } from '../../src/services';

/**
 * Story 8.3's core AC (B2+B3): two users in different regions tracking the
 * SAME game row each see membership/leaving per THEIR region — the two
 * answers coexist, and no write path can repaint the other's, because there
 * is no per-user flag write at all (membership is a per-request derivation
 * from the region's snapshot; dates derive from the region-keyed ledger).
 */

const db = () => createDb(env.DB);

async function seedUser(email: string, region: string) {
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
	await setSetting(db(), id, 'psn_region', region);
	return id;
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
});

describe('two-region coexistence (Story 8.3, B2+B3)', () => {
	it('the same game row answers per-region for two users, with per-region leaving dates', async () => {
		const userX = await seedUser('region-x@press-start.test', 'it-it');
		const userY = await seedUser('region-y@press-start.test', 'en-us');

		// ONE shared game row, tracked by both users.
		const shared = await insertGame(db(), {
			title: 'Border Crosser',
			titleNormalized: 'border crosser',
			releaseDate: '2020-01-01', // released — playableNow needs it (AD-8)
		});
		await upsertTracking(db(), userX, shared.id, { owned: false });
		await upsertTracking(db(), userY, shared.id, { owned: false });

		// The game is in it-it's catalog only.
		await upsertCatalogProducts(
			db(),
			{ region: 'it-it' },
			'gen-x',
			[
				{
					productId: 'PROD-IT',
					npTitleId: null,
					name: 'Border Crosser',
					titleNormalized: 'border crosser',
					coverUrl: null,
					platforms: ['PS5'],
					storeClassification: null,
					storeUrl: 'https://store.example/it',
				},
			],
			'2026-07-17',
		);
		// …and en-us has a snapshot too (non-empty region ≠ absent region), just
		// without this game.
		await upsertCatalogProducts(
			db(),
			{ region: 'en-us' },
			'gen-y',
			[
				{
					productId: 'PROD-US-OTHER',
					npTitleId: null,
					name: 'Something Else',
					titleNormalized: 'something else',
					coverUrl: null,
					platforms: ['PS5'],
					storeClassification: null,
					storeUrl: 'https://store.example/us',
				},
			],
			'2026-07-17',
		);
		// A leaving date exists only in it-it's ledger.
		await setLeavingOnLedger(db(), { region: 'it-it', tier: PS_PLUS_TIER }, [
			{
				productId: 'PROD-IT',
				npTitleId: null,
				titleNormalized: 'border crosser',
				leavingOn: '2099-01-31',
				psnConceptId: 'C-1',
			},
		]);

		const shelfX = await getShelf(db(), userX, true, 'it-it');
		const shelfY = await getShelf(db(), userY, true, 'en-us');
		const cardX = shelfX.find((g) => g.id === shared.id);
		const cardY = shelfY.find((g) => g.id === shared.id);

		// SAME game row, two coexisting answers — the B2 write-collision is
		// structurally impossible.
		expect(cardX).toMatchObject({
			psPlusExtra: true,
			psPlusLeavingOn: '2099-01-31',
			playableNow: true,
		});
		expect(cardY).toMatchObject({
			psPlusExtra: false,
			psPlusLeavingOn: null,
			playableNow: false,
		});

		// A region with NO snapshot at all derives honest absence.
		const shelfNone = await getShelf(db(), userX, true, 'de-de');
		expect(shelfNone.find((g) => g.id === shared.id)?.psPlusExtra).toBe(false);
		// …and a null region (no setting anywhere) too.
		const shelfNull = await getShelf(db(), userX, true, null);
		expect(shelfNull.find((g) => g.id === shared.id)?.psPlusExtra).toBe(false);
	});
});
