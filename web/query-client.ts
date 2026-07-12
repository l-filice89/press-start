import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { authClient } from './auth-client';

/** A thrown value is only status-bearing if it's an object carrying `status` —
 * a query can reject with anything (`null`, a string, an `AbortError`). */
function statusOf(error: unknown): number | undefined {
	return typeof error === 'object' && error !== null
		? (error as { status?: number }).status
		: undefined;
}

/**
 * better-auth's cross-component session-invalidation signal: the mounted
 * session atom re-fetches /api/auth/get-session and stores `null` when it
 * answers 401, so the session gate in App.tsx re-renders <Login/>.
 */
function reauthOn401(error: unknown): void {
	if (statusOf(error) === 401) {
		authClient.$store.notify('$sessionSignal');
	}
}

/** A 4xx (e.g. an expired session → 401) is a dead end; only transient errors retry. */
function retryUnlessClientError(failureCount: number, error: unknown): boolean {
	const status = statusOf(error);
	if (status && status >= 400 && status < 500) return false;
	return failureCount < 3;
}

/**
 * The app's single TanStack Query client (the architecture-pinned data-fetch
 * layer). Reads are cached; the shelf query and the play-status mutation live
 * under it.
 *
 * The 401 re-auth is wired once, at the client, and applies to every query *and*
 * mutation. It only *does* anything for errors that carry an HTTP `status` —
 * today that's `web/shelf/api.ts`'s `callApi`, which attaches it on a non-OK
 * response. Non-401 failures fall through to whatever generic error the surface
 * shows.
 *
 * Retries are asymmetric on purpose. A failed *read* is safe to repeat, so a
 * transient (5xx/network) error retries and a 4xx doesn't. A failed *write* is
 * not: a request that timed out may still have been applied, so mutations keep
 * TanStack Query's default of never retrying. Writes here are idempotent today,
 * but that's a property of this story's PATCH, not a rule the client can assume
 * for every future mutation.
 */
export function createQueryClient(): QueryClient {
	return new QueryClient({
		queryCache: new QueryCache({ onError: reauthOn401 }),
		mutationCache: new MutationCache({ onError: reauthOn401 }),
		defaultOptions: {
			queries: { retry: retryUnlessClientError },
			mutations: { retry: false },
		},
	});
}
