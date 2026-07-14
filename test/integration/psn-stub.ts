import { vi } from 'vitest';

/**
 * The ONE NPSSO→bearer exchange double (Story 9.5). Every PSN suite needs it —
 * the provider runs the two-leg exchange (authorize → code, token → bearer)
 * before any library/trophy call — and four suites used to carry their own
 * copy-pasted copy. That is exactly how a stale exchange shape keeps every
 * suite green while production breaks, so it lives here once.
 *
 * `psnHost` answers the calls this suite actually cares about; return
 * `undefined` and the request falls through to the REAL fetch (the Worker's own
 * traffic under vitest-pool-workers shares this global).
 */
const realFetch = globalThis.fetch;

const AUTHORIZE = 'https://ca.account.sony.com/api/authz/v3/oauth/authorize';
const TOKEN = 'https://ca.account.sony.com/api/authz/v3/oauth/token';

export function stubPsnFetch(
	psnHost: (
		url: string,
	) => Response | Promise<Response> | undefined | Promise<undefined>,
): void {
	vi.stubGlobal(
		'fetch',
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			if (url.startsWith(AUTHORIZE)) {
				return new Response(null, {
					status: 302,
					headers: {
						location:
							'com.scee.psxandroid.scecompcall://redirect?code=test-auth-code',
					},
				});
			}
			if (url.startsWith(TOKEN)) {
				return new Response(JSON.stringify({ access_token: 'test-bearer' }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			}
			return (await psnHost(url)) ?? realFetch(input, init);
		},
	);
}

/** The library GraphQL host (`services/sync.ts`). */
export const PSN_LIBRARY_HOST = 'https://web.np.playstation.com/';
/** The trophy host (`services/trophies.ts`, `services/backfill.ts`). */
export const PSN_TROPHY_HOST = 'https://m.np.playstation.com/';

/** One store-browse request, as the ingest actually issued it. */
export interface StoreCall {
	offset: number;
	/** The `filterBy` genre facet key, or null on the unfiltered page. */
	genreKey: string | null;
	/** `x-psn-store-locale-override` — the region the catalog is fetched for. */
	locale: string;
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
			const variables = JSON.parse(
				new URL(url).searchParams.get('variables') ?? '{}',
			) as { pageArgs?: { offset?: number }; filterBy?: string[] };
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
