import { describe, expect, it, vi } from 'vitest';
import { createDb } from './db';
import {
	clearDeparturesForProducts,
	stampDepartures,
} from './psplus-departure';

/**
 * The departure-ledger write SHAPE (Story 7.1 regression, migrated to the
 * Story 8.3 ledger — `setPsPlusExtraFlags` is gone). D1 caps bound parameters
 * at 100 per statement, so a single `UPDATE … WHERE product_id IN (…)` over a
 * real catalog diff would throw `D1_ERROR: too many SQL variables`. Asserted
 * against a never-executed D1 stub: what matters is that no statement carries
 * more than 100 binds.
 */
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const scope = { region: 'it-it' };

describe('clearDeparturesForProducts', () => {
	it('chunks the product-id list under D1 100-bind cap (hazard: too many SQL variables)', async () => {
		const db = createDb({} as D1Database);
		const batch = vi.spyOn(db, 'batch').mockResolvedValue([] as never);

		await clearDeparturesForProducts(db, scope, ids(250));

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
		await clearDeparturesForProducts(db, scope, []);
		expect(batch).not.toHaveBeenCalled();
	});
});

describe('stampDepartures', () => {
	it('one statement per product, chunked under the per-batch ceiling, each under the bind cap', async () => {
		const db = createDb({} as D1Database);
		const batch = vi.spyOn(db, 'batch').mockResolvedValue([] as never);

		await stampDepartures(
			db,
			scope,
			ids(120).map((productId) => ({
				productId,
				npTitleId: null,
				titleNormalized: `title ${productId}`,
			})),
			'2026-07-17',
		);

		// 120 statements chunk at 90/batch (D1 per-batch ceiling) → two calls.
		expect(batch).toHaveBeenCalledTimes(2);
		const statements = batch.mock.calls.flatMap(
			(call) =>
				call[0] as unknown as readonly { toSQL(): { params: unknown[] } }[],
		);
		expect(statements).toHaveLength(120);
		for (const statement of statements) {
			expect(statement.toSQL().params.length).toBeLessThanOrEqual(100);
		}
	});

	it('issues no D1 call when nothing was pruned', async () => {
		const db = createDb({} as D1Database);
		const batch = vi.spyOn(db, 'batch');
		await stampDepartures(db, scope, [], '2026-07-17');
		expect(batch).not.toHaveBeenCalled();
	});
});
