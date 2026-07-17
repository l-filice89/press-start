import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
	claimRegionLock,
	ensureRegionState,
	getRegionState,
	insertGame,
	listCatalogGenres,
	listCatalogProducts,
	listLibraryForUser,
	setCatalogGenres,
	setSetting,
	upsertCatalogProducts,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { game, psPlusRegionState, user } from '../../src/schema';
import {
	runPsPlusCheck,
	runScheduledPsPlusCheck,
} from '../../src/services/psplus';
import {
	getPsPlusLeavingState,
	getPsPlusSweepState,
	PSN_REGION_SETTING_KEY,
	setPsPlusLeavingState,
	setPsPlusSweepState,
} from '../../src/services/settings';
import {
	BAD_CATEGORY_PAYLOAD,
	BAD_REGION_PAYLOAD,
	CAPTURED_COVER_URL,
	catalogPagePayload,
	EMPTY_CATALOG_PAYLOAD,
	PAST_END_PAYLOAD,
	productId,
} from '../fixtures/psn';
import { stubStore } from './psn-stub';
import { establishSession, TEST_EMAIL } from './session';

/**
 * PS+ catalog ingest (Story 5.1 + 7.1; FR-38/39/50, AD-24/27) against the real
 * Worker + local D1, with the PUBLIC store-browse call stubbed — from the
 * CAPTURED payloads (`test/fixtures/psn/`), because every degenerate answer this
 * endpoint gives is an HTTP 200 and a stub that assumed otherwise would keep
 * this suite green while production wiped the shelf.
 *
 * The hazards: the snapshot is upserted + pruned; the flag pass reads the TABLE
 * and covers EVERY tracked game, owned included; catalog games are never
 * inserted into `game`; an empty RESULT fails closed while an empty PAGE past
 * the end is a normal terminator.
 */

const db = () => createDb(env.DB);
const REGION = 'it-it';
const scope = { region: REGION };

/** The whole catalog on the first page, in the captured shape. */
const stubCatalog = (names: string[], status = 200) =>
	stubStore(({ offset }) =>
		status !== 200
			? { status, body: '{}' }
			: {
					body: catalogPagePayload(offset === 0 ? names : [], {
						totalCount: names.length,
						offset,
					}),
				},
	);

// Story 8.4: POST /api/ps-plus-check is GONE — the membership pass is the
// per-region service, driven by the cron rotation and the shelf guard.
const check = (region: string = REGION, lockToken?: string) =>
	runPsPlusCheck(db(), region, lockToken);

let userId: string;

/** Park both sweeps so the cron rotation hands the slot to the membership pass. */
async function markSweepsDone(region: string) {
	const sweep = await getPsPlusSweepState(db(), region);
	if (sweep) await setPsPlusSweepState(db(), region, { ...sweep, done: true });
	const leaving = await getPsPlusLeavingState(db(), region);
	if (leaving)
		await setPsPlusLeavingState(db(), region, { ...leaving, done: true });
}

async function seedGame(
	title: string,
	{ owned = false, discarded = false } = {},
) {
	const created = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
	});
	await upsertTracking(db(), userId, created.id, { owned, discarded });
	return created;
}

/**
 * Put titles in the region's snapshot under a PRE-RUN generation (Story 8.3):
 * "previously a member" is now a catalog fact, not a game-column flag — the
 * next check diffs (and prunes) against these rows.
 */
async function seedOldCatalog(names: string[]) {
	await upsertCatalogProducts(
		db(),
		scope,
		'gen-old',
		names.map((name) => ({
			productId: productId(name),
			npTitleId: null,
			name,
			titleNormalized: name.toLowerCase(),
			coverUrl: null,
			platforms: ['PS5'],
			storeClassification: null,
			storeUrl: 'https://store.example/x',
		})),
		'2026-07-01',
	);
}

/** Derived membership for one library game (Story 8.3) — the region join. */
const flagOf = async (id: string) =>
	(
		await listLibraryForUser(db(), userId, {
			includeDiscarded: true,
			region: REGION,
		})
	).find((row) => row.id === id)?.psPlusExtra;

const snapshotNames = async () =>
	(await listCatalogProducts(db(), scope)).map((row) => row.name).sort();

beforeAll(async () => {
	await applyD1Migrations(env.DB, inject('migrations'));
	await establishSession();
	const [row] = await db()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, TEST_EMAIL));
	userId = row.id;
	// The cron's region picker walks registered users' psn_region settings (8.4).
	await setSetting(db(), userId, PSN_REGION_SETTING_KEY, REGION);
});

afterEach(() => vi.unstubAllGlobals());

describe('runPsPlusCheck — per-region membership pass (integration, real workerd + local D1)', () => {
	// "requires auth" and the env-seed test died with the POST route (8.4):
	// the service is cron/guard-driven, and region seeding is pinned in
	// settings.test.ts (getPsnRegion).

	it('reports the region it checked and sends it as the store locale', async () => {
		const seen = stubCatalog(['Anything In Catalog']);
		const outcome = await check();
		expect(outcome).toMatchObject({ ok: true, result: { region: REGION } });
		expect(seen.length).toBeGreaterThan(0);
		expect(seen[0].locale).toBe(REGION);
	});

	// AD-24/FR-50: the catalog itself is now DATA — with its cover, its store
	// URL and its store ids — not a list of names thrown away after the flag pass.
	it('persists the whole catalog as a snapshot (cover + store URL + ids), and creates no game row for it', async () => {
		const gamesBefore = (await db().select({ id: game.id }).from(game)).length;
		stubCatalog(['Crow Country', 'Stellar Blade']);
		expect((await check()).ok).toBe(true);

		const rows = await listCatalogProducts(db(), scope);
		expect(rows.map((row) => row.name).sort()).toEqual([
			'Crow Country',
			'Stellar Blade',
		]);
		const crow = rows.find((row) => row.name === 'Crow Country');
		expect(crow?.productId).toBe(productId('Crow Country'));
		expect(crow?.npTitleId).toBe(`NP${productId('Crow Country')}`);
		expect(crow?.titleNormalized).toBe('crow country');
		// The cover rides the captured `media[]` — never a second per-product fetch.
		expect(crow?.coverUrl).toBe(CAPTURED_COVER_URL);
		expect(crow?.storeUrl).toBe(
			`https://store.playstation.com/${REGION}/product/${productId('Crow Country')}`,
		);
		expect(crow?.platforms).toBe('["PS5"]');
		expect(crow?.storeClassification).toBe('GAME_BUNDLE');
		// Availability is not ownership: no game / game_tracking row is minted.
		expect((await db().select({ id: game.id }).from(game)).length).toBe(
			gamesBefore,
		);
	});

	it('sets and clears flags in BOTH directions on every tracked game — OWNED ONES INCLUDED (AD-27)', async () => {
		const nowIn = await seedGame('Hades'); // enters the catalog
		const left = await seedGame('Bloodborne'); // left it
		// The 7.1 fix: an owned catalog game is a MEMBER, so the derived fact says
		// so. (The badge stays hidden — every surface renders `psPlusExtra && !owned`.)
		const ownedInCatalog = await seedGame('Stray', { owned: true });
		const ownedLeft = await seedGame('Tunic', { owned: true });
		// "Previously in the catalog" is a snapshot fact now (8.3): the check
		// diffs membership across the refresh on the old vs new title keys.
		await seedOldCatalog(['Bloodborne', 'Tunic']);

		stubCatalog(['Hades', 'Stray', 'Ghost of Tsushima']);
		// The flagged/cleared readout died with the button (8.4) — the derived
		// facts below are the whole assertion now.
		expect((await check()).ok).toBe(true);

		expect(await flagOf(nowIn.id)).toBe(true);
		expect(await flagOf(left.id)).toBe(false);
		expect(await flagOf(ownedInCatalog.id)).toBe(true);
		expect(await flagOf(ownedLeft.id)).toBe(false);
	});

	// HAZARD (DW-12): the flag lives on the shared game row and describes catalog
	// membership, not user visibility — but the pass used the tombstone-filtered
	// library read, so a DISCARDED game's flag froze forever: stale (and visible)
	// the moment the game was revived. The pass now writes through tombstones;
	// the check's readout still reports only visible games, because "Flagged:
	// <a game you deleted>" is noise.
	it("updates a DISCARDED game's flag in both directions", async () => {
		const staleFlag = await seedGame('Outer Wilds', { discarded: true }); // left the catalog while discarded
		await seedOldCatalog(['Outer Wilds']);
		const nowIn = await seedGame('Returnal', { discarded: true }); // entered it
		await seedGame('Hollow Knight');

		stubCatalog(['Returnal', 'Hollow Knight']);
		expect((await check()).ok).toBe(true);

		// The stored facts move for tombstones too. (The visible-only readout
		// half of this test died with the button's flagged/cleared body, 8.4.)
		expect(await flagOf(staleFlag.id)).toBe(false);
		expect(await flagOf(nowIn.id)).toBe(true);
	});

	it('never auto-adds catalog games absent from the library (AR-10)', async () => {
		const before = (await db().select({ id: game.id }).from(game)).length;
		stubCatalog(['Some Catalog-Only Game', 'Another One']);
		expect((await check()).ok).toBe(true);
		const after = (await db().select({ id: game.id }).from(game)).length;
		expect(after).toBe(before);
	});

	it('matches catalog names through title normalization (™/case noise)', async () => {
		const glyphs = await seedGame('Heavy Rain');
		stubCatalog(['HEAVY RAIN™']);
		expect((await check()).ok).toBe(true);
		expect(await flagOf(glyphs.id)).toBe(true);
	});

	// The prune: the table is the CURRENT catalog, not a log. Genre tags die with
	// their product (the FK cascade) — an orphan tag would mis-filter 7.2's grid.
	it('prunes a product that LEFT the catalog and cascades its genre rows away', async () => {
		stubCatalog(['Stays Put', 'Departs Soon']);
		expect((await check()).ok).toBe(true);
		await setCatalogGenres(db(), scope, 'HORROR', [productId('Departs Soon')]);
		await setCatalogGenres(db(), scope, 'ACTION', [productId('Stays Put')]);
		expect(await listCatalogGenres(db(), scope)).toHaveLength(2);

		stubCatalog(['Stays Put']);
		expect(await check()).toMatchObject({ ok: true, result: { pruned: 1 } });

		expect(await snapshotNames()).toEqual(['Stays Put']);
		expect(await listCatalogGenres(db(), scope)).toEqual([
			{ productId: productId('Stays Put'), genreKey: 'ACTION' },
		]);
	});

	it('writes nothing when the catalog fetch fails', async () => {
		const flagged = await seedGame('Celeste');
		stubCatalog(['Celeste']);
		expect((await check()).ok).toBe(true);
		const before = await snapshotNames();

		stubCatalog([], 500);
		expect(await check()).toEqual({ ok: false, reason: 'provider' });
		// The stale flag AND the stale snapshot stand — no partial clear, no prune.
		expect(await flagOf(flagged.id)).toBe(true);
		expect(await snapshotNames()).toEqual(before);
	});

	// THE wipe hazard, from the CAPTURED payload: a 200 with zero products (bad
	// region / de-listed catalog / category-id rot) must never be read as "clear
	// everything". It now guards two datasets.
	it('treats an EMPTY 200 catalog as a provider failure — the snapshot AND every flag survive', async () => {
		const flagged = await seedGame('Journey');
		stubCatalog(['Journey', 'Sifu']);
		expect((await check()).ok).toBe(true);
		const before = await snapshotNames();
		expect(before.length).toBeGreaterThan(0);

		// The store ANSWERED with nothing — the bad-region/de-listed shape, a
		// typed `bad-region` (a retry cannot fix it), not a transient `provider`.
		stubStore(() => ({ body: EMPTY_CATALOG_PAYLOAD }));
		expect(await check()).toEqual({ ok: false, reason: 'bad-region' });

		expect(await flagOf(flagged.id)).toBe(true);
		expect(await snapshotNames()).toEqual(before);
	});

	// A 200 whose grid is NULL (a bad region, and separately a bad category id)
	// fails closed — and as the typed `bad-region`, not a retry-later `provider`:
	// the store answered and refused, so retrying cannot fix it (a real user hit
	// this with `uk-uk` for the UK store, which is `en-gb`).
	it.each([
		['a bad region (null grid, empty error message)', BAD_REGION_PAYLOAD],
		['a bad category id (null grid + errors[])', BAD_CATEGORY_PAYLOAD],
	])('fails closed on %s — a 200 is not success', async (_label, payload) => {
		const flagged = await seedGame(`Guard ${_label}`);
		stubCatalog([`Guard ${_label}`]);
		expect((await check()).ok).toBe(true);
		const before = await snapshotNames();

		stubStore(() => ({ body: payload }));
		expect(await check()).toEqual({ ok: false, reason: 'bad-region' });
		expect(await flagOf(flagged.id)).toBe(true);
		expect(await snapshotNames()).toEqual(before);
	});

	/**
	 * THE TRUNCATED WALK (review, H1) — the wipe this suite used to bless. The
	 * store serves page 0 (products, `totalCount: 490`) and then an EMPTY page at
	 * offset < 490. Breaking on any empty page yielded a "complete" catalog of
	 * whatever page 0 held — and the prune then deleted every other row and the
	 * flag pass cleared their `ps_plus_extra`. It is a PROVIDER FAILURE: a short
	 * walk never prunes, and the previous snapshot and every flag survive.
	 */
	it('a TRUNCATED walk (empty page while offset < totalCount) fails closed — no prune, no flag clear', async () => {
		const flagged = await seedGame('Survivor');
		const departed = await seedGame('Also Here');
		stubCatalog(['Survivor', 'Also Here']);
		expect((await check()).ok).toBe(true);
		const before = await snapshotNames();
		expect(before).toEqual(['Also Here', 'Survivor']);

		// Page 0 answers ONE product of a claimed 490; the next page is the VERBATIM
		// past-the-end capture (200, products [], totalCount 490) — at offset 1, so
		// the walk is short, not finished.
		stubStore(({ offset }) =>
			offset === 0
				? { body: catalogPagePayload(['Survivor'], { totalCount: 490 }) }
				: { body: PAST_END_PAYLOAD },
		);
		expect(await check()).toEqual({ ok: false, reason: 'provider' });

		// Nothing was pruned and nothing was un-flagged.
		expect(await snapshotNames()).toEqual(before);
		expect(await flagOf(flagged.id)).toBe(true);
		expect(await flagOf(departed.id)).toBe(true);
	});

	/**
	 * ONE ID-LESS PRODUCT MUST NOT BRICK THE REFRESH (Epic 7 cross-story review,
	 * M1). The provider drops a product with no `id` (it has no primary key), but
	 * the store still COUNTS it — and the reconcile demanded EXACT equality, so
	 * 489 !== 490 failed every refresh and every button click identically, with no
	 * self-heal short of a deploy. The walk is accounted for, not just kept.
	 */
	it('an ID-LESS store product does NOT fail the refresh — it is accounted for, not demanded', async () => {
		stubStore(({ offset }) => {
			const payload = catalogPagePayload(['Has Id', 'Also Has Id', 'No Id'], {
				totalCount: 3,
				offset,
			});
			if (offset === 0) {
				const products = payload.data.categoryGridRetrieve.products as {
					id?: string;
				}[];
				// Sony's grid does this: a row with no id at all, still counted.
				products[2].id = undefined;
			} else {
				payload.data.categoryGridRetrieve.products = [];
			}
			return { body: payload };
		});

		expect(await check()).toMatchObject({ ok: true, result: { products: 2 } });
		expect(await snapshotNames()).toEqual(['Also Has Id', 'Has Id']);
	});

	// …and a product ARRIVING between page 1 and page 5 (the last page's totalCount
	// wins) is drift, not truncation: a healthy catalog must not fail on it.
	it('tolerates a one-row store mutation mid-walk (totalCount moved under the walk)', async () => {
		// Page 0: two of a claimed three. Page 1: the third — but the store now says
		// FOUR (a product arrived while the walk was in flight). Page 2 is empty:
		// there is no fourth row to serve, and the walk ends one short of a count
		// that only ever existed after it started.
		stubStore(({ offset }) => {
			if (offset === 0)
				return {
					body: catalogPagePayload(['Alpha', 'Beta'], { totalCount: 3 }),
				};
			if (offset === 2)
				return {
					body: catalogPagePayload(['Gamma'], { totalCount: 4, offset }),
				};
			return { body: catalogPagePayload([], { totalCount: 4, offset }) };
		});
		expect((await check()).ok).toBe(true);
		expect(await snapshotNames()).toEqual(['Alpha', 'Beta', 'Gamma']);
	});

	// The genuine terminator: the accumulated count RECONCILES with the store's
	// own `totalCount` across a capped, multi-page walk — that run is complete and
	// prunes normally.
	it('a COMPLETE multi-page walk (accumulated == totalCount) succeeds and prunes', async () => {
		stubCatalog(['Gone Next Run']);
		expect((await check()).ok).toBe(true);

		// The server caps the page at 2 of a totalCount of 3.
		const pages = [['Alpha', 'Beta'], ['Gamma']];
		const seen = stubStore(({ offset }) => ({
			body: catalogPagePayload(pages[offset === 0 ? 0 : 1], {
				totalCount: 3,
				offset,
			}),
		}));

		expect(await check()).toMatchObject({
			ok: true,
			result: { products: 3, pruned: 1 },
		});
		expect(seen.map((call) => call.offset)).toEqual([0, 2]);
		expect(await snapshotNames()).toEqual(['Alpha', 'Beta', 'Gamma']);
	});

	/**
	 * THE CONCURRENT PRUNE (review, H3). The lock's TTL is PREEMPTION: run A
	 * stalls past two minutes, cron run B takes the lock over and writes the whole
	 * catalog under generation B — and run A, waking up, would prune "everything
	 * that is not generation A" and delete every one of B's rows, emptying the
	 * table and clearing every flag. The fence stops A dead: it writes nothing.
	 */
	it('a run whose REGION lock was preempted mid-fetch does not prune — the winner’s snapshot stands whole', async () => {
		const flagged = await seedGame('Alpha');
		stubCatalog(['Alpha', 'Beta', 'Gamma']);
		expect((await check()).ok).toBe(true);
		const winner = await snapshotNames();
		expect(winner).toEqual(['Alpha', 'Beta', 'Gamma']);

		// Run A claims the REGION lock (8.4: the catalog path's fence)…
		const tokenA = `${Date.now() + 60_000}:catalog-refresh:run-a`;
		await ensureRegionState(db(), REGION);
		expect(await claimRegionLock(db(), REGION, tokenA, Date.now())).toBe(true);

		// …and is mid-fetch when the TTL hands it to someone else (run B, which
		// has already written the snapshot above). A's fetch answers a SHORTER
		// catalog — exactly the response whose prune would delete B's other rows.
		stubStore(async () => {
			await db()
				.update(psPlusRegionState)
				.set({ lock: `${Date.now() + 60_000}:catalog-refresh:someone-else` })
				.where(eq(psPlusRegionState.region, REGION));
			return { body: catalogPagePayload(['Alpha'], { totalCount: 1 }) };
		});

		expect(await check(REGION, tokenA)).toEqual({
			ok: false,
			reason: 'conflict',
		});
		// The loser wrote NOTHING: no upsert, no prune, no flag clear.
		expect(await snapshotNames()).toEqual(winner);
		expect(await flagOf(flagged.id)).toBe(true);
		await db()
			.update(psPlusRegionState)
			.set({ lock: null })
			.where(eq(psPlusRegionState.region, REGION));
	});

	// INVERTED by Story 8.3 (review, H1): membership now DERIVES from the
	// region's snapshot, so regions must COEXIST — one user's check wiping
	// another region's rows would blank every other user's shelf. The old M6
	// "strand forever" concern moves to 8.4's idle-region prune.
	it('a check for another region leaves the first region’s snapshot INTACT (coexistence)', async () => {
		stubCatalog(['Old Region Game']);
		expect((await check()).ok).toBe(true);
		expect(await listCatalogProducts(db(), scope)).toHaveLength(1);

		stubCatalog(['New Region Game']);
		expect((await check('en-us')).ok).toBe(true);

		// BOTH regions' snapshots stand — the two-region AC's write-path half.
		expect((await listCatalogProducts(db(), scope)).map((r) => r.name)).toEqual(
			['Old Region Game'],
		);
		expect(
			(await listCatalogProducts(db(), { region: 'en-us' })).map((r) => r.name),
		).toEqual(['New Region Game']);
	});

	// Story 5.3, region-homed by 8.4: a successful CRON slot stamps the region
	// ledger's last_success; a failed one leaves the prior stamp (stale-but-real
	// beats wrong) and counts the failure.
	it('the cron stamps the region ledger on success and leaves last_success on failure', async () => {
		const stampedAt = async () =>
			(await getRegionState(db(), REGION))?.lastSuccess ?? null;

		// Park the sweeps so the rotation hands this slot to the membership pass.
		await markSweepsDone(REGION);
		stubCatalog(['Anything In Catalog']);
		await runScheduledPsPlusCheck(db(), env);
		const afterSuccess = await stampedAt();
		expect(afterSuccess).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		// A failed run must not overwrite the last good stamp — it lands on the
		// ledger as a failure count instead (no banner exists any more, AD-31).
		await markSweepsDone(REGION); // the pass above re-armed them
		stubCatalog([], 500);
		await runScheduledPsPlusCheck(db(), env);
		expect(await stampedAt()).toBe(afterSuccess);
		expect((await getRegionState(db(), REGION))?.failureCount).toBe(1);
	});
});
