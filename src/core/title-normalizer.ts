/**
 * AD-9: curated, extensible edition-suffix list — not an exhaustive
 * real-world title dictionary. Stragglers get manual overrides later
 * (project-context.md); favor a small, documented list over guessing every
 * title's suffix. Ordered longest-first so a compound phrase (e.g. "digital
 * deluxe edition") isn't left half-stripped by a shorter alternative.
 */
const EDITION_SUFFIXES = [
	'digital deluxe edition',
	'game of the year edition',
	'anniversary edition',
	'definitive edition',
	"director's cut",
	'directors cut',
	'complete edition',
	'deluxe edition',
	'ultimate edition',
	'enhanced edition',
	'standard edition',
	'legendary edition',
	'special edition',
	'goty edition',
	'gold edition',
	'remastered',
	'remaster',
];

// Suffix is stripped only when it trails the string, optionally after a
// `:`/`-`/`–`/`—` separator — never mid-title.
const EDITION_SUFFIX_PATTERN = new RegExp(
	`(?:[:\\-–—]\\s*)?(?:${EDITION_SUFFIXES.join('|')})\\s*$`,
	'i',
);

// Matches a single "(PS4)"/"(PlayStation 5)" tag, or a combined bundle tag
// like "(PS4 & PS5)"/"(PS4/PS5)"/"(PS4, PS5)" — storefront/Notion listings
// use both forms for the same dual-platform release.
const PLATFORM_TOKEN = '(?:ps|playstation)\\s*[45]';
const PLATFORM_TAG_PATTERN = new RegExp(
	`\\(\\s*${PLATFORM_TOKEN}(?:\\s*(?:[,&/]|and)\\s*${PLATFORM_TOKEN})*\\s*\\)`,
	'gi',
);

const TRADEMARK_GLYPH_PATTERN = /[™®©]/g;

// Cross-source titles disagree on straight vs. curly/typographic apostrophes
// (e.g. Notion export vs. IGDB); fold them all to one form before suffix
// matching, so a straight and a curly-quoted spelling of the same title
// produce an identical key. ‘/’ = curly single quotes, ʼ =
// modifier letter apostrophe, ´/` = acute accent / backtick (some
// sources substitute these for an apostrophe).
const APOSTROPHE_PATTERN = /[‘’ʼ´`]/g;

const LEADING_ARTICLE_PATTERN = /^(?:a|an|the)\s+/i;

/**
 * AD-9: the single implementation of the shared cross-source title match
 * key. Strips trademark glyphs, folds apostrophe variants, a curated
 * edition-suffix list, PS4/PS5 platform tags (so both platform releases
 * collapse to one key), and a single leading article, then case/whitespace-
 * folds.
 */
export function normalizeTitle(rawTitle: string): string {
	let title = rawTitle.replace(TRADEMARK_GLYPH_PATTERN, '');
	title = title.replace(APOSTROPHE_PATTERN, "'");
	title = title.replace(PLATFORM_TAG_PATTERN, ' ');
	title = title.replace(EDITION_SUFFIX_PATTERN, '');
	title = title.toLowerCase().trim().replace(/\s+/g, ' ');
	title = title.replace(LEADING_ARTICLE_PATTERN, '');
	// Leftover separator punctuation (e.g. a trailing `:`/`-`/`,`) can remain
	// once a suffix is stripped from mid-pipeline; clean it up last.
	title = title.replace(/[\s:,\-–—]+$/, '').trim();
	return title;
}
