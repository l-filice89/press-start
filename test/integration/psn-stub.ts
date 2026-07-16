import { vi } from 'vitest';

/**
 * The ONE PSN store double (Epic 11 story 11.2 deleted the credential-exchange
 * double that used to live beside it — the credentialed provider is gone).
 * Requests the stub does not answer fall through to the REAL fetch (the
 * Worker's own traffic under vitest-pool-workers shares this global).
 */
const realFetch = globalThis.fetch;

/** The store-browse GraphQL host (the PS+ catalog grid). */
export const PSN_LIBRARY_HOST = 'https://web.np.playstation.com/';

/** One store-browse request, as the ingest actually issued it. */
export interface StoreCall {
	offset: number;
	/** The `filterBy` genre facet key, or null on the unfiltered page. */
	genreKey: string | null;
	/** `x-psn-store-locale-override` — the region the catalog is fetched for. */
	locale: string;
	/** The persisted-query `operationName` (Story 10.4 added two beyond the grid). */
	operation: string | null;
	/** `metGetProductById`'s variable, when present. */
	productId: string | null;
	/** `metGetPricingDataByConceptId`'s variable, when present. */
	conceptId: string | null;
}

/**
 * The PUBLIC store-browse host (the PS+ catalog grid, Story 5.1/7.1). NO
 * credential rides it, so this stub is deliberately separate from the bearer
 * exchange above. `reply` answers per request; the returned array records what
 * the ingest asked for — a refused run must leave it EMPTY.
 */
export function stubStore(
	reply: (
		query: StoreCall,
	) =>
		| { status?: number; body: unknown }
		| Promise<{ status?: number; body: unknown }>,
): StoreCall[] {
	const seen: StoreCall[] = [];
	vi.stubGlobal(
		'fetch',
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			if (!url.startsWith(PSN_LIBRARY_HOST)) return realFetch(input, init);
			const params = new URL(url).searchParams;
			const variables = JSON.parse(params.get('variables') ?? '{}') as {
				pageArgs?: { offset?: number };
				filterBy?: string[];
				productId?: string;
				conceptId?: string;
			};
			const filter = variables.filterBy?.[0] ?? '';
			const headers = new Headers(
				input instanceof Request ? input.headers : init?.headers,
			);
			const call: StoreCall = {
				offset: variables.pageArgs?.offset ?? 0,
				genreKey: filter.startsWith('productGenres:')
					? filter.slice('productGenres:'.length)
					: null,
				locale: headers.get('x-psn-store-locale-override') ?? '',
				operation: params.get('operationName'),
				productId: variables.productId ?? null,
				conceptId: variables.conceptId ?? null,
			};
			seen.push(call);
			const { status = 200, body } = await reply(call);
			return new Response(
				typeof body === 'string' ? body : JSON.stringify(body),
				{ status, headers: { 'content-type': 'application/json' } },
			);
		},
	);
	return seen;
}
