import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	insertGame,
	listCatalogProducts,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { game, user } from '../../src/schema';
import { todayForUser } from '../../src/services/settings';
import { catalogPagePayload, EMPTY_CATALOG_PAYLOAD } from '../fixtures/psn';
import { stubStore } from './psn-stub';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

/**
 * Story 10.2 (VR-6): the departure diff — `ps_plus_left_on` stamped when the
 * flag pass clears a previously-flagged game, NULLed when the game returns.
 * Two-run tests against the real Worker + local D1 with the captured store
 * payload shape. The named hazards, red-then-green:
 *  - departure stamps + flag clears (present-before, absent-now);
 *  - a RETURNING game clears the stamp and never misreads as new (DW-13);
 *  - the degenerate empty-catalog response stamps NOTHING (wipe guard);
 *  - owned games carry the fact (shared game fact) — the UI hides it, not
 *    the write path (that gate is pinned in Card.test.tsx).
 */

const db = () => createDb(env.DB);

const stubCatalog = (names: string[]) =>
	stubStore(({ offset }) => ({
		body: catalogPagePayload(offset === 0 ? names : [], {
			totalCount: names.length,
			offset,
		}),
	}));

const postCheck = (cookie: string) =>
	appFetch('/api/ps-plus-check', { method: 'POST', headers: { cookie } });

let cookie: string;
let userId: string;

async function seedGame(
	title: string,
	{ owned = false, psPlusExtra = false } = {},
) {
	const created = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
		psPlusExtra,
	});
	await upsertTracking(db(), userId, created.id, { owned });
	return created;
}

const rowOf = async (id: string) => {
	const [row] = await db().select().from(game).where(eq(game.id, id));
	return row;
};

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	cookie = await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, ALLOWED_EMAIL));
	userId = row.id;
});

afterEach(() => vi.unstubAllGlobals());

describe('PS+ departure stamping (Story 10.2, two-run diff)', () => {
	it('stamps ps_plus_left_on and clears the flag when a flagged game leaves the catalog', async () => {
		const kept = await seedGame('Departure Kept');
		const leaver = await seedGame('Departure Leaver');

		// Run 1: both titles present — both flagged, no stamps.
		stubCatalog(['Departure Kept', 'Departure Leaver']);
		expect((await postCheck(cookie)).status).toBe(200);
		expect(await rowOf(leaver.id)).toMatchObject({
			psPlusExtra: true,
			psPlusLeftOn: null,
		});

		// Run 2: the leaver is gone. Present-before + absent-now = departed.
		vi.unstubAllGlobals();
		stubCatalog(['Departure Kept']);
		expect((await postCheck(cookie)).status).toBe(200);

		const departed = await rowOf(leaver.id);
		expect(departed.psPlusExtra).toBe(false);
		// The exact user-zone date, not just any ISO string — a UTC-vs-user-zone
		// regression must fail this (review).
		expect(departed.psPlusLeftOn).toBe(await todayForUser(db(), userId));
		// The stayer is untouched.
		expect(await rowOf(kept.id)).toMatchObject({
			psPlusExtra: true,
			psPlusLeftOn: null,
		});

		// Idempotency (review): a THIRD run with the leaver still absent leaves
		// the original stamp date intact — no re-stamp, no wipe.
		const firstStamp = departed.psPlusLeftOn;
		vi.unstubAllGlobals();
		stubCatalog(['Departure Kept']);
		expect((await postCheck(cookie)).status).toBe(200);
		expect((await rowOf(leaver.id)).psPlusLeftOn).toBe(firstStamp);
	});

	it('DW-13 HAZARD: a departed game that RETURNS is re-flagged and its stamp is NULLed — never a fresh departure', async () => {
		const boomerang = await seedGame('Departure Boomerang');

		stubCatalog(['Departure Boomerang']);
		await postCheck(cookie);
		// Leaves — via a catalog that still has SOMETHING in it (an empty
		// result would fail closed at the wipe guard, covered below).
		vi.unstubAllGlobals();
		stubCatalog(['Departure Some Other Game']);
		await postCheck(cookie);
		expect((await rowOf(boomerang.id)).psPlusLeftOn).not.toBeNull();

		// …and returns (the prune deleted its catalog row meanwhile, so its
		// first_seen_at restamps — the warning must NOT key off that).
		vi.unstubAllGlobals();
		stubCatalog(['Departure Boomerang', 'Departure Some Other Game']);
		await postCheck(cookie);

		expect(await rowOf(boomerang.id)).toMatchObject({
			psPlusExtra: true,
			psPlusLeftOn: null,
		});

		// Verify the DW-13 premise itself, not just the survival (review): the
		// returning title's catalog row is a fresh INSERT, so first_seen_at DID
		// restamp to this run's date — that's exactly why the warning must not
		// read it.
		const products = await listCatalogProducts(db(), { region: 'it-it' });
		const returned = products.find((p) => p.name === 'Departure Boomerang');
		expect(returned?.firstSeenAt).toBe(await todayForUser(db(), userId));
	});

	it('HAZARD (degenerate response): the empty-catalog wipe guard stamps NOTHING and existing stamps survive', async () => {
		const flagged = await seedGame('Departure Guarded', { psPlusExtra: true });

		stubStore(() => ({ body: EMPTY_CATALOG_PAYLOAD }));
		const res = await postCheck(cookie);
		expect(res.status).not.toBe(200); // fails closed

		expect(await rowOf(flagged.id)).toMatchObject({
			psPlusExtra: true, // flag survives
			psPlusLeftOn: null, // no phantom departure
		});
	});

	it('an OWNED game departing carries the fact too (shared game fact; display gating is the UI test)', async () => {
		const ownedGame = await seedGame('Departure Owned', { owned: true });

		stubCatalog(['Departure Owned']);
		await postCheck(cookie);
		vi.unstubAllGlobals();
		stubCatalog(['Departure Anything Else']);
		await postCheck(cookie);

		const row = await rowOf(ownedGame.id);
		expect(row.psPlusExtra).toBe(false);
		expect(row.psPlusLeftOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
