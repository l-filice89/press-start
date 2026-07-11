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

export const OWNERSHIP_TYPES = ['physical', 'digital'] as const;

export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

/** A partial per-field lifecycle-date edit: a date string sets, `null` clears. */
export type DateEdits = Partial<
	Record<
		'wishlistedOn' | 'boughtOn' | 'startedOn' | 'completedOn' | 'platinumOn',
		string | null
	>
>;

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
	playableNow: z.boolean(),
	psPlusExtra: z.boolean(),
	hasCompleted: z.boolean(),
	hasPlatinum: z.boolean(),
	completedOn: z.string().nullable(),
	platinumOn: z.string().nullable(),
	startedOn: z.string().nullable(),
	boughtOn: z.string().nullable(),
	wishlistedOn: z.string().nullable(),
	ownershipType: z.enum(['physical', 'digital']).nullable(),
	// `membership` = PS+ claim (FR-9 amended) — the card tags it.
	ownedVia: z.enum(['purchase', 'membership']).nullable(),
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
export async function callApi(
	url: string,
	init?: RequestInit,
): Promise<unknown> {
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

/**
 * Change the ownership flag and/or type (Story 2.4). Owning stamps `bought_on`
 * once server-side; a type on an un-owned game is refused with a 400.
 */
export async function changeOwnership(
	gameId: string,
	change: { owned?: boolean; ownershipType?: OwnershipType },
): Promise<EffectiveState> {
	const body = await callApi(
		`/api/games/${encodeURIComponent(gameId)}/ownership`,
		{
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(change),
		},
	);
	return playStatusResponseSchema.parse(body).effectiveState;
}

/**
 * Manually correct lifecycle dates (Story 2.4, FR-45). An edit that would
 * clear the last milestone of a status-less game is refused server-side with
 * a 409.
 */
export async function editDates(
	gameId: string,
	edits: DateEdits,
): Promise<EffectiveState> {
	const body = await callApi(`/api/games/${encodeURIComponent(gameId)}/dates`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(edits),
	});
	return playStatusResponseSchema.parse(body).effectiveState;
}

const genresResponseSchema = z.object({ genres: z.array(z.string()) });

/**
 * Tag a game with a genre by name (Story 2.5, FR-24/FR-25). A name not yet in
 * the vocabulary auto-creates the genre row server-side (case-insensitive
 * reuse). Resolves to the game's updated genre list.
 */
export async function addGenre(
	gameId: string,
	name: string,
): Promise<string[]> {
	const body = await callApi(
		`/api/games/${encodeURIComponent(gameId)}/genres`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name }),
		},
	);
	return genresResponseSchema.parse(body).genres;
}

/** Untag a game (idempotent server-side). Resolves to the updated list. */
export async function removeGenre(
	gameId: string,
	name: string,
): Promise<string[]> {
	const body = await callApi(
		`/api/games/${encodeURIComponent(gameId)}/genres/${encodeURIComponent(name)}`,
		{ method: 'DELETE' },
	);
	return genresResponseSchema.parse(body).genres;
}

/** The whole genre vocabulary, sorted — feeds the add input's suggestions. */
export async function fetchGenreVocabulary(
	signal?: AbortSignal,
): Promise<string[]> {
	const body = await callApi('/api/genres', { signal });
	return genresResponseSchema.parse(body).genres;
}

/**
 * The whole ordered library (Story 3.2): live statuses first, hidden states
 * (milestones, Dropped) ranked after. The client filter derives the default
 * visible set; reveal pills OR hidden states back in.
 */
export function fetchShelf(signal?: AbortSignal): Promise<ShelfGame[]> {
	return fetchGames('/api/shelf?include=hidden', signal);
}

/** The dedicated whole-library search (matches every game, ignores filters). */
export function searchShelf(
	query: string,
	signal?: AbortSignal,
): Promise<ShelfGame[]> {
	return fetchGames(`/api/shelf/search?q=${encodeURIComponent(query)}`, signal);
}

/* ---- Add a game by name (Story 6.1) ---- */

const addPreviewSchema = z.object({
	available: z.boolean(),
	candidate: z
		.object({
			igdbId: z.string(),
			name: z.string(),
			coverUrl: z.string().nullable(),
			releaseDate: z.string().nullable(),
			genres: z.array(z.string()),
		})
		.nullable(),
});

export type AddPreview = z.infer<typeof addPreviewSchema>;

/** IGDB candidate for the add dialog; `available: false` = games DB down. */
export async function fetchAddPreview(
	title: string,
	signal?: AbortSignal,
): Promise<AddPreview> {
	const body = await callApi(
		`/api/games/preview?title=${encodeURIComponent(title)}`,
		{ signal },
	);
	return addPreviewSchema.parse(body);
}

export interface AddGamePayload {
	title: string;
	igdbId?: string;
	coverUrl?: string | null;
	releaseDate?: string | null;
	genres?: string[];
	owned?: boolean;
}

export type AddGameResult = { kind: 'created' | 'duplicate'; gameId: string };

const addGameResponseSchema = z.object({ gameId: z.string() });

/**
 * Create the game (FR-41). A 409 is not an error to the UI — it carries the
 * existing game's id so the caller opens its detail view instead (FR-42), so
 * this is a raw fetch rather than `callApi` (which throws on any non-OK).
 */
export async function addGame(payload: AddGamePayload): Promise<AddGameResult> {
	const response = await fetch('/api/games', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { accept: 'application/json', 'content-type': 'application/json' },
		body: JSON.stringify(payload),
	});
	if (response.status === 409) {
		return {
			kind: 'duplicate',
			gameId: addGameResponseSchema.parse(await response.json()).gameId,
		};
	}
	if (!response.ok) {
		const error = new Error(`Request failed (${response.status})`);
		(error as Error & { status?: number }).status = response.status;
		throw error;
	}
	return {
		kind: 'created',
		gameId: addGameResponseSchema.parse(await response.json()).gameId,
	};
}
