import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { todayInZone } from '../../src/core';
import {
	getTracking,
	insertGame,
	upsertTracking,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
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
		});
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
