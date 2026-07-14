import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPsnProvider, PsnAuthError } from './psn';

/**
 * Wire-level PSN adapter tests (Story 4.1, re-credentialed in 9.1b) over a
 * mocked fetch. The hazard rows: the NPSSO is exchanged for a bearer ONCE per
 * provider instance (AD-15 subrequest budget), every auth denial — a missing
 * token, an authorize redirect without a `?code=`, a refused token exchange, a
 * 401/403, or the real HTTP-200-plus-`errors[]` shape — fails closed after
 * exactly ONE attempt (NFR-4/AD-14 — an expired token is never retried).
 */

const AUTHORIZE = 'https://ca.account.sony.com/api/authz/v3/oauth/authorize';
const TOKEN = 'https://ca.account.sony.com/api/authz/v3/oauth/token';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function page(games: unknown[], isLast: boolean) {
	return jsonResponse({
		data: { purchasedTitlesRetrieve: { games, pageInfo: { isLast } } },
	});
}

/**
 * The probed authorize answer: a 302 whose `location` carries the code on the
 * app's custom scheme. `Response.redirect` refuses a non-http scheme — build it
 * by hand, the way PSN answers it.
 */
function authorizeRedirect(code: string | null): Response {
	const location =
		code === null
			? 'com.scee.psxandroid.scecompcall://redirect?error=login_required'
			: `com.scee.psxandroid.scecompcall://redirect?code=${code}&cid=x`;
	return new Response(null, { status: 302, headers: { location } });
}

const tokenResponse = (accessToken: string) =>
	jsonResponse({ access_token: accessToken, refresh_token: 'refresh-me' });

const rawGame = (name: string, extra: Record<string, unknown> = {}) => ({
	name,
	platform: 'PS4',
	membership: 'NONE',
	...extra,
});

const provider = (npssos: (string | undefined)[]) => {
	const getNpsso = vi.fn(async () => npssos.shift());
	return { provider: createPsnProvider({ getNpsso }), getNpsso };
};

/**
 * A fetch mock answering the two exchange legs with the live-probed shapes and
 * handing every other call to `api` (the PSN GraphQL responses). `api` is a
 * factory, not a Response: a body can only be read once.
 */
// biome-ignore lint/suspicious/noExplicitAny: the mock inspects arbitrary fetch inits (headers, body, redirect) — typing them as RequestInit would fight every assertion below.
type FetchInit = any;

function mockPsn(
	api: (url: string) => Response,
	code: string | null = 'auth-code',
) {
	return vi.fn(async (input: unknown, _init?: FetchInit) => {
		const url = String(input);
		if (url.startsWith(AUTHORIZE)) return authorizeRedirect(code);
		if (url.startsWith(TOKEN)) return tokenResponse('jwt-bearer');
		return api(url);
	});
}

/** The PSN GraphQL calls only — the two exchange legs filtered out. */
const apiCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
	fetchMock.mock.calls.filter(
		([url]) =>
			!String(url).startsWith(AUTHORIZE) && !String(url).startsWith(TOKEN),
	);

afterEach(() => vi.unstubAllGlobals());

describe('createPsnProvider', () => {
	it('paginates until isLast and maps the raw shape', async () => {
		const pages = [
			page(
				[
					rawGame('HEAVY RAIN™', {
						titleId: 'CUSA02356_00',
						productId: 'EP9000-CUSA02356_00',
						entitlementId: 'EP9000-CUSA02356_00',
						image: { url: 'https://image.api.playstation.com/icon0.png' },
					}),
				],
				false,
			),
			page(
				[
					rawGame('Astro Bot', {
						platform: 'PS5',
						membership: 'PS_PLUS',
						conceptId: '10005478',
					}),
				],
				true,
			),
		];
		const fetchMock = mockPsn(() => pages.shift() as Response);
		vi.stubGlobal('fetch', fetchMock);

		const games = await provider(['npsso-1']).provider.fetchPurchasedGames();

		const api = apiCalls(fetchMock);
		expect(api).toHaveLength(2);
		// Second page starts where the first left off.
		expect(api[1][0]).toContain('%22start%22%3A1');
		expect(games).toEqual([
			{
				name: 'HEAVY RAIN™',
				platform: 'PS4',
				membership: 'NONE',
				titleId: 'CUSA02356_00',
				productId: 'EP9000-CUSA02356_00',
				conceptId: null,
				entitlementId: 'EP9000-CUSA02356_00',
				imageUrl: 'https://image.api.playstation.com/icon0.png',
				storeUrl: 'https://store.playstation.com/product/EP9000-CUSA02356_00',
			},
			{
				name: 'Astro Bot',
				platform: 'PS5',
				membership: 'PS_PLUS',
				titleId: null,
				productId: null,
				conceptId: '10005478',
				entitlementId: null,
				imageUrl: null,
				storeUrl: 'https://store.playstation.com/concept/10005478',
			},
		]);
	});

	it('exchanges the NPSSO exactly as probed and sends the bearer, never a cookie', async () => {
		const fetchMock = mockPsn(() => page([], true));
		vi.stubGlobal('fetch', fetchMock);

		await provider(['secret-npsso']).provider.fetchPurchasedGames();

		// Leg 1 — authorize: the npsso rides a Cookie header, redirect NOT
		// followed (following it would drop the `?code=`).
		const [authUrl, authInit] = fetchMock.mock.calls[0];
		expect(String(authUrl)).toContain(AUTHORIZE);
		expect(String(authUrl)).toContain(
			'client_id=09515159-7237-4370-9b40-3806e67c0891',
		);
		expect(String(authUrl)).toContain('access_type=offline');
		expect(String(authUrl)).toContain('response_type=code');
		// The probed scope, in its exact encoded form — a silent divergence from
		// the shape that actually authorizes must go red here.
		expect(String(authUrl)).toContain(
			'scope=psn%3Amobile.v2.core+psn%3Aclientapp',
		);
		expect(decodeURIComponent(String(authUrl))).toContain(
			'redirect_uri=com.scee.psxandroid.scecompcall://redirect',
		);
		expect(authInit.headers.cookie).toBe('npsso=secret-npsso');
		expect(authInit.redirect).toBe('manual');

		// Leg 2 — token: form-encoded POST with the public Basic credentials.
		const [tokenUrl, tokenInit] = fetchMock.mock.calls[1];
		expect(String(tokenUrl)).toBe(TOKEN);
		expect(tokenInit.method).toBe('POST');
		expect(tokenInit.headers.authorization).toBe(
			'Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=',
		);
		expect(tokenInit.headers['content-type']).toBe(
			'application/x-www-form-urlencoded',
		);
		const body = String(tokenInit.body);
		expect(body).toContain('code=auth-code');
		expect(body).toContain('grant_type=authorization_code');
		expect(body).toContain('token_format=jwt');

		// The purchased-list call: persisted query + Bearer, no cookie at all.
		const [url, init] = apiCalls(fetchMock)[0];
		expect(url).toContain('operationName=getPurchasedGameList');
		expect(url).toContain(
			'827a423f6a8ddca4107ac01395af2ec0eafd8396fc7fa204aaf9b7ed2eefa168',
		);
		expect(init.headers.authorization).toBe('Bearer jwt-bearer');
		expect(init.headers.cookie).toBeUndefined();
		expect(init.headers['apollographql-client-name']).toBe('my-playstation');
		expect(init.headers.origin).toBe('https://library.playstation.com');
		expect(init.method ?? 'GET').toBe('GET');
		expect(init.body).toBeUndefined();
	});

	it('exchanges ONCE across every page of a run (hazard: an exchange per page would blow the subrequest budget)', async () => {
		const pages = [
			page([rawGame('One')], false),
			page([rawGame('Two')], false),
			page([rawGame('Three')], true),
		];
		const fetchMock = mockPsn(() => pages.shift() as Response);
		vi.stubGlobal('fetch', fetchMock);

		const { provider: psn, getNpsso } = provider(['npsso-1']);
		const games = await psn.fetchPurchasedGames();

		expect(games).toHaveLength(3);
		expect(apiCalls(fetchMock)).toHaveLength(3);
		// One NPSSO read, one authorize, one token — for three pages.
		expect(getNpsso).toHaveBeenCalledTimes(1);
		expect(
			fetchMock.mock.calls.filter(([url]) => String(url).startsWith(AUTHORIZE)),
		).toHaveLength(1);
		expect(
			fetchMock.mock.calls.filter(([url]) => String(url).startsWith(TOKEN)),
		).toHaveLength(1);
		// Every page carries the SAME bearer.
		for (const [, init] of apiCalls(fetchMock)) {
			expect(init.headers.authorization).toBe('Bearer jwt-bearer');
		}
	});

	it.each([
		401, 403,
	])('throws PsnAuthError on %d after exactly one attempt (hazard: no retry)', async (status) => {
		const fetchMock = mockPsn(() => jsonResponse({}, status));
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['expired']).provider.fetchPurchasedGames(),
		).rejects.toBeInstanceOf(PsnAuthError);
		expect(apiCalls(fetchMock)).toHaveLength(1);
	});

	it('a 401 mid-pagination stops immediately — no retry of page two either', async () => {
		const bodies = [page([rawGame('First Page Game')], false)];
		const fetchMock = mockPsn(() => bodies.shift() ?? jsonResponse({}, 401));
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['dies-midway']).provider.fetchPurchasedGames(),
		).rejects.toBeInstanceOf(PsnAuthError);
		expect(apiCalls(fetchMock)).toHaveLength(2);
	});

	it('aborts a runaway pagination instead of looping forever (hazard: isLast never true)', async () => {
		const fetchMock = mockPsn(() => page([rawGame('Groundhog Game')], false));
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['npsso']).provider.fetchPurchasedGames(),
		).rejects.toThrow(/never reported isLast/);
		expect(apiCalls(fetchMock)).toHaveLength(40);
	});

	it('surfaces a non-JSON 200 body readably (stale-session login HTML)', async () => {
		vi.stubGlobal(
			'fetch',
			mockPsn(() => new Response('<html>sign in</html>', { status: 200 })),
		);

		await expect(
			provider(['npsso']).provider.fetchPurchasedGames(),
		).rejects.toThrow(/non-JSON/);
	});

	it('rejects a well-formed 200 whose page shape is malformed', async () => {
		vi.stubGlobal(
			'fetch',
			mockPsn(() =>
				jsonResponse({
					data: { purchasedTitlesRetrieve: { pageInfo: { isLast: true } } },
				}),
			),
		);

		await expect(
			provider(['npsso']).provider.fetchPurchasedGames(),
		).rejects.toThrow(/well-formed/);
	});

	it('throws PsnAuthError without calling PSN when no NPSSO is configured (hazard: zero fetches)', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider([undefined]).provider.fetchPurchasedGames(),
		).rejects.toBeInstanceOf(PsnAuthError);
		// Not even the authorize leg — a missing credential never touches PSN.
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('throws PsnAuthError when the authorize redirect carries no ?code= (hazard: an expired NPSSO is not a 401)', async () => {
		const fetchMock = mockPsn(() => page([], true), null);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['stale-npsso']).provider.fetchPurchasedGames(),
		).rejects.toBeInstanceOf(PsnAuthError);
		// One authorize attempt, and the token leg is never reached.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('throws PsnAuthError when the token exchange is refused (hazard: valid code, non-2xx token endpoint)', async () => {
		const fetchMock = vi.fn(async (input: unknown) => {
			const url = String(input);
			if (url.startsWith(AUTHORIZE)) return authorizeRedirect('auth-code');
			if (url.startsWith(TOKEN))
				return jsonResponse({ error: 'invalid_grant' }, 400);
			throw new Error('PSN must not be called after a refused exchange');
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['npsso']).provider.fetchPurchasedGames(),
		).rejects.toBeInstanceOf(PsnAuthError);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('a Sony 5xx on the authorize leg is a plain Error, NOT an auth denial (hazard: an outage would flag a valid token expired)', async () => {
		const fetchMock = vi.fn(async (input: unknown) => {
			if (String(input).startsWith(AUTHORIZE))
				return new Response('<html>Service Unavailable</html>', {
					status: 503,
				});
			throw new Error('the token leg must not be reached');
		});
		vi.stubGlobal('fetch', fetchMock);

		const error = await provider(['perfectly-good-npsso'])
			.provider.fetchPurchasedGames()
			.catch((e) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(PsnAuthError);
		expect(String(error)).toContain('503');
	});

	it('a Sony 5xx on the token leg is a plain Error, NOT an auth denial', async () => {
		const fetchMock = vi.fn(async (input: unknown) => {
			const url = String(input);
			if (url.startsWith(AUTHORIZE)) return authorizeRedirect('auth-code');
			if (url.startsWith(TOKEN)) return new Response('boom', { status: 503 });
			throw new Error('PSN must not be called without a bearer');
		});
		vi.stubGlobal('fetch', fetchMock);

		const error = await provider(['perfectly-good-npsso'])
			.provider.fetchPurchasedGames()
			.catch((e) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(PsnAuthError);
		expect(String(error)).toContain('503');
	});

	it('never mines a code out of a sign-in page that merely carries redirect_uri in its query (hazard: substring match)', async () => {
		const fetchMock = vi.fn(async (input: unknown) => {
			if (String(input).startsWith(AUTHORIZE))
				return new Response(null, {
					status: 302,
					headers: {
						location:
							'https://ca.account.sony.com/api/v1/ssocookie/signin?redirect_uri=com.scee.psxandroid.scecompcall://redirect&code=not-our-code',
					},
				});
			throw new Error('the token leg must not be reached');
		});
		vi.stubGlobal('fetch', fetchMock);

		const error = await provider(['npsso'])
			.provider.fetchPurchasedGames()
			.catch((e) => e);
		// Not our redirect: neither a code to exchange nor a denial to persist.
		expect(error).not.toBeInstanceOf(PsnAuthError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('retries the exchange after a failed one (hazard: a memoized REJECTED promise replays the stale failure)', async () => {
		let firstAuthorize = true;
		const fetchMock = vi.fn(async (input: unknown) => {
			const url = String(input);
			if (url.startsWith(AUTHORIZE)) {
				if (firstAuthorize) {
					firstAuthorize = false;
					return new Response('down', { status: 503 });
				}
				return authorizeRedirect('auth-code');
			}
			if (url.startsWith(TOKEN)) return tokenResponse('jwt-bearer');
			return page([rawGame('Second Chance')], true);
		});
		vi.stubGlobal('fetch', fetchMock);

		const { provider: psn } = provider(['npsso', 'npsso']);
		await expect(psn.fetchPurchasedGames()).rejects.toThrow(/503/);
		// Same instance, second call: the exchange runs again instead of
		// replaying the memoized rejection.
		const games = await psn.fetchPurchasedGames();
		expect(games.map((g) => g.name)).toEqual(['Second Chance']);
	});

	it('a 200 token response with no access_token is a plain Error, NOT an auth denial (hazard: degenerate 2xx interstitial)', async () => {
		const fetchMock = vi.fn(async (input: unknown) => {
			const url = String(input);
			if (url.startsWith(AUTHORIZE)) return authorizeRedirect('auth-code');
			if (url.startsWith(TOKEN)) return jsonResponse({ error: 'nope' }, 200);
			throw new Error('PSN must not be called without a bearer');
		});
		vi.stubGlobal('fetch', fetchMock);

		const error = await provider(['npsso'])
			.provider.fetchPurchasedGames()
			.catch((e) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(PsnAuthError);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it.each([
		['authorize', AUTHORIZE],
		['token', TOKEN],
	])('a 403 bot-challenge on the %s leg is a plain Error, NOT an auth denial (hazard: a WAF page would flag a valid token expired)', async (_leg, challenged) => {
		const fetchMock = vi.fn(async (input: unknown) => {
			const url = String(input);
			if (url.startsWith(challenged))
				return new Response('<html>Attention Required</html>', {
					status: 403,
				});
			if (url.startsWith(AUTHORIZE)) return authorizeRedirect('auth-code');
			throw new Error('PSN must not be called without a bearer');
		});
		vi.stubGlobal('fetch', fetchMock);

		const error = await provider(['perfectly-good-npsso'])
			.provider.fetchPurchasedGames()
			.catch((e) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(PsnAuthError);
		expect(String(error)).toContain('403');
	});

	it('throws PsnAuthError on the REAL denial response: HTTP 200 + Access-denied GraphQL error (hazard: PSN never answers 401)', async () => {
		// Captured live 2026-07-11 with a bogus credential — verbatim fixture.
		const fetchMock = mockPsn(() =>
			jsonResponse({
				data: { purchasedTitlesRetrieve: null },
				errors: [
					{
						message:
							'Access denied! You need to be authorized to perform this action!',
						path: ['purchasedTitlesRetrieve'],
						extensions: { service: 'arkham-gql' },
					},
				],
			}),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['expired']).provider.fetchPurchasedGames(),
		).rejects.toBeInstanceOf(PsnAuthError);
		// One attempt, no retry — same contract as the HTTP 401/403 path.
		expect(apiCalls(fetchMock)).toHaveLength(1);
	});

	it('surfaces GraphQL-level errors', async () => {
		vi.stubGlobal(
			'fetch',
			mockPsn(() =>
				jsonResponse({ errors: [{ message: 'PersistedQueryNotFound' }] }),
			),
		);

		await expect(
			provider(['npsso']).provider.fetchPurchasedGames(),
		).rejects.toThrow(/PersistedQueryNotFound/);
	});

	it('surfaces non-auth HTTP failures with the status', async () => {
		vi.stubGlobal(
			'fetch',
			mockPsn(() => new Response('boom', { status: 500 })),
		);

		await expect(
			provider(['npsso']).provider.fetchPurchasedGames(),
		).rejects.toThrow(/500/);
	});
});

/**
 * Trophy list (Story 9.2). Every fixture below is the shape CAPTURED LIVE on
 * 2026-07-13 by `tmp/probe-trophies.ts` — not a convention-derived guess (one
 * of those shipped a production bug on this project). The captured facts:
 * `{trophyTitles[], nextOffset, totalItemCount}`, entries carrying
 * `npCommunicationId`/`trophyTitleName`/`trophyTitlePlatform`/
 * `definedTrophies`/`earnedTrophies`/`progress` and NO titleId, and a bogus
 * bearer answering a REAL HTTP 401 `{"error":{"message":"Invalid token"}}`.
 */
const TROPHY_HOST =
	'https://m.np.playstation.com/api/trophy/v1/users/me/trophyTitles';

const trophyEntry = (over: Record<string, unknown> = {}) => ({
	npCommunicationId: 'NPWR22372_00',
	// PS4-era titles carry `trophy`, PS5 `trophy2` — 94/43 of the probed
	// account's 137 titles (`tmp/probe-service-name.ts`, 2026-07-13).
	npServiceName: 'trophy',
	trophyTitleName: 'Ultimate Chicken Horse Trophies',
	trophyTitlePlatform: 'PS4',
	hasTrophyGroups: false,
	definedTrophies: { bronze: 40, silver: 12, gold: 6, platinum: 1 },
	earnedTrophies: { bronze: 3, silver: 0, gold: 0, platinum: 0 },
	progress: 4,
	lastUpdatedDateTime: '2026-05-02T19:22:11Z',
	...over,
});

const trophyPage = (
	titles: unknown[],
	extra: Record<string, unknown> = {},
): Response =>
	jsonResponse({
		trophyTitles: titles,
		totalItemCount: titles.length,
		...extra,
	});

/** The trophy calls only — the two exchange legs filtered out. */
const trophyCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
	fetchMock.mock.calls.filter(([url]) => String(url).startsWith(TROPHY_HOST));

describe('fetchTrophyTitles', () => {
	it('maps the CAPTURED entry shape and rides the same bearer (no cookie)', async () => {
		const fetchMock = mockPsn(() => trophyPage([trophyEntry()]));
		vi.stubGlobal('fetch', fetchMock);

		const titles = await provider(['npsso']).provider.fetchTrophyTitles();

		expect(titles).toEqual([
			{
				npCommunicationId: 'NPWR22372_00',
				// Carried through: 9.3's detail call 404s on the wrong service name.
				npServiceName: 'trophy',
				trophyTitleName: 'Ultimate Chicken Horse Trophies',
				trophyTitlePlatform: 'PS4',
				definedTrophies: { bronze: 40, silver: 12, gold: 6, platinum: 1 },
				earnedTrophies: { bronze: 3, silver: 0, gold: 0, platinum: 0 },
			},
		]);
		// PSN's weighted `progress` is deliberately NOT carried — the % is derived
		// from the counts in core/ (a persisted derived value = a second truth).
		expect(titles[0]).not.toHaveProperty('progress');

		const [url, init] = trophyCalls(fetchMock)[0];
		expect(String(url)).toContain('limit=100');
		expect(String(url)).toContain('offset=0');
		expect(init.headers.authorization).toBe('Bearer jwt-bearer');
		expect(init.headers.cookie).toBeUndefined();
		expect(init.method ?? 'GET').toBe('GET');
	});

	it('accepts an EMPTY page past the end (hazard: a boundary account would 502 forever)', async () => {
		// PSN hands back a nextOffset on the boundary page of an account whose
		// title count is an exact multiple of the page size — the page it tells us
		// to fetch is empty, and every title is already in hand. Failing there
		// would be an outage-as-denial: the run holds the whole account.
		const pages = [
			trophyPage([trophyEntry({ trophyTitleName: 'Tales of Arise' })], {
				nextOffset: 100,
				totalItemCount: 1,
			}),
			trophyPage([], { totalItemCount: 1 }),
		];
		const fetchMock = mockPsn(() => pages.shift() as Response);
		vi.stubGlobal('fetch', fetchMock);

		const titles = await provider(['npsso']).provider.fetchTrophyTitles();

		expect(titles.map((t) => t.trophyTitleName)).toEqual(['Tales of Arise']);
		expect(trophyCalls(fetchMock)).toHaveLength(2);
	});

	it('paginates on nextOffset and exchanges the NPSSO ONCE (hazard: the fetch budget is 4 subrequests)', async () => {
		const pages = [
			trophyPage([trophyEntry({ trophyTitleName: 'Tales of Arise' })], {
				nextOffset: 100,
				totalItemCount: 2,
			}),
			trophyPage([trophyEntry({ trophyTitleName: 'Astro Bot' })], {
				totalItemCount: 2,
			}),
		];
		const fetchMock = mockPsn(() => pages.shift() as Response);
		vi.stubGlobal('fetch', fetchMock);

		const { provider: psn, getNpsso } = provider(['npsso']);
		const titles = await psn.fetchTrophyTitles();

		expect(titles.map((t) => t.trophyTitleName)).toEqual([
			'Tales of Arise',
			'Astro Bot',
		]);
		const calls = trophyCalls(fetchMock);
		expect(calls).toHaveLength(2);
		expect(String(calls[1][0])).toContain('offset=100');
		// One exchange for the whole run: 2 exchange legs + 2 trophy pages = 4.
		expect(getNpsso).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it('throws PsnAuthError on the CAPTURED 401 body, after exactly one attempt (hazard: no retry)', async () => {
		// Verbatim from the probe's bogus-bearer run.
		const fetchMock = mockPsn(() =>
			jsonResponse({ error: { message: 'Invalid token' } }, 401),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['expired']).provider.fetchTrophyTitles(),
		).rejects.toBeInstanceOf(PsnAuthError);
		expect(trophyCalls(fetchMock)).toHaveLength(1);
	});

	it('fails closed on a DEGENERATE 200 carrying an error body (hazard: 200 + error must not read as zero trophies)', async () => {
		const fetchMock = mockPsn(() =>
			jsonResponse({ error: { message: 'Invalid token' }, trophyTitles: [] }),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['npsso']).provider.fetchTrophyTitles(),
		).rejects.toThrow(/error body/);
	});

	it('fails closed on an empty list while totalItemCount > 0 (hazard: an empty page would wipe nothing but report "no trophies")', async () => {
		const fetchMock = mockPsn(() =>
			jsonResponse({ trophyTitles: [], totalItemCount: 137 }),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['npsso']).provider.fetchTrophyTitles(),
		).rejects.toThrow(/degenerate/i);
	});

	it('a genuinely empty account (totalItemCount 0) is not degenerate', async () => {
		vi.stubGlobal(
			'fetch',
			mockPsn(() => jsonResponse({ trophyTitles: [], totalItemCount: 0 })),
		);
		expect(await provider(['npsso']).provider.fetchTrophyTitles()).toEqual([]);
	});

	it('rejects a 200 with no trophyTitles array, and a non-JSON 200', async () => {
		vi.stubGlobal(
			'fetch',
			mockPsn(() => jsonResponse({ totalItemCount: 3 })),
		);
		await expect(
			provider(['npsso']).provider.fetchTrophyTitles(),
		).rejects.toThrow(/trophyTitles array/);

		vi.stubGlobal(
			'fetch',
			mockPsn(() => new Response('<html>sign in</html>', { status: 200 })),
		);
		await expect(
			provider(['npsso']).provider.fetchTrophyTitles(),
		).rejects.toThrow(/non-JSON/);
	});

	it('aborts a runaway pagination instead of looping forever (hazard: nextOffset never settles)', async () => {
		// An always-advancing nextOffset: the brake is the only thing that stops it.
		let offset = 0;
		const fetchMock = mockPsn(() => {
			offset += 100;
			return trophyPage([trophyEntry()], {
				nextOffset: offset,
				totalItemCount: 1e6,
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['npsso']).provider.fetchTrophyTitles(),
		).rejects.toThrow(/exceeded 20 pages/);
		expect(trophyCalls(fetchMock)).toHaveLength(20);
	});

	it('stops on a non-advancing nextOffset, and the short result FAILS CLOSED (hazard: nextOffset: 0 would re-fetch page one forever; truncating silently would strand 136 titles)', async () => {
		const fetchMock = mockPsn(() =>
			trophyPage([trophyEntry()], { nextOffset: 0, totalItemCount: 137 }),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['npsso']).provider.fetchTrophyTitles(),
		).rejects.toThrow(/1 of 137 titles/);
		expect(trophyCalls(fetchMock)).toHaveLength(1);
	});

	it('fails closed when a MIDDLE page comes back short (hazard: the collected count must reconcile against totalItemCount, not just page one)', async () => {
		// Page 1 is full and promises 137 titles; page 2 is the last page and
		// carries only one — 101 collected of 137, a truncated run.
		const pages = [
			trophyPage(
				Array.from({ length: 100 }, (_, i) =>
					trophyEntry({ trophyTitleName: `Game ${i}` }),
				),
				{ nextOffset: 100, totalItemCount: 137 },
			),
			trophyPage([trophyEntry({ trophyTitleName: 'Astro Bot' })], {
				totalItemCount: 137,
			}),
		];
		const fetchMock = mockPsn(() => pages.shift() as Response);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['npsso']).provider.fetchTrophyTitles(),
		).rejects.toThrow(/101 of 137 titles/);
	});

	it('surfaces a non-auth HTTP failure with its status', async () => {
		vi.stubGlobal(
			'fetch',
			mockPsn(() => new Response('boom', { status: 500 })),
		);
		await expect(
			provider(['npsso']).provider.fetchTrophyTitles(),
		).rejects.toThrow(/500/);
	});

	it('throws PsnAuthError without touching PSN when no NPSSO is configured', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider([undefined]).provider.fetchTrophyTitles(),
		).rejects.toBeInstanceOf(PsnAuthError);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

/** Catalog page response (Story 5.1). */
function catalogPage(names: string[], totalCount: number) {
	return jsonResponse({
		data: {
			categoryGridRetrieve: {
				products: names.map((name) => ({ name })),
				pageInfo: { totalCount },
			},
		},
	});
}

describe('fetchPsPlusExtraCatalog', () => {
	it('sends the catalog persisted query with the region header and NO credential', async () => {
		const fetchMock = vi.fn().mockResolvedValue(catalogPage([], 0));
		vi.stubGlobal('fetch', fetchMock);

		const { provider: psn, getNpsso } = provider(['unused']);
		await psn.fetchPsPlusExtraCatalog('it-it');

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('operationName=categoryGridRetrieve');
		expect(url).toContain(
			'4ce7d410a4db2c8b635a48c1dcec375906ff63b19dadd87e073f8fd0c0481d35',
		);
		// The PS+ Game Catalog category id rides the variables.
		expect(decodeURIComponent(url)).toContain(
			'3a7006fe-e26f-49fe-87e5-4473d7ed0fb2',
		);
		expect(init.headers['x-psn-store-locale-override']).toBe('it-it');
		// Public endpoint — no credential may leak onto it, and the NPSSO is
		// never even read (no exchange, no bearer).
		expect(init.headers.cookie).toBeUndefined();
		expect(init.headers.authorization).toBeUndefined();
		expect(getNpsso).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(init.method ?? 'GET').toBe('GET');
	});

	it('advances the offset by what actually arrived (hazard: server caps the page size)', async () => {
		// size=100 requested, server caps at 2 per page; totalCount 5.
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(catalogPage(['A', 'B'], 5))
			.mockResolvedValueOnce(catalogPage(['C', 'D'], 5))
			.mockResolvedValueOnce(catalogPage(['E'], 5));
		vi.stubGlobal('fetch', fetchMock);

		const names = await provider(['x']).provider.fetchPsPlusExtraCatalog(
			'en-us',
		);

		expect(names).toEqual(['A', 'B', 'C', 'D', 'E']);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(decodeURIComponent(fetchMock.mock.calls[1][0])).toContain(
			'"offset":2',
		);
		expect(decodeURIComponent(fetchMock.mock.calls[2][0])).toContain(
			'"offset":4',
		);
	});

	it('stops on an empty page when totalCount is missing', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					data: {
						categoryGridRetrieve: {
							products: [{ name: 'Only' }],
							pageInfo: {},
						},
					},
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					data: { categoryGridRetrieve: { products: [], pageInfo: {} } },
				}),
			);
		vi.stubGlobal('fetch', fetchMock);

		expect(
			await provider(['x']).provider.fetchPsPlusExtraCatalog('en-us'),
		).toEqual(['Only']);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('aborts a runaway catalog pagination instead of looping forever', async () => {
		vi.stubGlobal(
			'fetch',
			// totalCount always ahead of the offset — the brake must trip.
			vi.fn().mockImplementation(async () => catalogPage(['Loop'], 999999)),
		);

		await expect(
			provider(['x']).provider.fetchPsPlusExtraCatalog('en-us'),
		).rejects.toThrow(/exceeded 30 pages/);
	});

	it('surfaces catalog GraphQL errors and malformed pages readably', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					jsonResponse({ errors: [{ message: 'PersistedQueryNotFound' }] }),
				),
		);
		await expect(
			provider(['x']).provider.fetchPsPlusExtraCatalog('en-us'),
		).rejects.toThrow(/PersistedQueryNotFound/);

		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					jsonResponse({ data: { categoryGridRetrieve: {} } }),
				),
		);
		await expect(
			provider(['x']).provider.fetchPsPlusExtraCatalog('en-us'),
		).rejects.toThrow(/well-formed/);
	});
});

/**
 * Per-title trophy DETAIL (Story 9.3), built from the LIVE capture
 * (`tmp/probe-trophy-dates.ts`, run 2026-07-13): `{trophies:[{trophyId,
 * trophyType, earned, earnedDateTime, …}], totalItemCount}`, the platinum's
 * `earnedDateTime` a UTC instant, and a bogus npCommunicationId answering a
 * real HTTP 404 `{"error":{"message":"Resource not found"}}` — the per-title
 * skip that must NOT read as an auth failure.
 */
const DETAIL_HOST =
	'https://m.np.playstation.com/api/trophy/v1/users/me/npCommunicationIds';

const detailCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
	fetchMock.mock.calls.filter(([url]) => String(url).startsWith(DETAIL_HOST));

const detailTrophy = (over: Record<string, unknown> = {}) => ({
	trophyId: 0,
	trophyHidden: false,
	earned: true,
	earnedDateTime: '2026-07-06T18:30:27Z',
	trophyType: 'platinum',
	trophyRare: 1,
	trophyEarnedRate: '12.3',
	...over,
});

describe('fetchPlatinumEarnedAt', () => {
	it("reads the platinum's earnedDateTime out of the CAPTURED detail payload, on the same bearer", async () => {
		const fetchMock = mockPsn(() =>
			jsonResponse({
				trophies: [
					detailTrophy({
						trophyId: 12,
						trophyType: 'bronze',
						earnedDateTime: '2026-06-01T09:00:00Z',
					}),
					detailTrophy(),
					detailTrophy({
						trophyId: 30,
						trophyType: 'gold',
						earned: false,
						earnedDateTime: undefined,
					}),
				],
				totalItemCount: 3,
			}),
		);
		vi.stubGlobal('fetch', fetchMock);

		expect(
			await provider(['npsso']).provider.fetchPlatinumEarnedAt(
				'NPWR22372_00',
				'trophy2',
			),
		).toEqual({ earnedAt: '2026-07-06T18:30:27Z', found: true });

		const [url, init] = detailCalls(fetchMock)[0];
		// The probed path + the title's OWN npServiceName.
		expect(String(url)).toContain(
			'/NPWR22372_00/trophyGroups/all/trophies?npServiceName=trophy2',
		);
		expect(init.headers.authorization).toBe('Bearer jwt-bearer');
	});

	it("sends the TITLE'S npServiceName, not a pinned one (hazard: `trophy2` 404s every PS3/PS4/Vita title — 94 of the probed account's 137)", async () => {
		const fetchMock = mockPsn((url) =>
			// The live behaviour: ENDER LILIES (PS4) 404s on `trophy2` and answers
			// 200 on `trophy` (`tmp/probe-service-name.ts`, 2026-07-13).
			String(url).includes('npServiceName=trophy2')
				? jsonResponse({ error: { message: 'Resource not found' } }, 404)
				: jsonResponse({ trophies: [detailTrophy()], totalItemCount: 1 }),
		);
		vi.stubGlobal('fetch', fetchMock);

		expect(
			await provider(['npsso']).provider.fetchPlatinumEarnedAt(
				'NPWR12112_00',
				'trophy',
			),
		).toEqual({ earnedAt: '2026-07-06T18:30:27Z', found: true });
		expect(String(detailCalls(fetchMock)[0][0])).toContain(
			'npServiceName=trophy&',
		);
	});

	it('falls back to trophy2 when no service name is stored (pre-9.3 rows; a wrong guess 404s into the per-title skip, and the copy says to re-sync)', async () => {
		const fetchMock = mockPsn(() =>
			jsonResponse({ trophies: [detailTrophy()], totalItemCount: 1 }),
		);
		vi.stubGlobal('fetch', fetchMock);

		await provider(['npsso']).provider.fetchPlatinumEarnedAt('NPWR22372_00');
		expect(String(detailCalls(fetchMock)[0][0])).toContain(
			'npServiceName=trophy2',
		);
	});

	it('maps the CAPTURED 404 to a per-title skip, NOT a PsnAuthError (hazard: one delisted title must not kill a 53-title run)', async () => {
		const fetchMock = mockPsn(() =>
			jsonResponse({ error: { message: 'Resource not found' } }, 404),
		);
		vi.stubGlobal('fetch', fetchMock);

		expect(
			await provider(['npsso']).provider.fetchPlatinumEarnedAt('NPWR00000_00'),
		).toEqual({ earnedAt: null, found: false });
	});

	it('a title with no EARNED platinum has no date (never a fabricated one)', async () => {
		const fetchMock = mockPsn(() =>
			jsonResponse({
				trophies: [
					detailTrophy({ earned: false, earnedDateTime: undefined }),
					detailTrophy({ trophyType: 'bronze' }),
				],
				totalItemCount: 2,
			}),
		);
		vi.stubGlobal('fetch', fetchMock);

		expect(
			await provider(['npsso']).provider.fetchPlatinumEarnedAt('NPWR22372_00'),
		).toEqual({ earnedAt: null, found: true });
	});

	it('throws PsnAuthError on a 401, after exactly one attempt (hazard: no retry)', async () => {
		const fetchMock = mockPsn(() =>
			jsonResponse({ error: { message: 'Invalid token' } }, 401),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['expired']).provider.fetchPlatinumEarnedAt('NPWR22372_00'),
		).rejects.toBeInstanceOf(PsnAuthError);
		expect(detailCalls(fetchMock)).toHaveLength(1);
	});

	it('fails closed on a TRUNCATED trophy set with no platinum in it (hazard: "PlayStation has no earned date" would be a lie, and the date it suppresses is write-once)', async () => {
		// The call never pages: a set longer than the limit can hide the platinum.
		vi.stubGlobal(
			'fetch',
			mockPsn(() =>
				jsonResponse({
					trophies: [detailTrophy({ trophyType: 'bronze' })],
					totalItemCount: 240,
				}),
			),
		);
		await expect(
			provider(['npsso']).provider.fetchPlatinumEarnedAt('NPWR22372_00'),
		).rejects.toThrow(/truncated/);

		// A truncated page that DID carry the earned platinum is fine — the rest of
		// the trophies are nothing this call reads.
		vi.stubGlobal(
			'fetch',
			mockPsn(() =>
				jsonResponse({ trophies: [detailTrophy()], totalItemCount: 240 }),
			),
		);
		expect(
			await provider(['npsso']).provider.fetchPlatinumEarnedAt('NPWR22372_00'),
		).toEqual({ earnedAt: '2026-07-06T18:30:27Z', found: true });
	});

	it('fails closed on a DEGENERATE 200 (error body / no trophies array)', async () => {
		vi.stubGlobal(
			'fetch',
			mockPsn(() => jsonResponse({ error: { message: 'Invalid token' } })),
		);
		await expect(
			provider(['npsso']).provider.fetchPlatinumEarnedAt('NPWR22372_00'),
		).rejects.toThrow(/error body/);

		vi.stubGlobal(
			'fetch',
			mockPsn(() => jsonResponse({ totalItemCount: 0 })),
		);
		await expect(
			provider(['npsso']).provider.fetchPlatinumEarnedAt('NPWR22372_00'),
		).rejects.toThrow(/trophies array/);
	});
});
