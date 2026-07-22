import { applyD1Migrations, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { normalizeTitle } from '../../src/core';
import {
	getTracking,
	insertGame,
	insertTrackingIfAbsent,
	recordRegionOutcome,
} from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { appFetch, establishSession, TEST_EMAIL } from './session';

/**
 * Discard (soft-delete tombstone) integration, through the real Worker + local
 * D1. The hazards: a discarded game must leave EVERY library surface (shelf,
 * search, stragglers) via the single `listLibraryForUser` filter, and re-adding
 * the name must REVIVE the row (never duplicate). (The "sync must not re-own a
 * tombstone" hazard died with the credentialed sync — Epic 11 story 11.1.)
 */

const db = () => createDb(env.DB);

function patch(path: string, body: unknown, cookie: string) {
	return appFetch(path, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify(body),
	});
}

const discard = (gameId: string, discarded: boolean, cookie: string) =>
	patch(`/api/games/${gameId}/discard`, { discarded }, cookie);

async function shelfTitles(cookie: string): Promise<string[]> {
	const res = await appFetch('/api/shelf?include=hidden', {
		headers: { cookie },
	});
	const { games } = (await res.json()) as { games: { title: string }[] };
	return games.map((g) => g.title);
}

let cookie: string;
let userId: string;

async function trackedGame(title: string, unenriched = false) {
	const g = await insertGame(db(), {
		title,
		titleNormalized: normalizeTitle(title),
		unenriched,
	});
	await insertTrackingIfAbsent(db(), userId, g.id, {
		owned: false,
		playStatus: 'Not started',
		wishlistedOn: '2026-07-11',
	});
	return g;
}

describe('discard (soft-delete tombstone, through the route)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		// Story 8.4: /api/shelf's waitUntil stale-snapshot guard would otherwise
		// hit the REAL store (nothing stubs fetch here) — a fresh ledger row for
		// the env-seeded region keeps it dormant.
		await recordRegionOutcome(db(), 'it-it', {
			attemptedOn: new Date().toISOString().slice(0, 10),
			succeeded: true,
			window: new Date().toISOString().slice(0, 7),
		});
		cookie = await establishSession();
		const [row] = await db()
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, TEST_EMAIL))
			.limit(1);
		userId = row.id;
	});

	it('hides a discarded game from the shelf and revives it on undo', async () => {
		const g = await trackedGame('Discard Me');
		expect(await shelfTitles(cookie)).toContain('Discard Me');

		const res = await discard(g.id, true, cookie);
		expect(res.status).toBe(200);
		expect((await res.json()) as { discarded: boolean }).toEqual({
			discarded: true,
		});
		expect((await getTracking(db(), userId, g.id))?.discarded).toBe(true);
		expect(await shelfTitles(cookie)).not.toContain('Discard Me');

		// UNDO = revive through the same endpoint.
		expect((await discard(g.id, false, cookie)).status).toBe(200);
		expect((await getTracking(db(), userId, g.id))?.discarded).toBe(false);
		expect(await shelfTitles(cookie)).toContain('Discard Me');
	});

	it('drops a discarded name-only game from the shelf and the stragglers list', async () => {
		const g = await trackedGame('Zzz Only Search', true);
		await discard(g.id, true, cookie);

		expect(await shelfTitles(cookie)).not.toContain('Zzz Only Search');

		const strag = await appFetch('/api/stragglers', { headers: { cookie } });
		const { stragglers } = (await strag.json()) as {
			stragglers: { id: string }[];
		};
		expect(stragglers.map((s) => s.id)).not.toContain(g.id);
	});

	it('404s a discard on a game the user does not track', async () => {
		const g = await insertGame(db(), {
			title: 'Untracked',
			titleNormalized: normalizeTitle('Untracked'),
		});
		expect((await discard(g.id, true, cookie)).status).toBe(404);
	});

	it('revives a discarded game when its name is re-added (no duplicate row)', async () => {
		const g = await trackedGame('Revive By Readd', true);
		await discard(g.id, true, cookie);
		expect(await shelfTitles(cookie)).not.toContain('Revive By Readd');

		// Re-adding the same name resolves to the existing row (409 duplicate) and
		// clears the tombstone — the ONLY revive path besides UNDO.
		const readd = await appFetch('/api/games', {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ title: 'Revive By Readd' }),
		});
		expect(readd.status).toBe(409);
		expect(((await readd.json()) as { gameId: string }).gameId).toBe(g.id);
		expect((await getTracking(db(), userId, g.id))?.discarded).toBe(false);
		expect(await shelfTitles(cookie)).toContain('Revive By Readd');
	});
});
