import { Hono } from 'hono';
import { z } from 'zod';
import { isValidTimeZone } from '../core';
import { getSetting, setSetting } from '../repositories';
import { createDb } from '../repositories/db';
import {
	clearPsnAuthExpired,
	FAB_HANDEDNESS_SETTING_KEY,
	getPsnNpsso,
	getPsPlusRefreshedAt,
	isPsnAuthExpired,
	isPsPlusRefreshFailed,
	PSN_NPSSO_SETTING_KEY,
	readFabHandedness,
	readSyncAttention,
	TIMEZONE_SETTING_KEY,
} from '../services/settings';
import { countStragglers } from '../services/stragglers';
import { cancelMembership, countMembershipClaims } from '../services/tracking';
import { type AuthVariables, requireAuth } from './auth';

/**
 * User settings (Epic 2 retro timezone policy + Story 9.1b PSN NPSSO). The
 * SPA PUTs the browser's IANA zone with `onlyIfUnset: true` after login
 * (first-login capture); a plain PUT overwrites (the Settings panel edits
 * through the same endpoint). GET feeds that surface — for the NPSSO token it
 * reports PRESENCE only; the stored value is never echoed back to the client.
 */

const timezoneBodySchema = z.object({
	timezone: z.string().min(1).max(100),
	onlyIfUnset: z.boolean().optional(),
});

/**
 * What the user actually pastes. The Settings deep link opens Sony's
 * `/api/v1/ssocookie`, which renders `{"npsso":"abc…"}` — so the whole JSON
 * blob is the COMMON paste, not the exception (and it slips through the
 * charset guard below, storing garbage). Unwrap it, plus the two other paste
 * shapes: surrounding quotes and a leading `npsso=` from copying the pair.
 */
function unwrapNpsso(raw: string): string {
	const value = raw.trim();
	if (value.startsWith('{')) {
		try {
			const parsed = JSON.parse(value) as { npsso?: unknown };
			if (typeof parsed?.npsso === 'string') return parsed.npsso.trim();
		} catch {
			// Not JSON after all — fall through to the plain-paste path.
		}
	}
	return value
		.replace(/^npsso=/, '')
		.replace(/^"(.*)"$/s, '$1')
		.trim();
}

// The unwrapped value goes verbatim into an outbound Cookie header (the
// provider exchanges it as `npsso=<value>`), so this is a trust boundary: the
// charset guard runs on the FINAL value and refuses anything that could smuggle
// extra cookie pairs or break the header — semicolons, commas, whitespace,
// control characters.
const psnNpssoBodySchema = z.object({
	npsso: z
		.string()
		.transform(unwrapNpsso)
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
	// Presence reflects the EFFECTIVE token (saved setting or the Wrangler
	// secret seed) — a deployment running on the seed must not claim "no
	// token" while sync works.
	const [
		timezone,
		psnNpsso,
		psnAuthExpired,
		syncAttention,
		psPlusRefreshFailed,
		psPlusRefreshedAt,
		stragglerCount,
		fabHandedness,
		psPlusClaimCount,
	] = await Promise.all([
		getSetting(db, userId, TIMEZONE_SETTING_KEY),
		getPsnNpsso(db, userId, c.env),
		isPsnAuthExpired(db, userId),
		readSyncAttention(db, userId),
		isPsPlusRefreshFailed(db, userId),
		getPsPlusRefreshedAt(db, userId),
		countStragglers(db, userId),
		readFabHandedness(db, userId),
		countMembershipClaims(db, userId),
	]);
	return c.json(
		{
			timezone: timezone ?? null,
			psnNpssoSet: Boolean(psnNpsso),
			psnAuthExpired,
			syncAttention,
			psPlusRefreshFailed,
			psPlusRefreshedAt,
			// Drives the amber "needs a match" banner (Story 6.2, AR-22).
			stragglerCount,
			// FAB placement (Story 6.3, UX-DR10).
			fabHandedness,
			// Owned PS+ claims (Story 6.4): drives + names the cancel-PS+ confirm.
			psPlusClaimCount,
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

settingsRoute.put('/settings/psn-npsso', requireAuth, async (c) => {
	const body = psnNpssoBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!body.success) {
		return c.json({ error: 'invalid npsso value' }, 400);
	}

	const db = createDb(c.env.DB);
	const userId = c.get('userId');
	await setSetting(db, userId, PSN_NPSSO_SETTING_KEY, body.data.npsso);
	// A fresh token is the expired-banner's only exit (Story 4.1 AC3).
	await clearPsnAuthExpired(db, userId);
	return c.json({ psnNpssoSet: true, psnAuthExpired: false }, 200);
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
