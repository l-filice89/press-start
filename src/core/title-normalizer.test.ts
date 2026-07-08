import { describe, expect, it } from 'vitest';
import { normalizeTitle } from './title-normalizer';

describe('normalizeTitle (AD-9)', () => {
	it('strips trademark glyphs', () => {
		expect(normalizeTitle('HEAVY RAIN™')).toBe('heavy rain');
	});

	it('strips a registered mark mid-title', () => {
		expect(normalizeTitle('Gran Turismo® 7')).toBe('gran turismo 7');
	});

	it('drops a single leading article', () => {
		expect(normalizeTitle('The Last of Us Part II')).toBe('last of us part 2');
	});

	it('strips an edition suffix', () => {
		expect(
			normalizeTitle("Marvel's Spider-Man: Game of the Year Edition"),
		).toBe("marvel's spider-man");
	});

	it('collapses PS4/PS5 platform tags to an identical key', () => {
		expect(normalizeTitle('Ghost of Tsushima (PS4)')).toBe('ghost of tsushima');
		expect(normalizeTitle('Ghost of Tsushima (PS5)')).toBe('ghost of tsushima');
	});

	it('collapses a combined PS4/PS5 bundle tag to the same key', () => {
		expect(normalizeTitle('Ghost of Tsushima (PS4 & PS5)')).toBe(
			'ghost of tsushima',
		);
		expect(normalizeTitle('Ghost of Tsushima (PS4/PS5)')).toBe(
			'ghost of tsushima',
		);
	});

	it('folds and collapses whitespace', () => {
		expect(normalizeTitle('  Bloodborne   ')).toBe('bloodborne');
	});

	it('folds curly apostrophe variants to match a straight-quoted spelling', () => {
		expect(normalizeTitle('Marvel’s Spider-Man')).toBe(
			normalizeTitle("Marvel's Spider-Man"),
		);
	});

	it('applies trademark glyph, platform tag, edition suffix, and leading-article stripping together', () => {
		expect(normalizeTitle("The Ghost of Tsushima™ (PS4): Director's Cut")).toBe(
			'ghost of tsushima',
		);
	});

	it('folds diacritics so an accented and a plain-ASCII spelling match', () => {
		expect(normalizeTitle('Ghost of Yōtei')).toBe(
			normalizeTitle('Ghost of Yotei'),
		);
	});

	it('folds a trailing Roman-numeral sequel number to its Arabic digit', () => {
		expect(normalizeTitle('Alan Wake II')).toBe(normalizeTitle('Alan Wake 2'));
		expect(normalizeTitle('Dead Space III')).toBe('dead space 3');
	});

	it('does not fold a bare trailing "I" or "X" (real words/franchise letters, not numbering)', () => {
		expect(normalizeTitle('Malice X')).toBe('malice x');
		expect(normalizeTitle('Mega Man X')).toBe('mega man x');
	});
});
