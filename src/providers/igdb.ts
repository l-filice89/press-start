/**
 * IGDB enrichment provider (Story 1.6) — the external-I/O seam for game
 * metadata (AD-5). Genres, release date, and (fallback) cover art come
 * exclusively from IGDB (FR-23). The real adapter is a thin fetch wrapper
 * over the IGDB v4 API (Twitch-authenticated); match confidence is decided by
 * the pure `core/pickIgdbMatch`, so a low-confidence result becomes null
 * rather than a guess (FR-28). Exercised live from the seed script and the
 * add-by-name preview route (Story 6.1); tests inject fakes.
 */

import { pickIgdbMatch } from '../core/igdb-match';

export interface IgdbEnrichment {
	/** IGDB cover (`t_cover_big`), or null when the match has no cover. */
	coverUrl: string | null;
	/** First release date as ISO `YYYY-MM-DD`, or null when unknown/TBA. */
	releaseDate: string | null;
	/** Genre names — the sole genre vocabulary (FR-23). */
	genres: string[];
}

export interface IgdbProvider {
	/** Enrich by title; null = no confident IGDB match (never guessed). */
	enrich(title: string): Promise<IgdbEnrichment | null>;
}

/** One IGDB search hit offered as an add-by-name preview (Story 6.1). */
export interface IgdbCandidate extends IgdbEnrichment {
	/** IGDB game id — becomes the `external_link (IGDB, id)` identity anchor. */
	igdbId: string;
	/** IGDB's canonical name (may differ from what the user typed). */
	name: string;
}

/**
 * The add-by-name preview seam (Story 6.1) — a separate interface so existing
 * fakes that only implement `enrich` keep compiling. Unlike `enrich`, a
 * non-exact match is allowed here: the preview is user-confirmed before
 * anything persists, so IGDB's top relevance hit is a useful suggestion, not
 * a guess written blindly.
 */
export interface IgdbSearch {
	searchCandidate(title: string): Promise<IgdbCandidate | null>;
	/**
	 * Up to `limit` candidates for the straggler-resolution pick list (Story
	 * 6.2) — a wrong top hit shouldn't be a dead end, so the user chooses.
	 */
	searchCandidates(title: string, limit?: number): Promise<IgdbCandidate[]>;
}

export interface IgdbConfig {
	/** Twitch app client id. */
	clientId: string;
	/** Twitch app access token (`Bearer`). */
	accessToken: string;
	/** Min ms between calls (IGDB allows ~4 req/s). Default 260. */
	minIntervalMs?: number;
}

interface IgdbGame {
	id?: number;
	name: string;
	first_release_date?: number;
	cover?: { image_id?: string };
	genres?: { name: string }[];
}

const IGDB_GAMES_ENDPOINT = 'https://api.igdb.com/v4/games';
const IGDB_TIMEOUT_MS = 15_000;

function coverUrl(game: IgdbGame): string | null {
	const id = game.cover?.image_id;
	return id
		? `https://images.igdb.com/igdb/image/upload/t_cover_big/${id}.jpg`
		: null;
}

function releaseDate(game: IgdbGame): string | null {
	if (typeof game.first_release_date !== 'number') return null;
	// IGDB stores a unix timestamp in seconds (UTC).
	return new Date(game.first_release_date * 1000).toISOString().slice(0, 10);
}

function enrichment(game: IgdbGame): IgdbEnrichment {
	return {
		coverUrl: coverUrl(game),
		releaseDate: releaseDate(game),
		genres: (game.genres ?? []).map((g) => g.name).filter(Boolean),
	};
}

/** Real IGDB adapter. Rate-limited; surfaces HTTP failures (AD-14). */
export function createIgdbProvider(
	config: IgdbConfig,
): IgdbProvider & IgdbSearch {
	const minInterval = config.minIntervalMs ?? 260;
	let nextAllowed = 0;

	async function throttle(): Promise<void> {
		const now = Date.now();
		const wait = nextAllowed - now;
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		nextAllowed = Math.max(now, nextAllowed) + minInterval;
	}

	async function searchGames(title: string): Promise<IgdbGame[]> {
		// Trademark glyphs break IGDB's own search matching outright (a
		// query containing "®" returned zero results live, even for an
		// exact, unambiguous title) — strip them same as quotes/backslashes.
		const query = title.replace(/["\\™®©]/g, ' ').trim();
		if (!query) return [];
		await throttle();

		const response = await fetch(IGDB_GAMES_ENDPOINT, {
			method: 'POST',
			headers: {
				'Client-ID': config.clientId,
				Authorization: `Bearer ${config.accessToken}`,
				Accept: 'application/json',
			},
			// 50, not IGDB's default 15 (verified live): a base game (e.g.
			// "Genshin Impact") can rank behind dozens of same-named
			// DLC/event entries, dropping out of a shorter candidate list
			// entirely and leaving a real, released game unenriched.
			body: `search "${query}"; fields id, name, first_release_date, cover.image_id, genres.name; limit 50;`,
			signal: AbortSignal.timeout(IGDB_TIMEOUT_MS),
		});

		if (response.status === 401 || response.status === 403) {
			throw new Error(
				`IGDB rejected the request (HTTP ${response.status}) — the access token has likely expired. Refresh IGDB_ACCESS_TOKEN.`,
			);
		}
		if (!response.ok) {
			throw new Error(
				`IGDB request failed: ${response.status} ${await response.text()}`,
			);
		}

		return (await response.json()) as IgdbGame[];
	}

	return {
		async enrich(title) {
			const games = await searchGames(title);
			const index = pickIgdbMatch(
				title,
				games.map((g) => g.name),
			);
			if (index === null) return null;
			return enrichment(games[index]);
		},

		async searchCandidate(title) {
			const games = await searchGames(title);
			if (games.length === 0) return null;
			// Prefer the exact-normalized match; fall back to IGDB's top
			// relevance hit — the user confirms it in the preview.
			const index =
				pickIgdbMatch(
					title,
					games.map((g) => g.name),
				) ?? 0;
			const game = games[index];
			// A hit missing id or name can't anchor an external link or fill the
			// preview — treat as no match so the route degrades (NFR-4) instead
			// of the response schema throwing a 500.
			if (game.id === undefined || !game.name) return null;
			return { igdbId: String(game.id), name: game.name, ...enrichment(game) };
		},

		async searchCandidates(title, limit = 10) {
			const games = await searchGames(title);
			const candidates: IgdbCandidate[] = [];
			for (const game of games) {
				if (game.id === undefined || !game.name) continue;
				candidates.push({
					igdbId: String(game.id),
					name: game.name,
					...enrichment(game),
				});
				if (candidates.length >= limit) break;
			}
			return candidates;
		},
	};
}
