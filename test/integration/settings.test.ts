import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { todayInZone } from '../../src/core';
import {
	findGamesByNormalizedTitle,
	getSetting,
	getTracking,
	insertGame,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import {
	getPsnRegion,
	PSN_REGION_SETTING_KEY,
} from '../../src/services/settings';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

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
			.where(eq(user.email, ALLOWED_EMAIL));
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
			psPlusRefreshFailed: false,
			psPlusRefreshedAt: null,
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

		// A REAL region change clears the old region's refresh stamps (review
		// 2026-07-15) — the header must not date a catalog this region never had.
		// Re-saving the SAME region clears nothing.
		const {
			stampPsPlusRefreshedAt,
			markPsPlusRefreshFailed,
			isPsPlusRefreshFailed,
			getPsPlusRefreshedAt,
		} = await import('../../src/services/settings');
		await stampPsPlusRefreshedAt(db(), userId);
		await markPsPlusRefreshFailed(db(), userId);

		const resaved = await appFetch('/api/settings/psn-region', {
			method: 'PUT',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ region: 'en-us' }),
		});
		expect(resaved.status).toBe(200);
		expect(await getPsPlusRefreshedAt(db(), userId)).not.toBeNull();
		expect(await isPsPlusRefreshFailed(db(), userId)).toBe(true);

		// A 3-part Sony locale is accepted — and the change wipes both stamps.
		const changed = await appFetch('/api/settings/psn-region', {
			method: 'PUT',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ region: 'ZH-HANS-HK' }),
		});
		expect(changed.status).toBe(200);
		expect(await changed.json()).toEqual({ region: 'zh-hans-hk' });
		expect(await getPsPlusRefreshedAt(db(), userId)).toBeNull();
		expect(await isPsPlusRefreshFailed(db(), userId)).toBe(false);

		// No setting and no seed reads as unset (the route reports null).
		expect(await getPsnRegion(db(), 'user-with-no-region', {})).toBeUndefined();

		// Auth is required on the write path.
		const unauthed = await appFetch('/api/settings/psn-region', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ region: 'it-it' }),
		});
		expect(unauthed.status).toBe(401);
	});

	it('PS+ refresh failure (5.2): GET exposes psPlusRefreshFailed, cleared on resolve', async () => {
		const { markPsPlusRefreshFailed, clearPsPlusRefreshFailed } = await import(
			'../../src/services/settings'
		);

		await markPsPlusRefreshFailed(db(), userId);
		expect(
			await (await appFetch('/api/settings', { headers: { cookie } })).json(),
		).toMatchObject({ psPlusRefreshFailed: true });

		await clearPsPlusRefreshFailed(db(), userId);
		expect(
			await (await appFetch('/api/settings', { headers: { cookie } })).json(),
		).toMatchObject({ psPlusRefreshFailed: false });
	});

	it('PS+ refreshed-at (5.3): GET exposes the stamped date', async () => {
		const { stampPsPlusRefreshedAt } = await import(
			'../../src/services/settings'
		);
		await stampPsPlusRefreshedAt(db(), userId);
		const body = (await (
			await appFetch('/api/settings', { headers: { cookie } })
		).json()) as { psPlusRefreshedAt: string | null };
		expect(body.psPlusRefreshedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
			psPlusExtra: false,
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
	// AND IT NEVER TOUCHES `ps_plus_extra` (Epic 7 cross-story review, H2). It used
	// to force the flag TRUE on every claim, on a premise Story 7.1 deleted: the
	// flag is now a faithful cache of `ps_plus_catalog` for EVERY tracked row,
	// owned included. Re-flagging lit the ◈ PS+ pill (and the filter, and the CSV)
	// for a PS+ ESSENTIAL monthly game that is not in the Extra catalog at all —
	// for up to a month, until the next refresh.
	it('cancel PS+ un-owns claims only: purchases + milestones/dates/status intact, count named, and ps_plus_extra is LEFT ALONE (hazard)', async () => {
		// A sync-ingested claim carrying a live status, a milestone, and lifecycle
		// dates. It is an ESSENTIAL monthly game: NOT in the Extra snapshot, so 7.1
		// left its flag false — and cancelling must not invent a membership for it.
		const claimA = await insertGame(db(), {
			title: 'Claim With History',
			titleNormalized: 'claim with history',
			psPlusExtra: false,
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
		// …and a claim that IS in the Extra catalog: 7.1 flagged it (owned rows
		// included), so its pill returns on cancel with no write at all.
		const claimB = await insertGame(db(), {
			title: 'Plain Claim',
			titleNormalized: 'plain claim',
			psPlusExtra: true,
		});
		await upsertTracking(db(), userId, claimB.id, {
			owned: true,
			ownedVia: 'membership',
			playStatus: 'Not started',
		});
		// A real purchase must be left completely alone (never in the filter).
		const purchase = await insertGame(db(), {
			title: 'Real Purchase',
			titleNormalized: 'real purchase',
			psPlusExtra: false,
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

		// THE FLAG IS THE CATALOG'S CACHE, and cancel writes NOTHING to it (H2). The
		// Essential-only claim stays false — un-owning it must not hand it a ◈ PS+
		// pill, a place in the PS+ filter and a `yes` in the export for a month. The
		// Extra claim keeps the true 7.1 gave it, so its pill returns on its own.
		const [ga] = await findGamesByNormalizedTitle(db(), 'claim with history');
		const [gb] = await findGamesByNormalizedTitle(db(), 'plain claim');
		const [gp] = await findGamesByNormalizedTitle(db(), 'real purchase');
		expect(ga.psPlusExtra).toBe(false);
		expect(gb.psPlusExtra).toBe(true);
		expect(gp.psPlusExtra).toBe(false);

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
