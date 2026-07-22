import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { todayInZone } from '../../src/core';
import {
	claimRegionLock,
	deleteSetting,
	ensureRegionState,
	getSetting,
	getTracking,
	insertGame,
	listLibraryForUser,
	recordRegionOutcome,
	releaseRegionLock,
	upsertCatalogProducts,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import {
	getPsnRegion,
	PSN_REGION_SETTING_KEY,
} from '../../src/services/settings';
import { appFetch, establishSession, TEST_EMAIL } from './session';

/**
 * Timezone policy integration tests (Epic 2 retro): the settings endpoint
 * (first-login capture vs. edit) and the hazard itself — a tracking write
 * must stamp "today" in the user's captured zone, not the Worker's UTC clock.
 */

const db = () => createDb(env.DB);

function putTimezone(body: unknown, cookie?: string) {
	return appFetch('/api/settings/timezone', {
		method: 'PUT',
		headers: {
			'content-type': 'application/json',
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify(body),
	});
}

let cookie: string;
let userId: string;

describe('settings + timezone stamping (integration, real workerd + local D1)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		cookie = await establishSession();
		const [row] = await db()
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, TEST_EMAIL));
		userId = row.id;
	});

	it('requires auth', async () => {
		expect((await appFetch('/api/settings')).status).toBe(401);
		expect((await putTimezone({ timezone: 'Europe/Rome' })).status).toBe(401);
	});

	it('rejects an unresolvable timezone', async () => {
		const res = await putTimezone({ timezone: 'Not/AZone' }, cookie);
		expect(res.status).toBe(400);
	});

	it('captures at first login, never overwrites under onlyIfUnset, edits on plain PUT', async () => {
		// First-login capture.
		const captured = await putTimezone(
			{ timezone: 'Europe/Rome', onlyIfUnset: true },
			cookie,
		);
		expect(captured.status).toBe(200);
		expect(await captured.json()).toEqual({ timezone: 'Europe/Rome' });

		// A second capture (another device, another login) must not clobber.
		const recaptured = await putTimezone(
			{ timezone: 'America/New_York', onlyIfUnset: true },
			cookie,
		);
		expect(await recaptured.json()).toEqual({ timezone: 'Europe/Rome' });

		// An explicit edit overwrites.
		const edited = await putTimezone({ timezone: 'Europe/Berlin' }, cookie);
		expect(await edited.json()).toEqual({ timezone: 'Europe/Berlin' });
		expect(
			await (await appFetch('/api/settings', { headers: { cookie } })).json(),
		).toEqual({
			timezone: 'Europe/Berlin',
			// Story 8.4: the failure banner died — the field is the region's
			// "refresh in flight" readout now.
			catalogRefreshing: false,
			psPlusRefreshedAt: null,
			scoresRefreshFailed: false,
			stragglerCount: 0,
			fabHandedness: 'right',
			psPlusClaimCount: 0,
			// The GET above already read the region through `getPsnRegion`, which
			// seeds (and persists) the test env's `PSN_REGION` var.
			region: 'it-it',
		});
	});

	it('PSN region: GET reports the effective value, PUT normalizes + persists, bad value 400', async () => {
		// GET reports the effective value — the wrangler var seeds `it-it` in the
		// test env (this GET, not a sibling test's, does the first read+persist).
		expect(
			await (await appFetch('/api/settings', { headers: { cookie } })).json(),
		).toMatchObject({ region: 'it-it' });
		expect(await getSetting(db(), userId, PSN_REGION_SETTING_KEY)).toBe(
			'it-it',
		);

		// PUT trims + lowercases, echoes what it stored.
		const put = await appFetch('/api/settings/psn-region', {
			method: 'PUT',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ region: ' EN-US ' }),
		});
		expect(put.status).toBe(200);
		expect(await put.json()).toEqual({ region: 'en-us' });
		expect(await getSetting(db(), userId, PSN_REGION_SETTING_KEY)).toBe(
			'en-us',
		);
		expect(
			await (await appFetch('/api/settings', { headers: { cookie } })).json(),
		).toMatchObject({ region: 'en-us' });

		// The saved setting now wins over the env seed (Story 5.1 precedence).
		expect(await getPsnRegion(db(), userId, { PSN_REGION: 'it-it' })).toBe(
			'en-us',
		);

		// Malformed locales rejected at the boundary, nothing written. (3-part
		// locales like `zh-hans-hk` are VALID — Sony has script segments.)
		for (const bad of [
			'italy',
			'',
			'   ',
			'it_IT',
			'itit',
			'i-t',
			'zh-hans-hk-x',
			42,
		]) {
			const rejected = await appFetch('/api/settings/psn-region', {
				method: 'PUT',
				headers: { 'content-type': 'application/json', cookie },
				body: JSON.stringify({ region: bad }),
			});
			expect(rejected.status, `expected 400 for ${JSON.stringify(bad)}`).toBe(
				400,
			);
		}
		const noBody = await appFetch('/api/settings/psn-region', {
			method: 'PUT',
			headers: { 'content-type': 'application/json', cookie },
		});
		expect(noBody.status).toBe(400);
		expect(await getSetting(db(), userId, PSN_REGION_SETTING_KEY)).toBe(
			'en-us',
		);

		// Story 8.4: freshness is per-REGION (the ledger's last_success) — a
		// region change clears NOTHING, the readout simply follows the new
		// region's ledger row. The header still can't date a catalog the new
		// region never had, because the new region reads its OWN (empty) row.
		const { getPsPlusRefreshedAt } = await import(
			'../../src/services/settings'
		);
		await recordRegionOutcome(db(), 'en-us', {
			attemptedOn: '2026-07-10',
			succeeded: true,
			window: '2026-07',
		});

		const resaved = await appFetch('/api/settings/psn-region', {
			method: 'PUT',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ region: 'en-us' }),
		});
		expect(resaved.status).toBe(200);
		expect(await getPsPlusRefreshedAt(db(), 'en-us')).toBe('2026-07-10');

		// A 3-part Sony locale is accepted — the old region's stamp SURVIVES
		// (per-region fact) while the new region reads null until its own refresh.
		const changed = await appFetch('/api/settings/psn-region', {
			method: 'PUT',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ region: 'ZH-HANS-HK' }),
		});
		expect(changed.status).toBe(200);
		expect(await changed.json()).toEqual({ region: 'zh-hans-hk' });
		expect(await getPsPlusRefreshedAt(db(), 'zh-hans-hk')).toBeNull();
		expect(await getPsPlusRefreshedAt(db(), 'en-us')).toBe('2026-07-10');

		// No setting and no seed reads as unset (the route reports null).
		expect(await getPsnRegion(db(), 'user-with-no-region', {})).toBeUndefined();

		// A MALFORMED env seed behaves as unset and persists NOTHING — both write
		// paths share normalizePsnRegion, so a value the PUT would 400 can never
		// enter through the wrangler var (Epic 11 sweep).
		expect(
			await getPsnRegion(db(), 'user-with-no-region', { PSN_REGION: 'IT_IT' }),
		).toBeUndefined();
		expect(
			await getSetting(db(), 'user-with-no-region', PSN_REGION_SETTING_KEY),
		).toBeUndefined();
		// A well-formed but shouty seed is normalized before it persists (a real
		// user row: the setting write is FK-bound to `user`).
		await deleteSetting(db(), userId, PSN_REGION_SETTING_KEY);
		expect(await getPsnRegion(db(), userId, { PSN_REGION: ' IT-IT ' })).toBe(
			'it-it',
		);
		expect(await getSetting(db(), userId, PSN_REGION_SETTING_KEY)).toBe(
			'it-it',
		);

		// Auth is required on the write path.
		const unauthed = await appFetch('/api/settings/psn-region', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ region: 'it-it' }),
		});
		expect(unauthed.status).toBe(401);
	});

	// The 5.2 failure banner is structurally gone (Story 8.4, AD-31: refresh
	// failures are passive) — the field's replacement is the per-region
	// "refresh in flight" flag, read off the region lock.
	it('GET exposes catalogRefreshing while the region lock is held (8.4)', async () => {
		const region = 'it-it'; // the user's effective region at this point
		const token = `${Date.now() + 60_000}:catalog-refresh:settings-test`;
		await ensureRegionState(db(), region);
		expect(await claimRegionLock(db(), region, token, Date.now())).toBe(true);
		try {
			expect(
				await (await appFetch('/api/settings', { headers: { cookie } })).json(),
			).toMatchObject({ catalogRefreshing: true });
		} finally {
			await releaseRegionLock(db(), region, token);
		}
		expect(
			await (await appFetch('/api/settings', { headers: { cookie } })).json(),
		).toMatchObject({ catalogRefreshing: false });
	});

	it('PS+ refreshed-at (5.3, region ledger since 8.4): GET exposes the region last_success', async () => {
		await recordRegionOutcome(db(), 'it-it', {
			attemptedOn: '2026-07-10',
			succeeded: true,
			window: '2026-07',
		});
		const body = (await (
			await appFetch('/api/settings', { headers: { cookie } })
		).json()) as { psPlusRefreshedAt: string | null };
		expect(body.psPlusRefreshedAt).toBe('2026-07-10');
	});

	it('FAB handedness: defaults right, PUT persists, bad value 400 (Story 6.3)', async () => {
		// Default when unset.
		const other = 'handedness-fresh-user';
		const { readFabHandedness } = await import('../../src/services/settings');
		expect(await readFabHandedness(db(), other)).toBe('right');

		// PUT persists and rides the GET payload.
		const put = await appFetch('/api/settings/fab-handedness', {
			method: 'PUT',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ handedness: 'left' }),
		});
		expect(put.status).toBe(200);
		expect(
			await (await appFetch('/api/settings', { headers: { cookie } })).json(),
		).toMatchObject({ fabHandedness: 'left' });

		// Bad value rejected at the boundary.
		const bad = await appFetch('/api/settings/fab-handedness', {
			method: 'PUT',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ handedness: 'sideways' }),
		});
		expect(bad.status).toBe(400);
	});

	it('cancel PS+ with no claims is an inert no-op (0-claim matrix row)', async () => {
		// The session user holds no membership claims yet.
		const before = (await (
			await appFetch('/api/settings', { headers: { cookie } })
		).json()) as { psPlusClaimCount: number };
		expect(before.psPlusClaimCount).toBe(0);

		const res = await appFetch('/api/settings/cancel-ps-plus', {
			method: 'POST',
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ unowned: 0 });
	});

	it('excludes a discarded PS+ claim from the count and leaves it untouched', async () => {
		// A tombstoned claim is off the shelf — it must not inflate the count the
		// confirm names, nor be touched by cancel (Story 6.4 AC4: count matches
		// what the user can see).
		const hidden = await insertGame(db(), {
			title: 'Discarded Claim',
			titleNormalized: 'discarded claim',
		});
		await upsertTracking(db(), userId, hidden.id, {
			owned: true,
			ownedVia: 'membership',
			playStatus: 'Not started',
			discarded: true,
		});

		const named = (await (
			await appFetch('/api/settings', { headers: { cookie } })
		).json()) as { psPlusClaimCount: number };
		expect(named.psPlusClaimCount).toBe(0);

		const res = await appFetch('/api/settings/cancel-ps-plus', {
			method: 'POST',
			headers: { cookie },
		});
		expect(await res.json()).toEqual({ unowned: 0 });

		// The discarded claim is byte-for-byte untouched — still an owned claim.
		const t = await getTracking(db(), userId, hidden.id);
		expect(t?.owned).toBe(true);
		expect(t?.ownedVia).toBe('membership');
		expect(t?.discarded).toBe(true);
	});

	// The AC4 named-invariant hazard: cancel un-owns membership rows ONLY —
	// purchases untouched, tracking/milestones/dates/status intact, the count is
	// named first.
	//
	// AND IT NEVER TOUCHES PS+ MEMBERSHIP (Epic 7 cross-story review, H2 —
	// Story 8.3 made this structural: membership is DERIVED from the region's
	// `ps_plus_catalog` at read time, never stored on `game`, so cancel cannot
	// invent a membership for a PS+ ESSENTIAL monthly game that is not in the
	// Extra catalog at all).
	it('cancel PS+ un-owns claims only: purchases + milestones/dates/status intact, count named, and PS+ membership is LEFT ALONE (hazard)', async () => {
		// A sync-ingested claim carrying a live status, a milestone, and lifecycle
		// dates. It is an ESSENTIAL monthly game: NOT in the Extra snapshot, so
		// membership derives false — and cancelling must not invent one for it.
		const claimA = await insertGame(db(), {
			title: 'Claim With History',
			titleNormalized: 'claim with history',
		});
		await upsertTracking(db(), userId, claimA.id, {
			owned: true,
			ownershipType: 'digital',
			ownedVia: 'membership',
			playStatus: 'Playing',
			startedOn: '2024-02-02',
			completedOn: '2024-06-01',
			wishlistedOn: '2024-01-01',
		});
		// …and a claim that IS in the Extra catalog (a seeded region snapshot row —
		// membership derives from it, owned rows included), so its pill returns on
		// cancel with no write at all.
		const claimB = await insertGame(db(), {
			title: 'Plain Claim',
			titleNormalized: 'plain claim',
		});
		await upsertCatalogProducts(
			db(),
			{ region: 'it-it' },
			'gen-test',
			[
				{
					productId: 'p-plain-claim',
					npTitleId: null,
					name: 'Plain Claim',
					titleNormalized: 'plain claim',
					coverUrl: null,
					platforms: ['PS5'],
					storeClassification: null,
					storeUrl: 'https://store.example/x',
				},
			],
			'2026-07-17',
		);
		await upsertTracking(db(), userId, claimB.id, {
			owned: true,
			ownedVia: 'membership',
			playStatus: 'Not started',
		});
		// A real purchase must be left completely alone (never in the filter).
		const purchase = await insertGame(db(), {
			title: 'Real Purchase',
			titleNormalized: 'real purchase',
		});
		await upsertTracking(db(), userId, purchase.id, {
			owned: true,
			ownershipType: 'physical',
			ownedVia: 'purchase',
			boughtOn: '2023-12-01',
			playStatus: 'Paused',
		});

		// The count is named FIRST — GET reports exactly the two claim rows.
		const named = (await (
			await appFetch('/api/settings', { headers: { cookie } })
		).json()) as { psPlusClaimCount: number };
		expect(named.psPlusClaimCount).toBe(2);

		// Cancel returns the same count it named.
		const res = await appFetch('/api/settings/cancel-ps-plus', {
			method: 'POST',
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ unowned: 2 });

		// Claim A: ownership reversed (owned/type/via ONLY) — every milestone,
		// date and status stands, discarded untouched.
		const a = await getTracking(db(), userId, claimA.id);
		expect(a?.owned).toBe(false);
		expect(a?.ownershipType).toBeNull();
		expect(a?.ownedVia).toBeNull();
		expect(a?.playStatus).toBe('Playing');
		expect(a?.startedOn).toBe('2024-02-02');
		expect(a?.completedOn).toBe('2024-06-01');
		expect(a?.wishlistedOn).toBe('2024-01-01');
		expect(a?.boughtOn).toBeNull();
		expect(a?.discarded).toBe(false);

		const b = await getTracking(db(), userId, claimB.id);
		expect(b?.owned).toBe(false);
		expect(b?.ownedVia).toBeNull();
		expect(b?.playStatus).toBe('Not started');

		// The purchase is byte-for-byte untouched.
		const p = await getTracking(db(), userId, purchase.id);
		expect(p?.owned).toBe(true);
		expect(p?.ownedVia).toBe('purchase');
		expect(p?.ownershipType).toBe('physical');
		expect(p?.boughtOn).toBe('2023-12-01');
		expect(p?.playStatus).toBe('Paused');

		// MEMBERSHIP IS THE CATALOG'S DERIVATION, and cancel writes NOTHING to it
		// (H2, structural since 8.3). The Essential-only claim derives false —
		// un-owning it must not hand it a ◈ PS+ pill, a place in the PS+ filter
		// and a `yes` in the export for a month. The Extra claim still derives
		// true from its snapshot row, so its pill returns on its own.
		const lib = await listLibraryForUser(db(), userId, { region: 'it-it' });
		const derived = (id: string) =>
			lib.find((row) => row.id === id)?.psPlusExtra;
		expect(derived(claimA.id)).toBe(false);
		expect(derived(claimB.id)).toBe(true);
		expect(derived(purchase.id)).toBe(false);

		// The count is back to zero — the claims are gone.
		const after = (await (
			await appFetch('/api/settings', { headers: { cookie } })
		).json()) as { psPlusClaimCount: number };
		expect(after.psPlusClaimCount).toBe(0);
	});

	it('stamps started_on as today IN THE USER ZONE, not the UTC day (hazard)', async () => {
		// Pick a zone whose current date provably differs from UTC's right now,
		// so a UTC-clock stamp cannot pass by coincidence: UTC+14 is a day
		// ahead once the UTC clock reads 10:00; UTC-12 is a day behind before
		// UTC 12:00. Between them every hour of the day is covered.
		const zone =
			new Date().getUTCHours() >= 10 ? 'Pacific/Kiritimati' : 'Etc/GMT+12';
		expect((await putTimezone({ timezone: zone }, cookie)).status).toBe(200);

		const game = await insertGame(db(), {
			title: 'Timezone Hazard',
			titleNormalized: 'timezone hazard',
		});
		await upsertTracking(db(), userId, game.id, { playStatus: 'Not started' });

		// Tolerate a midnight crossing between here and the Worker's stamp.
		const before = todayInZone(zone, new Date());
		const res = await appFetch(`/api/games/${game.id}/play-status`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ playStatus: 'Playing' }),
		});
		const after = todayInZone(zone, new Date());
		expect(res.status).toBe(200);

		const stamped = (await getTracking(db(), userId, game.id))?.startedOn;
		expect([before, after]).toContain(stamped);
		expect(stamped).not.toBe(new Date().toISOString().slice(0, 10));
	});
});
