import { randomUUID } from 'node:crypto';

/**
 * Seed-shape for a `game` row + the signed-in user's `game_tracking` row —
 * mirrors migrations/0002 columns. Unique-by-default (uuid in the title) so
 * parallel tests never collide.
 */
// ponytail: hand-rolled uuid uniqueness instead of a faker dependency; add faker when tests need realistic varied data
export interface SeedGame {
	id: string;
	title: string;
	releaseDate: string | null;
	coverUrl: string | null;
	storeUrl: string | null;
	psPlusExtra: boolean;
	tracking: {
		owned: boolean;
		playStatus:
			| 'Not started'
			| 'Up next'
			| 'Playing'
			| 'Paused'
			| 'Dropped'
			| null;
		completedOn: string | null;
		platinumOn: string | null;
		wishlistedOn: string | null;
	};
}

export function createGame(
	overrides: Partial<Omit<SeedGame, 'tracking'>> & {
		tracking?: Partial<SeedGame['tracking']>;
	} = {},
): SeedGame {
	const id = overrides.id ?? randomUUID();
	return {
		id,
		title: `E2E Game ${id.slice(0, 8)}`,
		releaseDate: '2020-01-01',
		coverUrl: null,
		storeUrl: null,
		psPlusExtra: false,
		...overrides,
		tracking: {
			owned: true,
			playStatus: null,
			completedOn: null,
			platinumOn: null,
			wishlistedOn: null,
			...overrides.tracking,
		},
	};
}

export const createWishlistedGame = (
	overrides: Parameters<typeof createGame>[0] = {},
): SeedGame =>
	createGame({
		...overrides,
		tracking: {
			owned: false,
			wishlistedOn: '2026-01-01',
			...overrides.tracking,
		},
	});
