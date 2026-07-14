import { randomUUID } from 'node:crypto';
import { createGame } from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
import { loadAllPages } from '../support/helpers/shelf';
import { expect, test } from '../support/merged-fixtures';

/**
 * Story 9.2 (trophy progress on every game). The trophy sync itself needs a PSN
 * response the e2e Worker cannot stub — the run is pinned at the integration
 * tier (`trophies.test.ts`) — so here we drive what the PERSISTED counts do to
 * the UI: a card with data shows `% · grade`, a card without shows NOTHING (the
 * "never a fake 0%" rule), the detail panel carries the tier breakdown, and the
 * no-credential trophy sync lights the expired-token banner (the live 401 →
 * flag → banner wiring).
 */

test('a game with trophy counts shows % · grade on its card; one without shows NOTHING (never a fake 0%)', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	// 28 of 45 earned = 62% → grade B.
	const withTrophies = createGame({
		title: `Trophy Hunter ${run}`,
		tracking: {
			playStatus: 'Playing',
			trophyEarned: { bronze: 20, silver: 6, gold: 2, platinum: 0 },
			trophyDefined: { bronze: 30, silver: 10, gold: 4, platinum: 1 },
		},
	});
	// Played, nothing earned — REAL data, and it must read 0% · D, not nothing.
	const zeroEarned = createGame({
		title: `Trophy Zero ${run}`,
		tracking: {
			playStatus: 'Playing',
			trophyEarned: { bronze: 0, silver: 0, gold: 0, platinum: 0 },
			trophyDefined: { bronze: 40, silver: 12, gold: 6, platinum: 1 },
		},
	});
	// No trophy data at all → the card shows nothing.
	const noTrophies = createGame({
		title: `Trophy None ${run}`,
		tracking: { playStatus: 'Playing' },
	});

	try {
		await seedGames([withTrophies, zeroEarned, noTrophies]);
		await page.goto('/');
		await loadAllPages(page);

		const card = (title: string) =>
			page.getByTestId('shelf-card').filter({ hasText: title });

		await expect(
			card(withTrophies.title).getByTestId('card-trophy'),
		).toHaveText(/62% · B/);
		// A real zero is data — distinct from no data.
		await expect(card(zeroEarned.title).getByTestId('card-trophy')).toHaveText(
			/0% · D/,
		);
		// And the game with no trophy data renders no stat at all.
		await expect(card(noTrophies.title).getByTestId('card-trophy')).toHaveCount(
			0,
		);
	} finally {
		await deleteGames([withTrophies.id, zeroEarned.id, noTrophies.id]);
	}
});

test('the detail panel carries a Trophies section with the tier breakdown, and omits it without data', async ({
	page,
}) => {
	const run = randomUUID().slice(0, 8);
	const withTrophies = createGame({
		title: `Trophy Detail ${run}`,
		tracking: {
			playStatus: 'Playing',
			trophyEarned: { bronze: 6, silver: 0, gold: 0, platinum: 0 },
			trophyDefined: { bronze: 40, silver: 12, gold: 6, platinum: 1 },
		},
	});
	const noTrophies = createGame({
		title: `Trophy Bare ${run}`,
		tracking: { playStatus: 'Playing' },
	});

	try {
		await seedGames([withTrophies, noTrophies]);
		await page.goto('/');
		await loadAllPages(page);

		const openDetail = async (title: string) => {
			await page
				.getByTestId('shelf-card')
				.filter({ hasText: title })
				.getByTestId('card-cover-button')
				.click();
			return page.getByTestId('detail-panel');
		};

		const panel = await openDetail(withTrophies.title);
		const trophies = panel.getByTestId('detail-trophies');
		await expect(trophies).toBeVisible();
		// 6 of 59 → 10% (count-based; PSN's own weighted number would say 7).
		await expect(trophies).toContainText('10% · D');
		await expect(trophies).toContainText('6 / 40');
		await expect(trophies).toContainText('0 / 1');
		await page.getByRole('button', { name: 'Close details' }).click();

		const bare = await openDetail(noTrophies.title);
		await expect(bare).toBeVisible();
		await expect(bare.getByTestId('detail-trophies')).toHaveCount(0);
	} finally {
		await deleteGames([withTrophies.id, noTrophies.id]);
	}
});

test('Settings carries the platinum-date backfill, and a run with no trophy data says to sync trophies first (9.3)', async ({
	page,
}) => {
	// The e2e user has no trophy-synced title at all, so the run has ZERO
	// candidates: it never calls PSN (unstubbable here) and still has to end in a
	// readable summary — and "nothing to recover, every platinum is dated" would
	// be a LIE here: there is nothing to recover FROM until the trophy sync runs.
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();

	const button = page.getByTestId('backfill-platinum-dates');
	await expect(button).toBeVisible();
	await button.click();

	await expect(page.getByTestId('backfill-summary')).toHaveText(
		/No trophy data yet — run the trophy sync first/,
	);
});

/*
 * The no-credential trophy sync → expired-token banner flow lives in
 * `epic4-settings.spec.ts`, NOT here: it mutates the same per-user PSN setting
 * keys (`psn_auth`) as every test in that SERIAL file, and a parallel worker's
 * cleanup wipes the flag mid-assert (observed 2026-07-13). One file owns those
 * keys — that is the only place the flow can be driven deterministically.
 */
