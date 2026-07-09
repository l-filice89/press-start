import { applyD1Migrations, env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { insertGame, upsertTracking } from '../../src/repositories';
import { createDb } from '../../src/repositories/db';
import { user } from '../../src/schema';
import { genre } from '../../src/schema/catalog';
import { ALLOWED_EMAIL, appFetch, establishSession } from './session';

/**
 * Story 2.5 integration tests: the genre-editing write path through the real
 * Worker with a real session. The named hazard (FR-24: a name not in the
 * vocabulary auto-creates the genre row exactly once, a case-insensitive
 * match reuses the existing row) is asserted on row counts, not just the
 * response body.
 */

const db = () => createDb(env.DB);

async function seedUser(email: string) {
	const id = crypto.randomUUID();
	const now = new Date();
	await db().insert(user).values({
		id,
		name: email,
		email,
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
	return id;
}

async function addGame(userId: string, title: string) {
	const g = await insertGame(db(), {
		title,
		titleNormalized: title.toLowerCase(),
	});
	await upsertTracking(db(), userId, g.id, { playStatus: 'Not started' });
	return g.id;
}

/** POST the add-genre route through the real Worker. */
function postGenre(gameId: string, body: unknown, cookie?: string) {
	return appFetch(`/api/games/${gameId}/genres`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify(body),
	});
}

/** DELETE the remove-genre route through the real Worker. */
function deleteGenre(gameId: string, name: string, cookie?: string) {
	return appFetch(`/api/games/${gameId}/genres/${encodeURIComponent(name)}`, {
		method: 'DELETE',
		headers: cookie ? { cookie } : {},
	});
}

/** Vocabulary rows matching a name case-insensitively. */
async function vocabularyRows(name: string) {
	return db()
		.select()
		.from(genre)
		.where(sql`lower(${genre.name}) = lower(${name})`);
}

let sessionCookie: string;
let sessionUser: string;
let foreignUser: string;

describe('genre edits (Story 2.5, through the route with a real session)', () => {
	beforeAll(async () => {
		await applyD1Migrations(env.DB, inject('migrations'));
		sessionCookie = await establishSession();
		const [row] = await db()
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, ALLOWED_EMAIL))
			.limit(1);
		sessionUser = row.id;
		foreignUser = await seedUser('genres-foreign@example.com');
	});

	it('auto-creates a genre row exactly once and links it (FR-24)', async () => {
		const id = await addGame(sessionUser, 'Hades');

		const res = await postGenre(id, { name: 'Roguelite' }, sessionCookie);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ genres: ['Roguelite'] });
		expect(await vocabularyRows('Roguelite')).toHaveLength(1);

		// A case-variant re-add reuses the row — no near-duplicate, no dupe link.
		const again = await postGenre(id, { name: 'roguelite' }, sessionCookie);
		expect(again.status).toBe(200);
		expect(await again.json()).toEqual({ genres: ['Roguelite'] });
		expect(await vocabularyRows('Roguelite')).toHaveLength(1);
	});

	it('links an existing vocabulary genre without creating a new row', async () => {
		const seededGame = await addGame(sessionUser, 'Seeder');
		await postGenre(seededGame, { name: 'Action' }, sessionCookie);

		const id = await addGame(sessionUser, 'Bayonetta');
		const res = await postGenre(id, { name: 'Action' }, sessionCookie);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ genres: ['Action'] });
		expect(await vocabularyRows('Action')).toHaveLength(1);
	});

	it('re-adding an already-linked genre changes nothing (idempotent)', async () => {
		const id = await addGame(sessionUser, 'Doom');
		await postGenre(id, { name: 'Shooter' }, sessionCookie);

		const res = await postGenre(id, { name: 'Shooter' }, sessionCookie);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ genres: ['Shooter'] });
	});

	it('trims and collapses whitespace before matching or creating', async () => {
		const id = await addGame(sessionUser, 'Zelda');

		const res = await postGenre(id, { name: '  Open   world ' }, sessionCookie);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ genres: ['Open world'] });
		expect(await vocabularyRows('Open world')).toHaveLength(1);
	});

	it('rejects an empty (whitespace-only) name with 400, nothing written', async () => {
		const id = await addGame(sessionUser, 'Blank');

		const res = await postGenre(id, { name: '   ' }, sessionCookie);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'invalid genre' });
	});

	it('rejects a malformed (non-string) body with 400', async () => {
		const id = await addGame(sessionUser, 'Malformed');

		const res = await postGenre(id, { name: 42 }, sessionCookie);
		expect(res.status).toBe(400);
	});

	it('rejects a name over 64 characters with 400, nothing written', async () => {
		const id = await addGame(sessionUser, 'Oversize');

		const name = 'X'.repeat(65);
		const res = await postGenre(id, { name }, sessionCookie);
		expect(res.status).toBe(400);
		expect(await vocabularyRows(name)).toHaveLength(0);
	});

	it('removes a linked genre; the vocabulary row survives', async () => {
		const id = await addGame(sessionUser, 'Journey');
		await postGenre(id, { name: 'Adventure' }, sessionCookie);

		const res = await deleteGenre(id, 'Adventure', sessionCookie);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ genres: [] });
		// FR-25: no vocabulary garbage collection — the row stays for reuse.
		expect(await vocabularyRows('Adventure')).toHaveLength(1);
	});

	it('removing an unlinked or unknown genre answers the list unchanged', async () => {
		const id = await addGame(sessionUser, 'Tetris');
		await postGenre(id, { name: 'Puzzle' }, sessionCookie);

		const res = await deleteGenre(id, 'Zzz Unknown', sessionCookie);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ genres: ['Puzzle'] });
	});

	it('lists the vocabulary sorted case-insensitively by name', async () => {
		// Self-seeded: this test does not depend on what earlier tests added.
		const id = await addGame(sessionUser, 'Vocab Seeder');
		await postGenre(id, { name: 'aardvark simulator' }, sessionCookie);
		await postGenre(id, { name: 'Zoo tycoon' }, sessionCookie);

		const res = await appFetch('/api/genres', {
			headers: { cookie: sessionCookie },
		});
		expect(res.status).toBe(200);
		const { genres } = (await res.json()) as { genres: string[] };
		expect(genres).toContain('aardvark simulator');
		expect(genres).toContain('Zoo tycoon');
		// NOCASE order — a lowercase name must not sink below the uppercase set.
		const lowered = genres.map((g) => g.toLowerCase());
		expect(lowered).toEqual([...lowered].sort());
	});

	it('rejects an unauthenticated request with 401 JSON (requireAuth seam)', async () => {
		const id = await addGame(sessionUser, 'NoCookie');

		for (const res of [
			await postGenre(id, { name: 'Action' }),
			await deleteGenre(id, 'Action'),
			await appFetch('/api/genres'),
		]) {
			expect(res.status).toBe(401);
		}
	});

	it('answers 404 for a game this user does not track, writing nothing', async () => {
		const foreignGame = await addGame(foreignUser, 'Foreign Genres');

		const added = await postGenre(
			foreignGame,
			{ name: 'Intruded' },
			sessionCookie,
		);
		expect(added.status).toBe(404);
		expect(await vocabularyRows('Intruded')).toHaveLength(0);

		const removed = await deleteGenre(foreignGame, 'Action', sessionCookie);
		expect(removed.status).toBe(404);
	});
});
