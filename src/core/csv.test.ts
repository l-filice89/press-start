import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('parseCsv (Story 1.6 seed CSV parsing)', () => {
	it('parses a simple header + rows into keyed records', () => {
		const records = parseCsv('a,b,c\n1,2,3\n4,5,6\n');
		expect(records).toEqual([
			{ a: '1', b: '2', c: '3' },
			{ a: '4', b: '5', c: '6' },
		]);
	});

	it('keeps commas inside quoted fields intact', () => {
		const records = parseCsv(
			'name,platform\n"Warhammer 40,000: Boltgun",PS5\n',
		);
		expect(records[0].name).toBe('Warhammer 40,000: Boltgun');
		expect(records[0].platform).toBe('PS5');
	});

	it('unescapes doubled quotes inside a quoted field', () => {
		const records = parseCsv('title\n"She said ""hi"""\n');
		expect(records[0].title).toBe('She said "hi"');
	});

	it('strips a leading utf-8-sig BOM from the header', () => {
		const records = parseCsv('﻿name,platform\nHEAVY RAIN™,PS4\n');
		// Without BOM handling the first header key would be "﻿name".
		expect(records[0].name).toBe('HEAVY RAIN™');
	});

	it('handles CRLF line endings and embedded newlines in quotes', () => {
		const records = parseCsv('a,b\r\n1,"line1\nline2"\r\n');
		expect(records).toHaveLength(1);
		expect(records[0].b).toBe('line1\nline2');
	});

	it('parses a final row with no trailing newline', () => {
		const records = parseCsv('a,b\n1,2');
		expect(records).toEqual([{ a: '1', b: '2' }]);
	});

	it('pads short rows and skips fully blank lines', () => {
		const records = parseCsv('a,b,c\n1,2\n\n3,4,5\n');
		expect(records).toEqual([
			{ a: '1', b: '2', c: '' },
			{ a: '3', b: '4', c: '5' },
		]);
	});

	it('returns an empty array for empty input', () => {
		expect(parseCsv('')).toEqual([]);
	});
});

describe('toCsv (Story 6.3 export, RFC-4180)', () => {
	it('serializes a grid with CRLF line endings, quoting only when needed', () => {
		expect(
			toCsv([
				['Title', 'Genres'],
				['Hades', 'Roguelike; Action'],
			]),
		).toBe('Title,Genres\r\nHades,Roguelike; Action');
	});

	it('quotes fields with commas, quotes, or newlines and doubles embedded quotes', () => {
		expect(toCsv([['Warhammer 40,000: Boltgun']])).toBe(
			'"Warhammer 40,000: Boltgun"',
		);
		expect(toCsv([['She said "hi"']])).toBe('"She said ""hi"""');
		expect(toCsv([['line1\nline2']])).toBe('"line1\nline2"');
	});

	it('round-trips with parseCsv', () => {
		const grid = [
			['Title', 'Note'],
			['Celeste', 'has, comma'],
			['Braid', 'plain'],
			['Multi', 'line1\nline2'],
			['Quoted', 'she said "hi"'],
		];
		expect(parseCsv(toCsv(grid))).toEqual([
			{ Title: 'Celeste', Note: 'has, comma' },
			{ Title: 'Braid', Note: 'plain' },
			// The quoted-newline cell reassembles — the one case quoting exists for.
			{ Title: 'Multi', Note: 'line1\nline2' },
			{ Title: 'Quoted', Note: 'she said "hi"' },
		]);
	});
});
