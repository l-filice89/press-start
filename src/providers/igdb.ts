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
	/** Twitch app client id (permanent). */
	clientId: string;
	/** Twitch app client secret (permanent). The short-lived app access token
	 * is minted from id+secret on demand and refreshed automatically — no
	 * manual 60-day token rotation (contrast the PSN cookie). */
	clientSecret: string;
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
const TWITCH_TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';
const IGDB_TIMEOUT_MS = 15_000;

/**
 * Twitch app-access-token cache, keyed by client id. The token is a
 * client-credentials grant (~60-day TTL) minted from the permanent id+secret;
 * caching it means we mint once and reuse, refreshing on expiry or on a 401.
 *
 * ponytail: in-memory, per-isolate — an *app* token, not user data. A cold
 * Worker isolate re-mints once on its first IGDB call; warm requests reuse it.
 * The route builds the provider per request, so this MUST be module-level (a
 * closure cache would never survive across requests). Persist to KV only if
 * cold-start mint latency is ever measured as a problem.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Test-only: drop cached tokens so mint behaviour is observable per test. */
export function __resetIgdbTokenCache(): void {
	tokenCache.clear();
}

async function getAccessToken(
	clientId: string,
	clientSecret: string,
	forceRefresh: boolean,
): Promise<string> {
	const cached = tokenCache.get(clientId);
	// 60s skew: never hand out a token about to expire mid-request.
	if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60_000) {
		return cached.token;
	}
	const url =
		`${TWITCH_TOKEN_ENDPOINT}?client_id=${encodeURIComponent(clientId)}` +
		`&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`;
	const res = await fetch(url, {
		method: 'POST',
		signal: AbortSignal.timeout(IGDB_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(
			`Twitch token request failed (HTTP ${res.status}) — check IGDB_CLIENT_ID / IGDB_CLIENT_SECRET: ${await res.text()}`,
		);
	}
	const body = (await res.json()) as {
		access_token?: string;
		expires_in?: number;
	};
	if (!body.access_token) {
		throw new Error(
			`Twitch token response missing access_token: ${JSON.stringify(body).slice(0, 200)}`,
		);
	}
	const ttlMs =
		(typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000;
	tokenCache.set(clientId, {
		token: body.access_token,
		expiresAt: Date.now() + ttlMs,
	});
	return body.access_token;
}

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

	async function fetchGames(query: string, forceRefresh: boolean) {
		const token = await getAccessToken(
			config.clientId,
			config.clientSecret,
			forceRefresh,
		);
		return fetch(IGDB_GAMES_ENDPOINT, {
			method: 'POST',
			headers: {
				'Client-ID': config.clientId,
				Authorization: `Bearer ${token}`,
				Accept: 'application/json',
			},
			// 50, not IGDB's default 15 (verified live): a base game (e.g.
			// "Genshin Impact") can rank behind dozens of same-named
			// DLC/event entries, dropping out of a shorter candidate list
			// entirely and leaving a real, released game unenriched. `id` is
			// requested for the add-by-name previews (Stories 6.1/6.2).
			//
			// `where category = (...)` keeps only full games (PV-2): main_game(0),
			// standalone_expansion(4), remake(8), remaster(9), expanded_game(10),
			// port(11) — dropping DLC/bundle/season/pack/update/mod/episode noise
			// that otherwise buries real games in search + candidate lists.
			body: `search "${query}"; fields id, name, first_release_date, cover.image_id, genres.name; where category = (0,4,8,9,10,11); limit 50;`,
			signal: AbortSignal.timeout(IGDB_TIMEOUT_MS),
		});
	}

	// Shared search seam for enrich + the add-by-name previews (Stories
	// 6.1/6.2): query sanitization, throttle, stable-auth 401 retry, and the
	// Epic-5 DEGENERATE-RESPONSE guard all live here so every caller inherits
	// them — an empty/error IGDB response can never write a garbage game.
	async function searchGames(title: string): Promise<IgdbGame[]> {
		// Trademark glyphs break IGDB's own search matching outright (a
		// query containing "®" returned zero results live, even for an
		// exact, unambiguous title) — strip them same as quotes/backslashes.
		const query = title.replace(/["\\™®©]/g, ' ').trim();
		if (!query) return [];
		await throttle();

		// A cached token that Twitch has expired/revoked answers 401/403 —
		// mint a fresh one and retry ONCE, so a 60-day rotation self-heals
		// with no manual refresh. A second 401 means the id/secret itself is
		// bad, not a stale token.
		let response = await fetchGames(query, false);
		if (response.status === 401 || response.status === 403) {
			response = await fetchGames(query, true);
		}
		if (response.status === 401 || response.status === 403) {
			throw new Error(
				`IGDB rejected the request (HTTP ${response.status}) even with a freshly minted token — check IGDB_CLIENT_ID / IGDB_CLIENT_SECRET.`,
			);
		}
		if (!response.ok) {
			throw new Error(
				`IGDB request failed: ${response.status} ${await response.text()}`,
			);
		}

		// DEGENERATE-RESPONSE GUARD (Epic 5 retro rule): a 200 is only trusted
		// if the body is actually the game array. Live probe (2026-07-11)
		// confirmed IGDB returns arrays on 200 and objects on error (401
		// `{message,…}`, 429 `{"message":"Too Many Requests"}`, 400 is a
		// `[{title,status}]` array) — but an API/proxy change handing back a
		// non-array 200 would otherwise throw a raw TypeError in `.map` and
		// surface as a 500 instead of a clean, fail-closed provider error.
		const parsed = await response.json();
		if (!Array.isArray(parsed)) {
			throw new Error(
				`IGDB returned a 200 with a non-array body: ${JSON.stringify(parsed).slice(0, 200)}`,
			);
		}
		return parsed as IgdbGame[];
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
