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
	/** IGDB reception scores (Story 10.1) — null = absent, renders nothing. */
	criticScore: number | null;
	criticScoreCount: number | null;
	userScore: number | null;
	userScoreCount: number | null;
	/** Story 10.2: date the game left the PS+ catalog (warning pill). */
	psPlusLeavingOn: string | null;
	/** Story 10.3: time-to-beat seconds (story / 100% / submissions). */
	ttbStorySeconds: number | null;
	ttbCompleteSeconds: number | null;
	ttbCount: number | null;
	tracking: {
		owned: boolean;
		/** FR-9 amended: `membership` = PS+ claim (card shows the PS+ tag). */
		ownedVia: 'purchase' | 'membership' | null;
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
		criticScore: null,
		criticScoreCount: null,
		userScore: null,
		userScoreCount: null,
		psPlusLeavingOn: null,
		ttbStorySeconds: null,
		ttbCompleteSeconds: null,
		ttbCount: null,
		...overrides,
		tracking: {
			owned: true,
			ownedVia: null,
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
