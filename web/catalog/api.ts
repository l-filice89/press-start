import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { callApi } from '../shelf/api';

/**
 * Client contract for the catalog destination (Story 7.2). Mirrors the server
 * shape rather than importing across the SPA/Worker program boundary — the same
 * policy as `web/shelf/api.ts`.
 *
 * Nothing here reaches PlayStation: these are reads of the snapshot 7.1
 * persisted (AD-6 — nothing external on render).
 */

const catalogGameSchema = z.object({
	productId: z.string(),
	name: z.string(),
	coverUrl: z.string().nullable(),
	storeUrl: z.string().nullable(),
	/** Already tracked → the `In library` / `Owned` marker instead of `＋ Add`. */
	inLibrary: z.boolean(),
	owned: z.boolean(),
	gameId: z.string().nullable(),
});

export type CatalogGame = z.infer<typeof catalogGameSchema>;

const catalogPageSchema = z.object({
	/** null = no PSN region configured → the NO REGION empty state. */
	region: z.string().nullable(),
	total: z.number(),
	/** The whole snapshot, ignoring filters — 0 = EMPTY CATALOG, not NO MATCH. */
	snapshotTotal: z.number(),
	nextCursor: z.number().nullable(),
	/**
	 * The snapshot generation this page was cut from (Story 7.2 review, M3). Paging
	 * is an OFFSET, so a refresh landing between page 1 and page 2 (the destination
	 * offers "Check PS+ Extra" itself, and the cron fires several times a month)
	 * shifts every boundary under the reader — duplicating one row and dropping
	 * another. A page whose generation differs from the first page's is a TORN read,
	 * and the grid re-keys its query on it and starts the paging over.
	 */
	generation: z.string().nullable(),
	games: z.array(catalogGameSchema),
});

export type CatalogPage = z.infer<typeof catalogPageSchema>;

export interface CatalogQuery {
	/** PS-store facet KEYS (AD-26), never IGDB genre names. OR within the group. */
	genreKeys: string[];
	search: string;
}

export async function fetchCatalogPage(
	{ genreKeys, search }: CatalogQuery,
	cursor: number,
	signal?: AbortSignal,
): Promise<CatalogPage> {
	const params = new URLSearchParams();
	for (const key of genreKeys) params.append('genre', key);
	if (search) params.set('q', search);
	if (cursor) params.set('cursor', String(cursor));
	const query = params.toString();
	const body = await callApi(
		`/api/ps-plus-catalog${query ? `?${query}` : ''}`,
		{ signal },
	);
	return catalogPageSchema.parse(body);
}

const catalogGenresSchema = z.object({
	genres: z.array(z.object({ key: z.string(), count: z.number() })),
});

export type CatalogGenre = z.infer<
	typeof catalogGenresSchema
>['genres'][number];

/** The region's facet keys with counts — the filter's vocabulary (AD-26). */
export async function fetchCatalogGenres(
	signal?: AbortSignal,
): Promise<CatalogGenre[]> {
	const body = await callApi('/api/ps-plus-catalog/genres', { signal });
	return catalogGenresSchema.parse(body).genres;
}

const sweepChunkSchema = z.object({
	/** The snapshot generation these tags belong to — presented back each chunk. */
	generation: z.string(),
	nextCursor: z.string().nullable(),
	/** Rides back only while the loop continues — the last chunk released it. */
	lockToken: z.string().optional(),
});

/**
 * Drive the chunked genre sweep to completion (Story 7.1's "do it now" client
 * loop — the piece 7.2 owed). Without it `ps_plus_catalog_genre` fills only
 * when the monthly cron converges, so a fresh check left the genre filter
 * empty for days (and forever in local dev). Re-posts cursor + generation +
 * lockToken until the cursor comes back null, exactly the contract the chunk
 * endpoint documents.
 */
export async function sweepCatalogGenres(generation?: string): Promise<void> {
	// The check response's generation is optional; the chunk response's is not —
	// adopt it from the first chunk so the server's torn-sweep fence stays armed
	// on every continuation even when the caller had none (review #3).
	let gen = generation;
	let cursor: string | undefined;
	let lockToken: string | undefined;
	try {
		// ponytail: hard stop far past the ~5 chunks a 20-key region needs — a
		// server bug must not turn this background loop into an infinite poster.
		// Ceiling: 25 × CHUNK_SIZE(4) = 100 facet keys; raise it if a region ever
		// names more.
		for (let i = 0; i < 25; i++) {
			const params = new URLSearchParams();
			if (gen) params.set('generation', gen);
			if (cursor) params.set('cursor', cursor);
			if (lockToken) params.set('lockToken', lockToken);
			const body = await callApi(`/api/ps-plus-catalog/genres?${params}`, {
				method: 'POST',
			});
			const chunk = sweepChunkSchema.parse(body);
			gen ??= chunk.generation;
			if (chunk.nextCursor === null) return;
			cursor = chunk.nextCursor;
			lockToken = chunk.lockToken;
		}
		throw new Error('genre sweep did not terminate');
	} catch (error) {
		// Abandoning mid-loop with a live token keeps every other PSN op 409ing
		// for the whole lock TTL — the endpoint's release=1 exists for exactly
		// this (review #1). A server-side failure already released; releasing
		// again is a no-op.
		if (lockToken) {
			const release = new URLSearchParams({ release: '1', lockToken });
			await callApi(`/api/ps-plus-catalog/genres?${release}`, {
				method: 'POST',
			}).catch(() => {});
		}
		throw error;
	}
}

/**
 * Fire-and-forget wrapper for the check button's onSuccess: the sweep is ~5
 * chunks of live store queries, so it must not hold the check's own readout
 * hostage. When it lands, the genre vocabulary (and the counts on the chips)
 * refetch. A failure is logged, not surfaced — the membership snapshot is
 * valid either way (AD-28) and the cron re-drives the persisted cursor.
 * ponytail: no stale-generation restart here — the cron converges it.
 */
export function startGenreSweep(
	queryClient: QueryClient,
	generation?: string,
): void {
	void sweepCatalogGenres(generation)
		.then(() => {
			queryClient.invalidateQueries({ queryKey: ['catalog-genres'] });
			queryClient.invalidateQueries({ queryKey: ['catalog'] });
		})
		.catch((error: unknown) =>
			console.warn('genre sweep did not finish — the cron converges it', error),
		);
}

/**
 * The DISPLAY label for a facet key. Keys are locale-independent enums
 * (`ROLE_PLAYING_GAMES`, `MUSIC/RHYTHM`) — we render a label and always filter
 * on the KEY; the label is never stored, never sent, never matched on (AD-26).
 * ponytail: derived from the key rather than a hand-kept translation table — the
 * key list is discovered per region, so a table would silently miss a new one.
 */
export function genreLabel(key: string): string {
	return key
		.split('/')
		.map((part) =>
			part
				.split('_')
				.map((word) => word.charAt(0) + word.slice(1).toLowerCase())
				.join(' '),
		)
		.join(' / ');
}
