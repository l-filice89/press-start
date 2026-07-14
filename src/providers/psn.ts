/**
 * PSN library provider (Story 4.1, re-credentialed in 9.1b) — the external-I/O
 * seam for the PlayStation purchased-games list (AD-5). The auth mechanism (the
 * NPSSO token and the authorize→code→token exchange it rides through) lives
 * entirely inside this adapter (AR-5): services, routes and the UI see only
 * `PsnProvider` + `PsnAuthError`. Everything wire-level is ported verbatim from
 * a live probe (spike S-1, probed live 2026-07-13 — the endpoint × auth-path
 * table in `_bmad-output/implementation-artifacts/deferred-work.md` DW-10 is
 * the committed evidence) — only the pinned persisted-query hash works, and
 * only the probed exchange shape authorizes.
 */

const API_URL = 'https://web.np.playstation.com/api/graphql/v1/op';

// NPSSO → authorization code → access token: the PSN mobile-app OAuth flow,
// copied VERBATIM from the live probe (URLs, params, the public client
// credentials, `redirect: 'manual'`). Convention-derived guesses shipped a
// production bug once (Epic 4); this is not re-derived.
const AUTHORIZE_URL =
	'https://ca.account.sony.com/api/authz/v3/oauth/authorize';
const TOKEN_URL = 'https://ca.account.sony.com/api/authz/v3/oauth/token';
const OAUTH_CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const OAUTH_REDIRECT_URI = 'com.scee.psxandroid.scecompcall://redirect';
/** Public client id:secret of the PSN Android app — not a user secret. */
const OAUTH_BASIC_AUTH =
	'Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';
const OPERATION = 'getPurchasedGameList';
const PERSISTED_QUERY_HASH =
	'827a423f6a8ddca4107ac01395af2ec0eafd8396fc7fa204aaf9b7ed2eefa168';
const PAGE_SIZE = 100;
const PSN_TIMEOUT_MS = 30_000;
// Runaway brake for an unversioned, reverse-engineered API: a pageInfo
// regression (isLast never true) must not loop a Worker forever. 40 pages =
// 4,000 games; worst case is 2 (the authorize + token exchange) + 40 = 42
// subrequests, inside the 50-external-subrequests budget (AD-15).
const MAX_PAGES = 40;

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

// Trophy list (Story 9.2): a DIFFERENT host from the library GraphQL surface,
// and it behaves differently — a rejected bearer answers a real HTTP 401
// `{"error":{"message":"Invalid token"}}` here, where GraphQL answers 200 +
// errors[]. Wire shape captured live 2026-07-13 (`tmp/probe-trophies.ts`),
// never derived from convention.
const TROPHY_URL =
	'https://m.np.playstation.com/api/trophy/v1/users/me/trophyTitles';
const TROPHY_PAGE_SIZE = 100;

// Per-title trophy detail (Story 9.3): where the EARNED DATE lives. The title
// list carries none — captured live 2026-07-13 (`tmp/probe-trophy-dates.ts`):
// `{trophies:[{trophyId, trophyType, earned, earnedDateTime, …}], totalItemCount}`,
// and a bogus npCommunicationId answers a real HTTP 404
// `{"error":{"message":"Resource not found"}}` — a per-title skip, not a denial.
const TROPHY_DETAIL_HOST =
	'https://m.np.playstation.com/api/trophy/v1/users/me/npCommunicationIds';
// npServiceName is PER TITLE and load-bearing: the detail call 404s on the
// wrong one (probed live 2026-07-13, `tmp/probe-service-name.ts` — the account's
// 137 titles split 94 `trophy` / 43 `trophy2`, and ENDER LILIES answers 404 to
// `trophy2` and 200 to `trophy`). The trophy list carries it per entry and 9.2
// persists it; this default only covers rows synced BEFORE that column existed.
const TROPHY_SERVICE_NAME_FALLBACK = 'trophy2';
// One title's whole trophy set in one call (the probed max set is well under
// 200) — the fan-out is already one call per platinum title, and paging it
// would multiply that by the page count.
const TROPHY_DETAIL_LIMIT = 200;
// One paginated collection for the WHOLE account (137 titles → 2 pages), not a
// per-game lookup. 20 pages = 2,000 titles; the brake keeps a nextOffset
// regression inside the 50-subrequest budget (AD-15).
const TROPHY_MAX_PAGES = 20;

/**
 * NPSSO missing or rejected (a denied exchange, or a 401/403 on the API).
 * Thrown after exactly ONE attempt — the caller surfaces the refresh
 * instructions, never retries (NFR-4, AD-14).
 */
export class PsnAuthError extends Error {
	constructor(reason: 'missing-npsso' | 'denied' | 401 | 403) {
		super(
			reason === 'missing-npsso'
				? 'No PlayStation NPSSO token is configured.'
				: reason === 'denied'
					? 'PlayStation denied access — the NPSSO token has most likely expired.'
					: `PlayStation rejected the request (HTTP ${reason}) — the NPSSO token has most likely expired.`,
		);
		this.name = 'PsnAuthError';
	}
}

/** One purchased-list entry, as sync (4.2) needs it. */
export interface PsnGame {
	name: string;
	/** Raw PSN value, passed through unmangled (`'PS4'`/`'PS5'` expected —
	 * the request filters on those — but never coerced, so a surprise value
	 * is visible downstream instead of silently stamped PS4). */
	platform: string;
	/** `'PS_PLUS'` = membership claim (never creates/owns a game, FR-9/33). */
	membership: string | null;
	titleId: string | null;
	productId: string | null;
	conceptId: string | null;
	entitlementId: string | null;
	/** PS Store cover, captured at sync time (FR-35). */
	imageUrl: string | null;
	/** Locale-less store page (redirects to the account region), or null. */
	storeUrl: string | null;
}

/** Earned/defined trophies by tier, exactly as the trophy host sends them. */
export interface PsnTrophyTierCounts {
	bronze: number;
	silver: number;
	gold: number;
	platinum: number;
}

/**
 * One trophy title (Story 9.2), from the LIVE capture. There is NO `titleId`
 * or `conceptId` on this payload — `npCommunicationId` is an NPWR id the
 * library side has never seen — so the only join back to a library game is
 * `trophyTitleName`. PSN's weighted `progress` is deliberately NOT carried:
 * the % is derived from the counts in `core/` (AR-3/AR-8).
 */
export interface PsnTrophyTitle {
	npCommunicationId: string;
	/** `trophy` (PS3/PS4/Vita) or `trophy2` (PS5) — the detail call 404s on the
	 * wrong one, so it is persisted per title and handed back to PSN as-is. */
	npServiceName: string;
	trophyTitleName: string;
	trophyTitlePlatform: string;
	definedTrophies: PsnTrophyTierCounts;
	earnedTrophies: PsnTrophyTierCounts;
}

/**
 * One title's platinum date (Story 9.3), from the LIVE capture. `earnedAt` is
 * PSN's UTC instant (`"2026-07-06T18:30:27Z"`) — NOT a local date: the caller
 * converts it in the user's zone. `found: false` = PSN did not resolve this
 * `npCommunicationId` + `npServiceName` pair (HTTP 404: a delisted title, or a
 * pre-9.3 row whose service name was never stored and defaulted wrong): a
 * per-title SKIP the caller reports and steps past, never an auth failure and
 * never a reason to abort.
 */
export interface PsnPlatinumDate {
	earnedAt: string | null;
	found: boolean;
}

export interface PsnProvider {
	/** The full purchased list, paginated until `pageInfo.isLast`. */
	fetchPurchasedGames(): Promise<PsnGame[]>;
	/**
	 * The platinum's earned instant for ONE title (Story 9.3). Rides the same
	 * bearer and the same one-attempt `PsnAuthError` discipline; a 404 resolves
	 * to `{ found: false }` instead of throwing.
	 */
	fetchPlatinumEarnedAt(
		npCommunicationId: string,
		npServiceName?: string,
	): Promise<PsnPlatinumDate>;
	/**
	 * Every trophy title on the account (Story 9.2), paginated on `nextOffset`.
	 * Rides the same bearer as the library call, with the same one-attempt
	 * `PsnAuthError` discipline (NFR-4/AD-14).
	 */
	fetchTrophyTitles(): Promise<PsnTrophyTitle[]>;
	/**
	 * Every product currently in the region's PS+ Game Catalog (Story 5.1,
	 * widened to full records in 7.1). Public store-browse endpoint — no
	 * credential involved, so `PsnAuthError` semantics don't apply; any failure
	 * is a plain error.
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
}

interface RawPsnGame {
	name?: string;
	platform?: string;
	membership?: string;
	titleId?: string;
	productId?: string;
	conceptId?: string;
	entitlementId?: string;
	image?: { url?: string };
}

interface PsnPage {
	games: RawPsnGame[];
	pageInfo: { isLast: boolean; totalCount?: number };
}

function storeUrl(game: RawPsnGame): string | null {
	if (game.conceptId)
		return `https://store.playstation.com/concept/${game.conceptId}`;
	if (game.productId)
		return `https://store.playstation.com/product/${game.productId}`;
	return null;
}

function toPsnGame(game: RawPsnGame): PsnGame {
	return {
		name: game.name ?? '',
		platform: game.platform ?? '',
		membership: game.membership ?? null,
		titleId: game.titleId ?? null,
		productId: game.productId ?? null,
		conceptId: game.conceptId ?? null,
		entitlementId: game.entitlementId ?? null,
		imageUrl: game.image?.url ?? null,
		storeUrl: storeUrl(game),
	};
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

interface RawTrophyTitle {
	npCommunicationId?: string;
	npServiceName?: string;
	trophyTitleName?: string;
	trophyTitlePlatform?: string;
	definedTrophies?: Partial<PsnTrophyTierCounts>;
	earnedTrophies?: Partial<PsnTrophyTierCounts>;
}

interface TrophyPage {
	trophyTitles: RawTrophyTitle[];
	nextOffset?: number | null;
	totalItemCount?: number;
}

const tierCounts = (
	raw: Partial<PsnTrophyTierCounts> | undefined,
): PsnTrophyTierCounts => ({
	bronze: raw?.bronze ?? 0,
	silver: raw?.silver ?? 0,
	gold: raw?.gold ?? 0,
	platinum: raw?.platinum ?? 0,
});

function toTrophyTitle(raw: RawTrophyTitle): PsnTrophyTitle {
	return {
		npCommunicationId: raw.npCommunicationId ?? '',
		npServiceName: raw.npServiceName ?? '',
		trophyTitleName: raw.trophyTitleName ?? '',
		trophyTitlePlatform: raw.trophyTitlePlatform ?? '',
		definedTrophies: tierCounts(raw.definedTrophies),
		earnedTrophies: tierCounts(raw.earnedTrophies),
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

function pageUrl(start: number): string {
	const variables = {
		isActive: true,
		platform: ['ps4', 'ps5'],
		size: PAGE_SIZE,
		start,
		sortBy: 'ACTIVE_DATE',
		sortDirection: 'desc',
	};
	const extensions = {
		persistedQuery: { version: 1, sha256Hash: PERSISTED_QUERY_HASH },
	};
	const query = new URLSearchParams({
		operationName: OPERATION,
		variables: JSON.stringify(variables),
		extensions: JSON.stringify(extensions),
	});
	return `${API_URL}?${query}`;
}

/**
 * Real PSN adapter. `getNpsso` is read fresh on every provider instance (FR-36:
 * editing the setting takes effect without redeploy) — the caller composes it
 * with the `setting`-table read. The instance is created per request, so a
 * memoized bearer is still a fresh credential on every sync.
 */
export function createPsnProvider({
	getNpsso,
}: {
	getNpsso: () => Promise<string | undefined>;
}): PsnProvider {
	/**
	 * NPSSO → `?code=` → access token. Wire shape copied verbatim from the live
	 * probe: the authorize call answers with a 302 whose `location` carries the
	 * code on a custom app scheme, so `redirect: 'manual'` is load-bearing —
	 * following the redirect would drop the code. An EXPIRED npsso answers a
	 * redirect WITHOUT a code (never a 401), which is the denial signal.
	 */
	async function exchange(): Promise<string> {
		const npsso = await getNpsso();
		if (!npsso) throw new PsnAuthError('missing-npsso');

		const authorize = new URL(AUTHORIZE_URL);
		authorize.search = new URLSearchParams({
			access_type: 'offline',
			client_id: OAUTH_CLIENT_ID,
			response_type: 'code',
			scope: 'psn:mobile.v2.core psn:clientapp',
			redirect_uri: OAUTH_REDIRECT_URI,
		}).toString();

		const authResponse = await fetch(authorize, {
			headers: { cookie: `npsso=${npsso}` },
			redirect: 'manual',
			signal: AbortSignal.timeout(PSN_TIMEOUT_MS),
		});
		const location = authResponse.headers.get('location') ?? '';
		// Only a location that IS the app redirect answers the exchange. A
		// location merely CONTAINING the redirect URI (a Sony sign-in page
		// carrying `redirect_uri=…` in its query) is not our code — parsing it
		// would swallow that page's own `code` param.
		const code = location.startsWith(OAUTH_REDIRECT_URI)
			? new URL(
					location.replace(OAUTH_REDIRECT_URI, 'https://x'),
				).searchParams.get('code')
			: null;
		if (!code) {
			// Denial vs. outage. Sony REFUSES a stale npsso by redirecting to the
			// app scheme WITHOUT a `?code=` (never a 401) — that, plus the two
			// statuses OAuth itself denies with, is the whole denial set. Anything
			// else (5xx, 429, a 403 bot-challenge or WAF interstitial, an HTML
			// page) means Sony is unwell: a plain Error, never the expired flag —
			// the user cannot fix a challenge page by re-pasting a valid token.
			const denied =
				location.startsWith(OAUTH_REDIRECT_URI) ||
				authResponse.status === 400 ||
				authResponse.status === 401;
			if (denied) throw new PsnAuthError('denied');
			throw new Error(
				`PSN authorize failed: ${authResponse.status} ${(await authResponse.text()).slice(0, 200)}`,
			);
		}

		const tokenResponse = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				authorization: OAUTH_BASIC_AUTH,
			},
			body: new URLSearchParams({
				code,
				redirect_uri: OAUTH_REDIRECT_URI,
				grant_type: 'authorization_code',
				token_format: 'jwt',
			}),
			signal: AbortSignal.timeout(PSN_TIMEOUT_MS),
		});
		// Same denial-vs-outage split as the authorize leg: only the statuses
		// OAuth denies with (400 invalid_grant / 401 bad client) are a denial.
		if (tokenResponse.status === 400 || tokenResponse.status === 401) {
			throw new PsnAuthError('denied');
		}
		if (!tokenResponse.ok) {
			throw new Error(
				`PSN token exchange failed: ${tokenResponse.status} ${(await tokenResponse.text()).slice(0, 200)}`,
			);
		}
		// `access_type=offline` also returns a refresh_token — deliberately NOT
		// stored: the NPSSO is the durable credential, a second secret at rest
		// would only buy back two subrequests (see the spec's Design Notes).
		// A 2xx that is not a token (an HTML interstitial) is an outage, not a
		// denial — it must not flag a valid npsso expired.
		const token = (await tokenResponse.json().catch(() => ({}))) as {
			access_token?: string;
		};
		if (!token.access_token) {
			throw new Error(
				`PSN token exchange returned no access_token (HTTP ${tokenResponse.status})`,
			);
		}
		return token.access_token;
	}

	// ponytail: one exchange per provider instance, no cross-request bearer
	// cache. Upgrade path if the 2 extra subrequests ever matter: persist
	// access+refresh tokens in the setting table and refresh on 401.
	// A REJECTED exchange is not memoized — replaying a stale failure would
	// deny a second caller on this instance a retry.
	let bearer: Promise<string> | undefined;
	const getBearer = () =>
		(bearer ??= exchange().catch((error) => {
			bearer = undefined;
			throw error;
		}));

	async function fetchPage(token: string, start: number): Promise<PsnPage> {
		const response = await fetch(pageUrl(start), {
			headers: {
				accept: 'application/json',
				'content-type': 'application/json',
				'apollographql-client-name': 'my-playstation',
				origin: 'https://library.playstation.com',
				referer: 'https://library.playstation.com/',
				'user-agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
				authorization: `Bearer ${token}`,
			},
			signal: AbortSignal.timeout(PSN_TIMEOUT_MS),
		});

		if (response.status === 401 || response.status === 403) {
			// One attempt, then surface — never retry an expired credential.
			throw new PsnAuthError(response.status);
		}
		if (!response.ok) {
			throw new Error(
				`PSN request failed: ${response.status} ${(await response.text()).slice(0, 500)}`,
			);
		}

		// A stale credential can 200 with a login HTML page — surface that as a
		// readable failure, not a bare SyntaxError from response.json().
		const text = await response.text();
		let payload: {
			errors?: unknown;
			data?: { purchasedTitlesRetrieve?: PsnPage };
		};
		try {
			payload = JSON.parse(text);
		} catch {
			throw new Error(
				`PSN returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
			);
		}
		if (payload.errors) {
			// Real PSN answers an expired/invalid credential with HTTP 200 + an
			// "Access denied! You need to be authorized…" GraphQL error — never
			// 401/403 (probed live 2026-07-11). Map it to the auth path so the
			// refresh banner lights instead of a generic 502.
			// ponytail: matches the observed message text — if PSN localizes or
			// rewords it, this misses and falls to the generic 502 (banner stays
			// dark). Upgrade path if that bites: key off a GraphQL error
			// extensions `code`, or treat errors+`purchasedTitlesRetrieve===null`
			// as auth (accepting it also swallows a rotted-query-hash error).
			const errorText = JSON.stringify(payload.errors);
			if (/access denied|authoriz/i.test(errorText)) {
				throw new PsnAuthError('denied');
			}
			throw new Error(`PSN GraphQL error: ${errorText}`);
		}
		const page = payload.data?.purchasedTitlesRetrieve;
		if (!page || !Array.isArray(page.games) || !page.pageInfo) {
			throw new Error(
				'PSN response missing a well-formed purchasedTitlesRetrieve page',
			);
		}
		return page;
	}

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
			throw new Error(
				`PS+ catalog GraphQL error: ${JSON.stringify(payload.errors)}`,
			);
		}
		const page = payload.data?.categoryGridRetrieve;
		if (!page || !Array.isArray(page.products) || !page.pageInfo) {
			throw new Error(
				'PS+ catalog response missing a well-formed categoryGridRetrieve page',
			);
		}
		return page;
	}

	/**
	 * One trophy page. The DEGENERATE-RESPONSE GUARD lives here: a 200 carrying
	 * an `error` body, a missing/!array `trophyTitles`, or an EMPTY list while
	 * `totalItemCount > 0` all throw — the sync writes nothing and the stored
	 * trophy counts survive. (Captured 401 shape: `{"error":{"message":"Invalid
	 * token"}}` — a real HTTP 401 on this host, unlike the GraphQL surface.)
	 */
	async function fetchTrophyPage(
		token: string,
		offset: number,
		collected: number,
	): Promise<TrophyPage> {
		const response = await fetch(
			`${TROPHY_URL}?limit=${TROPHY_PAGE_SIZE}&offset=${offset}`,
			{
				headers: {
					accept: 'application/json',
					authorization: `Bearer ${token}`,
				},
				signal: AbortSignal.timeout(PSN_TIMEOUT_MS),
			},
		);

		if (response.status === 401 || response.status === 403) {
			// One attempt, then surface — never retry an expired credential.
			throw new PsnAuthError(response.status);
		}
		if (!response.ok) {
			throw new Error(
				`PSN trophy request failed: ${response.status} ${(await response.text()).slice(0, 500)}`,
			);
		}

		const text = await response.text();
		let payload: TrophyPage & { error?: { message?: string } };
		try {
			payload = JSON.parse(text);
		} catch {
			throw new Error(
				`PSN trophies returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
			);
		}
		if (payload.error) {
			throw new Error(
				`PSN trophy error body on HTTP ${response.status}: ${JSON.stringify(payload.error)}`,
			);
		}
		if (!Array.isArray(payload.trophyTitles)) {
			throw new Error('PSN trophy response missing a trophyTitles array');
		}
		if (
			collected === 0 &&
			payload.trophyTitles.length === 0 &&
			(payload.totalItemCount ?? 0) > 0
		) {
			// An account with 137 titles answering an EMPTY FIRST page is a broken
			// response, not an empty account: fail closed rather than let the caller
			// interpret "no trophies" and act on it.
			// The guard is deliberately scoped to the first page. A later empty page
			// is one PSN's own nextOffset told us to fetch — a boundary account (an
			// exact multiple of the page size) or a title delisted mid-run lands
			// there legitimately, and throwing would 502 a run whose titles we
			// already hold. A genuinely truncated run is still caught: the caller
			// reconciles the collected count against totalItemCount below.
			throw new Error(
				`PSN trophies returned an empty list while totalItemCount is ${payload.totalItemCount} — refusing a degenerate response`,
			);
		}
		return payload;
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
			}
			if (page.products.length === 0) {
				if (totalCount !== undefined && offset < totalCount) {
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
		return { products, totalCount: totalCount ?? products.length };
	}

	return {
		async fetchPurchasedGames() {
			// One exchange for the whole (paginated) run — keeps the sync inside
			// the 50-subrequest budget (AD-15).
			const token = await getBearer();

			const games: PsnGame[] = [];
			let start = 0;
			for (let pageCount = 0; ; pageCount++) {
				if (pageCount >= MAX_PAGES) {
					throw new Error(
						`PSN pagination never reported isLast after ${MAX_PAGES} pages — aborting instead of looping.`,
					);
				}
				const page = await fetchPage(token, start);
				games.push(...page.games.map(toPsnGame));
				if (page.pageInfo.isLast || page.games.length === 0) break;
				start += page.games.length;
			}
			return games;
		},

		async fetchTrophyTitles() {
			// The SAME bearer as the library call: one exchange for the whole FETCH
			// (2 exchange legs + 2 trophy pages for a 137-title account) — the D1
			// writes the sync then issues are batched, and are the other half of the
			// subrequest budget (AD-15).
			const token = await getBearer();

			const titles: PsnTrophyTitle[] = [];
			let offset = 0;
			let total: number | undefined;
			for (let pageCount = 0; ; pageCount++) {
				if (pageCount >= TROPHY_MAX_PAGES) {
					throw new Error(
						`PSN trophy pagination exceeded ${TROPHY_MAX_PAGES} pages — aborting instead of looping.`,
					);
				}
				const page = await fetchTrophyPage(token, offset, titles.length);
				titles.push(...page.trophyTitles.map(toTrophyTitle));
				if (typeof page.totalItemCount === 'number')
					total = page.totalItemCount;
				const next = page.nextOffset;
				// The last page carries no (or a non-advancing) nextOffset. Requiring
				// it to MOVE FORWARD is what stops a `nextOffset: 0` regression from
				// re-fetching page one until the brake trips.
				if (typeof next !== 'number' || next <= offset) break;
				if (page.trophyTitles.length === 0) break;
				offset = next;
			}
			// FAIL CLOSED on a short run: a truncated pagination (a dropped
			// nextOffset, a short middle page) would otherwise be indistinguishable
			// from "the account has fewer titles" — and those titles would silently
			// keep their stale counts, unreported.
			if (typeof total === 'number' && titles.length < total) {
				throw new Error(
					`PSN trophies returned ${titles.length} of ${total} titles — refusing a short result`,
				);
			}
			return titles;
		},

		async fetchPlatinumEarnedAt(npCommunicationId: string, npServiceName) {
			const token = await getBearer();
			const service = npServiceName || TROPHY_SERVICE_NAME_FALLBACK;
			const response = await fetch(
				`${TROPHY_DETAIL_HOST}/${encodeURIComponent(npCommunicationId)}/trophyGroups/all/trophies?npServiceName=${encodeURIComponent(service)}&limit=${TROPHY_DETAIL_LIMIT}`,
				{
					headers: {
						accept: 'application/json',
						authorization: `Bearer ${token}`,
					},
					signal: AbortSignal.timeout(PSN_TIMEOUT_MS),
				},
			);

			if (response.status === 401 || response.status === 403) {
				// One attempt, then surface — never retry an expired credential.
				throw new PsnAuthError(response.status);
			}
			// The CAPTURED not-resolved answer (a delisted title — or the wrong
			// npServiceName). Resolving it instead of throwing is what keeps one dead
			// title from aborting a 53-title backfill.
			if (response.status === 404) return { earnedAt: null, found: false };
			if (!response.ok) {
				throw new Error(
					`PSN trophy detail request failed: ${response.status} ${(await response.text()).slice(0, 500)}`,
				);
			}

			const text = await response.text();
			let payload: {
				trophies?: {
					trophyType?: string;
					earned?: boolean;
					earnedDateTime?: string;
				}[];
				totalItemCount?: number;
				error?: { message?: string };
			};
			try {
				payload = JSON.parse(text);
			} catch {
				throw new Error(
					`PSN trophy detail returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
				);
			}
			// Same fail-closed posture as the trophy list: a 200 carrying an error
			// body, or no `trophies` array, is a broken response — not "no platinum".
			if (payload.error) {
				throw new Error(
					`PSN trophy detail error body on HTTP ${response.status}: ${JSON.stringify(payload.error)}`,
				);
			}
			if (!Array.isArray(payload.trophies)) {
				throw new Error('PSN trophy detail response missing a trophies array');
			}
			const platinum = payload.trophies.find(
				(trophy) => trophy.trophyType === 'platinum' && trophy.earned === true,
			);
			// FAIL CLOSED on a TRUNCATED set, exactly as the title list reconciles its
			// count: this call never pages (limit=200 covers the probed sets), so a
			// trophy set longer than the limit could hide the platinum — and reporting
			// "PlayStation has no earned date on record" for it would be a lie the
			// user cannot see through. A truncated set that DID carry the platinum is
			// fine: the rest of the trophies are nothing this run reads.
			const total = payload.totalItemCount;
			if (
				!platinum &&
				typeof total === 'number' &&
				payload.trophies.length < total
			) {
				throw new Error(
					`PSN trophy detail returned ${payload.trophies.length} of ${total} trophies for ${npCommunicationId} and no earned platinum among them — refusing a truncated result`,
				);
			}
			return {
				earnedAt:
					typeof platinum?.earnedDateTime === 'string'
						? platinum.earnedDateTime
						: null,
				found: true,
			};
		},

		fetchPsPlusExtraCatalog: (region) => walkCatalog(region),

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
