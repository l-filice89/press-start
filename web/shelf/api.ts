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

export const TROPHY_GRADES = ['S', 'A', 'B', 'C', 'D'] as const;
export type TrophyGrade = (typeof TROPHY_GRADES)[number];

const trophyTiersSchema = z.object({
	bronze: z.number(),
	silver: z.number(),
	gold: z.number(),
	platinum: z.number(),
});

const trophySchema = z.object({
	percent: z.number(),
	grade: z.enum(TROPHY_GRADES),
	earned: trophyTiersSchema,
	defined: trophyTiersSchema,
});

export type Trophy = z.infer<typeof trophySchema>;

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
	// Trophy progress (Story 9.2), derived server-side from the counts the
	// trophy sync persisted. `null` = no trophy data → the UI renders NOTHING
	// (never a fake 0%). Defaulted so a deploy-skewed response can't reject the
	// whole shelf payload.
	trophy: trophySchema.nullable().default(null),
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
		// Carry the error BODY too: a failed platinum-backfill chunk (9.3) has
		// already written rows, and its partial report rides in that body — a bare
		// status would throw it away.
		// (Wrapped in a promise: a body-less/mocked response may not even have a
		// usable `json()` — a missing body is never a reason to lose the status.)
		(error as Error & { body?: unknown }).body = await Promise.resolve()
			.then(() => response.json())
			.catch(() => undefined);
		throw error;
	}
	return response.json();
}

/**
 * The server's own message out of a failed `callApi` (Story 9.5). A 409 from a
 * PSN op says something the user can ACT on — "a sync is already running" —
 * which a generic "try again later" throws away.
 */
export function serverMessage(error: unknown): string | null {
	const message = (error as { body?: { error?: unknown } } | undefined)?.body
		?.error;
	return typeof message === 'string' && message ? message : null;
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
	change: {
		owned?: boolean;
		ownershipType?: OwnershipType;
		// Acquisition source (Story 6.4): sent only when the buy-vs-claim prompt
		// resolves on a PS+-catalog game; omitted otherwise (server defaults purchase).
		via?: 'purchase' | 'membership';
	},
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

/**
 * Discard (soft-delete) a game or revive it (Story: discard-with-readd-revive).
 * A discarded game leaves every library surface but keeps its tracking row; the
 * UNDO toast calls this with `false`. Not a status change — resolves to void; a
 * 404 (no tracking row) throws via `callApi`.
 */
export async function setDiscarded(
	gameId: string,
	discarded: boolean,
): Promise<void> {
	await callApi(`/api/games/${encodeURIComponent(gameId)}/discard`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ discarded }),
	});
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

const gameResponseSchema = z.object({ game: shelfGameSchema });

/**
 * ONE game by id (Story 7.2) — what the routed `/game/:id` detail resolves
 * through. Deliberately its own read route, not a lookup in the `['shelf']`
 * list cache: an add-then-navigate (7.3) would otherwise race the shelf refetch
 * and render not-found on a game that exists. `callApi` throws with `.status`,
 * so the caller can tell a resolved 404 from a failed load.
 */
export async function fetchGame(
	gameId: string,
	signal?: AbortSignal,
): Promise<ShelfGame> {
	const body = await callApi(`/api/games/${encodeURIComponent(gameId)}`, {
		signal,
	});
	return gameResponseSchema.parse(body).game;
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
	/** The PS Store product id this add came from, if any (Story 7.3, AD-20). */
	psnProductId?: string;
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

/* ---- Straggler resolution (Story 6.2) ---- */

const stragglersSchema = z.object({
	stragglers: z.array(
		z.object({
			id: z.string(),
			kind: z.enum(['import', 'unenriched']),
			title: z.string(),
		}),
	),
});

export type Straggler = z.infer<typeof stragglersSchema>['stragglers'][number];

/** Both straggler kinds as one list for the resolution dialog. */
export async function fetchStragglers(
	signal?: AbortSignal,
): Promise<Straggler[]> {
	const body = await callApi('/api/stragglers', { signal });
	return stragglersSchema.parse(body).stragglers;
}

const igdbCandidateSchema = z.object({
	igdbId: z.string(),
	name: z.string(),
	coverUrl: z.string().nullable(),
	releaseDate: z.string().nullable(),
	genres: z.array(z.string()),
});

export type IgdbCandidate = z.infer<typeof igdbCandidateSchema>;

const searchSchema = z.object({ candidates: z.array(igdbCandidateSchema) });

/** Manual IGDB search for a match; empty when the games DB is down/unset. */
export async function searchIgdb(
	title: string,
	signal?: AbortSignal,
): Promise<IgdbCandidate[]> {
	const body = await callApi(
		`/api/games/search?title=${encodeURIComponent(title)}`,
		{ signal },
	);
	return searchSchema.parse(body).candidates;
}

export interface ResolveStragglerPayload {
	id: string;
	kind: 'import' | 'unenriched';
	igdbId: string;
	name?: string;
	coverUrl?: string | null;
	releaseDate?: string | null;
	genres?: string[];
}

/** Resolve a straggler onto the chosen IGDB match; returns the game id. */
export async function resolveStraggler(
	payload: ResolveStragglerPayload,
): Promise<{ gameId: string }> {
	const body = await callApi('/api/stragglers/resolve', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
	});
	return z.object({ gameId: z.string() }).parse(body);
}

/**
 * Ignore (dismiss) an import straggler — hard-deletes its Notion staging row
 * server-side (no undo, so the caller confirm-gates it). A 404 (already gone)
 * throws via `callApi`; the resolve-view onError toast pattern covers it.
 */
export async function ignoreStraggler(id: string): Promise<void> {
	await callApi('/api/stragglers/ignore', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id }),
	});
}

/* ---- Rematch an already-added game (PV-4) ---- */

export interface RematchPayload {
	igdbId: string;
	name?: string;
	coverUrl?: string | null;
	releaseDate?: string | null;
	genres?: string[];
}

/**
 * Re-point a wrongly-matched game at the chosen IGDB entry (PV-4). Overwrites
 * its cover/date/title/genres in place. A 409 (the pick already belongs to
 * another game) or 404 (not this user's game) throws via `callApi` with its
 * status — the caller's onError toast surfaces it.
 */
export async function rematchGame(
	gameId: string,
	payload: RematchPayload,
): Promise<{ gameId: string }> {
	const body = await callApi(
		`/api/games/${encodeURIComponent(gameId)}/rematch`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
		},
	);
	return z.object({ gameId: z.string() }).parse(body);
}
