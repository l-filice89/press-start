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

// A trailing sequel number written as a Roman numeral (e.g. "Alan Wake II")
// must fold to the same key as its Arabic-digit spelling ("Alan Wake 2") —
// cross-source titles disagree on which they use. Deliberately excludes bare
// "I"/"X": both collide with real words/franchise letters (the pronoun "I",
// "Mega Man X" as a proper name rather than "Mega Man 10"), so only the
// unambiguous II-IX cluster is folded. Longest-first so "viii" isn't cut
// short by an earlier partial alternative like "vi".
const ROMAN_NUMERAL_TO_ARABIC: Record<string, string> = {
	viii: '8',
	vii: '7',
	iii: '3',
	vi: '6',
	iv: '4',
	ix: '9',
	ii: '2',
	v: '5',
};
const TRAILING_ROMAN_NUMERAL_PATTERN = new RegExp(
	`\\s(${Object.keys(ROMAN_NUMERAL_TO_ARABIC).join('|')})\\s*$`,
	'i',
);

/**
 * AD-9: the single implementation of the shared cross-source title match
 * key. Strips trademark glyphs, folds apostrophe variants, a curated
 * edition-suffix list, PS4/PS5 platform tags (so both platform releases
 * collapse to one key), diacritics, a trailing Roman-numeral sequel number,
 * and a single leading article, then case/whitespace-folds.
 */
export function normalizeTitle(rawTitle: string): string {
	let title = rawTitle.replace(TRADEMARK_GLYPH_PATTERN, '');
	title = title.replace(APOSTROPHE_PATTERN, "'");
	title = title.replace(PLATFORM_TAG_PATTERN, ' ');
	title = title.replace(EDITION_SUFFIX_PATTERN, '');
	// Fold diacritics (e.g. "Yōtei" / "Yotei") after NFD-decomposing each
	// accented character into base letter + combining mark, then dropping
	// the marks (Unicode combining-diacriticals block) — cross-source titles
	// disagree on whether they're kept.
	const COMBINING_MARK_MIN = 0x0300;
	const COMBINING_MARK_MAX = 0x036f;
	title = Array.from(title.normalize('NFD'))
		.filter((ch) => {
			const code = ch.codePointAt(0) ?? 0;
			return code < COMBINING_MARK_MIN || code > COMBINING_MARK_MAX;
		})
		.join('');
	title = title.toLowerCase().trim().replace(/\s+/g, ' ');
	title = title.replace(LEADING_ARTICLE_PATTERN, '');
	title = title.replace(
		TRAILING_ROMAN_NUMERAL_PATTERN,
		(_, numeral: string) =>
			` ${ROMAN_NUMERAL_TO_ARABIC[numeral.toLowerCase()]}`,
	);
	// Leftover separator punctuation (e.g. a trailing `:`/`-`/`,`) can remain
	// once a suffix is stripped from mid-pipeline; clean it up last.
	title = title.replace(/[\s:,\-–—]+$/, '').trim();
	return title;
}
