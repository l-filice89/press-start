/**
 * PSN store-browse provider (Story 5.1/7.1, stripped to the anonymous surface
 * by Epic 11 story 11.2) — the external-I/O seam for the public PS+ Game
 * Catalog grid (AD-5/AR-5). No credential of any kind rides these calls: the
 * only request headers are `accept`/`content-type`/`x-psn-store-locale-override`.
 * The credentialed half (the token→bearer exchange, purchased-list, trophies)
 * was deleted with Epic 11 — this adapter must never grow an auth path again.
 */

const API_URL = 'https://web.np.playstation.com/api/graphql/v1/op';
const PSN_TIMEOUT_MS = 30_000;

// PS+ Game Catalog (Story 5.1, FR-38/39): the public store-browse category
// grid — persisted query + category id pinned from the store web app
// (research 2026-07-11, mrt1m/playstation-store-api). No auth: region rides
// the `x-psn-store-locale-override` header.
const CATALOG_OPERATION = 'categoryGridRetrieve';
const CATALOG_QUERY_HASH =
	'4ce7d410a4db2c8b635a48c1dcec375906ff63b19dadd87e073f8fd0c0481d35';
/** "PS Plus Game Catalog — All games" store category (region-independent id). */
const PS_PLUS_CATALOG_CATEGORY = '3a7006fe-e26f-49fe-87e5-4473d7ed0fb2';
const CATALOG_PAGE_SIZE = 100;
// ~500-catalog fits in 5-6 pages even if the server caps pages at 24; the cap
// keeps a totalCount regression inside the 50-subrequest budget (AD-15).
const CATALOG_MAX_PAGES = 30;
/**
 * How far short of the store's own `totalCount` a walk may end before it is
 * treated as TRUNCATED (Epic 7 cross-story review, M1). It absorbs a product
 * added or removed BETWEEN the first page and the last — the last page's
 * `totalCount` is the one that sticks — and nothing more: a truncated walk is
 * short by hundreds. The service reconciles the accumulated count against the
 * same slack (`psplus.ts`).
 */
const CATALOG_DRIFT_TOLERANCE = 2;

// Story 10.4 (VR-6 rework): per-game departure dates. Two more persisted
// queries on the same anonymous endpoint (hashes pinned from the store web
// app via mrt1m/playstation-store-api, verified live 2026-07-16 — probe
// artifact psn-leaving-endtime-probe-2026-07-16.md): a product's concept id,
// then the concept's pricing, whose PS_PLUS-branded offer carries `endTime`
// (epoch ms) exactly when the game is scheduled to leave the catalog —
// staying games answer null (distribution probed over 11 games, never one).
const PRODUCT_OPERATION = 'metGetProductById';
const PRODUCT_QUERY_HASH =
	'a128042177bd93dd831164103d53b73ef790d56f51dae647064cb8f9d9fc9d1a';
const PRICING_OPERATION = 'metGetPricingDataByConceptId';
const PRICING_QUERY_HASH =
	'abcb311ea830e679fe2b697a27f755764535d825b24510ab1239a4ca3092bd09';

/**
 * The store ANSWERED (HTTP 200) but refused the catalog query — a null grid or
 * a GraphQL `errors[]`. In practice this is a region that is not a real store
 * locale (`uk-uk` instead of `en-gb`), or category-id rot. Distinct from an
 * outage/timeout so the caller can say "check your region" instead of "try
 * again later".
 */
export class PsnStoreRejectionError extends Error {
	constructor(detail: string) {
		super(`PlayStation store rejected the catalog query: ${detail}`);
		this.name = 'PsnStoreRejectionError';
	}
}

export interface PsnProvider {
	/**
	 * Every product currently in the region's PS+ Game Catalog (Story 5.1,
	 * widened to full records in 7.1). Public store-browse endpoint — no
	 * credential involved; any failure is a plain error.
	 */
	fetchPsPlusExtraCatalog(region: string): Promise<PsnCatalog>;
	/**
	 * The `productGenres` facet keys this REGION names (Story 7.1, AD-26).
	 * DISCOVERED, never hardcoded: de-de returns 19 keys, en-us 20 (it adds
	 * `MUSIC/RHYTHM`) — probed live 2026-07-14. One page, size 1: the facet list
	 * rides every response, so the products are dead weight here.
	 */
	fetchPsPlusCatalogGenreKeys(region: string): Promise<string[]>;
	/**
	 * The catalog filtered to ONE genre facet key (Story 7.1, AD-28) — the only
	 * way per-game genre is obtainable, since the product record carries none.
	 * The key travels inside the URL-encoded `filterBy` variable, so a key with a
	 * slash (`MUSIC/RHYTHM`) round-trips untouched.
	 */
	fetchPsPlusExtraCatalogByGenre(
		region: string,
		genreKey: string,
	): Promise<PsnCatalogProduct[]>;
	/**
	 * The date a catalog product LEAVES PS+ (Story 10.4) — the store's own
	 * PS_PLUS offer `endTime`, or null while the game is staying. Resolves the
	 * product's concept id first unless the caller already cached it (the
	 * steady-state sweep pays one call, not two). Throws on any malformed or
	 * refused reply so the caller keeps its stored value (per-game fail-closed);
	 * a WELL-FORMED reply with no PS_PLUS offer or a null endTime is the
	 * legitimate "staying" answer.
	 */
	fetchPsPlusOfferEnd(
		region: string,
		productId: string,
		conceptId?: string | null,
	): Promise<PsnOfferEnd>;
}

/** One leaving-sweep answer: the (cacheable) concept id + the departure date. */
export interface PsnOfferEnd {
	conceptId: string;
	/** ISO date (UTC) the game leaves PS+, or null while it is staying. */
	leavingOn: string | null;
}

/**
 * One PS+ catalog product, exactly as the store grid gives it (probed live
 * 2026-07-14, `tmp/probe-catalog.ts` → `test/fixtures/psn/`). There is NO genre
 * and NO release date on this payload — do not synthesize either (AD-24/26).
 */
export interface PsnCatalogProduct {
	/** The store product id — a `'PSN_PRODUCT'` external id, NOT an npTitleId (AD-20). */
	productId: string;
	npTitleId: string | null;
	name: string;
	/** `['PS4','PS5']`, passed through unmangled. */
	platforms: string[];
	/** Picked off `media[]` by role preference; null rather than a second fetch. */
	coverUrl: string | null;
	/** `FULL_GAME` / `GAME_BUNDLE` / … — the store's own classification. */
	storeClassification: string | null;
	/** The REGIONAL store deep link ("Claim now", 7.3). */
	storeUrl: string;
}

/**
 * One completed catalog walk. `totalCount` is the store's OWN count for the
 * (optionally filtered) category — it rides every page and it is the only thing
 * that can tell a finished walk from a truncated one. The caller reconciles
 * against it before it is allowed to prune anything (Story 7.1 review, H1).
 */
export interface PsnCatalog {
	products: PsnCatalogProduct[];
	totalCount: number;
	/**
	 * Products the walk SAW but could not use — no `id` at all (Epic 7 cross-story
	 * review, M1). They count towards the store's `totalCount`, so the caller must
	 * add them back before reconciling, or ONE id-less entry in Sony's grid fails
	 * every refresh identically until a deploy.
	 */
	skipped: number;
}

interface RawCatalogProduct {
	id?: string;
	name?: string;
	npTitleId?: string;
	platforms?: string[];
	media?: { role?: string; type?: string; url?: string }[];
	storeDisplayClassification?: string;
}

interface CatalogFacet {
	name?: string;
	values?: { key?: string }[];
}

interface CatalogPage {
	products: RawCatalogProduct[];
	pageInfo: { totalCount?: number };
	facetOptions?: CatalogFacet[];
}

/**
 * Cover art rides the `media[]` already in the grid payload — a per-product
 * fetch would cost ~490 extra subrequests (AD-15) for a picture. Portrait roles
 * first (the shelf card is portrait), then the wider art; a product with none
 * usable stores `null` rather than costing a second call.
 */
const COVER_ROLES = [
	'PORTRAIT_BANNER',
	'GAMEHUB_COVER_ART',
	'MASTER',
	'EDITION_KEY_ART',
	'FOUR_BY_THREE_BANNER',
];

function coverUrl(product: RawCatalogProduct): string | null {
	const images = (product.media ?? []).filter(
		(item) => item.type === 'IMAGE' && typeof item.url === 'string',
	);
	for (const role of COVER_ROLES) {
		const hit = images.find((item) => item.role === role);
		if (hit?.url) return hit.url;
	}
	// The store renaming its media roles must not silently blank every cover in
	// the catalog: ANY image beats none (Story 7.1 review, L4).
	return images[0]?.url ?? null;
}

function toCatalogProduct(
	product: RawCatalogProduct,
	region: string,
): PsnCatalogProduct {
	return {
		productId: product.id ?? '',
		npTitleId: product.npTitleId ?? null,
		name: product.name ?? '',
		platforms: Array.isArray(product.platforms) ? product.platforms : [],
		coverUrl: coverUrl(product),
		storeClassification: product.storeDisplayClassification ?? null,
		storeUrl: `https://store.playstation.com/${region}/product/${product.id ?? ''}`,
	};
}

function catalogPageUrl(
	offset: number,
	{
		size = CATALOG_PAGE_SIZE,
		genreKey,
	}: { size?: number; genreKey?: string } = {},
): string {
	const variables = {
		id: PS_PLUS_CATALOG_CATEGORY,
		pageArgs: { size, offset },
		sortBy: { name: 'productReleaseDate', isAscending: false },
		// The facet key is NOT identifier-safe (`MUSIC/RHYTHM` carries a slash), so
		// it may only ever travel inside this variable — `URLSearchParams` encodes
		// the whole JSON blob, so the slash round-trips (AD-26).
		filterBy: genreKey ? [`productGenres:${genreKey}`] : [],
		facetOptions: [],
	};
	const extensions = {
		persistedQuery: { version: 1, sha256Hash: CATALOG_QUERY_HASH },
	};
	const query = new URLSearchParams({
		operationName: CATALOG_OPERATION,
		variables: JSON.stringify(variables),
		extensions: JSON.stringify(extensions),
	});
	return `${API_URL}?${query}`;
}

/**
 * Every OFFER node in a pricing reply, wherever it nests — the payload shape
 * shifts between products (2–3 offer nodes observed), so a structural walk
 * beats a brittle path. An offer node carries BOTH `serviceBranding` and an
 * `endTime` field.
 *
 * The caller keeps only the CATALOG-INCLUSION offers (review, H1): `isFree:
 * true, isTiedToSubscription: true` beside the PS_PLUS branding — a PS+
 * member DISCOUNT is also PS_PLUS-branded, and its `endTime` is the promo
 * end, not a departure. Branding alone would paint "LEAVING <sale end>" on a
 * game that is merely on sale.
 */
interface PricingOfferNode {
	branding: unknown[];
	endTime: unknown;
	isFree: unknown;
	isTiedToSubscription: unknown;
}

function collectOfferNodes(node: unknown, out: PricingOfferNode[]): void {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const item of node) collectOfferNodes(item, out);
		return;
	}
	const record = node as Record<string, unknown>;
	if (Array.isArray(record.serviceBranding) && 'endTime' in record) {
		out.push({
			branding: record.serviceBranding,
			endTime: record.endTime,
			isFree: record.isFree,
			isTiedToSubscription: record.isTiedToSubscription,
		});
	}
	for (const key of Object.keys(record)) {
		collectOfferNodes(record[key], out);
	}
}

/**
 * Plausibility bounds for the store's epoch-MS `endTime` (review): a scale
 * regression to epoch-SECONDS (1784620800) would otherwise write 1970-01-21
 * and the card would dutifully warn "LEAVING 21 JAN". Fail closed instead.
 */
const END_TIME_MIN_MS = Date.UTC(2015, 0, 1);
const END_TIME_MAX_MS = Date.UTC(2100, 0, 1);

/** Real PSN store-browse adapter — anonymous catalog reads only. */
export function createPsnProvider(): PsnProvider {
	async function fetchCatalogPage(
		region: string,
		offset: number,
		options: { size?: number; genreKey?: string } = {},
	): Promise<CatalogPage> {
		const response = await fetch(catalogPageUrl(offset, options), {
			headers: {
				accept: 'application/json',
				'content-type': 'application/json',
				'x-psn-store-locale-override': region,
			},
			signal: AbortSignal.timeout(PSN_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(
				`PS+ catalog request failed: ${response.status} ${(await response.text()).slice(0, 500)}`,
			);
		}
		const text = await response.text();
		let payload: {
			errors?: unknown;
			data?: { categoryGridRetrieve?: CatalogPage };
		};
		try {
			payload = JSON.parse(text);
		} catch {
			throw new Error(
				`PS+ catalog returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
			);
		}
		if (payload.errors) {
			throw new PsnStoreRejectionError(
				`GraphQL error: ${JSON.stringify(payload.errors)}`,
			);
		}
		const page = payload.data?.categoryGridRetrieve;
		if (!page || !Array.isArray(page.products) || !page.pageInfo) {
			throw new PsnStoreRejectionError(
				'response missing a well-formed categoryGridRetrieve page',
			);
		}
		return page;
	}

	/**
	 * One paginated walk of the category grid, optionally filtered to one genre
	 * facet key.
	 *
	 * AN EMPTY PAGE IS ONLY A TERMINATOR WHERE THE COUNT SAYS IT IS (Story 7.1
	 * review, H1). An offset past the end answers 200 + `products: []` +
	 * `totalCount: 490` (captured: `catalog-page-past-end.json`) — that is the
	 * legitimate end. An empty page while `offset < totalCount` is the store
	 * TRUNCATING the walk, and breaking on it would hand the caller a partial
	 * catalog that looks complete — which prunes (and un-flags) every product the
	 * walk never reached. So it THROWS: a provider failure, never a short answer.
	 * `totalCount` rides back out with the products so the caller reconciles too.
	 */
	async function walkCatalog(
		region: string,
		genreKey?: string,
	): Promise<PsnCatalog> {
		const products: PsnCatalogProduct[] = [];
		let skipped = 0;
		let offset = 0;
		let totalCount: number | undefined;
		for (let pageCount = 0; ; pageCount++) {
			if (pageCount >= CATALOG_MAX_PAGES) {
				throw new Error(
					`PS+ catalog pagination exceeded ${CATALOG_MAX_PAGES} pages — aborting instead of looping.`,
				);
			}
			const page = await fetchCatalogPage(region, offset, { genreKey });
			if (typeof page.pageInfo.totalCount === 'number')
				totalCount = page.pageInfo.totalCount;
			for (const product of page.products) {
				if (product.id) products.push(toCatalogProduct(product, region));
				else skipped++; // it still counts towards totalCount (review, M1)
			}
			if (page.products.length === 0) {
				// A walk that ends SHORT is truncation and it throws (Story 7.1, H1) —
				// but "short by one or two" is a product arriving or leaving BETWEEN
				// page 1 and page 5, and the last page's totalCount is the one that
				// sticks (Epic 7 cross-story review, M1). Throwing on that failed a
				// healthy catalog on an ordinary store mutation; a truncated walk is
				// short by hundreds and still fails closed.
				if (
					totalCount !== undefined &&
					offset + CATALOG_DRIFT_TOLERANCE < totalCount
				) {
					throw new Error(
						`PS+ catalog returned an empty page at offset ${offset} while totalCount is ${totalCount} — refusing a truncated walk`,
					);
				}
				break;
			}
			// The server may cap the page below the requested size — advance by
			// what actually arrived, or a capped page would skip catalog rows.
			offset += page.products.length;
			if (totalCount !== undefined && offset >= totalCount) break;
		}
		// A response that names no count at all cannot be reconciled — the walk's
		// own tally is all there is.
		return {
			products,
			totalCount: totalCount ?? products.length + skipped,
			skipped,
		};
	}

	async function fetchOp(
		region: string,
		operationName: string,
		hash: string,
		variables: Record<string, unknown>,
	): Promise<unknown> {
		const query = new URLSearchParams({
			operationName,
			variables: JSON.stringify(variables),
			extensions: JSON.stringify({
				persistedQuery: { version: 1, sha256Hash: hash },
			}),
		});
		const response = await fetch(`${API_URL}?${query}`, {
			headers: {
				accept: 'application/json',
				'content-type': 'application/json',
				'x-psn-store-locale-override': region,
			},
			signal: AbortSignal.timeout(PSN_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(
				`PSN ${operationName} failed: ${response.status} ${(await response.text()).slice(0, 300)}`,
			);
		}
		const text = await response.text();
		let payload: { errors?: unknown; data?: unknown };
		try {
			payload = JSON.parse(text);
		} catch {
			throw new Error(
				`PSN ${operationName} returned non-JSON: ${text.slice(0, 200)}`,
			);
		}
		if (payload.errors) {
			throw new PsnStoreRejectionError(
				`${operationName} GraphQL error: ${JSON.stringify(payload.errors).slice(0, 300)}`,
			);
		}
		return payload.data;
	}

	return {
		fetchPsPlusExtraCatalog: (region) => walkCatalog(region),

		async fetchPsPlusOfferEnd(region, productId, conceptId) {
			let concept = conceptId ?? null;
			if (!concept) {
				const data = (await fetchOp(
					region,
					PRODUCT_OPERATION,
					PRODUCT_QUERY_HASH,
					{
						productId,
					},
				)) as { productRetrieve?: { concept?: { id?: unknown } } } | null;
				const id = data?.productRetrieve?.concept?.id;
				// No concept = no priceable surface. Malformed for our purpose: throw
				// so the caller keeps its stored value instead of clearing it.
				if (typeof id !== 'string' && typeof id !== 'number') {
					throw new PsnStoreRejectionError(
						`product ${productId} answered without a concept id`,
					);
				}
				concept = String(id);
			}
			const pricing = (await fetchOp(
				region,
				PRICING_OPERATION,
				PRICING_QUERY_HASH,
				{ conceptId: concept },
			)) as { conceptRetrieve?: unknown } | null;
			const offers: PricingOfferNode[] = [];
			collectOfferNodes(pricing, offers);
			// DEGENERATE-RESPONSE GUARD: a hollow-but-200 reply (null/empty
			// conceptRetrieve, schema drift) carries ZERO offer nodes — writing
			// "staying" off it would CLEAR a real departure date. Fail closed;
			// "staying" needs offers present with no inclusion date among them.
			if (!pricing?.conceptRetrieve || offers.length === 0) {
				throw new PsnStoreRejectionError(
					`pricing for concept ${concept} answered no offer nodes`,
				);
			}
			// The catalog-INCLUSION offers only (H1: a PS+ member discount is also
			// PS_PLUS-branded; its endTime is a promo end, not a departure).
			const inclusionEnds = offers
				.filter(
					(offer) =>
						offer.branding.includes('PS_PLUS') &&
						offer.isFree === true &&
						offer.isTiedToSubscription === true,
				)
				.map((offer) => offer.endTime)
				.filter((value) => value != null);
			if (inclusionEnds.length === 0)
				return { conceptId: concept, leavingOn: null };
			// Multiple inclusion nodes ride one reply (2–3 observed, same value) —
			// take the EARLIEST after validation so a mixed answer warns sooner,
			// never later, and never depends on walk order.
			let earliest = Number.POSITIVE_INFINITY;
			for (const raw of inclusionEnds) {
				const ms = Number(raw);
				// A present-but-unreadable or implausibly-scaled endTime must fail
				// closed, never clear (and never write 1970).
				if (
					!Number.isFinite(ms) ||
					ms < END_TIME_MIN_MS ||
					ms > END_TIME_MAX_MS
				) {
					throw new PsnStoreRejectionError(
						`concept ${concept} carries an unreadable endTime: ${String(raw).slice(0, 40)}`,
					);
				}
				earliest = Math.min(earliest, ms);
			}
			return {
				conceptId: concept,
				// The UTC date of the departure instant (the store announces UTC
				// morning instants; the region-local day matched in the capture).
				leavingOn: new Date(earliest).toISOString().slice(0, 10),
			};
		},

		fetchPsPlusExtraCatalogByGenre: async (region, genreKey) =>
			(await walkCatalog(region, genreKey)).products,

		async fetchPsPlusCatalogGenreKeys(region: string) {
			// The facet list rides EVERY response, so one product is enough payload.
			const page = await fetchCatalogPage(region, 0, { size: 1 });
			const facet = page.facetOptions?.find(
				(option) => option.name === 'productGenres',
			);
			return (facet?.values ?? [])
				.map((value) => value.key)
				.filter((key): key is string => typeof key === 'string' && key !== '');
		},
	};
}
