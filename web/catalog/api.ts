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
