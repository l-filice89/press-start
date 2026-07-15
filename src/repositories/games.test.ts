import { describe, expect, it, vi } from 'vitest';
import { createDb } from './db';
import { setPsPlusExtraFlags } from './games';

/**
 * The flag write's SHAPE (Story 7.1 regression). D1 caps bound parameters at
 * 100 per statement, so a single `UPDATE … WHERE id IN (…)` over a real library
 * threw `D1_ERROR: too many SQL variables` — a 502 on the PS+ check for any user
 * with ~100+ games to flag or clear. Asserted against a never-executed D1 stub:
 * what matters is that no statement carries more than 99 ids.
 */
const ids = (n: number) => Array.from({ length: n }, (_, i) => `g${i}`);

describe('setPsPlusExtraFlags', () => {
	it('chunks the id list under D1 100-bind cap (hazard: too many SQL variables)', async () => {
		const db = createDb({} as D1Database);
		const batch = vi.spyOn(db, 'batch').mockResolvedValue([] as never);

		await setPsPlusExtraFlags(db, ids(250), false);

		expect(batch).toHaveBeenCalledTimes(1);
		const statements = batch.mock.calls[0][0] as unknown as readonly {
			toSQL(): { params: unknown[] };
		}[];
		expect(statements).toHaveLength(3);
		for (const statement of statements) {
			expect(statement.toSQL().params.length).toBeLessThanOrEqual(100);
		}
	});

	it('issues no D1 call when nothing matched', async () => {
		const db = createDb({} as D1Database);
		const batch = vi.spyOn(db, 'batch');
		await setPsPlusExtraFlags(db, [], true);
		expect(batch).not.toHaveBeenCalled();
	});
});
