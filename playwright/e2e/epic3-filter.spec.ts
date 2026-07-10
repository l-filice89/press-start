import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
	createGame,
	createWishlistedGame,
	type SeedGame,
} from '../support/factories/game-factory';
import { d1Execute, deleteGames, seedGames, sq } from '../support/helpers/d1';
import { loadAllPages } from '../support/helpers/shelf';
import { expect, test } from '../support/merged-fixtures';

/**
 * Story 3.1 (FR-20/21/22 + FR-18 amendment): State/Genre multiselect filters.
 * Tests seed run-unique games/genres and delete them in finally; assertions
 * target seeded titles (never global counts) because parallel workers share
 * the e2e DB. Filter state itself is per-page client state, so workers can't
 * disturb each other's filtered view — only add rows to the shared payload.
 */

/** Seed genre rows and attach them to games; cleanup cascades from `genre`. */
async function seedGenres(
	genreNames: string[],
	links: Array<{ gameId: string; genre: string }>,
): Promise<string[]> {
	const ids = new Map(genreNames.map((name) => [name, randomUUID()]));
	const idFor = (name: string): string => {
		const id = ids.get(name);
		if (!id) throw new Error(`seedGenres: unknown genre "${name}"`);
		return id;
	};
	await d1Execute(
		...genreNames.map(
			(name) =>
				`INSERT INTO genre (id, name) VALUES (${sq(idFor(name))}, ${sq(name)});`,
		),
		...links.map(
			(l) =>
				`INSERT INTO game_genre (game_id, genre_id) VALUES (${sq(l.gameId)}, ${sq(idFor(l.genre))});`,
		),
	);
	return [...ids.values()];
}

async function deleteGenres(genreIds: string[]): Promise<void> {
	if (genreIds.length > 0) {
		await d1Execute(
			`DELETE FROM genre WHERE id IN (${genreIds.map(sq).join(', ')});`,
		);
	}
}

const cardFor = (page: Page, game: SeedGame) =>
	page.getByTestId('shelf-card').filter({ hasText: game.title });

test('state filter shows exactly the selected states, highlights, and restores the default set (FR-21/22)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const playing = createGame({
		title: `Filter Playing ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	const paused = createGame({
		title: `Filter Paused ${run}`,
		tracking: { playStatus: 'Paused' },
	});
	try {
		await seedGames([playing, paused]);
		await page.goto('/');
		await expect(cardFor(page, playing)).toBeVisible();

		const stateTrigger = page.getByTestId('filter-state');
		await stateTrigger.click();
		const playingRow = page.getByRole('menuitemcheckbox', { name: 'Playing' });
		await playingRow.click();

		// Active highlight is machine-readable, not color-alone (FR-22).
		await expect(playingRow).toHaveAttribute('aria-checked', 'true');
		await expect(stateTrigger).toHaveAttribute('data-active', 'true');
		await expect(stateTrigger).toHaveAccessibleName('State — 1 selected');

		// Exactly the selected state: Playing visible, Paused gone (FR-21).
		await page.keyboard.press('Escape');
		await loadAllPages(page);
		await expect(cardFor(page, playing)).toBeVisible();
		await expect(cardFor(page, paused)).toHaveCount(0);

		// Deselect: the default visible set returns.
		await stateTrigger.click();
		await page.getByRole('menuitemcheckbox', { name: 'Playing' }).click();
		await page.keyboard.press('Escape');
		await loadAllPages(page);
		await expect(cardFor(page, paused)).toBeVisible();
	} finally {
		await deleteGames([playing.id, paused.id]);
	}
});

test('genre filter ORs within the group and ANDs against the state group (FR-20)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const rpg = `E2E RPG ${run}`;
	const racing = `E2E Racing ${run}`;
	const playingRpg = createGame({
		title: `Genre A ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	const playingRacing = createGame({
		title: `Genre B ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	const pausedRpg = createGame({
		title: `Genre C ${run}`,
		tracking: { playStatus: 'Paused' },
	});
	let genreIds: string[] = [];
	try {
		await seedGames([playingRpg, playingRacing, pausedRpg]);
		genreIds = await seedGenres(
			[rpg, racing],
			[
				{ gameId: playingRpg.id, genre: rpg },
				{ gameId: playingRacing.id, genre: racing },
				{ gameId: pausedRpg.id, genre: rpg },
			],
		);
		await page.goto('/');
		await expect(cardFor(page, playingRpg)).toBeVisible();

		// Genre multiselect lists the vocabulary (FR-20) — pick both seeded genres.
		await page.getByTestId('filter-genre').click();
		await page.getByRole('menuitemcheckbox', { name: rpg }).click();
		await page.getByRole('menuitemcheckbox', { name: racing }).click();
		await page.keyboard.press('Escape');
		await loadAllPages(page);
		// OR within the genre group: all three seeded games match.
		await expect(cardFor(page, playingRpg)).toBeVisible();
		await expect(cardFor(page, playingRacing)).toBeVisible();
		await expect(cardFor(page, pausedRpg)).toBeVisible();

		// AND across groups: narrow the genre group to rpg, then add a State pick.
		await page.getByTestId('filter-genre').click();
		await page.getByRole('menuitemcheckbox', { name: racing }).click();
		await page.keyboard.press('Escape');
		await page.getByTestId('filter-state').click();
		await page.getByRole('menuitemcheckbox', { name: 'Playing' }).click();
		await page.keyboard.press('Escape');
		await loadAllPages(page);
		await expect(cardFor(page, playingRpg)).toBeVisible();
		await expect(cardFor(page, playingRacing)).toHaveCount(0);
		await expect(cardFor(page, pausedRpg)).toHaveCount(0);
	} finally {
		await deleteGenres(genreIds);
		await deleteGames([playingRpg.id, playingRacing.id, pausedRpg.id]);
	}
});

test('a filtered view keeps state → owned → alpha ordering (FR-18 amendment)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	// Alphabetically-first wishlisted vs later-alpha owned, same state: the
	// ownership tier must win inside the filtered view.
	const wishlisted = createWishlistedGame({
		title: `Tier A Wish ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	const owned = createGame({
		title: `Tier B Owned ${run}`,
		tracking: { playStatus: 'Playing' },
	});
	const pausedOwned = createGame({
		title: `Tier C Paused ${run}`,
		tracking: { playStatus: 'Paused' },
	});
	try {
		await seedGames([wishlisted, owned, pausedOwned]);
		await page.goto('/');
		await expect(cardFor(page, owned)).toBeVisible();

		await page.getByTestId('filter-state').click();
		await page.getByRole('menuitemcheckbox', { name: 'Playing' }).click();
		await page.getByRole('menuitemcheckbox', { name: 'Paused' }).click();
		await page.keyboard.press('Escape');
		await loadAllPages(page);

		const titles = [wishlisted.title, owned.title, pausedOwned.title];
		const labels = await page
			.getByTestId('shelf-card')
			.evaluateAll((cells) =>
				cells.map((c) => c.getAttribute('aria-label') ?? ''),
			);
		const order = labels
			.map((l) => titles.find((t) => l.startsWith(`${t} —`)))
			.filter((t): t is string => t !== undefined);
		// Playing before Paused (state priority), owned before wishlisted inside
		// Playing (ownership tier beats alpha).
		expect(order).toEqual([owned.title, wishlisted.title, pausedOwned.title]);
	} finally {
		await deleteGames([wishlisted.id, owned.id, pausedOwned.id]);
	}
});

test('whole-library search ignores active shelf filters (search isolation)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const paused = createGame({
		title: `Search Isolation ${run}`,
		tracking: { playStatus: 'Paused' },
	});
	try {
		await seedGames([paused]);
		await page.goto('/');
		await expect(cardFor(page, paused)).toBeVisible();

		// Filter the shelf down to Playing — the Paused game leaves the shelf…
		await page.getByTestId('filter-state').click();
		await page.getByRole('menuitemcheckbox', { name: 'Playing' }).click();
		await page.keyboard.press('Escape');
		await loadAllPages(page);
		await expect(cardFor(page, paused)).toHaveCount(0);

		// …but the whole-library search still finds it (filters never leak in).
		await page
			.getByRole('combobox', { name: 'Search your library' })
			.fill(paused.title);
		await expect(
			page.getByRole('option', { name: new RegExp(paused.title) }),
		).toBeVisible();
	} finally {
		await deleteGames([paused.id]);
	}
});
