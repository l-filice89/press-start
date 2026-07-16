/**
 * CAPTURED PS Store payloads (Story 7.1) — probed live 2026-07-14 against
 * `categoryGridRetrieve` with `tmp/probe-catalog.ts`, written verbatim (the
 * product lists are truncated to 3, nothing else is touched).
 *
 * The hazard tests assert against THESE, not against a hand-written optimistic
 * stub: every degenerate answer this endpoint gives is an HTTP **200** — an
 * empty product list, a null grid on a bad region, a null grid + `errors` on a
 * bad category id — and a stub built from the assumption ("a failure is a 500")
 * would keep every suite green while production wiped the shelf.
 *
 * Recorded facts, all from the capture:
 * - a product carries `id`, `name`, `npTitleId`, `platforms`, `media[]`,
 *   `price`, `storeDisplayClassification` — and NO genre, NO release date;
 * - `de-de` names 19 genre facet keys, `en-us` names 20 (it adds `MUSIC/RHYTHM`);
 * - an offset PAST THE END answers `products: []` with `totalCount: 490` — a
 *   legitimate terminator, not the wipe case.
 */
import badCategory from './catalog-bad-category.json';
import badRegion from './catalog-bad-region.json';
import emptyCatalog from './catalog-empty.json';
import facetsEnUs from './catalog-facets-en-us.json';
import genrePageMusicRhythm from './catalog-genre-page-music-rhythm.json';
import pageDeDe from './catalog-page-de-de.json';
import pastEnd from './catalog-page-past-end.json';
import leavingPricing from './leaving-pricing.json';
import leavingProduct from './leaving-product.json';
import stayingPricing from './staying-pricing.json';

export {
	badCategory as BAD_CATEGORY_PAYLOAD,
	badRegion as BAD_REGION_PAYLOAD,
	emptyCatalog as EMPTY_CATALOG_PAYLOAD,
	facetsEnUs as CATALOG_FACETS_EN_US_PAYLOAD,
	genrePageMusicRhythm as GENRE_PAGE_MUSIC_RHYTHM_PAYLOAD,
	pageDeDe as CATALOG_PAGE_PAYLOAD,
	pastEnd as PAST_END_PAYLOAD,
};

const grid = pageDeDe.data.categoryGridRetrieve;

/** The genre facet keys each region actually named (19 vs 20). */
const genreValues = (facets: { name: string; values?: { key: string }[] }[]) =>
	facets.find((facet) => facet.name === 'productGenres')?.values ?? [];

export const DE_DE_GENRE_KEYS = genreValues(grid.facetOptions).map(
	(v) => v.key,
);
export const EN_US_GENRE_KEYS = genreValues(
	facetsEnUs.data.categoryGridRetrieve.facetOptions,
).map((v) => v.key);

/** The captured product template — real `media[]` roles, real price block. */
export const CAPTURED_PRODUCT = grid.products[0];

/**
 * A stable, COLLISION-FREE store id for a fixture title. The full slug, not a
 * 10-char prefix (review, L5): "Ghost of Tsushima" and "Ghost of Tsushima
 * Director's Cut" share their first 10 alphanumerics, so a prefix silently
 * collapsed two products onto ONE primary key — the upsert would overwrite one
 * with the other and a test asserting on both would pass with a row missing.
 */
export const productId = (name: string) =>
	`EP0000-PROD${name.replace(/[^a-z0-9]/gi, '').toUpperCase()}_00`;

/** One product, verbatim in shape, renamed — the id is derived from the name. */
export function catalogProduct(name: string) {
	return {
		...structuredClone(CAPTURED_PRODUCT),
		id: productId(name),
		name,
		npTitleId: `NP${productId(name)}`,
	};
}

/** The cover role the ingest must pick out of the captured `media[]`. */
export const CAPTURED_COVER_URL = CAPTURED_PRODUCT.media.find(
	(item) => item.role === 'PORTRAIT_BANNER',
)?.url as string;

/**
 * A category-grid page in the captured shape (facets included, so the genre
 * sweep's discovery works against it too).
 */
export function catalogPagePayload(
	names: string[],
	{
		totalCount = names.length,
		offset = 0,
		genreKeys,
	}: { totalCount?: number; offset?: number; genreKeys?: string[] } = {},
) {
	const facetOptions = structuredClone(grid.facetOptions);
	if (genreKeys) {
		const facet = facetOptions.find((f) => f.name === 'productGenres');
		if (facet)
			facet.values = genreKeys.map((key) => ({
				...structuredClone(facet.values[0]),
				key,
			}));
	}
	return {
		data: {
			categoryGridRetrieve: {
				...structuredClone(grid),
				facetOptions,
				products: names.map(catalogProduct),
				pageInfo: {
					__typename: 'PageInfo',
					isLast: offset + names.length >= totalCount,
					offset,
					size: 100,
					totalCount,
				},
			},
		},
	};
}

/** What the store-browse host was asked for (offset + the genre filter). */
export function parseCatalogQuery(url: string) {
	const variables = JSON.parse(
		new URL(url).searchParams.get('variables') ?? '{}',
	) as { pageArgs?: { offset?: number }; filterBy?: string[] };
	const filter = variables.filterBy?.[0] ?? '';
	return {
		offset: variables.pageArgs?.offset ?? 0,
		genreKey: filter.startsWith('productGenres:')
			? filter.slice('productGenres:'.length)
			: null,
	};
}

/**
 * Story 10.4 (leaving sweep) — CAPTURED payloads, probed live 2026-07-16 with
 * `scripts/probe-psn-leaving.ts`: `leaving-product.json` / `leaving-pricing.json`
 * are Risk of Rain 2 (announced to leave PS+ 2026-07-21 — its PS_PLUS offer
 * carries `endTime: "1784620800000"`, epoch MS as a STRING); `staying-pricing.json`
 * is Returnal (every PS_PLUS offer's `endTime` is null). The builders below
 * derive minimal same-shape payloads for multi-game integration runs.
 */
export {
	leavingPricing as LEAVING_PRICING_PAYLOAD,
	leavingProduct as LEAVING_PRODUCT_PAYLOAD,
	stayingPricing as STAYING_PRICING_PAYLOAD,
};

/** A `metGetProductById` reply naming one concept (captured shape). */
export function productPayload(conceptId: string) {
	return {
		data: {
			productRetrieve: {
				__typename: 'Product',
				id: 'STUB-PRODUCT',
				concept: { __typename: 'Concept', id: conceptId },
			},
		},
	};
}

/**
 * A `metGetPricingDataByConceptId` reply whose PS_PLUS offer carries the given
 * `endTime` (epoch-ms string, or null while staying) — captured shape: the
 * offer node nests under mobilectas, `serviceBranding: ["PS_PLUS"]`.
 */
export function pricingPayload(endTime: string | null) {
	return {
		data: {
			conceptRetrieve: {
				__typename: 'Concept',
				defaultProduct: {
					__typename: 'Product',
					id: 'STUB-PRODUCT',
					mobilectas: [
						{
							__typename: 'MobileCta',
							price: {
								__typename: 'Price',
								serviceBranding: ['PS_PLUS'],
								endTime,
								isFree: true,
								isTiedToSubscription: true,
							},
						},
					],
				},
			},
		},
	};
}
