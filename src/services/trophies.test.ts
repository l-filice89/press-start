import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PsnTrophyTitle } from '../providers';
import type { Db } from '../repositories/db';
import { runTrophySync } from './trophies';

/**
 * Trophy sync unit rows (Story 9.2), with the PSN adapter and the persistence
 * seam stubbed — what is under test is the MATCHING and the WRITE SHAPE. The
 * hazards: PSN lists the PS4 and PS5 trophy sets of one game as two entries
 * that collapse to the same key (writing both in PSN's arbitrary order would
 * overwrite a platinum with an abandoned run), the LIBRARY side must key on the
 * stored normalized title (never the " Trophies"-stripped one, or a game named
 * "X Trophies" collides with "X"), and the write must be BATCHED — a D1 call
 * per title would blow the Workers subrequest budget on a real account.
 */

const mocks = vi.hoisted(() => ({
	fetchTrophyTitles: vi.fn(),
	listLibraryForUser: vi.fn(),
	setTrophyCountsBatch: vi.fn(),
}));

vi.mock('../providers', async (importOriginal) => ({
	...(await importOriginal<typeof import('../providers')>()),
	createPsnProvider: () => ({ fetchTrophyTitles: mocks.fetchTrophyTitles }),
}));

vi.mock('../repositories', () => ({
	listLibraryForUser: mocks.listLibraryForUser,
	setTrophyCountsBatch: mocks.setTrophyCountsBatch,
}));

vi.mock('./settings', () => ({
	getPsnNpsso: async () => 'npsso',
	markPsnAuthExpired: async () => {},
	todayForUser: async () => '2026-07-13',
}));

const db = {} as Db;

const title = (
	name: string,
	earned: number,
	defined = 59,
	npCommId = 'NPWR00001_00',
): PsnTrophyTitle => ({
	npCommunicationId: npCommId,
	npServiceName: 'trophy2',
	trophyTitleName: name,
	trophyTitlePlatform: 'PS5',
	earnedTrophies: { bronze: earned, silver: 0, gold: 0, platinum: 0 },
	definedTrophies: { bronze: defined, silver: 0, gold: 0, platinum: 0 },
});

const libraryRow = (id: string, title: string, titleNormalized: string) =>
	({ id, title, titleNormalized }) as never;

/** All writes handed to the repository, flattened across every call. */
const writes = () =>
	mocks.setTrophyCountsBatch.mock.calls.flatMap((call) => call[2]);

async function run() {
	const outcome = await runTrophySync(db, 'user-1', {});
	if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
	return outcome.result;
}

beforeEach(() => {
	vi.clearAllMocks();
	// Default: every write persists.
	mocks.setTrophyCountsBatch.mockImplementation(
		async (_db, _userId, rows: { gameId: string }[]) =>
			new Set(rows.map((r) => r.gameId)),
	);
});

describe('runTrophySync', () => {
	it('collapses the PS4 + PS5 trophy sets of ONE game to the entry with the most EARNED trophies (hazard: PSN order would let a 3% PS4 run overwrite a 100% PS5 platinum)', async () => {
		mocks.listLibraryForUser.mockResolvedValue([
			libraryRow('g1', 'Hades', 'hades'),
		]);
		// The real two-entry shape: a plain PS5 title and a " Trophies"-suffixed
		// PS4 one, delivered PS4-first (PSN's order is arbitrary).
		mocks.fetchTrophyTitles.mockResolvedValue([
			title('Hades Trophies', 2, 49, 'NPWR17245_00'),
			title('Hades', 49, 49, 'NPWR20718_00'),
		]);

		const result = await run();

		expect(writes()).toEqual([
			{
				gameId: 'g1',
				npCommId: 'NPWR20718_00',
				// Persisted per title — 9.3's detail call 404s on the wrong one.
				npServiceName: 'trophy2',
				earned: { bronze: 49, silver: 0, gold: 0, platinum: 0 },
				defined: { bronze: 49, silver: 0, gold: 0, platinum: 0 },
				syncedAt: '2026-07-13',
			},
		]);
		// And the game is listed ONCE, not once per trophy set.
		expect(result.updated).toEqual(['Hades']);
		expect(result.needsAttention).toEqual([]);
	});

	it('keeps the winner whichever order PSN sends the two sets in', async () => {
		mocks.listLibraryForUser.mockResolvedValue([
			libraryRow('g1', 'Hades', 'hades'),
		]);
		mocks.fetchTrophyTitles.mockResolvedValue([
			title('Hades', 49, 49, 'NPWR20718_00'),
			title('Hades Trophies', 2, 49, 'NPWR17245_00'),
		]);

		await run();

		expect(writes()).toHaveLength(1);
		expect(writes()[0].earned.bronze).toBe(49);
	});

	it('keys the LIBRARY side on the STORED normalized title (hazard: stripping " Trophies" from library names makes a game called "Blood Trophies" collide with "Blood" — both then ambiguous, neither written)', async () => {
		mocks.listLibraryForUser.mockResolvedValue([
			libraryRow('g-blood', 'Blood', 'blood'),
			libraryRow('g-blood-trophies', 'Blood Trophies', 'blood trophies'),
		]);
		mocks.fetchTrophyTitles.mockResolvedValue([title('Blood Trophies', 3)]);

		const result = await run();

		// The PS4-suffixed trophy title joins the game named "Blood" — the library
		// game legitimately NAMED "Blood Trophies" is not a second candidate.
		expect(writes().map((w) => w.gameId)).toEqual(['g-blood']);
		expect(result.updated).toEqual(['Blood']);
		expect(result.needsAttention).toEqual([]);
	});

	it('BATCHES the writes: the D1 call count is bounded, not linear in matched titles (hazard: 137 sequential UPDATEs blow the 50-subrequest limit)', async () => {
		const library = Array.from({ length: 137 }, (_, i) =>
			libraryRow(`g${i}`, `Game ${i}`, `game ${i}`),
		);
		mocks.listLibraryForUser.mockResolvedValue(library);
		mocks.fetchTrophyTitles.mockResolvedValue(
			Array.from({ length: 137 }, (_, i) => title(`Game ${i}`, i)),
		);

		const result = await run();

		expect(result.updated).toHaveLength(137);
		expect(writes()).toHaveLength(137);
		// One repository call carrying every write — the chunking into D1 batches
		// happens inside it (see `repositories/tracking.test.ts`), never a call
		// per title.
		expect(mocks.setTrophyCountsBatch).toHaveBeenCalledTimes(1);
	});

	it('counts only what ACTUALLY persisted (hazard: a row deleted underneath the run updates nothing — the readout must not claim it)', async () => {
		mocks.listLibraryForUser.mockResolvedValue([
			libraryRow('g1', 'Astro Bot', 'astro bot'),
			libraryRow('g2', 'Tearaway', 'tearaway'),
		]);
		mocks.fetchTrophyTitles.mockResolvedValue([
			title('Astro Bot', 10),
			title('Tearaway', 20),
		]);
		// g2's row vanished between the read and the write.
		mocks.setTrophyCountsBatch.mockResolvedValue(new Set(['g1']));

		expect((await run()).updated).toEqual(['Astro Bot']);
	});

	it('skips a blank trophy title outright (hazard: an empty key can join nothing and would print an empty row in the unmatched list)', async () => {
		mocks.listLibraryForUser.mockResolvedValue([]);
		mocks.fetchTrophyTitles.mockResolvedValue([
			title('', 1),
			title('A Demo Nobody Owns', 1),
		]);

		const result = await run();

		expect(result.unmatched).toEqual(['A Demo Nobody Owns']);
		expect(writes()).toEqual([]);
	});
});
