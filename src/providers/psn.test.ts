import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BAD_CATEGORY_PAYLOAD,
	BAD_REGION_PAYLOAD,
	CAPTURED_COVER_URL,
	CATALOG_FACETS_EN_US_PAYLOAD,
	CATALOG_PAGE_PAYLOAD,
	catalogPagePayload,
	DE_DE_GENRE_KEYS,
	EN_US_GENRE_KEYS,
	GENRE_PAGE_MUSIC_RHYTHM_PAYLOAD,
	LEAVING_PRICING_PAYLOAD,
	LEAVING_PRODUCT_PAYLOAD,
	PAST_END_PAYLOAD,
	pricingPayload,
	productId,
	productPayload,
	STAYING_PRICING_PAYLOAD,
} from '../../test/fixtures/psn';
import { createPsnProvider, PsnStoreRejectionError } from './psn';

/**
 * Wire-level PSN store-browse adapter tests (Story 5.1/7.1; the credentialed
 * half was deleted by Epic 11 story 11.2) over a mocked fetch. The hazard rows:
 * the walk reconciles against the store's own totalCount (a truncated walk
 * throws, never a short answer), every degenerate answer is an HTTP 200 and
 * throws typed, and NO credential of any kind rides the requests.
 */

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

afterEach(() => vi.unstubAllGlobals());

/**
 * Catalog page response (Story 5.1, widened in 7.1) — built from the CAPTURED
 * payload (`test/fixtures/psn/catalog-page-de-de.json`, probed live 2026-07-14),
 * so the record this adapter reads is the record the store actually sends.
 */
function catalogPage(names: string[], totalCount: number) {
	return jsonResponse(catalogPagePayload(names, { totalCount }));
}

const catalogNames = (products: { name: string }[]) =>
	products.map((product) => product.name);

describe('fetchPsPlusExtraCatalog', () => {
	it('sends the catalog persisted query with the region header and NO credential', async () => {
		const fetchMock = vi.fn().mockResolvedValue(catalogPage([], 0));
		vi.stubGlobal('fetch', fetchMock);

		await createPsnProvider().fetchPsPlusExtraCatalog('it-it');

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
		// Public endpoint — no credential may leak onto it.
		expect(init.headers.cookie).toBeUndefined();
		expect(init.headers.authorization).toBeUndefined();
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

		const { products, totalCount } =
			await createPsnProvider().fetchPsPlusExtraCatalog('en-us');

		expect(catalogNames(products)).toEqual(['A', 'B', 'C', 'D', 'E']);
		// The count rides back out — the ingest reconciles against it before it
		// prunes anything (review, H1).
		expect(totalCount).toBe(5);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(decodeURIComponent(fetchMock.mock.calls[1][0])).toContain(
			'"offset":2',
		);
		expect(decodeURIComponent(fetchMock.mock.calls[2][0])).toContain(
			'"offset":4',
		);
	});

	it('stops on an empty page when totalCount is missing', async () => {
		const page = (names: string[]) => {
			const payload = catalogPagePayload(names);
			// @ts-expect-error — deliberately dropping the count the loop leans on.
			payload.data.categoryGridRetrieve.pageInfo = {};
			return jsonResponse(payload);
		};
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(page(['Only']))
			.mockResolvedValueOnce(page([]));
		vi.stubGlobal('fetch', fetchMock);

		expect(
			catalogNames(
				(await createPsnProvider().fetchPsPlusExtraCatalog('en-us')).products,
			),
		).toEqual(['Only']);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	/**
	 * The record the store ACTUALLY sends (captured 2026-07-14): ids, platforms,
	 * a store classification, a cover picked out of `media[]` — and NO genre, NO
	 * release date. A per-product fetch for either would cost ~490 subrequests.
	 */
	it('maps the CAPTURED product record: ids, platforms, classification, a cover from media[] — and no release date', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogPage(['Sifu'], 1)));

		const {
			products: [product],
		} = await createPsnProvider().fetchPsPlusExtraCatalog('de-de');

		expect(product).toEqual({
			productId: productId('Sifu'),
			npTitleId: `NP${productId('Sifu')}`,
			name: 'Sifu',
			platforms: ['PS5'],
			coverUrl: CAPTURED_COVER_URL,
			storeClassification: 'GAME_BUNDLE',
			storeUrl: `https://store.playstation.com/de-de/product/${productId('Sifu')}`,
		});
		expect(product).not.toHaveProperty('releaseDate');
	});

	/**
	 * THE TRUNCATED WALK (review, H1). An empty page is a terminator ONLY where
	 * the store's own count says the walk is over. Page 0 of 490 followed by an
	 * empty page at offset 100 used to answer "100 products, all of them" — and
	 * the ingest would then prune the other 390 rows and clear their flags. It is
	 * a provider failure now, and nothing downstream ever sees a short catalog.
	 */
	it('THROWS on an empty page while offset < totalCount (hazard: a truncated walk reads as a complete catalog)', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(catalogPage(['A', 'B'], 490))
				.mockResolvedValueOnce(jsonResponse(PAST_END_PAYLOAD)),
		);

		await expect(
			createPsnProvider().fetchPsPlusExtraCatalog('en-us'),
		).rejects.toThrow(/empty page at offset 2 while totalCount is 490/);
	});

	it('the genuine terminator: an empty page once the count is reached ends the walk', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(catalogPage(['A', 'B'], 2))
			.mockResolvedValueOnce(jsonResponse(PAST_END_PAYLOAD));
		vi.stubGlobal('fetch', fetchMock);

		const { products, totalCount } =
			await createPsnProvider().fetchPsPlusExtraCatalog('en-us');
		expect(catalogNames(products)).toEqual(['A', 'B']);
		expect(totalCount).toBe(2);
		// The count was already reached — the past-the-end page is never even asked for.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	// The store renaming its media roles must not blank EVERY cover (review, L4).
	it('falls back to the first IMAGE when no known cover role is present', async () => {
		const payload = catalogPagePayload(['Rebranded']);
		payload.data.categoryGridRetrieve.products[0].media = [
			{
				__typename: 'Media',
				role: 'SOMETHING_NEW',
				type: 'VIDEO',
				url: 'https://v/clip.mp4',
			},
			{
				__typename: 'Media',
				role: 'SOMETHING_NEW',
				type: 'IMAGE',
				url: 'https://i/cover.png',
			},
		];
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));

		const {
			products: [product],
		} = await createPsnProvider().fetchPsPlusExtraCatalog('de-de');
		expect(product.coverUrl).toBe('https://i/cover.png');
	});

	it('a product with no usable image stores null rather than costing a second fetch', async () => {
		const payload = catalogPagePayload(['Coverless']);
		payload.data.categoryGridRetrieve.products[0].media = [];
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));

		const {
			products: [product],
		} = await createPsnProvider().fetchPsPlusExtraCatalog('de-de');
		expect(product.coverUrl).toBeNull();
	});

	it('aborts a runaway catalog pagination instead of looping forever', async () => {
		vi.stubGlobal(
			'fetch',
			// totalCount always ahead of the offset — the brake must trip.
			vi.fn().mockImplementation(async () => catalogPage(['Loop'], 999999)),
		);

		await expect(
			createPsnProvider().fetchPsPlusExtraCatalog('en-us'),
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
			createPsnProvider().fetchPsPlusExtraCatalog('en-us'),
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
			createPsnProvider().fetchPsPlusExtraCatalog('en-us'),
		).rejects.toThrow(/well-formed/);
	});

	/**
	 * EVERY degenerate catalog answer is an HTTP 200 (captured 2026-07-14): a null
	 * grid on a bad region carries an `errors[]` with an EMPTY message; a bad
	 * category id carries `errors: ["Invalid args"]` + a null grid. The adapter
	 * throws on both — a 200 is not success.
	 */
	it.each([
		['a bad region (null grid, empty message)', BAD_REGION_PAYLOAD],
		['a bad category id (null grid + errors)', BAD_CATEGORY_PAYLOAD],
	])('throws on the CAPTURED degenerate 200 for %s', async (_label, payload) => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));
		// The TYPED rejection is the seam the route's "check your region" 409
		// hangs off — a plain Error here would degrade it to a retry-later 502.
		await expect(
			createPsnProvider().fetchPsPlusExtraCatalog('en-us'),
		).rejects.toThrow(PsnStoreRejectionError);
	});

	it('surfaces non-2xx HTTP failures with the status', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('boom', { status: 500 })),
		);

		await expect(
			createPsnProvider().fetchPsPlusExtraCatalog('en-us'),
		).rejects.toThrow(/500/);
	});
});

describe('fetchPsPlusCatalogGenreKeys / fetchPsPlusExtraCatalogByGenre (Story 7.1)', () => {
	// AD-26: a pinned 19-key enum would silently drop a whole genre for any region
	// that names one we never saw — de-de has 19, en-us has 20.
	it.each([
		['en-us', CATALOG_FACETS_EN_US_PAYLOAD, EN_US_GENRE_KEYS, 20, true],
		['de-de', CATALOG_PAGE_PAYLOAD, DE_DE_GENRE_KEYS, 19, false],
	])('DISCOVERS the %s facet keys FROM THE RESPONSE — the PROVIDER returns what the payload named', async (_region, payload, expected, count, hasMusicRhythm) => {
		// Driven through the provider, not asserted on the fixture: a test that
		// reads a JSON file back and checks it contains what its author typed is
		// not evidence (review, L6).
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));

		const keys = await createPsnProvider().fetchPsPlusCatalogGenreKeys(_region);

		expect(keys).toEqual(expected);
		expect(keys).toHaveLength(count);
		expect(keys.includes('MUSIC/RHYTHM')).toBe(hasMusicRhythm);
	});

	it('sends a SLASHED key inside the URL-encoded filterBy variable (never a path)', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse(GENRE_PAGE_MUSIC_RHYTHM_PAYLOAD));
		vi.stubGlobal('fetch', fetchMock);

		const products = await createPsnProvider().fetchPsPlusExtraCatalogByGenre(
			'en-us',
			'MUSIC/RHYTHM',
		);

		const url = String(fetchMock.mock.calls[0][0]);
		// The raw slash never appears outside the encoded variables blob.
		expect(url).toContain('productGenres%3AMUSIC%2FRHYTHM');
		expect(decodeURIComponent(url)).toContain(
			'"filterBy":["productGenres:MUSIC/RHYTHM"]',
		);
		expect(catalogNames(products)).toEqual(['Entwined™']);
	});
});

describe('fetchPsPlusOfferEnd (Story 10.4)', () => {
	const provider = () => createPsnProvider();

	it('resolves the concept then reads the PS_PLUS endTime from the CAPTURED leaving payloads', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(LEAVING_PRODUCT_PAYLOAD))
			.mockResolvedValueOnce(jsonResponse(LEAVING_PRICING_PAYLOAD));
		vi.stubGlobal('fetch', fetchMock);

		const answer = await provider().fetchPsPlusOfferEnd(
			'it-it',
			'EP0290-PPSA06517_00-RISKOFRAIN2SIEE0',
		);

		// Risk of Rain 2, captured 2026-07-16: endTime "1784620800000" = 21 Jul.
		expect(answer).toEqual({ conceptId: '234386', leavingOn: '2026-07-21' });
		const [productUrl] = fetchMock.mock.calls[0];
		expect(productUrl).toContain('operationName=metGetProductById');
		const [pricingUrl, init] = fetchMock.mock.calls[1];
		expect(pricingUrl).toContain('operationName=metGetPricingDataByConceptId');
		expect(decodeURIComponent(String(pricingUrl))).toContain('234386');
		// Anonymous surface: no credential header of any kind.
		expect(
			new Headers((init as RequestInit).headers).get('authorization'),
		).toBeNull();
	});

	it('a cached conceptId skips the product resolve — ONE subrequest (budget)', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse(STAYING_PRICING_PAYLOAD));
		vi.stubGlobal('fetch', fetchMock);

		const answer = await provider().fetchPsPlusOfferEnd(
			'it-it',
			'EP9000-PPSA01285_00-RETURNALGAME0001',
			'10000176',
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(answer).toEqual({ conceptId: '10000176', leavingOn: null });
	});

	it('a STAYING game (captured: every PS_PLUS endTime null) answers leavingOn null — legitimate, not an error', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(productPayload('10000176')))
				.mockResolvedValueOnce(jsonResponse(STAYING_PRICING_PAYLOAD)),
		);
		const answer = await provider().fetchPsPlusOfferEnd('it-it', 'ANY');
		expect(answer.leavingOn).toBeNull();
	});

	it('offers present but none PS_PLUS-branded is "staying"', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(productPayload('1')))
				.mockResolvedValueOnce(
					jsonResponse({
						data: {
							conceptRetrieve: {
								price: { serviceBranding: ['NONE'], endTime: '1784620800000' },
							},
						},
					}),
				),
		);
		expect(
			(await provider().fetchPsPlusOfferEnd('it-it', 'ANY')).leavingOn,
		).toBeNull();
	});

	it('a PS+-EXCLUSIVE DISCOUNT (PS_PLUS-branded, not the inclusion offer) never becomes a leaving date (review H1)', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(productPayload('1')))
				.mockResolvedValueOnce(
					jsonResponse({
						data: {
							conceptRetrieve: {
								prices: [
									// The member-sale node: branded PS_PLUS but a PAID price —
									// its endTime is the promo end, not a departure.
									{
										serviceBranding: ['PS_PLUS'],
										endTime: '1784620800000',
										isFree: false,
										isTiedToSubscription: false,
									},
									// The actual catalog-inclusion offer says staying.
									{
										serviceBranding: ['PS_PLUS'],
										endTime: null,
										isFree: true,
										isTiedToSubscription: true,
									},
								],
							},
						},
					}),
				),
		);
		expect(
			(await provider().fetchPsPlusOfferEnd('it-it', 'ANY')).leavingOn,
		).toBeNull();
	});

	it('a HOLLOW 200 (null conceptRetrieve / zero offer nodes) throws — never "staying" (DEGENERATE-RESPONSE GUARD)', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(productPayload('1')))
				.mockResolvedValueOnce(
					jsonResponse({ data: { conceptRetrieve: null } }),
				),
		);
		await expect(
			provider().fetchPsPlusOfferEnd('it-it', 'ANY'),
		).rejects.toBeInstanceOf(PsnStoreRejectionError);

		vi.unstubAllGlobals();
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(productPayload('1')))
				.mockResolvedValueOnce(
					jsonResponse({ data: { conceptRetrieve: { mobilectas: [] } } }),
				),
		);
		await expect(
			provider().fetchPsPlusOfferEnd('it-it', 'ANY'),
		).rejects.toBeInstanceOf(PsnStoreRejectionError);
	});

	it('an epoch-SECONDS-scale endTime throws — never writes 1970 (review)', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(productPayload('1')))
				.mockResolvedValueOnce(jsonResponse(pricingPayload('1784620800'))),
		);
		await expect(
			provider().fetchPsPlusOfferEnd('it-it', 'ANY'),
		).rejects.toBeInstanceOf(PsnStoreRejectionError);
	});

	it('a GraphQL errors[] reply throws typed — the caller keeps its stored date', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					jsonResponse({ errors: [{ message: 'PersistedQueryNotFound' }] }),
				),
		);
		await expect(
			provider().fetchPsPlusOfferEnd('it-it', 'ANY'),
		).rejects.toBeInstanceOf(PsnStoreRejectionError);
	});

	it('a product without a concept id throws typed — never silently "staying"', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(jsonResponse({ data: { productRetrieve: {} } })),
		);
		await expect(
			provider().fetchPsPlusOfferEnd('it-it', 'ANY'),
		).rejects.toBeInstanceOf(PsnStoreRejectionError);
	});

	it('a present-but-unreadable endTime throws typed — a garbage date must not CLEAR a real one', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(productPayload('1')))
				.mockResolvedValueOnce(jsonResponse(pricingPayload('not-a-number'))),
		);
		await expect(
			provider().fetchPsPlusOfferEnd('it-it', 'ANY'),
		).rejects.toBeInstanceOf(PsnStoreRejectionError);
	});
});
