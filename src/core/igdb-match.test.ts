import { describe, expect, it } from 'vitest';
import { pickIgdbMatch } from './igdb-match';

describe('pickIgdbMatch (Story 1.6, FR-28)', () => {
	it('matches on normalized equality despite glyphs and articles', () => {
		expect(pickIgdbMatch('HEAVY RAIN™', ['Heavy Rain', 'Heavy Rain 2'])).toBe(
			0,
		);
		expect(pickIgdbMatch('The Last of Us', ['Last of Us'])).toBe(0);
	});

	it('returns null when no candidate is a confident match', () => {
		expect(pickIgdbMatch('Bloodborne', ['Dark Souls', 'Sekiro'])).toBeNull();
		expect(pickIgdbMatch('Something', [])).toBeNull();
	});

	it('returns null for an empty/normalizing-to-empty query', () => {
		expect(pickIgdbMatch('', ['Anything'])).toBeNull();
	});

	it('returns the first of several normalized duplicates (relevance order)', () => {
		expect(pickIgdbMatch('Hades', ['HADES', 'Hades'])).toBe(0);
	});
});
