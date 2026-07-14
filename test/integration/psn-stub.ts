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
