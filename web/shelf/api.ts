import { z } from 'zod';

/**
 * Client-side contract for the shelf/search API (AR-26: Zod at every boundary).
 *
 * The SPA (tsconfig.app, DOM lib) and the Worker (tsconfig.worker) are separate
 * TypeScript programs, so this schema deliberately mirrors the server's
 * `ShelfGame` rather than importing it across the project boundary. Both sides
 * validate the wire shape independently; a drift surfaces as a parse error
 * here, not a silent mismatch.
 */

const EFFECTIVE_STATES = [
	'Not started',
	'Up next',
	'Playing',
	'Paused',
	'Dropped',
	'Platinum achieved',
	'Story completed',
] as const;

export type EffectiveState = (typeof EFFECTIVE_STATES)[number];

export const shelfGameSchema = z.object({
	id: z.string(),
	title: z.string(),
	coverUrl: z.string().nullable(),
	storeUrl: z.string().nullable(),
	effectiveState: z.enum(EFFECTIVE_STATES),
	owned: z.boolean(),
	released: z.boolean(),
	wishlisted: z.boolean(),
	psPlusExtra: z.boolean(),
	hasCompleted: z.boolean(),
	hasPlatinum: z.boolean(),
	releaseDate: z.string().nullable(),
	genres: z.array(z.string()),
});

export type ShelfGame = z.infer<typeof shelfGameSchema>;

const shelfResponseSchema = z.object({
	games: z.array(shelfGameSchema),
});

async function fetchGames(
	url: string,
	signal?: AbortSignal,
): Promise<ShelfGame[]> {
	const response = await fetch(url, {
		// Same-origin: the better-auth session cookie rides along automatically.
		credentials: 'same-origin',
		headers: { accept: 'application/json' },
		signal,
	});
	if (!response.ok) {
		// Carry the status so the query client can skip pointless retries on a
		// 4xx (e.g. an expired session → 401 shouldn't be retried three times).
		const error = new Error(`Request failed (${response.status})`);
		(error as Error & { status?: number }).status = response.status;
		throw error;
	}
	return shelfResponseSchema.parse(await response.json()).games;
}

/** The default backlog shelf (server-ordered, hidden states removed). */
export function fetchShelf(signal?: AbortSignal): Promise<ShelfGame[]> {
	return fetchGames('/api/shelf', signal);
}

/** The dedicated whole-library search (matches every game, ignores filters). */
export function searchShelf(
	query: string,
	signal?: AbortSignal,
): Promise<ShelfGame[]> {
	return fetchGames(`/api/shelf/search?q=${encodeURIComponent(query)}`, signal);
}
