import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { appFetch, establishSession } from './session';

/**
 * Epic 11 story 11.1 hazard test — "credentialed routes no longer exist".
 * The three credentialed PSN operations (library sync, trophy sync, platinum
 * backfill) put the account's NPSSO credential on the wire and got the real
 * account locked (2026-07-15). They are severed, not disabled: an
 * AUTHENTICATED request must fall through the API router to a 404, proving
 * no handler — and no PSN call — can ever answer them again.
 */

let cookie: string;

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	cookie = await establishSession();
});

describe('severed credentialed PSN routes (Epic 11 story 11.1)', () => {
	for (const path of [
		'/api/sync',
		'/api/sync/trophies',
		'/api/backfill/platinum-dates',
	]) {
		it(`POST ${path} answers 404 — the route no longer exists`, async () => {
			const res = await appFetch(path, {
				method: 'POST',
				headers: { cookie },
			});
			expect(res.status).toBe(404);
		});
	}
});
