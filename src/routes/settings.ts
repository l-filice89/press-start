import { Hono } from 'hono';
import { z } from 'zod';
import { isValidTimeZone } from '../core';
import { getSetting, setSetting } from '../repositories';
import { createDb } from '../repositories/db';
import { TIMEZONE_SETTING_KEY } from '../services/settings';
import { type AuthVariables, requireAuth } from './auth';

/**
 * User settings (Epic 2 retro timezone policy). The SPA PUTs the browser's
 * IANA zone with `onlyIfUnset: true` after login (first-login capture); a
 * plain PUT overwrites (the future Settings surface edits through the same
 * endpoint). GET feeds that surface.
 */

const timezoneBodySchema = z.object({
	timezone: z.string().min(1).max(100),
	onlyIfUnset: z.boolean().optional(),
});

type SettingsEnv = { Bindings: Env; Variables: AuthVariables };

export const settingsRoute = new Hono<SettingsEnv>();

settingsRoute.get('/settings', requireAuth, async (c) => {
	const timezone = await getSetting(
		createDb(c.env.DB),
		c.get('userId'),
		TIMEZONE_SETTING_KEY,
	);
	return c.json({ timezone: timezone ?? null }, 200);
});

settingsRoute.put('/settings/timezone', requireAuth, async (c) => {
	const body = timezoneBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!body.success || !isValidTimeZone(body.data.timezone)) {
		return c.json({ error: 'invalid timezone' }, 400);
	}

	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	await setSetting(db, userId, TIMEZONE_SETTING_KEY, body.data.timezone, {
		onlyIfUnset: body.data.onlyIfUnset ?? false,
	});
	// Report what actually stands — under `onlyIfUnset` that may be the
	// earlier value, not the one just sent.
	const timezone = await getSetting(db, userId, TIMEZONE_SETTING_KEY);
	return c.json({ timezone: timezone ?? null }, 200);
});
