import { QueryCache, QueryClient } from '@tanstack/react-query';
import { authClient } from './auth-client';

/** A thrown value is only status-bearing if it's an object carrying `status` —
 * a query can reject with anything (`null`, a string, an `AbortError`). */
function statusOf(error: unknown): number | undefined {
	return typeof error === 'object' && error !== null
		? (error as { status?: number }).status
		: undefined;
}

/**
 * The app's single TanStack Query client (the architecture-pinned data-fetch
 * layer). Reads are cached; the shelf/search queries live under it.
 *
 * Both behaviours below are wired once, at the client, and apply to every
 * query. They only *do* anything for errors that carry an HTTP `status` —
 * today that's `fetchGames` (web/shelf/api.ts), which attaches it on a non-OK
 * response. Queries do not cover mutations: `MutationCache` has no 401 hook
 * because the app has no mutations yet.
 *
 * - **Retry policy.** A 4xx (e.g. an expired session → 401) is a dead end —
 *   don't burn the default three retries on it; only transient (5xx/network)
 *   errors retry.
 * - **Central 401 re-auth.** On a 401 we refetch the better-auth session: the
 *   expired cookie resolves it to `null`, so the session gate in App.tsx
 *   re-renders <Login/>. Non-401 failures fall through to whatever generic
 *   error the surface shows.
 */
export function createQueryClient(): QueryClient {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error) => {
				if (statusOf(error) === 401) {
					// better-auth's cross-component session-invalidation signal: the
					// mounted session atom re-fetches /api/auth/get-session and stores
					// `null` when it answers 401.
					authClient.$store.notify('$sessionSignal');
				}
			},
		}),
		defaultOptions: {
			queries: {
				retry: (failureCount, error) => {
					const status = statusOf(error);
					if (status && status >= 400 && status < 500) return false;
					return failureCount < 3;
				},
			},
		},
	});
}
