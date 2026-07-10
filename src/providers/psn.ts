/**
 * PSN library provider (Story 4.1) — the external-I/O seam for the
 * PlayStation purchased-games list (AD-5). The auth mechanism (v1: the
 * `pdccws_p` session cookie) lives entirely inside this adapter; swapping to
 * NPSSO later changes only this file. Everything wire-level is ported
 * verbatim from the legacy `export_ps_catalog.py`: only the pinned
 * persisted-query hash works — PSN rejects hand-written GraphQL.
 */

const API_URL = 'https://web.np.playstation.com/api/graphql/v1/op';
const OPERATION = 'getPurchasedGameList';
const PERSISTED_QUERY_HASH =
	'827a423f6a8ddca4107ac01395af2ec0eafd8396fc7fa204aaf9b7ed2eefa168';
const PAGE_SIZE = 100;
const PSN_TIMEOUT_MS = 30_000;
// Runaway brake for an unversioned, reverse-engineered API: a pageInfo
// regression (isLast never true) must not loop a Worker forever. 40 pages =
// 4,000 games, safely inside the 50-external-subrequests budget (AD-15).
const MAX_PAGES = 40;

/**
 * Cookie missing or rejected (401/403). Thrown after exactly ONE attempt —
 * the caller surfaces the refresh instructions, never retries (NFR-4, AD-14).
 */
export class PsnAuthError extends Error {
	constructor(reason: 'missing-cookie' | 401 | 403) {
		super(
			reason === 'missing-cookie'
				? 'No PlayStation session cookie is configured.'
				: `PlayStation rejected the request (HTTP ${reason}) — the session cookie has most likely expired.`,
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

export interface PsnProvider {
	/** The full purchased list, paginated until `pageInfo.isLast`. */
	fetchPurchasedGames(): Promise<PsnGame[]>;
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
 * Real PSN adapter. `getCookie` is read fresh on every `fetchPurchasedGames`
 * call (FR-36: editing the setting takes effect without redeploy) — the
 * caller composes it with the `setting`-table read.
 */
export function createPsnProvider({
	getCookie,
}: {
	getCookie: () => Promise<string | undefined>;
}): PsnProvider {
	async function fetchPage(cookie: string, start: number): Promise<PsnPage> {
		const response = await fetch(pageUrl(start), {
			headers: {
				accept: 'application/json',
				'content-type': 'application/json',
				'apollographql-client-name': 'my-playstation',
				origin: 'https://library.playstation.com',
				referer: 'https://library.playstation.com/',
				'user-agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
				cookie: `pdccws_p=${cookie}; isSignedIn=true`,
			},
			signal: AbortSignal.timeout(PSN_TIMEOUT_MS),
		});

		if (response.status === 401 || response.status === 403) {
			// One attempt, then surface — never retry an expired cookie.
			throw new PsnAuthError(response.status);
		}
		if (!response.ok) {
			throw new Error(
				`PSN request failed: ${response.status} ${(await response.text()).slice(0, 500)}`,
			);
		}

		// A stale session can 200 with a login HTML page — surface that as a
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
			throw new Error(`PSN GraphQL error: ${JSON.stringify(payload.errors)}`);
		}
		const page = payload.data?.purchasedTitlesRetrieve;
		if (!page || !Array.isArray(page.games) || !page.pageInfo) {
			throw new Error(
				'PSN response missing a well-formed purchasedTitlesRetrieve page',
			);
		}
		return page;
	}

	return {
		async fetchPurchasedGames() {
			const cookie = await getCookie();
			if (!cookie) throw new PsnAuthError('missing-cookie');

			const games: PsnGame[] = [];
			let start = 0;
			for (let pageCount = 0; ; pageCount++) {
				if (pageCount >= MAX_PAGES) {
					throw new Error(
						`PSN pagination never reported isLast after ${MAX_PAGES} pages — aborting instead of looping.`,
					);
				}
				const page = await fetchPage(cookie, start);
				games.push(...page.games.map(toPsnGame));
				if (page.pageInfo.isLast || page.games.length === 0) break;
				start += page.games.length;
			}
			return games;
		},
	};
}
