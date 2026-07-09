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

export const PLAY_STATUSES = [
	'Not started',
	'Up next',
	'Playing',
	'Paused',
	'Dropped',
] as const;

const EFFECTIVE_STATES = [
	...PLAY_STATUSES,
	'Platinum achieved',
	'Story completed',
] as const;

export type PlayStatus = (typeof PLAY_STATUSES)[number];
export type EffectiveState = (typeof EFFECTIVE_STATES)[number];

export type Milestone = 'completed' | 'platinum';

export const shelfGameSchema = z.object({
	id: z.string(),
	title: z.string(),
	coverUrl: z.string().nullable(),
	storeUrl: z.string().nullable(),
	playStatus: z.enum(PLAY_STATUSES).nullable(),
	effectiveState: z.enum(EFFECTIVE_STATES),
	owned: z.boolean(),
	released: z.boolean(),
	wishlisted: z.boolean(),
	psPlusExtra: z.boolean(),
	hasCompleted: z.boolean(),
	hasPlatinum: z.boolean(),
	completedOn: z.string().nullable(),
	platinumOn: z.string().nullable(),
	startedOn: z.string().nullable(),
	boughtOn: z.string().nullable(),
	wishlistedOn: z.string().nullable(),
	ownershipType: z.enum(['physical', 'digital']).nullable(),
	releaseDate: z.string().nullable(),
	genres: z.array(z.string()),
});

export type ShelfGame = z.infer<typeof shelfGameSchema>;

const shelfResponseSchema = z.object({
	games: z.array(shelfGameSchema),
});

/**
 * Same-origin JSON call: the better-auth session cookie rides along
 * automatically. A non-OK response throws an error carrying its HTTP `status`,
 * which is what lets the query client skip pointless retries on a 4xx and route
 * a 401 back to sign-in.
 */
async function callApi(url: string, init?: RequestInit): Promise<unknown> {
	const response = await fetch(url, {
		credentials: 'same-origin',
		...init,
		headers: { accept: 'application/json', ...init?.headers },
	});
	if (!response.ok) {
		const error = new Error(`Request failed (${response.status})`);
		(error as Error & { status?: number }).status = response.status;
		throw error;
	}
	return response.json();
}

async function fetchGames(
	url: string,
	signal?: AbortSignal,
): Promise<ShelfGame[]> {
	return shelfResponseSchema.parse(await callApi(url, { signal })).games;
}

const playStatusResponseSchema = z.object({
	effectiveState: z.enum(EFFECTIVE_STATES),
});

/**
 * Apply a play status to one game (Story 2.1), or clear it with `null`
 * (Story 2.3). Resolves to its new effective state; a clear that would violate
 * the completion invariant is refused server-side with a 409.
 */
export async function changePlayStatus(
	gameId: string,
	playStatus: PlayStatus | null,
): Promise<EffectiveState> {
	const body = await callApi(
		`/api/games/${encodeURIComponent(gameId)}/play-status`,
		{
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ playStatus }),
		},
	);
	return playStatusResponseSchema.parse(body).effectiveState;
}

/** Log a completion milestone (Story 2.2). Resolves to the new effective state. */
export async function logMilestone(
	gameId: string,
	milestone: Milestone,
): Promise<EffectiveState> {
	const body = await callApi(
		`/api/games/${encodeURIComponent(gameId)}/milestones`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ milestone }),
		},
	);
	return playStatusResponseSchema.parse(body).effectiveState;
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
