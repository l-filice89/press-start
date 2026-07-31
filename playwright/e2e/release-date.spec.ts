import { randomUUID } from 'node:crypto';
import { createGame } from '../support/factories/game-factory';
import { deleteGames, seedGames } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

/**
 * Spec release-date-display-edit: the shelf card shows the actual release date
 * (never "SOON"), and the detail panel's Release date row edits the shared
 * `game` fact — persisted server-side, pill re-baked on refetch.
 */

test('unreleased card shows the formatted release date, editable from the detail panel', async ({
	page,
}) => {
	// Far-future, non-current year → the pill carries the year.
	const game = createGame({
		title: `Release Pill ${randomUUID().slice(0, 8)}`,
		releaseDate: '2994-01-05',
	});
	try {
		await seedGames([game]);
		await page.goto('/');

		const card = page.getByTestId('shelf-card').filter({ hasText: game.title });
		// The date replaces the old SOON label — same for next week or next year.
		await expect(card.getByText('5 JAN 2994')).toBeVisible();
		await expect(card.getByText('SOON')).toHaveCount(0);

		// Edit from the detail panel: blur commits, the pill re-bakes.
		await card.getByTestId('card-cover-button').click();
		const panel = page.getByTestId('detail-panel');
		await expect(panel).toBeVisible();
		const input = panel.getByLabel('Release date');
		await expect(input).toHaveValue('2994-01-05');
		await input.fill('2995-12-31');
		await input.blur();
		await expect(
			page.getByTestId('toast').getByText(`${game.title} — date saved`),
		).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(card.getByText('31 DEC 2995')).toBeVisible();

		// Server round trip: the value survives a fresh fetch.
		await page.goto('/');
		await expect(card.getByText('31 DEC 2995')).toBeVisible();
	} finally {
		await deleteGames([game.id]);
	}
});
