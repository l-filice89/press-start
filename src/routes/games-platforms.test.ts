import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/games.ts', 'utf8');

describe('interactive IGDB route platform wiring', () => {
	it('composes the current user setting into preview and multi-result searches', () => {
		const helper = source.slice(
			source.indexOf('async function interactiveIgdbForUser'),
			source.indexOf('/**\n * The add-by-name boundary'),
		);
		expect(helper).toContain('getPlayStationPlatforms(db, userId)');
		expect(helper).toContain('getIgdbPlatformIds(');

		const preview = source.slice(
			source.indexOf("gamesRoute.get('/games/preview'"),
			source.indexOf("gamesRoute.get('/games/search'"),
		);
		const search = source.slice(
			source.indexOf("gamesRoute.get('/games/search'"),
			source.indexOf("gamesRoute.get('/games/:id'"),
		);
		for (const route of [preview, search]) {
			expect(route).toContain(
				"await interactiveIgdbForUser(c.env, db, c.get('userId'))",
			);
		}
	});
});
