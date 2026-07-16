import type { PlayStatus, ShelfGame } from './api';
import { showLeaving } from './leaving';

/**
 * Shelf filter model (Stories 3.1/3.2/3.5, FR-20/21 as amended 2026-07-10).
 * OR within a group, AND across groups. The payload is the whole
 * server-ordered library (live statuses first, hidden states ranked after —
 * FR-18); the filter derives the visible set: the selected states (else the
 * live default set), or — exclusively — the revealed hidden states (a reveal
 * REPLACES the state group; the toggle handlers keep `states` and `reveals`
 * mutually exclusive), then each active flag ANDs. Filtering is a pure,
 * order-preserving subset — never re-sort here.
 */

export const LIVE_STATUSES = [
	'Not started',
	'Up next',
	'Playing',
	'Paused',
] as const satisfies readonly PlayStatus[];

export type LiveStatus = (typeof LIVE_STATUSES)[number];

/** The backlog-hidden states, reachable only via their reveal pill (FR-4/17). */
export const REVEAL_STATES = [
	'Story completed',
	'Platinum achieved',
	'Dropped',
] as const;

export type RevealState = (typeof REVEAL_STATES)[number];

/** Derived-flag pills — each active one is its own AND group (FR-20). */
export const FLAGS = [
	{ key: 'owned', label: 'Owned' },
	{ key: 'wishlisted', label: 'Wishlisted' },
	{ key: 'released', label: 'Released' },
	{ key: 'playableNow', label: 'Playable now' },
	// "Play these before they're gone" — the PS+ Extra badge set exactly:
	// in the catalog and NOT owned (an owned game hides the badge). Its
	// visibility as a pill is gated on the library actually having such a game
	// (see FilterRow) — a natural proxy for "has a PS+ subscription".
	{ key: 'psPlusExtra', label: 'PS+' },
	// The LEAVING pill set exactly (Story 10.4 follow-on): un-owned with a
	// future departure date — `showLeaving`, the same gate every surface
	// renders by. Visibility gated like PS+ (see FilterRow).
	{ key: 'leavingSoon', label: 'Leaving soon' },
] as const;

export type FlagKey = (typeof FLAGS)[number]['key'];

/**
 * Time-to-beat bands (Story 12.1, VR-9). Half-open (`25 < h ≤ 50` shape): a
 * game landing exactly on a boundary matches exactly ONE band — no overlap,
 * no gap. Hours = selected-metric seconds / 3600. `unknown` is the explicit
 * absence band: a null selected metric matches it and ONLY it (NFR-4 — never
 * a numeric band, never zero-as-value); its hour predicate is therefore
 * constant-false. Bands are static — always all six, no zero-count hiding.
 */
export const TTB_BANDS = [
	{ key: 'lte25', label: '≤25h', match: (h: number) => h <= 25 },
	{ key: '25-50', label: '25–50h', match: (h: number) => h > 25 && h <= 50 },
	{ key: '50-75', label: '50–75h', match: (h: number) => h > 50 && h <= 75 },
	{
		key: '75-100',
		label: '75–100h',
		match: (h: number) => h > 75 && h <= 100,
	},
	{ key: 'gt100', label: '>100h', match: (h: number) => h > 100 },
	{ key: 'unknown', label: 'Unknown', match: () => false },
] as const;

export type TtbBandKey = (typeof TTB_BANDS)[number]['key'];

/** Display label for a band key — the ONE lookup both the menu rows and the
 *  summary sentence render from. */
export const ttbBandLabel = (key: TtbBandKey): string =>
	TTB_BANDS.find((b) => b.key === key)?.label ?? key;

/** Which stored TTB metric the bands read — filter state, never persisted. */
export type TtbMetric = 'story' | 'complete';

export type ShelfFilter = {
	states: LiveStatus[];
	genres: string[];
	reveals: RevealState[];
	flags: FlagKey[];
	ttb: { metric: TtbMetric; bands: TtbBandKey[] };
};

export const EMPTY_FILTER: ShelfFilter = {
	states: [],
	genres: [],
	reveals: [],
	flags: [],
	ttb: { metric: 'story', bands: [] },
};

export function isFilterActive(filter: ShelfFilter): boolean {
	// The TTB metric alone never activates the filter — only selected bands do.
	return (
		filter.states.length > 0 ||
		filter.genres.length > 0 ||
		filter.reveals.length > 0 ||
		filter.flags.length > 0 ||
		filter.ttb.bands.length > 0
	);
}

/**
 * The Time-group clause (Story 12.1): OR across the selected bands against
 * the chosen metric. An absent metric ⇒ matches only `unknown` — and absence
 * covers any value that is not an honest duration (null/undefined schema
 * drift, NaN, negatives), never just `null`, so a malformed value can't
 * silently vanish a game or dishonestly land in ≤25h. `0` seconds is a real
 * value (≤25h) — absence is never zero (NFR-4).
 */
function matchesTtb(game: ShelfGame, ttb: ShelfFilter['ttb']): boolean {
	if (ttb.bands.length === 0) return true;
	const seconds =
		ttb.metric === 'story' ? game.ttbStorySeconds : game.ttbCompleteSeconds;
	if (seconds == null || !Number.isFinite(seconds) || seconds < 0)
		return ttb.bands.includes('unknown');
	const hours = seconds / 3600;
	return TTB_BANDS.some(
		(band) => ttb.bands.includes(band.key) && band.match(hours),
	);
}

/**
 * The filter predicate consumes the server-computed `effectiveState`, `genres`,
 * and derived flags on each game — never recomputed client-side (AD-7).
 * The empty filter yields the default visible set (live statuses only).
 */
export function applyShelfFilter(
	games: ShelfGame[],
	filter: ShelfFilter,
): ShelfGame[] {
	// Reveals are an EXCLUSIVE view (FR-21 amended): any reveal selection shows
	// only the revealed hidden states. Otherwise the selected states, else the
	// live default set. Reveals win even if `states` is somehow non-empty —
	// defense in depth behind the mutually-exclusive toggle handlers.
	const allowedStates: readonly string[] =
		filter.reveals.length > 0
			? filter.reveals
			: filter.states.length > 0
				? filter.states
				: LIVE_STATUSES;
	return games.filter(
		(game) =>
			allowedStates.includes(game.effectiveState) &&
			(filter.genres.length === 0 ||
				game.genres.some((genre) => filter.genres.includes(genre))) &&
			// PS+ and Leaving pills match their card badges exactly (in-catalog
			// AND not owned / future date AND not owned). Every other flag reads
			// its game field directly.
			filter.flags.every((flag) =>
				flag === 'psPlusExtra'
					? game.psPlusExtra && !game.owned
					: flag === 'leavingSoon'
						? showLeaving(game.psPlusLeavingOn, game.owned)
						: game[flag],
			) &&
			matchesTtb(game, filter.ttb),
	);
}

/**
 * Fold a string for free-text shelf search (Story 6.5): lowercase + strip
 * diacritics (NFD, drop combining marks U+0300–U+036F) + collapse runs of
 * whitespace to one space + trim. A web-local fold on PURPOSE — NOT
 * `core/normalizeTitle`, which strips articles/edition-suffixes/numerals to
 * build a match KEY (wrong for a substring needle: "the" → "" would drop it
 * from the haystack). This only case/diacritic/whitespace-normalizes so a
 * substring `contains` is fair.
 */
export function foldForSearch(s: string): string {
	return (
		s
			.normalize('NFD')
			// Strip the combining-marks block (U+0300-U+036F) NFD just produced. Folds
			// only COMBINING diacritics - precomposed letters are left as-is, fine for a
			// Latin-title library.
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/\s+/g, ' ')
			.trim()
	);
}

/**
 * Normalized, case/diacritic-insensitive substring match of `query` in `title`
 * (Story 6.5). An empty (or whitespace-only) folded query matches everything —
 * clearing the search restores the full shelf. Both sides fold identically, so
 * "pokemon" matches "Pokémon" and vice versa.
 */
export function matchesTitleQuery(title: string, query: string): boolean {
	const needle = foldForSearch(query);
	if (needle === '') return true;
	return foldForSearch(title).includes(needle);
}

/** One rendered token of the summary sentence (Story 3.3, UX-DR23). */
export type SummaryPart = {
	text: string;
	/** Set on the literal connector words so the UI can tint them (color redundant to the word). */
	connector?: 'or' | 'and';
};

const joinWithOr = (terms: string[]): SummaryPart[] =>
	terms.flatMap((text, i) =>
		i === 0 ? [{ text }] : [{ text: 'or', connector: 'or' as const }, { text }],
	);

/**
 * Plain-English readback of an active filter: OR within a group, AND across
 * groups, as literal words. An active reveal view narrates literally —
 * "Showing Story completed games." — exactly the exclusive subset the shelf
 * shows (FR-21 amended; the live-status enumeration went with the additive
 * semantics). Groups are comma-separated before each "and" so two OR-groups
 * can't misread as one. Empty filter → no parts.
 */
export function summarizeFilter(filter: ShelfFilter): SummaryPart[] {
	const groups: SummaryPart[][] = [];
	const stateTerms =
		filter.reveals.length > 0 ? [...filter.reveals] : [...filter.states];
	if (stateTerms.length > 0) groups.push(joinWithOr(stateTerms));
	if (filter.genres.length > 0) groups.push(joinWithOr(filter.genres));
	// Time bands narrate in selection order, like every other OR group.
	if (filter.ttb.bands.length > 0) {
		groups.push(joinWithOr(filter.ttb.bands.map(ttbBandLabel)));
	}
	for (const key of filter.flags) {
		const flag = FLAGS.find((f) => f.key === key);
		if (flag) groups.push([{ text: flag.label }]);
	}
	if (groups.length === 0) return [];
	const parts: SummaryPart[] = [{ text: 'Showing' }];
	groups.forEach((group, i) => {
		if (i > 0) {
			// Comma on the previous token scopes the groups audibly and visually.
			parts[parts.length - 1].text += ',';
			parts.push({ text: 'and', connector: 'and' });
		}
		parts.push(...group);
	});
	parts.push({ text: 'games.' });
	return parts;
}

/** The summary as one plain string — feeds live-region announcements. */
export function summarizeFilterText(filter: ShelfFilter): string {
	return summarizeFilter(filter)
		.map((p) => p.text)
		.join(' ');
}

/** Toggle one value in a selection list, preserving insertion order. */
export function toggleSelection<T>(selected: T[], value: T): T[] {
	return selected.includes(value)
		? selected.filter((v) => v !== value)
		: [...selected, value];
}
