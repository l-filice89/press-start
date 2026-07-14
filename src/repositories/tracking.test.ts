import { describe, expect, it, vi } from 'vitest';
import { createDb } from './db';
import { setTrophyCountsBatch } from './tracking';

/**
 * The trophy write's COST (Story 9.2). D1 binding calls count against the
 * Workers subrequest limit (50 on the free tier), so a per-title UPDATE would
 * spend ~137 of them on a real account. The statements are built against a
 * never-executed D1 stub — `batch` is spied, so nothing touches a database;
 * what is asserted is how many CALLS the write costs.
 */

const counts = { bronze: 1, silver: 0, gold: 0, platinum: 0 };

const writes = (n: number) =>
	Array.from({ length: n }, (_, i) => ({
		gameId: `g${i}`,
		npCommId: `NPWR${i}`,
		npServiceName: 'trophy',
		earned: counts,
		defined: counts,
		syncedAt: '2026-07-13',
	}));

describe('setTrophyCountsBatch', () => {
	it('chunk-batches the writes: 137 titles cost 3 D1 calls, not 137 (hazard: the subrequest budget)', async () => {
		const db = createDb({} as D1Database);
		const batch = vi
			.spyOn(db, 'batch')
			.mockImplementation(
				async (statements: readonly unknown[]) =>
					statements.map((_, i) => [{ gameId: `g${i}` }]) as never,
			);

		const written = await setTrophyCountsBatch(db, 'user-1', writes(137));

		expect(batch).toHaveBeenCalledTimes(3);
		expect(
			batch.mock.calls.map((call) => (call[0] as readonly unknown[]).length),
		).toEqual([50, 50, 37]);
		expect(written.size).toBe(137);
	});

	it('reports only the statements that returned a row (hazard: a vanished tracking row updates nothing)', async () => {
		const db = createDb({} as D1Database);
		// Statement 1 (g1) matched no row — its tracking row is gone.
		vi.spyOn(db, 'batch').mockImplementation(
			async (statements: readonly unknown[]) =>
				statements.map((_, i) =>
					i === 1 ? [] : [{ gameId: `g${i}` }],
				) as never,
		);

		const written = await setTrophyCountsBatch(db, 'user-1', writes(3));

		expect([...written].sort()).toEqual(['g0', 'g2']);
	});

	it('issues no D1 call at all when nothing matched', async () => {
		const db = createDb({} as D1Database);
		const batch = vi.spyOn(db, 'batch');
		expect((await setTrophyCountsBatch(db, 'user-1', [])).size).toBe(0);
		expect(batch).not.toHaveBeenCalled();
	});
});
