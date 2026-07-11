import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIgdbProvider } from './igdb';

/**
 * Wire-level IGDB adapter tests for the add-by-name preview (Story 6.1) over
 * a mocked fetch. The behavior rows: `searchCandidate` prefers the
 * exact-normalized match but falls back to IGDB's top relevance hit (unlike
 * `enrich`, which stays exact-or-null), and auth failures throw (AD-14).
 */

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

const igdbGame = (
	id: number,
	name: string,
	extra: Record<string, unknown> = {},
) => ({ id, name, ...extra });

const provider = () =>
	createIgdbProvider({ clientId: 'c', accessToken: 't', minIntervalMs: 0 });

afterEach(() => vi.unstubAllGlobals());

describe('createIgdbProvider.searchCandidate', () => {
	it('prefers the exact-normalized match over the top relevance hit', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse([
					igdbGame(1, 'Hades II'),
					igdbGame(2, 'Hades', {
						first_release_date: 1600300800,
						cover: { image_id: 'abc' },
						genres: [{ name: 'Roguelike' }],
					}),
				]),
			),
		);

		const candidate = await provider().searchCandidate('Hades');

		expect(candidate).toEqual({
			igdbId: '2',
			name: 'Hades',
			coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg',
			releaseDate: '2020-09-17',
			genres: ['Roguelike'],
		});
	});

	it('falls back to the first result when no normalized-exact match exists', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse([
					igdbGame(7, 'Elden Ring: Shadow of the Erdtree'),
					igdbGame(8, 'Elden Ring II'),
				]),
			),
		);

		const candidate = await provider().searchCandidate('elden rin');

		expect(candidate?.igdbId).toBe('7');
		expect(candidate?.name).toBe('Elden Ring: Shadow of the Erdtree');
	});

	it('returns null for an empty result set', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse([])),
		);
		expect(await provider().searchCandidate('zzz nothing')).toBeNull();
	});

	it('throws on 401 so the caller can degrade (never persists a guess)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ message: 'expired' }, 401)),
		);
		await expect(provider().searchCandidate('Hades')).rejects.toThrow(
			/access token/,
		);
	});
});
