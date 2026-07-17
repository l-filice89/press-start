import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	insertGame,
	listDeparturesForProducts,
	listLedgerForProducts,
	listLibraryForUser,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { psPlusDeparture, user } from '../../src/schema';
import { runScheduledPsPlusCheck } from '../../src/services/psplus';
import { runLeavingSweep } from '../../src/services/psplus-leaving';
import {
	getPsPlusLeavingState,
	getPsPlusSweepState,
	isPsPlusRefreshFailed,
	setPsPlusSweepState,
} from '../../src/services/settings';
import {
	catalogPagePayload,
	pricingPayload,
	productId,
	productPayload,
} from '../fixtures/psn';
import { type StoreCall, stubStore } from './psn-stub';
import { appFetch, establishSession, TEST_EMAIL } from './session';

/**
 * Story 10.4 (VR-6 rework): the leaving sweep — per-game departure dates from
 * the PS_PLUS offer `endTime`, chunked behind the membership pass. Real Worker
 * + local D1, store stubbed with the CAPTURED payload shapes. Named hazards,
 * red-then-green:
 *  - BOTH write directions (a date lands; a reprieve CLEARS a stale date);
 *  - concept ids cache (steady state pays ONE call per game, the budget claim);
 *  - a failed game keeps its stored date and the sweep STEPS PAST it;
 *  - a whole-chunk failure keeps the CURSOR (retry next fire), never a banner;
 *  - departure clears the leaving date in the SAME flag statement;
 *  - the scheduled rotation drives a leaving chunk once the genre sweep is done.
 */

const db = () => createDb(env.DB);

const CONCEPT_PREFIX = 'C-';
const conceptFor = (name: string) => CONCEPT_PREFIX + productId(name);

/**
 * One dispatching store double for the whole sweep surface: the catalog grid
 * (membership pass), the product→concept resolve, and the concept pricing.
 * `leavingByName` names each game's endTime (epoch-ms string) or null;
 * `failPricingFor` product names answer a GraphQL errors[] reply instead.
 */
function stubSweepStore(
	names: string[],
	leavingByName: Record<string, string | null>,
	{ failPricingFor = [] as string[] } = {},
): StoreCall[] {
	const failing = new Set(failPricingFor.map((name) => conceptFor(name)));
	return stubStore((call) => {
		if (call.operation === 'metGetProductById') {
			const name = names.find((n) => productId(n) === call.productId);
			return name
				? { body: productPayload(conceptFor(name)) }
				: { body: { errors: [{ message: 'not found' }] } };
		}
		if (call.operation === 'metGetPricingDataByConceptId') {
			if (!call.conceptId || failing.has(call.conceptId)) {
				return { body: { errors: [{ message: 'stub pricing refusal' }] } };
			}
			const name = names.find((n) => conceptFor(n) === call.conceptId);
			return {
				body: pricingPayload(name ? (leavingByName[name] ?? null) : null),
			};
		}
		return {
			body: catalogPagePayload(call.offset === 0 ? names : [], {
				totalCount: names.length,
				offset: call.offset,
			}),
		};
	});
}

const postCheck = (cookie: string) =>
	appFetch('/api/ps-plus-check', { method: 'POST', headers: { cookie } });

// 2026-07-21T08:00Z — Risk of Rain 2's captured endTime.
const END_JUL_21 = '1784620800000';

let cookie: string;
let userId: string;

async function seedGame(title: string, { owned = false } = {}) {
	const created = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
	});
	await upsertTracking(db(), userId, created.id, { owned });
	return created;
}

const REGION = 'it-it';
const scope = { region: REGION };

/** Derived library row (Story 8.3): membership + leaving via the region. */
const rowOf = async (id: string) =>
	(
		await listLibraryForUser(db(), userId, {
			includeDiscarded: true,
			region: REGION,
		})
	).find((row) => row.id === id);

/** The LEDGER's cached concept id for a fixture title (null when absent). */
const conceptOf = async (name: string) =>
	(await listLedgerForProducts(db(), scope, [productId(name)])).get(
		productId(name),
	)?.psnConceptId ?? null;

/** The ledger row (left_on/leaving_on) for a fixture title, or undefined. */
const ledgerOf = async (name: string) =>
	(await listDeparturesForProducts(db(), scope, [productId(name)]))[0];

/** Seed a stale leaving date on the LEDGER (Story 8.3 — dates live there). */
const seedLeavingDate = (name: string, leavingOn: string) =>
	db()
		.insert(psPlusDeparture)
		.values({
			region: REGION,
			productId: productId(name),
			npTitleId: null,
			titleNormalized: name.toLowerCase(),
			leavingOn,
		});

/** The rotation hands invocations to a pending GENRE sweep first — park it. */
async function markGenreSweepDone() {
	const state = await getPsPlusSweepState(db(), userId);
	if (state) await setPsPlusSweepState(db(), userId, { ...state, done: true });
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	cookie = await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, TEST_EMAIL));
	userId = row.id;
});

afterEach(() => vi.unstubAllGlobals());

describe('PS+ leaving sweep (Story 10.4)', () => {
	it('persists a leaving date, clears a stale one, and caches concept ids — BOTH directions, one chunk', async () => {
		const leaver = await seedGame('Sweep Leaver');
		const stayer = await seedGame('Sweep Stayer');
		// A stale date from a previous window (on the LEDGER, 8.3) — the reprieve
		// must CLEAR it.
		await seedLeavingDate('Sweep Stayer', '2026-06-30');

		const calls = stubSweepStore(['Sweep Leaver', 'Sweep Stayer'], {
			'Sweep Leaver': END_JUL_21,
			'Sweep Stayer': null,
		});
		expect((await postCheck(cookie)).status).toBe(200); // membership arms the sweep
		expect((await getPsPlusLeavingState(db(), userId))?.done).toBe(false);

		const outcome = await runLeavingSweep(db(), userId, env);
		expect(outcome).toMatchObject({
			ok: true,
			result: { swept: 2, failed: 0, done: true },
		});

		expect(await rowOf(leaver.id)).toMatchObject({
			psPlusExtra: true, // STILL in the catalog — that is the point
			psPlusLeavingOn: '2026-07-21',
		});
		expect(await rowOf(stayer.id)).toMatchObject({ psPlusLeavingOn: null });
		// Concept ids cache on the LEDGER now (8.3).
		expect(await conceptOf('Sweep Leaver')).toBe(conceptFor('Sweep Leaver'));
		expect(await conceptOf('Sweep Stayer')).toBe(conceptFor('Sweep Stayer'));

		// Steady state (budget claim): a SECOND sweep over cached concepts pays
		// ONE pricing call per game and ZERO product resolves.
		expect((await postCheck(cookie)).status).toBe(200); // re-arms
		const before = calls.length;
		expect((await runLeavingSweep(db(), userId, env)).ok).toBe(true);
		const secondSweep = calls.slice(before);
		expect(
			secondSweep.filter((c) => c.operation === 'metGetProductById'),
		).toHaveLength(0);
		expect(
			secondSweep.filter((c) => c.operation === 'metGetPricingDataByConceptId'),
		).toHaveLength(2);
	});

	it('a game whose pricing FAILS keeps its stored date and the sweep steps past it — no banner', async () => {
		const poison = await seedGame('Sweep Poison');
		const healthy = await seedGame('Sweep Healthy');
		await seedLeavingDate('Sweep Poison', '2026-07-01');

		stubSweepStore(
			['Sweep Poison', 'Sweep Healthy'],
			{ 'Sweep Poison': null, 'Sweep Healthy': END_JUL_21 },
			{ failPricingFor: ['Sweep Poison'] },
		);
		await postCheck(cookie);

		const outcome = await runLeavingSweep(db(), userId, env);
		expect(outcome).toMatchObject({
			ok: true,
			result: { failed: 1, done: true },
		});

		// Fail-closed: the stored date SURVIVES the refused reply.
		expect((await rowOf(poison.id))?.psPlusLeavingOn).toBe('2026-07-01');
		expect((await rowOf(healthy.id))?.psPlusLeavingOn).toBe('2026-07-21');
		expect(await isPsPlusRefreshFailed(db(), userId)).toBe(false);
	});

	it('a WHOLE-CHUNK failure retries ONCE, then steps past the poison chunk — never a livelock (review)', async () => {
		await seedGame('Sweep Outage A');
		await seedGame('Sweep Outage B');
		stubSweepStore(
			['Sweep Outage A', 'Sweep Outage B'],
			{},
			{ failPricingFor: ['Sweep Outage A', 'Sweep Outage B'] },
		);
		await postCheck(cookie);

		// First wholesale failure: cursor held, attempt recorded — an outage gets
		// exactly one retry.
		const first = await runLeavingSweep(db(), userId, env);
		expect(first).toMatchObject({ ok: false, reason: 'provider' });
		expect(await getPsPlusLeavingState(db(), userId)).toMatchObject({
			cursor: null,
			attempts: 1,
			done: false,
		});
		expect(await isPsPlusRefreshFailed(db(), userId)).toBe(false);

		// Second wholesale failure: poison, not outage — the cursor STEPS PAST so
		// the rotation (and the membership pass behind it) can never starve.
		const second = await runLeavingSweep(db(), userId, env);
		expect(second).toMatchObject({
			ok: true,
			result: { swept: 0, done: true },
		});
		expect((await getPsPlusLeavingState(db(), userId))?.done).toBe(true);
		// A stale cached concept id was dropped so the next re-arm re-resolves.
		expect(await conceptOf('Sweep Outage A')).toBeNull();
	});

	it('the scheduled rotation ENDS the invocation on a failed chunk — the membership pass never stacks on spent budget', async () => {
		await seedGame('Sweep Budget Guard');
		const calls = stubSweepStore(
			['Sweep Budget Guard'],
			{},
			{ failPricingFor: ['Sweep Budget Guard'] },
		);
		await postCheck(cookie);
		await markGenreSweepDone();

		const before = calls.length;
		await runScheduledPsPlusCheck(db(), {
			PSN_REGION: env.PSN_REGION,
		});
		const invocation = calls.slice(before);
		// The chunk fanned out (and failed) — and NO membership grid walk ran.
		expect(
			invocation.some((c) => c.operation === 'metGetPricingDataByConceptId'),
		).toBe(true);
		expect(
			invocation.filter((c) => c.operation === 'categoryGridRetrieve'),
		).toHaveLength(0);
	});

	it('DEPARTURE clears the leaving date in the same atomic flag statement (left_on stamps as shipped)', async () => {
		const departing = await seedGame('Sweep Departing');

		stubSweepStore(['Sweep Departing'], { 'Sweep Departing': END_JUL_21 });
		await postCheck(cookie);
		await runLeavingSweep(db(), userId, env);
		expect((await rowOf(departing.id))?.psPlusLeavingOn).toBe('2026-07-21');

		// Next window: the game is GONE from the catalog.
		vi.unstubAllGlobals();
		stubSweepStore(['Sweep Something Else'], {});
		await postCheck(cookie);

		const row = await rowOf(departing.id);
		expect(row?.psPlusExtra).toBe(false);
		expect(row?.psPlusLeavingOn).toBeNull(); // no future-dated warning on a departed game
		// 10.2 semantics live on the LEDGER now: departure stamps left_on there.
		const ledger = await ledgerOf('Sweep Departing');
		expect(ledger?.leftOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(ledger?.leavingOn).toBeNull();
	});

	it('the scheduled rotation drives ONE leaving chunk once the genre sweep is done', async () => {
		const scheduled = await seedGame('Sweep Scheduled');
		const calls = stubSweepStore(['Sweep Scheduled'], {
			'Sweep Scheduled': END_JUL_21,
		});
		await postCheck(cookie); // membership + arm
		await markGenreSweepDone();

		const membershipCalls = calls.length;
		await runScheduledPsPlusCheck(db(), {
			PSN_REGION: env.PSN_REGION,
		});

		// The invocation ran the LEAVING chunk, not another membership pass.
		const invocation = calls.slice(membershipCalls);
		expect(
			invocation.some((c) => c.operation === 'metGetPricingDataByConceptId'),
		).toBe(true);
		expect(
			invocation.filter((c) => c.operation === 'categoryGridRetrieve'),
		).toHaveLength(0);
		expect((await rowOf(scheduled.id))?.psPlusLeavingOn).toBe('2026-07-21');
		expect((await getPsPlusLeavingState(db(), userId))?.done).toBe(true);
	});

	it('a library past the chunk size converges over TWO sweeps — cursor advances, then done (budget)', async () => {
		const names = Array.from(
			{ length: 16 },
			(_, i) => `Sweep Bulk ${String(i).padStart(2, '0')}`,
		);
		for (const name of names) await seedGame(name);
		stubSweepStore(names, { [names[0]]: END_JUL_21 });
		await postCheck(cookie);

		const first = await runLeavingSweep(db(), userId, env);
		expect(first).toMatchObject({ ok: true, result: { done: false } });
		const mid = await getPsPlusLeavingState(db(), userId);
		expect(mid?.cursor).not.toBeNull();

		const second = await runLeavingSweep(db(), userId, env);
		expect(second).toMatchObject({ ok: true, result: { done: true } });
	}, 20000);

	it('an OWNED game gets the fact too (shared game fact; the FR-38 gate is the UI test)', async () => {
		const ownedGame = await seedGame('Sweep Owned', { owned: true });
		stubSweepStore(['Sweep Owned'], { 'Sweep Owned': END_JUL_21 });
		await postCheck(cookie);
		await runLeavingSweep(db(), userId, env);
		expect((await rowOf(ownedGame.id))?.psPlusLeavingOn).toBe('2026-07-21');
	});
});
