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
	/**
	 * Reception scores (Story 10.1, VR-5): IGDB's 0–100 values VERBATIM, null
	 * when IGDB has none — a null persists as NULL and renders as absent, never
	 * a zero. `critic` = `aggregated_rating`, `user` = `rating`; the counts are
	 * the sample sizes (3 reviews must never read like 300).
	 */
	criticScore: number | null;
	criticScoreCount: number | null;
	userScore: number | null;
	userScoreCount: number | null;
}

/** The four score facts alone, keyed by IGDB id — the refresh job's row. */
export interface IgdbScores {
	igdbId: string;
	criticScore: number | null;
	criticScoreCount: number | null;
	userScore: number | null;
	userScoreCount: number | null;
}

/**
 * Time-to-beat facts (Story 10.3, VR-8): `/game_time_to_beats` values in
 * SECONDS, verbatim (probe 2026-07-16: `normally` 54000 = 15h story), keyed
 * by the game's IGDB id. Null = IGDB has no submissions for that figure —
 * persists as NULL, renders as absent, and the completionist figure never
 * stands in for the story figure.
 */
export interface IgdbTimeToBeat {
	igdbId: string;
	ttbStorySeconds: number | null;
	ttbCompleteSeconds: number | null;
	ttbCount: number | null;
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

/**
 * The scheduled score refresh's seam (Story 10.1, VR-5): fetch the four score
 * fields for MANY games by their stored IGDB ids in as few subrequests as
 * possible (one per 500 ids) — never one call per game (NFR-1/AR-15). By-id,
 * not by-title: the join is the `external_link (IGDB, id)` anchor, so there is
 * no fuzzy matching anywhere on this path.
 */
export interface IgdbScoreFetch {
	fetchScoresByIds(igdbIds: string[]): Promise<IgdbScores[]>;
	/** Story 10.3: same batched by-id shape against `/game_time_to_beats` —
	 * the shared refresh pass calls both, one subrequest per 500 ids each. */
	fetchTimeToBeatByIds(igdbIds: string[]): Promise<IgdbTimeToBeat[]>;
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
	// Reception scores (Story 10.1) — absent on unscored games.
	aggregated_rating?: number;
	aggregated_rating_count?: number;
	rating?: number;
	rating_count?: number;
}

/** The apicalypse `fields` clause every games query shares (Story 10.1: the
 * score fields ride the SAME call — no second adapter, no extra subrequest). */
const GAME_FIELDS =
	'id, name, first_release_date, cover.image_id, genres.name, aggregated_rating, aggregated_rating_count, rating, rating_count';

const IGDB_GAMES_ENDPOINT = 'https://api.igdb.com/v4/games';
const IGDB_TTB_ENDPOINT = 'https://api.igdb.com/v4/game_time_to_beats';
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

function scores(game: IgdbGame): Omit<IgdbScores, 'igdbId'> {
	const criticScore =
		typeof game.aggregated_rating === 'number' ? game.aggregated_rating : null;
	const userScore = typeof game.rating === 'number' ? game.rating : null;
	return {
		criticScore,
		// A count never rides without its score (review): an orphan count is a
		// standing inconsistency nothing can display — the pair is a unit.
		criticScoreCount:
			criticScore !== null && typeof game.aggregated_rating_count === 'number'
				? game.aggregated_rating_count
				: null,
		userScore,
		userScoreCount:
			userScore !== null && typeof game.rating_count === 'number'
				? game.rating_count
				: null,
	};
}

function enrichment(game: IgdbGame): IgdbEnrichment {
	return {
		coverUrl: coverUrl(game),
		releaseDate: releaseDate(game),
		genres: (game.genres ?? []).map((g) => g.name).filter(Boolean),
		...scores(game),
	};
}

/** Real IGDB adapter. Rate-limited; surfaces HTTP failures (AD-14). */
export function createIgdbProvider(
	config: IgdbConfig,
): IgdbProvider & IgdbSearch & IgdbScoreFetch {
	const minInterval = config.minIntervalMs ?? 260;
	let nextAllowed = 0;

	async function throttle(): Promise<void> {
		const now = Date.now();
		const wait = nextAllowed - now;
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		nextAllowed = Math.max(now, nextAllowed) + minInterval;
	}

	async function fetchGames(
		body: string,
		forceRefresh: boolean,
		endpoint: string = IGDB_GAMES_ENDPOINT,
	) {
		const token = await getAccessToken(
			config.clientId,
			config.clientSecret,
			forceRefresh,
		);
		return fetch(endpoint, {
			method: 'POST',
			headers: {
				'Client-ID': config.clientId,
				Authorization: `Bearer ${token}`,
				Accept: 'application/json',
			},
			body,
			signal: AbortSignal.timeout(IGDB_TIMEOUT_MS),
		});
	}

	// Shared request seam for EVERY IGDB query — the searches (enrich,
	// add-by-name previews, Stories 6.1/6.2), the by-id score fetch (10.1)
	// and the time-to-beat fetch (10.3, its own endpoint): throttle,
	// stable-auth 401 retry, and the Epic-5 DEGENERATE-RESPONSE guard all
	// live here so every caller inherits them — an empty/error IGDB response
	// can never write a garbage game.
	async function queryRows(
		body: string,
		endpoint: string = IGDB_GAMES_ENDPOINT,
	): Promise<unknown[]> {
		await throttle();

		// A cached token that Twitch has expired/revoked answers 401/403 —
		// mint a fresh one and retry ONCE, so a 60-day rotation self-heals
		// with no manual refresh. A second 401 means the id/secret itself is
		// bad, not a stale token.
		let response = await fetchGames(body, false, endpoint);
		if (response.status === 401 || response.status === 403) {
			response = await fetchGames(body, true, endpoint);
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
		return parsed;
	}

	const queryGames = async (body: string): Promise<IgdbGame[]> =>
		(await queryRows(body)) as IgdbGame[];

	// `limit 50`, not IGDB's default 15 (verified live): a base game (e.g.
	// "Genshin Impact") can rank behind dozens of same-named DLC/event entries,
	// dropping out of a shorter candidate list entirely and leaving a real,
	// released game unenriched. `id` is requested for the add-by-name previews
	// (Stories 6.1/6.2).
	//
	// `where game_type = (...)` keeps only playable games (PV-2): main_game(0),
	// expansion(2), bundle(3), standalone_expansion(4), episode(6), remake(8),
	// remaster(9), expanded_game(10), port(11) — dropping DLC/season/
	// pack/update/mod noise that otherwise buries real games in search +
	// candidate lists. Expansion + episode were readmitted 2026-07-13 (the
	// widened result set has room): titles people genuinely own and track
	// (Witcher 3: Blood and Wine, Life is Strange episodes) live there.
	// Bundle was readmitted 2026-07-16 (v2.1.1): store collections people own
	// as ONE product (Crash N. Sane Trilogy, Mass Effect Legendary Edition,
	// Overcooked! All You Can Eat) are game_type 3 in IGDB — with scores —
	// and the filter made them unmatchable everywhere, even manually.
	// NB: IGDB retired the `category` field in favour of `game_type` (same
	// enum values); filtering on the dead `category` returned ZERO rows and
	// emptied every search live — verified against the API 2026-07-13.
	async function searchGames(title: string): Promise<IgdbGame[]> {
		// Trademark glyphs break IGDB's own search matching outright (a
		// query containing "®" returned zero results live, even for an
		// exact, unambiguous title) — strip them same as quotes/backslashes.
		const query = title.replace(/["\\™®©]/g, ' ').trim();
		if (!query) return [];
		return queryGames(
			`search "${query}"; fields ${GAME_FIELDS}; where game_type = (0,2,3,4,6,8,9,10,11); limit 50;`,
		);
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

		// Default cap matches the query's own `limit 50` fetch — one ceiling, not
		// two. A prolific franchise (Persona: 15+ full games post-PV-2 game_type
		// filter) can bury the right game past a smaller cap (PV-3), so surface the
		// whole filtered result set to the picker.
		async searchCandidates(title, limit = 50) {
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

		// Story 10.1: the refresh job's batched by-id fetch. 500 is IGDB's own
		// `limit` ceiling — a 65-game library is ONE subrequest; the no-search,
		// no-game_type-filter body is deliberate (an id already anchored by an
		// explicit user pick or enrichment is trusted; re-filtering could drop a
		// legitimately-linked entry and silently strand its scores).
		async fetchScoresByIds(igdbIds) {
			// Ids came from our own DB but are still interpolated into the query —
			// keep the numeric ones only rather than trust the round trip.
			const numeric = igdbIds.filter((id) => /^\d+$/.test(id));
			const rows: IgdbScores[] = [];
			for (let i = 0; i < numeric.length; i += 500) {
				const chunk = numeric.slice(i, i + 500);
				const games = await queryGames(
					`fields ${GAME_FIELDS}; where id = (${chunk.join(',')}); limit 500;`,
				);
				for (const game of games) {
					if (game.id === undefined) continue;
					rows.push({ igdbId: String(game.id), ...scores(game) });
				}
			}
			return rows;
		},

		// Story 10.3: `/game_time_to_beats`, keyed by game_id — SECONDS, verbatim
		// (captured probe row 2026-07-16: normally 54000, completely 95400,
		// count 8). Same batching and guard seam as the score fetch; a missing
		// figure maps to null (never the other figure — VR-8).
		async fetchTimeToBeatByIds(igdbIds) {
			const numeric = igdbIds.filter((id) => /^\d+$/.test(id));
			const rows: IgdbTimeToBeat[] = [];
			for (let i = 0; i < numeric.length; i += 500) {
				const chunk = numeric.slice(i, i + 500);
				const records = (await queryRows(
					`fields game_id, normally, completely, count; where game_id = (${chunk.join(',')}); limit 500;`,
					IGDB_TTB_ENDPOINT,
				)) as {
					game_id?: number;
					normally?: number;
					completely?: number;
					count?: number;
				}[];
				for (const record of records) {
					if (record.game_id === undefined) continue;
					// Zero/negative seconds are an anomaly, not a figure — mapped to
					// null so the UI can never render a fabricated "<1h" (review;
					// VR-8's never-zero rule). A record with NO usable figure is
					// dropped entirely: an all-null row would WIPE stored hours,
					// and an anomaly must not erase standing data any more than a
					// missing record does (follow-up review).
					const positive = (v: unknown): number | null =>
						typeof v === 'number' && v > 0 ? v : null;
					const ttbStorySeconds = positive(record.normally);
					const ttbCompleteSeconds = positive(record.completely);
					if (ttbStorySeconds === null && ttbCompleteSeconds === null) {
						continue;
					}
					rows.push({
						igdbId: String(record.game_id),
						ttbStorySeconds,
						ttbCompleteSeconds,
						ttbCount: positive(record.count),
					});
				}
			}
			return rows;
		},
	};
}
