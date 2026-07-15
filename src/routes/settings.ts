import { Hono } from 'hono';
import { z } from 'zod';
import { isValidTimeZone } from '../core';
import { deleteSetting, getSetting, setSetting } from '../repositories';
import { createDb } from '../repositories/db';
import {
	clearPsPlusRefreshFailed,
	FAB_HANDEDNESS_SETTING_KEY,
	getPsnRegion,
	getPsPlusRefreshedAt,
	isPsPlusRefreshFailed,
	PSN_REGION_SETTING_KEY,
	PSPLUS_REFRESHED_AT_SETTING_KEY,
	readFabHandedness,
	TIMEZONE_SETTING_KEY,
} from '../services/settings';
import { countStragglers } from '../services/stragglers';
import { cancelMembership, countMembershipClaims } from '../services/tracking';
import { type AuthVariables, requireAuth } from './auth';

/**
 * User settings (Epic 2 retro timezone policy). The SPA PUTs the browser's
 * IANA zone with `onlyIfUnset: true` after login (first-login capture); a
 * plain PUT overwrites (the Settings panel edits through the same endpoint).
 * GET feeds that surface.
 */

const timezoneBodySchema = z.object({
	timezone: z.string().min(1).max(100),
	onlyIfUnset: z.boolean().optional(),
});

type SettingsEnv = { Bindings: Env; Variables: AuthVariables };

export const settingsRoute = new Hono<SettingsEnv>();

settingsRoute.get('/settings', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	const [
		timezone,
		psPlusRefreshFailed,
		psPlusRefreshedAt,
		stragglerCount,
		fabHandedness,
		psPlusClaimCount,
		region,
	] = await Promise.all([
		getSetting(db, userId, TIMEZONE_SETTING_KEY),
		isPsPlusRefreshFailed(db, userId),
		getPsPlusRefreshedAt(db, userId),
		countStragglers(db, userId),
		readFabHandedness(db, userId),
		countMembershipClaims(db, userId),
		// Effective region (saved setting or the PSN_REGION seed) — presence of
		// the working value, not just the stored row.
		getPsnRegion(db, userId, c.env),
	]);
	return c.json(
		{
			timezone: timezone ?? null,
			psPlusRefreshFailed,
			psPlusRefreshedAt,
			// Drives the amber "needs a match" banner (Story 6.2, AR-22).
			stragglerCount,
			// FAB placement (Story 6.3, UX-DR10).
			fabHandedness,
			// Owned PS+ claims (Story 6.4): drives + names the cancel-PS+ confirm.
			psPlusClaimCount,
			// PSN store region the PS+ catalog is fetched for (anonymous call).
			region: region ?? null,
		},
		200,
	);
});

// "I cancelled PS+" (Story 6.4 AC4): un-own every `owned_via='membership'` row,
// purchases untouched, and re-flag those games so their PS+ pill re-shows. A
// local D1 mutation only — no PSN/IGDB call; the existing PS+ check reconciles
// catalog truth. Answers with the count actually un-owned.
settingsRoute.post('/settings/cancel-ps-plus', requireAuth, async (c) => {
	const { unowned } = await cancelMembership(
		createDb(c.env.DB),
		c.get('userId'),
	);
	return c.json({ unowned }, 200);
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

// Store locale, e.g. `it-it` / `en-us` / `zh-hans-hk` (Sony has 3-part locales
// with a script segment). Free text with a shape guard — Sony's locale set
// drifts, so no pinned list; a wrong-but-well-formed value degrades to the
// provider's existing bad-region handling (null grid → provider error).
const psnRegionBodySchema = z.object({
	region: z
		.string()
		.transform((value) => value.trim().toLowerCase())
		.pipe(z.string().regex(/^[a-z]{2}(-[a-z]{2,4})?-[a-z]{2}$/)),
});

settingsRoute.put('/settings/psn-region', requireAuth, async (c) => {
	const body = psnRegionBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!body.success) {
		return c.json({ error: 'invalid region' }, 400);
	}
	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	const previous = await getSetting(db, userId, PSN_REGION_SETTING_KEY);
	await setSetting(db, userId, PSN_REGION_SETTING_KEY, body.data.region);
	// A REAL region change orphans the old region's refresh stamps: the header
	// would date a catalog the new region never had. Clear both; the next check
	// (button or cron) restamps them. Re-saving the same region clears nothing.
	if (previous && previous !== body.data.region) {
		await Promise.all([
			deleteSetting(db, userId, PSPLUS_REFRESHED_AT_SETTING_KEY),
			clearPsPlusRefreshFailed(db, userId),
		]);
	}
	return c.json({ region: body.data.region }, 200);
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
