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

// Score fields captured live 2026-07-16 (Story 10.1 probe — real payload, not
// hand-written): floats stored verbatim, rounding is a render concern.
const HADES = {
	id: 113112,
	name: 'Hades',
	first_release_date: 1600300800,
	cover: { image_id: 'cob9kr' },
	genres: [{ name: 'Role-playing (RPG)' }, { name: 'Indie' }],
	aggregated_rating: 93.52941176470588,
	aggregated_rating_count: 17,
	rating: 89.47202036710553,
	rating_count: 1699,
};

const HADES_SCORES = {
	criticScore: 93.52941176470588,
	criticScoreCount: 17,
	userScore: 89.47202036710553,
	userScoreCount: 1699,
};

const NO_SCORES = {
	criticScore: null,
	criticScoreCount: null,
	userScore: null,
	userScoreCount: null,
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

/** Route fetch: Twitch token → `token`, `/game_time_to_beats` → `ttb`
 * (defaults to an empty array so a misrouted TTB call from a scores test
 * surfaces as missing data, never as the games fixture), else `games`. */
function stubFetch(opts: {
	token?: () => Response;
	games: () => Response;
	ttb?: () => Response;
}) {
	const token =
		opts.token ??
		(() => jsonResponse({ access_token: 'app-tok', expires_in: 5_000_000 }));
	// Second param typed so `calls[i][1]` (the request init) is reachable — the
	// PV-2 query-body assertion inspects it.
	const fetchMock = vi.fn(async (url: unknown, _init?: unknown) =>
		isTokenUrl(url)
			? token()
			: String(url).includes('game_time_to_beats')
				? (opts.ttb ?? (() => jsonResponse([])))()
				: opts.games(),
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
			...HADES_SCORES,
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

describe('createIgdbProvider query (PV-2 game_type filter)', () => {
	it('filters the games query to full games only (drops DLC noise, keeps bundles)', async () => {
		const m = stubFetch({ games: () => jsonResponse([HADES]) });
		await provider().enrich('Hades');
		const gamesCall = m.mock.calls.find((c) => !isTokenUrl(c[0]));
		const body = String((gamesCall?.[1] as RequestInit).body);
		// `game_type`, NOT the retired `category` field — the latter matches zero
		// rows live and empties every search (fixed 2026-07-13). Bundle (3) is in:
		// store collections (N. Sane Trilogy, ME Legendary) live there (v2.1.1).
		expect(body).toContain('where game_type = (0,2,3,4,6,8,9,10,11);');
		expect(body).not.toContain('category');
	});

	it('requests the four score fields on the SAME games call (VR-5: no second adapter)', async () => {
		const m = stubFetch({ games: () => jsonResponse([HADES]) });
		await provider().enrich('Hades');
		const gamesCall = m.mock.calls.find((c) => !isTokenUrl(c[0]));
		const body = String((gamesCall?.[1] as RequestInit).body);
		for (const field of [
			'aggregated_rating',
			'aggregated_rating_count',
			'rating',
			'rating_count',
		]) {
			expect(body).toContain(field);
		}
	});
});

describe('createIgdbProvider.fetchScoresByIds (Story 10.1 refresh fetch)', () => {
	it('fetches one batched where-id query and maps rows to IgdbScores', async () => {
		const m = stubFetch({
			games: () => jsonResponse([HADES, igdbGame(42, 'Unscored Game')]),
		});
		const rows = await provider().fetchScoresByIds(['113112', '42']);
		expect(rows).toEqual([
			{ igdbId: '113112', ...HADES_SCORES },
			{ igdbId: '42', ...NO_SCORES },
		]);
		const gamesCalls = m.mock.calls.filter((c) => !isTokenUrl(c[0]));
		expect(gamesCalls).toHaveLength(1); // 2 ids, ONE subrequest
		const body = String((gamesCalls[0]?.[1] as RequestInit).body);
		expect(body).toContain('where id = (113112,42);');
		expect(body).toContain('limit 500;');
		// A refresh must not re-filter by game_type: an anchored id is trusted.
		expect(body).not.toContain('game_type');
	});

	it('drops non-numeric ids instead of interpolating them into the query', async () => {
		const m = stubFetch({ games: () => jsonResponse([HADES]) });
		await provider().fetchScoresByIds(['113112', 'evil); fields *;']);
		const body = String(
			(m.mock.calls.find((c) => !isTokenUrl(c[0]))?.[1] as RequestInit).body,
		);
		expect(body).toContain('where id = (113112);');
		expect(body).not.toContain('evil');
	});

	it('DEGENERATE GUARD: a 200 non-array body fails closed here too', async () => {
		stubFetch({ games: () => jsonResponse({ count: 31 }) });
		await expect(provider().fetchScoresByIds(['113112'])).rejects.toThrow(
			/non-array body/,
		);
	});
});

describe('createIgdbProvider.fetchTimeToBeatByIds (Story 10.3)', () => {
	// Captured live 2026-07-16 (probe artifact) — seconds, keyed by game_id.
	const TTB_ROW = {
		id: 3540,
		game_id: 159119,
		normally: 54000,
		completely: 95400,
		count: 8,
	};

	it('queries /game_time_to_beats by game_id and maps seconds verbatim', async () => {
		const m = stubFetch({
			games: () => jsonResponse([]),
			ttb: () => jsonResponse([TTB_ROW, { id: 1, game_id: 42, count: 2 }]),
		});
		const rows = await provider().fetchTimeToBeatByIds(['159119', '42']);
		expect(rows).toEqual([
			{
				igdbId: '159119',
				ttbStorySeconds: 54000,
				ttbCompleteSeconds: 95400,
				ttbCount: 8,
			},
			// The count-only record for 42 is DROPPED entirely — an all-null row
			// would wipe stored hours, and an anomaly must not erase standing
			// data any more than a missing record does (follow-up review).
		]);
		const ttbCalls = m.mock.calls.filter((c) =>
			String(c[0]).includes('game_time_to_beats'),
		);
		expect(ttbCalls).toHaveLength(1); // 2 ids, ONE subrequest
		const body = String((ttbCalls[0]?.[1] as RequestInit).body);
		expect(body).toContain('where game_id = (159119,42);');
		expect(body).toContain('fields game_id, normally, completely, count;');
	});

	it('drops non-numeric ids before interpolation (same guard as scores)', async () => {
		const m = stubFetch({
			games: () => jsonResponse([]),
			ttb: () => jsonResponse([]),
		});
		await provider().fetchTimeToBeatByIds(['159119', 'evil); fields *;']);
		const body = String(
			(
				m.mock.calls.find((c) =>
					String(c[0]).includes('game_time_to_beats'),
				)?.[1] as RequestInit
			).body,
		);
		expect(body).toContain('where game_id = (159119);');
		expect(body).not.toContain('evil');
	});

	it('DEGENERATE GUARD: a 200 non-array body fails closed on this endpoint too', async () => {
		stubFetch({
			games: () => jsonResponse([]),
			ttb: () => jsonResponse({ count: 31 }),
		});
		await expect(provider().fetchTimeToBeatByIds(['159119'])).rejects.toThrow(
			/non-array body/,
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
			// An unscored hit maps to nulls — persisted as NULL, rendered as absent.
			...NO_SCORES,
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
