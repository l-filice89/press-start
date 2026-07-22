import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	insertGame,
	listCatalogProducts,
	listDeparturesForProducts,
	listLibraryForUser,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { runPsPlusCheck } from '../../src/services/psplus';
import {
	catalogPagePayload,
	EMPTY_CATALOG_PAYLOAD,
	productId,
} from '../fixtures/psn';
import { stubStore } from './psn-stub';
import { establishSession, TEST_EMAIL } from './session';

/**
 * Story 10.2 (VR-6), migrated to the Story 8.3 departure LEDGER: departures
 * are region-keyed `ps_plus_departure` rows — `left_on` stamped when the prune
 * removes a product, cleared (row kept) when it returns — and membership is a
 * per-region DERIVATION, never a game column. Two-run tests against the real
 * Worker + local D1 with the captured store payload shape. The named hazards,
 * red-then-green:
 *  - departure stamps `left_on` + membership derives false (present-before,
 *    absent-now);
 *  - a RETURNING product clears the stamp and never misreads as new (DW-13);
 *  - the degenerate empty-catalog response stamps NOTHING (wipe guard);
 *  - owned games carry the fact (shared region fact) — the UI hides it, not
 *    the write path (that gate is pinned in Card.test.tsx).
 */

const db = () => createDb(env.DB);
const REGION = 'it-it';
const scope = { region: REGION };

const stubCatalog = (names: string[]) =>
	stubStore(({ offset }) => ({
		body: catalogPagePayload(offset === 0 ? names : [], {
			totalCount: names.length,
			offset,
		}),
	}));

// Story 8.4: the POST route is gone — the membership pass is the service.
const check = () => runPsPlusCheck(db(), REGION);

// Departure stamps are a per-REGION shared fact and stamp in UTC (8.4) — not
// in any one user's zone.
const todayUTC = () => new Date().toISOString().slice(0, 10);

let userId: string;

async function seedGame(title: string, { owned = false } = {}) {
	const created = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
	});
	await upsertTracking(db(), userId, created.id, { owned });
	return created;
}

/** The derived library row (Story 8.3): membership + leaving via the region. */
const libRowOf = async (id: string) =>
	(
		await listLibraryForUser(db(), userId, {
			includeDiscarded: true,
			region: REGION,
		})
	).find((row) => row.id === id);

/** The ledger row for a fixture title's product, or undefined. */
const ledgerOf = async (name: string) =>
	(await listDeparturesForProducts(db(), scope, [productId(name)]))[0];

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, TEST_EMAIL));
	userId = row.id;
});

afterEach(() => vi.unstubAllGlobals());

describe('PS+ departure ledger (Story 10.2 semantics on the 8.3 ledger, two-run diff)', () => {
	it('stamps left_on on the ledger and membership derives false when a game leaves the catalog', async () => {
		const kept = await seedGame('Departure Kept');
		const leaver = await seedGame('Departure Leaver');

		// Run 1: both titles present — both derive as members, no stamps.
		stubCatalog(['Departure Kept', 'Departure Leaver']);
		expect((await check()).ok).toBe(true);
		expect((await libRowOf(leaver.id))?.psPlusExtra).toBe(true);
		expect((await ledgerOf('Departure Leaver'))?.leftOn ?? null).toBeNull();

		// Run 2: the leaver is gone. Present-before + absent-now = departed.
		vi.unstubAllGlobals();
		stubCatalog(['Departure Kept']);
		expect((await check()).ok).toBe(true);

		expect((await libRowOf(leaver.id))?.psPlusExtra).toBe(false);
		// The exact UTC date, not just any ISO string (8.4: per-region stamps
		// must not carry one user's zone).
		const stamped = await ledgerOf('Departure Leaver');
		expect(stamped?.leftOn).toBe(todayUTC());
		// A departed game's future "leaving" warning is moot (10.4 rule).
		expect(stamped?.leavingOn).toBeNull();
		// The stayer is untouched: still a member, no ledger stamp.
		expect((await libRowOf(kept.id))?.psPlusExtra).toBe(true);
		expect((await ledgerOf('Departure Kept'))?.leftOn ?? null).toBeNull();

		// Idempotency (review): a THIRD run with the leaver still absent leaves
		// the original stamp date intact — no re-stamp, no wipe.
		const firstStamp = stamped?.leftOn;
		vi.unstubAllGlobals();
		stubCatalog(['Departure Kept']);
		expect((await check()).ok).toBe(true);
		expect((await ledgerOf('Departure Leaver'))?.leftOn).toBe(firstStamp);
	});

	it('DW-13 HAZARD: a departed game that RETURNS re-derives membership and its stamp is NULLed — never a fresh departure', async () => {
		const boomerang = await seedGame('Departure Boomerang');

		stubCatalog(['Departure Boomerang']);
		await check();
		// Leaves — via a catalog that still has SOMETHING in it (an empty
		// result would fail closed at the wipe guard, covered below).
		vi.unstubAllGlobals();
		stubCatalog(['Departure Some Other Game']);
		await check();
		expect((await ledgerOf('Departure Boomerang'))?.leftOn).not.toBeNull();

		// …and returns (the prune deleted its catalog row meanwhile, so its
		// first_seen_at restamps — the warning must NOT key off that).
		vi.unstubAllGlobals();
		stubCatalog(['Departure Boomerang', 'Departure Some Other Game']);
		await check();

		expect((await libRowOf(boomerang.id))?.psPlusExtra).toBe(true);
		// The re-entry CLEARS the stamp; the ledger row may persist (DW-13 — the
		// sweep-owned fields survive), but left_on is null again.
		expect((await ledgerOf('Departure Boomerang'))?.leftOn ?? null).toBeNull();

		// Verify the DW-13 premise itself, not just the survival (review): the
		// returning title's catalog row is a fresh INSERT, so first_seen_at DID
		// restamp to this run's date — that's exactly why the warning must not
		// read it.
		const products = await listCatalogProducts(db(), scope);
		const returned = products.find((p) => p.name === 'Departure Boomerang');
		expect(returned?.firstSeenAt).toBe(todayUTC());
	});

	it('HAZARD (degenerate response): the empty-catalog wipe guard stamps NOTHING and the snapshot-derived membership survives', async () => {
		const flagged = await seedGame('Departure Guarded');
		// A real prior run makes it a member (the snapshot is the membership truth).
		stubCatalog(['Departure Guarded']);
		expect((await check()).ok).toBe(true);
		expect((await libRowOf(flagged.id))?.psPlusExtra).toBe(true);

		vi.unstubAllGlobals();
		stubStore(() => ({ body: EMPTY_CATALOG_PAYLOAD }));
		expect((await check()).ok).toBe(false); // fails closed

		// Membership survives (no prune) and no phantom departure was stamped.
		expect((await libRowOf(flagged.id))?.psPlusExtra).toBe(true);
		expect((await ledgerOf('Departure Guarded'))?.leftOn ?? null).toBeNull();
	});

	it('an OWNED game departing carries the fact too (shared region fact; display gating is the UI test)', async () => {
		const ownedGame = await seedGame('Departure Owned', { owned: true });

		stubCatalog(['Departure Owned']);
		await check();
		vi.unstubAllGlobals();
		stubCatalog(['Departure Anything Else']);
		await check();

		expect((await libRowOf(ownedGame.id))?.psPlusExtra).toBe(false);
		expect((await ledgerOf('Departure Owned'))?.leftOn).toMatch(
			/^\d{4}-\d{2}-\d{2}$/,
		);
	});
});
