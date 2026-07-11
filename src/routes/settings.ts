import { Hono } from 'hono';
import { z } from 'zod';
import { isValidTimeZone } from '../core';
import { getSetting, setSetting } from '../repositories';
import { createDb } from '../repositories/db';
import {
	clearPsnAuthExpired,
	FAB_HANDEDNESS_SETTING_KEY,
	getPsnCookie,
	isPsnAuthExpired,
	PSN_COOKIE_SETTING_KEY,
	readFabHandedness,
	readSyncAttention,
	TIMEZONE_SETTING_KEY,
} from '../services/settings';
import { countStragglers } from '../services/stragglers';
import { type AuthVariables, requireAuth } from './auth';

/**
 * User settings (Epic 2 retro timezone policy + Story 4.1 PSN cookie). The
 * SPA PUTs the browser's IANA zone with `onlyIfUnset: true` after login
 * (first-login capture); a plain PUT overwrites (the Settings panel edits
 * through the same endpoint). GET feeds that surface — for the PSN cookie it
 * reports PRESENCE only; the stored value is never echoed back to the client.
 */

const timezoneBodySchema = z.object({
	timezone: z.string().min(1).max(100),
	onlyIfUnset: z.boolean().optional(),
});

// The pasted value goes verbatim into an outbound Cookie header (via the PSN
// provider), so this is a trust boundary: strip the most common paste mistake
// (a leading `pdccws_p=` from copying the whole pair), then refuse anything
// that could smuggle extra cookie pairs or break the header — semicolons,
// commas, whitespace, control characters.
const psnCookieBodySchema = z.object({
	cookie: z
		.string()
		.trim()
		.transform((value) => value.replace(/^pdccws_p=/, ''))
		.pipe(
			z
				.string()
				.min(1)
				.max(4096)
				// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point — they would corrupt the outbound Cookie header.
				.regex(/^[^;,\s\x00-\x1f\x7f]+$/),
		),
});

type SettingsEnv = { Bindings: Env; Variables: AuthVariables };

export const settingsRoute = new Hono<SettingsEnv>();

settingsRoute.get('/settings', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	// Presence reflects the EFFECTIVE cookie (saved setting or the Wrangler
	// secret seed) — a deployment running on the seed must not claim "no
	// cookie" while sync works.
	const [
		timezone,
		psnCookie,
		psnAuthExpired,
		syncAttention,
		stragglerCount,
		fabHandedness,
	] = await Promise.all([
		getSetting(db, userId, TIMEZONE_SETTING_KEY),
		getPsnCookie(db, userId, c.env),
		isPsnAuthExpired(db, userId),
		readSyncAttention(db, userId),
		countStragglers(db, userId),
		readFabHandedness(db, userId),
	]);
	return c.json(
		{
			timezone: timezone ?? null,
			psnCookieSet: Boolean(psnCookie),
			psnAuthExpired,
			syncAttention,
			// Drives the amber "needs a match" banner (Story 6.2, AR-22).
			stragglerCount,
			// FAB placement (Story 6.3, UX-DR10).
			fabHandedness,
		},
		200,
	);
});

settingsRoute.put('/settings/psn-cookie', requireAuth, async (c) => {
	const body = psnCookieBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!body.success) {
		return c.json({ error: 'invalid cookie value' }, 400);
	}

	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	await setSetting(db, userId, PSN_COOKIE_SETTING_KEY, body.data.cookie);
	// A fresh cookie is the expired-banner's only exit (Story 4.1 AC3).
	await clearPsnAuthExpired(db, userId);
	return c.json({ psnCookieSet: true, psnAuthExpired: false }, 200);
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

const handednessBodySchema = z.object({
	handedness: z.enum(['left', 'right']),
});

settingsRoute.put('/settings/fab-handedness', requireAuth, async (c) => {
	const body = handednessBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!body.success) {
		return c.json({ error: 'invalid handedness' }, 400);
	}
	const db = createDb(c.env.DB);
	await setSetting(
		db,
		c.get('userId'),
		FAB_HANDEDNESS_SETTING_KEY,
		body.data.handedness,
	);
	return c.json({ fabHandedness: body.data.handedness }, 200);
});
