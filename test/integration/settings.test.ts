import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { todayInZone } from '../../src/core';
import {
	getSetting,
	getTracking,
	insertGame,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import {
	getPsnCookie,
	markPsnAuthExpired,
	PSN_COOKIE_SETTING_KEY,
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
		expect(
			(
				await appFetch('/api/settings/psn-cookie', {
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ cookie: 'x' }),
				})
			).status,
		).toBe(401);
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
			psnCookieSet: false,
			psnAuthExpired: false,
			syncAttention: [],
			stragglerCount: 0,
			fabHandedness: 'right',
		});
	});

	it('PSN cookie: PUT saves per-user, GET reports presence only and never echoes the value (hazard)', async () => {
		// The value lands in an outbound Cookie header — whitespace-only,
		// pair-smuggling and control characters are refused at the boundary.
		for (const bad of ['   ', 'a;b', 'a b', 'a,b', 'a\nb', 'pdccws_p=']) {
			const rejected = await appFetch('/api/settings/psn-cookie', {
				method: 'PUT',
				headers: { 'content-type': 'application/json', cookie },
				body: JSON.stringify({ cookie: bad }),
			});
			expect(rejected.status, `expected 400 for ${JSON.stringify(bad)}`).toBe(
				400,
			);
		}

		// The classic paste mistake — copying the whole `name=value` pair —
		// is corrected, not stored verbatim.
		const pasted = await appFetch('/api/settings/psn-cookie', {
			method: 'PUT',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ cookie: 'pdccws_p=pair-pasted-value' }),
		});
		expect(pasted.status).toBe(200);
		expect(await getSetting(db(), userId, PSN_COOKIE_SETTING_KEY)).toBe(
			'pair-pasted-value',
		);

		const saved = await appFetch('/api/settings/psn-cookie', {
			method: 'PUT',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ cookie: '  psn-secret-value  ' }),
		});
		expect(saved.status).toBe(200);
		expect(await saved.json()).toEqual({
			psnCookieSet: true,
			psnAuthExpired: false,
		});

		// Stored trimmed; readable through the provider-facing service read.
		expect(await getSetting(db(), userId, PSN_COOKIE_SETTING_KEY)).toBe(
			'psn-secret-value',
		);
		expect(await getPsnCookie(db(), userId, {})).toBe('psn-secret-value');

		// The hazard: the secret must never ride back to the client.
		const res = await appFetch('/api/settings', { headers: { cookie } });
		const body = await res.text();
		expect(body).not.toContain('psn-secret-value');
		expect(JSON.parse(body)).toMatchObject({
			psnCookieSet: true,
			psnAuthExpired: false,
		});
	});

	it('PSN auth-expired flag: persists across requests, cleared only by a fresh cookie (hazard)', async () => {
		await markPsnAuthExpired(db(), userId);

		// Survives reloads — it is persisted state, not a dismissible toast.
		const flagged = await (
			await appFetch('/api/settings', { headers: { cookie } })
		).json();
		expect(flagged).toMatchObject({ psnAuthExpired: true });

		// Saving a fresh cookie is the one exit.
		await appFetch('/api/settings/psn-cookie', {
			method: 'PUT',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ cookie: 'fresh-cookie' }),
		});
		const cleared = await (
			await appFetch('/api/settings', { headers: { cookie } })
		).json();
		expect(cleared).toMatchObject({ psnAuthExpired: false });
	});

	it('PSN cookie seed: the env secret is used only while no setting is saved', async () => {
		// A saved setting always wins over the seed.
		expect(
			await getPsnCookie(db(), userId, { PSN_SESSION_COOKIE: 'env-seed' }),
		).toBe('fresh-cookie');

		// A user with no saved cookie falls back to the env seed, then to none.
		const other = 'user-with-no-cookie';
		expect(
			await getPsnCookie(db(), other, { PSN_SESSION_COOKIE: 'env-seed' }),
		).toBe('env-seed');
		expect(await getPsnCookie(db(), other, {})).toBeUndefined();
		// A whitespace-only secret (trailing-newline paste) is no seed at all.
		expect(
			await getPsnCookie(db(), other, { PSN_SESSION_COOKIE: ' \n' }),
		).toBeUndefined();
	});

	it('sync needs-attention: GET surfaces persisted items; corrupt JSON reads as empty (hazard)', async () => {
		const { writeSyncAttention, SYNC_ATTENTION_SETTING_KEY } = await import(
			'../../src/services/settings'
		);
		const { setSetting: rawSet } = await import('../../src/repositories');

		await writeSyncAttention(db(), userId, [
			{ title: 'Doppelganger', reason: 'ambiguous match' },
		]);
		const withItems = await (
			await appFetch('/api/settings', { headers: { cookie } })
		).json();
		expect(withItems).toMatchObject({
			syncAttention: [{ title: 'Doppelganger', reason: 'ambiguous match' }],
		});

		// Corrupt persisted JSON must degrade to "nothing needs attention",
		// never a 500 — the next completed sync overwrites it.
		await rawSet(db(), userId, SYNC_ATTENTION_SETTING_KEY, '{not json');
		const corrupt = await (
			await appFetch('/api/settings', { headers: { cookie } })
		).json();
		expect(corrupt).toMatchObject({ syncAttention: [] });

		// Empty write deletes the row (self-resolution).
		await writeSyncAttention(db(), userId, []);
		expect(
			await getSetting(db(), userId, SYNC_ATTENTION_SETTING_KEY),
		).toBeUndefined();
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
