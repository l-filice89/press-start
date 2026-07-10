import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPsnProvider, PsnAuthError } from './psn';

/**
 * Wire-level PSN adapter tests (Story 4.1) over a mocked fetch. The hazard
 * rows: the cookie is read FRESH per call (FR-36 — editing the setting takes
 * effect without redeploy) and a 401/403 fails after exactly ONE attempt
 * (NFR-4/AD-14 — never retry an expired cookie).
 */

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

const rawGame = (name: string, extra: Record<string, unknown> = {}) => ({
	name,
	platform: 'PS4',
	membership: 'NONE',
	...extra,
});

const provider = (cookies: (string | undefined)[]) => {
	const getCookie = vi.fn(async () => cookies.shift());
	return { provider: createPsnProvider({ getCookie }), getCookie };
};

afterEach(() => vi.unstubAllGlobals());

describe('createPsnProvider', () => {
	it('paginates until isLast and maps the raw shape', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
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
			)
			.mockResolvedValueOnce(
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
			);
		vi.stubGlobal('fetch', fetchMock);

		const games = await provider(['c1']).provider.fetchPurchasedGames();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		// Second page starts where the first left off.
		expect(fetchMock.mock.calls[1][0]).toContain('%22start%22%3A1');
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

	it('sends the persisted query and the cookie header, never a GraphQL body', async () => {
		const fetchMock = vi.fn().mockResolvedValue(page([], true));
		vi.stubGlobal('fetch', fetchMock);

		await provider(['secret-cookie']).provider.fetchPurchasedGames();

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('operationName=getPurchasedGameList');
		expect(url).toContain(
			'827a423f6a8ddca4107ac01395af2ec0eafd8396fc7fa204aaf9b7ed2eefa168',
		);
		expect(init.headers.cookie).toBe('pdccws_p=secret-cookie; isSignedIn=true');
		expect(init.headers['apollographql-client-name']).toBe('my-playstation');
		expect(init.headers.origin).toBe('https://library.playstation.com');
		expect(init.method ?? 'GET').toBe('GET');
		expect(init.body).toBeUndefined();
	});

	it('reads the cookie fresh on every call (hazard: no redeploy needed)', async () => {
		// mockImplementation, not mockResolvedValue: each call needs a FRESH
		// Response — a body can only be read once.
		const fetchMock = vi.fn().mockImplementation(async () => page([], true));
		vi.stubGlobal('fetch', fetchMock);

		const { provider: psn, getCookie } = provider(['old-cookie', 'new-cookie']);
		await psn.fetchPurchasedGames();
		await psn.fetchPurchasedGames();

		expect(getCookie).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][1].headers.cookie).toContain('old-cookie');
		expect(fetchMock.mock.calls[1][1].headers.cookie).toContain('new-cookie');
	});

	it.each([
		401, 403,
	])('throws PsnAuthError on %d after exactly one attempt (hazard: no retry)', async (status) => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, status));
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['expired']).provider.fetchPurchasedGames(),
		).rejects.toBeInstanceOf(PsnAuthError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('a 401 mid-pagination stops immediately — no retry of page two either', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(page([rawGame('First Page Game')], false))
			.mockResolvedValue(jsonResponse({}, 401));
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['dies-midway']).provider.fetchPurchasedGames(),
		).rejects.toBeInstanceOf(PsnAuthError);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('aborts a runaway pagination instead of looping forever (hazard: isLast never true)', async () => {
		const fetchMock = vi
			.fn()
			.mockImplementation(async () => page([rawGame('Groundhog Game')], false));
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider(['c']).provider.fetchPurchasedGames(),
		).rejects.toThrow(/never reported isLast/);
		expect(fetchMock).toHaveBeenCalledTimes(40);
	});

	it('surfaces a non-JSON 200 body readably (stale-session login HTML)', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					new Response('<html>sign in</html>', { status: 200 }),
				),
		);

		await expect(
			provider(['c']).provider.fetchPurchasedGames(),
		).rejects.toThrow(/non-JSON/);
	});

	it('rejects a well-formed 200 whose page shape is malformed', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				jsonResponse({
					data: { purchasedTitlesRetrieve: { pageInfo: { isLast: true } } },
				}),
			),
		);

		await expect(
			provider(['c']).provider.fetchPurchasedGames(),
		).rejects.toThrow(/well-formed/);
	});

	it('throws PsnAuthError without calling PSN when no cookie is configured', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			provider([undefined]).provider.fetchPurchasedGames(),
		).rejects.toBeInstanceOf(PsnAuthError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('surfaces GraphQL-level errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					jsonResponse({ errors: [{ message: 'PersistedQueryNotFound' }] }),
				),
		);

		await expect(
			provider(['c']).provider.fetchPurchasedGames(),
		).rejects.toThrow(/PersistedQueryNotFound/);
	});

	it('surfaces non-auth HTTP failures with the status', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('boom', { status: 500 })),
		);

		await expect(
			provider(['c']).provider.fetchPurchasedGames(),
		).rejects.toThrow(/500/);
	});
});
