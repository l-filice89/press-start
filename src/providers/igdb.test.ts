import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetIgdbTokenCache, createIgdbProvider } from './igdb';

/**
 * Wire-level IGDB adapter tests over a mocked fetch. Axes:
 *  - failure-mode fixtures are the REAL payloads captured from a live probe
 *    (2026-07-11, igdb-failure-mode-probe-2026-07-11.md), not hand-written
 *    shapes (PROBE-BEFORE-YOU-MAP). The DEGENERATE-RESPONSE GUARD row is
 *    load-bearing: a 200 that isn't the game array must fail closed.
 *  - auth is client-credentials: the app mints/caches a Twitch token from the
 *    permanent id+secret and self-heals a 401 by minting a fresh one — no
 *    manual 60-day rotation. Those rows assert the mint/cache/refresh path.
 *  - the add-by-name preview (Story 6.1): `searchCandidate` prefers the
 *    exact-normalized match but falls back to IGDB's top relevance hit (unlike
 *    `enrich`, which stays exact-or-null).
 */

const HADES = {
	id: 113112,
	name: 'Hades',
	first_release_date: 1600300800,
	cover: { image_id: 'cob9kr' },
	genres: [{ name: 'Role-playing (RPG)' }, { name: 'Indie' }],
};

const igdbGame = (
	id: number,
	name: string,
	extra: Record<string, unknown> = {},
) => ({ id, name, ...extra });

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

const isTokenUrl = (url: unknown) =>
	String(url).startsWith('https://id.twitch.tv');

/** Route fetch: Twitch token endpoint → `token`, IGDB games → `games`. */
function stubFetch(opts: { token?: () => Response; games: () => Response }) {
	const token =
		opts.token ??
		(() => jsonResponse({ access_token: 'app-tok', expires_in: 5_000_000 }));
	const fetchMock = vi.fn(async (url: unknown) =>
		isTokenUrl(url) ? token() : opts.games(),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

const tokenMints = (m: ReturnType<typeof vi.fn>) =>
	m.mock.calls.filter((c) => isTokenUrl(c[0])).length;

const provider = () =>
	createIgdbProvider({
		clientId: 'cid',
		clientSecret: 'secret',
		minIntervalMs: 0,
	});

beforeEach(() => __resetIgdbTokenCache());
afterEach(() => vi.unstubAllGlobals());

describe('createIgdbProvider.enrich (live-probed failure modes)', () => {
	it('mints a token then maps a 200 game array to enrichment', async () => {
		const m = stubFetch({ games: () => jsonResponse([HADES]) });
		expect(await provider().enrich('Hades')).toEqual({
			coverUrl:
				'https://images.igdb.com/igdb/image/upload/t_cover_big/cob9kr.jpg',
			releaseDate: '2020-09-17',
			genres: ['Role-playing (RPG)', 'Indie'],
		});
		expect(tokenMints(m)).toBe(1);
	});

	it('returns null on an empty 200 array (no match — name-only fallback path)', async () => {
		stubFetch({ games: () => jsonResponse([]) });
		expect(await provider().enrich('zzqxwv nonexistent 99871')).toBeNull();
	});

	it('DEGENERATE GUARD: a 200 with a non-array body fails closed, not a TypeError', async () => {
		// The /count shape is a real 200 object: {"count":N}. Must throw clean.
		stubFetch({ games: () => jsonResponse({ count: 31 }) });
		await expect(provider().enrich('Hades')).rejects.toThrow(/non-array body/);
	});

	it('throws on a 400 syntax error (captured array error body)', async () => {
		stubFetch({
			games: () => jsonResponse([{ title: 'Syntax Error', status: 400 }], 400),
		});
		await expect(provider().enrich('Hades')).rejects.toThrow(/400/);
	});
});

describe('createIgdbProvider auth (client-credentials, self-healing)', () => {
	it('caches the app token across calls (mints once)', async () => {
		const m = stubFetch({ games: () => jsonResponse([HADES]) });
		const p = provider();
		await p.enrich('Hades');
		await p.enrich('Hades');
		expect(tokenMints(m)).toBe(1);
	});

	it('self-heals a 401 by minting a fresh token and retrying once', async () => {
		let call = 0;
		// First games call 401s (stale/expired token), the retry succeeds.
		const m = stubFetch({
			games: () =>
				call++ === 0
					? jsonResponse({ message: 'Too Many Requests' }, 401)
					: jsonResponse([HADES]),
		});
		expect(await provider().enrich('Hades')).not.toBeNull();
		expect(tokenMints(m)).toBe(2); // initial + forced refresh
	});

	it('throws a bad-credential error when a freshly minted token still 401s', async () => {
		const m = stubFetch({
			games: () => jsonResponse({ message: 'Authorization Failure' }, 401),
		});
		await expect(provider().enrich('Hades')).rejects.toThrow(
			/IGDB_CLIENT_SECRET/,
		);
		expect(tokenMints(m)).toBe(2); // tried a fresh token before giving up
	});

	it('surfaces a Twitch token-mint failure as a credential error', async () => {
		stubFetch({
			token: () => jsonResponse({ message: 'invalid client secret' }, 403),
			games: () => jsonResponse([HADES]),
		});
		await expect(provider().enrich('Hades')).rejects.toThrow(
			/IGDB_CLIENT_SECRET/,
		);
	});
});

describe('createIgdbProvider.searchCandidate', () => {
	it('prefers the exact-normalized match over the top relevance hit', async () => {
		stubFetch({
			games: () =>
				jsonResponse([
					igdbGame(1, 'Hades II'),
					igdbGame(2, 'Hades', {
						first_release_date: 1600300800,
						cover: { image_id: 'abc' },
						genres: [{ name: 'Roguelike' }],
					}),
				]),
		});

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
		stubFetch({
			games: () =>
				jsonResponse([
					igdbGame(7, 'Elden Ring: Shadow of the Erdtree'),
					igdbGame(8, 'Elden Ring II'),
				]),
		});

		const candidate = await provider().searchCandidate('elden rin');

		expect(candidate?.igdbId).toBe('7');
		expect(candidate?.name).toBe('Elden Ring: Shadow of the Erdtree');
	});

	it('returns null for an empty result set', async () => {
		stubFetch({ games: () => jsonResponse([]) });
		expect(await provider().searchCandidate('zzz nothing')).toBeNull();
	});

	it('throws when auth fails so the caller can degrade (never persists a guess)', async () => {
		// A persistent 401 self-heals once, then surfaces a credential error.
		stubFetch({
			games: () => jsonResponse({ message: 'expired' }, 401),
		});
		await expect(provider().searchCandidate('Hades')).rejects.toThrow(
			/IGDB_CLIENT_SECRET/,
		);
	});
});
