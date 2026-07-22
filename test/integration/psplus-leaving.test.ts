import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	addExternalLink,
	getRegionState,
	insertGame,
	listDeparturesForProducts,
	listLedgerForProducts,
	listLibraryForUser,
	setSetting,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { psPlusDeparture, user } from '../../src/schema';
import {
	runPsPlusCheck,
	runScheduledPsPlusCheck,
} from '../../src/services/psplus';
import { runLeavingSweep } from '../../src/services/psplus-leaving';
import {
	getPsPlusLeavingState,
	getPsPlusSweepState,
	PSN_REGION_SETTING_KEY,
	setPsPlusSweepState,
} from '../../src/services/settings';
import {
	catalogPagePayload,
	pricingPayload,
	productId,
	productPayload,
} from '../fixtures/psn';
import { type StoreCall, stubStore } from './psn-stub';
import { establishSession, TEST_EMAIL } from './session';

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

// Story 8.4: the POST route is gone — the membership pass is the service.
const check = () => runPsPlusCheck(db(), REGION);

// 2026-07-21T08:00Z — Risk of Rain 2's captured endTime.
const END_JUL_21 = '1784620800000';

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
	const state = await getPsPlusSweepState(db(), REGION);
	if (state) await setPsPlusSweepState(db(), REGION, { ...state, done: true });
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, TEST_EMAIL));
	userId = row.id;
	// Story 8.4: the leaving sweep's target list is the region's tracked games
	// — games tracked by users whose psn_region SETTING equals the region.
	await setSetting(db(), userId, PSN_REGION_SETTING_KEY, REGION);
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
		expect((await check()).ok).toBe(true); // membership arms the sweep
		expect((await getPsPlusLeavingState(db(), REGION))?.done).toBe(false);

		const outcome = await runLeavingSweep(db(), REGION);
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
		expect((await check()).ok).toBe(true); // re-arms
		const before = calls.length;
		expect((await runLeavingSweep(db(), REGION)).ok).toBe(true);
		const secondSweep = calls.slice(before);
		expect(
			secondSweep.filter((c) => c.operation === 'metGetProductById'),
		).toHaveLength(0);
		expect(
			secondSweep.filter((c) => c.operation === 'metGetPricingDataByConceptId'),
		).toHaveLength(2);
	});

	it('a catalog-added game (PSN_PRODUCT link, IGDB-retitled) gets its date through the LINK leg (deferred-work 2026-07-19)', async () => {
		// The add path re-seeds the title from the IGDB candidate, so the stored
		// title routinely differs from the store's name — a title-only join
		// skipped exactly these games and their leaving date could never
		// populate. The sweep must resolve products through the same three legs
		// as the 8.3 membership derivation.
		const retitled = await seedGame('Totally Different IGDB Name');
		await addExternalLink(db(), {
			gameId: retitled.id,
			source: 'PSN_PRODUCT',
			externalId: productId('Sweep Linked'),
		});

		stubSweepStore(['Sweep Linked'], { 'Sweep Linked': END_JUL_21 });
		expect((await check()).ok).toBe(true); // membership arms the sweep

		const outcome = await runLeavingSweep(db(), REGION);
		expect(outcome.ok).toBe(true);

		expect(await rowOf(retitled.id)).toMatchObject({
			psPlusExtra: true, // membership already worked via the link leg (8.3)
			psPlusLeavingOn: '2026-07-21', // …and now the date does too
		});
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
		await check();

		const outcome = await runLeavingSweep(db(), REGION);
		expect(outcome).toMatchObject({
			ok: true,
			result: { failed: 1, done: true },
		});

		// Fail-closed: the stored date SURVIVES the refused reply.
		expect((await rowOf(poison.id))?.psPlusLeavingOn).toBe('2026-07-01');
		expect((await rowOf(healthy.id))?.psPlusLeavingOn).toBe('2026-07-21');
		// Banner died (8.4): a sweep failure records NOTHING on the region ledger.
		expect((await getRegionState(db(), REGION))?.failureCount ?? 0).toBe(0);
	});

	it('a WHOLE-CHUNK failure retries ONCE, then steps past the poison chunk — never a livelock (review)', async () => {
		await seedGame('Sweep Outage A');
		await seedGame('Sweep Outage B');
		stubSweepStore(
			['Sweep Outage A', 'Sweep Outage B'],
			{},
			{ failPricingFor: ['Sweep Outage A', 'Sweep Outage B'] },
		);
		await check();

		// First wholesale failure: cursor held, attempt recorded — an outage gets
		// exactly one retry.
		const first = await runLeavingSweep(db(), REGION);
		expect(first).toMatchObject({ ok: false, reason: 'provider' });
		expect(await getPsPlusLeavingState(db(), REGION)).toMatchObject({
			cursor: null,
			attempts: 1,
			done: false,
		});
		// Banner died (8.4): a sweep failure records NOTHING on the region ledger.
		expect((await getRegionState(db(), REGION))?.failureCount ?? 0).toBe(0);

		// Second wholesale failure: poison, not outage — the cursor STEPS PAST so
		// the rotation (and the membership pass behind it) can never starve.
		const second = await runLeavingSweep(db(), REGION);
		expect(second).toMatchObject({
			ok: true,
			result: { swept: 0, done: true },
		});
		expect((await getPsPlusLeavingState(db(), REGION))?.done).toBe(true);
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
		await check();
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
		await check();
		await runLeavingSweep(db(), REGION);
		expect((await rowOf(departing.id))?.psPlusLeavingOn).toBe('2026-07-21');

		// Next window: the game is GONE from the catalog.
		vi.unstubAllGlobals();
		stubSweepStore(['Sweep Something Else'], {});
		await check();

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
		await check(); // membership + arm
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
		expect((await getPsPlusLeavingState(db(), REGION))?.done).toBe(true);
	});

	it('a library past the chunk size converges over TWO sweeps — cursor advances, then done (budget)', async () => {
		const names = Array.from(
			{ length: 16 },
			(_, i) => `Sweep Bulk ${String(i).padStart(2, '0')}`,
		);
		for (const name of names) await seedGame(name);
		stubSweepStore(names, { [names[0]]: END_JUL_21 });
		await check();

		const first = await runLeavingSweep(db(), REGION);
		expect(first).toMatchObject({ ok: true, result: { done: false } });
		const mid = await getPsPlusLeavingState(db(), REGION);
		expect(mid?.cursor).not.toBeNull();

		const second = await runLeavingSweep(db(), REGION);
		expect(second).toMatchObject({ ok: true, result: { done: true } });
	}, 20000);

	it('an OWNED game gets the fact too (shared game fact; the FR-38 gate is the UI test)', async () => {
		const ownedGame = await seedGame('Sweep Owned', { owned: true });
		stubSweepStore(['Sweep Owned'], { 'Sweep Owned': END_JUL_21 });
		await check();
		// The 8.4 target list spans EVERY game this region's users track (the
		// suite has seeded ~25 by now, in random-UUID id order) — run the sweep
		// to completion, as the cron rotation would across fires.
		for (let i = 0; i < 5; i++) {
			const outcome = await runLeavingSweep(db(), REGION);
			expect(outcome.ok).toBe(true);
			if (outcome.ok && outcome.result.done) break;
		}
		expect((await rowOf(ownedGame.id))?.psPlusLeavingOn).toBe('2026-07-21');
	});
});
