import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import type { IgdbEnrichment, IgdbProvider } from '../../src/providers/igdb';
import {
	findGameByExternalLink,
	findGamesByNormalizedTitle,
	getTracking,
	listExternalLinks,
	listGenresForGame,
	listStragglers,
	listTrackingForUser,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { runSeedImport } from '../../src/services/seed-import';

/**
 * Story 1.6 seed-import integration tests: the `runSeedImport` apply path
 * against real workerd + local D1, with a FAKE `IgdbProvider` (the live IGDB
 * fetch + D1 HTTP write are out-of-band, hand-verified). Covers the spec's
 * I/O & Edge-Case Matrix rows that touch the database.
 */

const db = () => createDb(env.DB);

const USER_EMAIL = 'l.filice.89@gmail.com';

/** A fake IGDB provider driven by a title→enrichment map; missing = no match. */
function fakeIgdb(map: Record<string, IgdbEnrichment> = {}): IgdbProvider {
	return {
		async enrich(title) {
			return map[title] ?? null;
		},
	};
}

function csv(header: string[], rows: Record<string, string>[]): string {
	const cell = (v: string) =>
		/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
	const lines = [header.join(',')];
	for (const row of rows) {
		lines.push(header.map((h) => cell(row[h] ?? '')).join(','));
	}
	return lines.join('\n');
}

const PS_HEADER = [
	'name',
	'platform',
	'membership',
	'title_id',
	'image_url',
	'store_url',
];
const NOTION_HEADER = [
	'Title',
	'Date finished',
	'Date started',
	'Owned',
	'Status',
];

async function seedUser(email: string): Promise<string> {
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

let userId: string;

/** Narrow a repository lookup that must have succeeded in this scenario. */
function must<T>(value: T | undefined): T {
	if (value == null) throw new Error('expected a defined row');
	return value;
}

describe('runSeedImport (integration, real workerd + local D1)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		userId = await seedUser(USER_EMAIL);
	});

	it('excludes PS+ claims (counted), imports NONE rows as owned digital', async () => {
		const ps = csv(PS_HEADER, [
			{
				name: 'Owned One',
				platform: 'PS5',
				membership: 'NONE',
				title_id: 'OWN1',
				image_url: 'https://ps/1.png',
				store_url: 'https://ps/s1',
			},
			{
				name: 'Claimed One',
				platform: 'PS5',
				membership: 'PS_PLUS',
				title_id: 'CLM1',
			},
		]);
		const summary = await runSeedImport({
			db: db(),
			igdb: fakeIgdb({
				'Owned One': {
					coverUrl: null,
					releaseDate: '2020-01-01',
					genres: ['Action'],
				},
			}),
			psCsv: ps,
			notionCsv: csv(NOTION_HEADER, []),
			userEmail: USER_EMAIL,
		});
		expect(summary.skippedMembership).toBe(1);
		expect(summary.gamesCreated).toBe(1);

		const owned = await findGameByExternalLink(db(), 'PSN', 'OWN1');
		expect(owned?.title).toBe('Owned One');
		expect(owned?.coverUrl).toBe('https://ps/1.png'); // PS cover kept over IGDB null
		expect(await findGameByExternalLink(db(), 'PSN', 'CLM1')).toBeUndefined();

		const tracking = await getTracking(db(), userId, must(owned).id);
		expect(tracking?.owned).toBe(true);
		expect(tracking?.ownershipType).toBe('digital');
		expect(tracking?.playStatus).toBe('Not started');
	});

	it('collapses PS4+PS5 to one game with both title_ids linked', async () => {
		const ps = csv(PS_HEADER, [
			{
				name: 'Nine Sols',
				platform: 'PS4',
				membership: 'NONE',
				title_id: 'CUSA50688',
				image_url: '',
				store_url: '',
			},
			{
				name: 'Nine Sols',
				platform: 'PS5',
				membership: 'NONE',
				title_id: 'PPSA25414',
				image_url: 'https://ps/ns.png',
				store_url: 'https://ps/ns',
			},
		]);
		await runSeedImport({
			db: db(),
			igdb: fakeIgdb(),
			psCsv: ps,
			notionCsv: csv(NOTION_HEADER, []),
			userEmail: USER_EMAIL,
		});

		const rows = await findGamesByNormalizedTitle(db(), 'nine sols');
		expect(rows).toHaveLength(1);
		const links = await listExternalLinks(db(), rows[0].id);
		expect(links.map((l) => l.externalId).sort()).toEqual([
			'CUSA50688',
			'PPSA25414',
		]);
		expect(rows[0].unenriched).toBe(true); // IGDB returned nothing
	});

	it('maps a Notion Completed row to null status + completed_on and links IGDB genres', async () => {
		const notion = csv(NOTION_HEADER, [
			{
				Title: 'Alan Wake',
				'Date finished': 'November 5, 2024',
				'Date started': 'October 1, 2024',
				Owned: 'Yes',
				Status: 'Completed',
			},
		]);
		await runSeedImport({
			db: db(),
			igdb: fakeIgdb({
				'Alan Wake': {
					coverUrl: 'https://igdb/aw.jpg',
					releaseDate: '2010-05-14',
					genres: ['Adventure', 'Shooter'],
				},
			}),
			psCsv: csv(PS_HEADER, []),
			notionCsv: notion,
			userEmail: USER_EMAIL,
		});

		const [game] = await findGamesByNormalizedTitle(db(), 'alan wake');
		expect(game.coverUrl).toBe('https://igdb/aw.jpg');
		expect(game.releaseDate).toBe('2010-05-14');
		expect(
			(await listGenresForGame(db(), game.id)).map((g) => g.name).sort(),
		).toEqual(['Adventure', 'Shooter']);

		const tracking = await getTracking(db(), userId, game.id);
		expect(tracking?.playStatus).toBeNull();
		expect(tracking?.completedOn).toBe('2024-11-05');
		expect(tracking?.startedOn).toBe('2024-10-01');
		expect(tracking?.ownershipType).toBe('physical');
	});

	it('creates a Notion-only wishlist game when IGDB resolves (not owned)', async () => {
		const notion = csv(NOTION_HEADER, [
			{
				Title: 'Silksong',
				'Date finished': '',
				'Date started': '',
				Owned: 'No',
				Status: 'Up next!',
			},
		]);
		await runSeedImport({
			db: db(),
			igdb: fakeIgdb({
				Silksong: {
					coverUrl: 'https://igdb/ss.jpg',
					releaseDate: null,
					genres: ['Platform'],
				},
			}),
			psCsv: csv(PS_HEADER, []),
			notionCsv: notion,
			userEmail: USER_EMAIL,
		});
		const [game] = await findGamesByNormalizedTitle(db(), 'silksong');
		expect(game.unenriched).toBe(false);
		const tracking = await getTracking(db(), userId, game.id);
		expect(tracking?.owned).toBe(false);
		expect(tracking?.playStatus).toBe('Up next');
	});

	it('records a straggler (no game) for a Notion-only title IGDB cannot resolve', async () => {
		const notion = csv(NOTION_HEADER, [
			{
				Title: 'Obscure Homebrew',
				'Date finished': '',
				'Date started': '',
				Owned: 'No',
				Status: 'Not started',
			},
		]);
		const summary = await runSeedImport({
			db: db(),
			igdb: fakeIgdb(),
			psCsv: csv(PS_HEADER, []),
			notionCsv: notion,
			userEmail: USER_EMAIL,
		});
		expect(summary.stragglers).toBe(1);
		expect(
			await findGamesByNormalizedTitle(db(), 'obscure homebrew'),
		).toHaveLength(0);
		expect(
			(await listStragglers(db())).some(
				(s) => s.sourceTitle === 'Obscure Homebrew',
			),
		).toBe(true);
	});

	it('creates an unenriched, owned game for a PS title IGDB cannot resolve', async () => {
		const ps = csv(PS_HEADER, [
			{
				name: 'Rare PS Game',
				platform: 'PS5',
				membership: 'NONE',
				title_id: 'RARE1',
				image_url: 'https://ps/r.png',
				store_url: '',
			},
		]);
		const summary = await runSeedImport({
			db: db(),
			igdb: fakeIgdb(),
			psCsv: ps,
			notionCsv: csv(NOTION_HEADER, []),
			userEmail: USER_EMAIL,
		});
		expect(summary.unenriched).toBe(1);
		const game = await findGameByExternalLink(db(), 'PSN', 'RARE1');
		expect(game?.unenriched).toBe(true);
		expect(game?.coverUrl).toBe('https://ps/r.png');
		const tracking = await getTracking(db(), userId, must(game).id);
		expect(tracking?.owned).toBe(true);
		expect(tracking?.playStatus).toBe('Not started');
	});

	it('records a straggler for an unknown Notion status', async () => {
		const notion = csv(NOTION_HEADER, [
			{
				Title: 'Weird Status Game',
				'Date finished': '',
				'Date started': '',
				Owned: 'No',
				Status: 'Backlogged',
			},
		]);
		await runSeedImport({
			db: db(),
			igdb: fakeIgdb(),
			psCsv: csv(PS_HEADER, []),
			notionCsv: notion,
			userEmail: USER_EMAIL,
		});
		expect(
			(await listStragglers(db())).some(
				(s) => s.sourceTitle === 'Weird Status Game',
			),
		).toBe(true);
		expect(
			await findGamesByNormalizedTitle(db(), 'weird status game'),
		).toHaveLength(0);
	});

	it('is idempotent on re-run — no duplicate games, links, or genres', async () => {
		const ps = csv(PS_HEADER, [
			{
				name: 'Idem Game',
				platform: 'PS5',
				membership: 'NONE',
				title_id: 'IDEM1',
				image_url: '',
				store_url: '',
			},
		]);
		const notion = csv(NOTION_HEADER, [
			{
				Title: 'Idem Game',
				'Date finished': '',
				'Date started': '',
				Owned: 'Yes',
				Status: 'Playing',
			},
		]);
		const igdb = fakeIgdb({
			'Idem Game': {
				coverUrl: 'https://igdb/i.jpg',
				releaseDate: '2022-02-02',
				genres: ['RPG'],
			},
		});
		const args = {
			db: db(),
			igdb,
			psCsv: ps,
			notionCsv: notion,
			userEmail: USER_EMAIL,
		};

		const first = await runSeedImport(args);
		expect(first.gamesCreated).toBe(1);
		const second = await runSeedImport(args);
		expect(second.gamesCreated).toBe(0);
		expect(second.gamesExisting).toBe(1);

		const rows = await findGamesByNormalizedTitle(db(), 'idem game');
		expect(rows).toHaveLength(1);
		expect(await listExternalLinks(db(), rows[0].id)).toHaveLength(1);
		expect(await listGenresForGame(db(), rows[0].id)).toHaveLength(1);
		const forUser = (await listTrackingForUser(db(), userId)).filter(
			(r) => r.gameId === rows[0].id,
		);
		expect(forUser).toHaveLength(1);
		expect(forUser[0].playStatus).toBe('Playing');
	});

	it('is idempotent on re-run for a Notion-only game and a straggler (no external link)', async () => {
		// A wishlist game (no PS presence, IGDB resolves) and an unresolvable
		// straggler both lack an external link — the re-run must resolve them by
		// title, not recreate/re-record them.
		const notion = csv(NOTION_HEADER, [
			{
				Title: 'Wishlist Only',
				'Date finished': '',
				'Date started': '',
				Owned: 'No',
				Status: 'Up next!',
			},
			{
				Title: 'Unresolvable Only',
				'Date finished': '',
				'Date started': '',
				Owned: 'No',
				Status: 'Not started',
			},
		]);
		const args = {
			db: db(),
			igdb: fakeIgdb({
				'Wishlist Only': {
					coverUrl: 'https://igdb/wo.jpg',
					releaseDate: null,
					genres: ['Adventure'],
				},
			}),
			psCsv: csv(PS_HEADER, []),
			notionCsv: notion,
			userEmail: USER_EMAIL,
		};

		const first = await runSeedImport(args);
		expect(first.gamesCreated).toBe(1);
		expect(first.stragglers).toBe(1);
		const second = await runSeedImport(args);
		expect(second.gamesCreated).toBe(0);
		expect(second.gamesExisting).toBe(1);
		expect(second.stragglers).toBe(0);

		const games = await findGamesByNormalizedTitle(db(), 'wishlist only');
		expect(games).toHaveLength(1);
		expect(await listGenresForGame(db(), games[0].id)).toHaveLength(1);
		const tracked = (await listTrackingForUser(db(), userId)).filter(
			(r) => r.gameId === games[0].id,
		);
		expect(tracked).toHaveLength(1);
		expect(
			(await listStragglers(db())).filter(
				(s) => s.sourceTitle === 'Unresolvable Only',
			),
		).toHaveLength(1);
	});

	it('refuses to run when no user exists for the target email', async () => {
		await expect(
			runSeedImport({
				db: db(),
				igdb: fakeIgdb(),
				psCsv: csv(PS_HEADER, []),
				notionCsv: csv(NOTION_HEADER, []),
				userEmail: 'nobody@example.com',
			}),
		).rejects.toThrow(/sign in once/i);
	});
});
