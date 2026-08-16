import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BASELINE_GAMES, d1Execute, d1Query, sq } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';
import { SERVER_LOG } from '../support/server';

test.use({ storageState: { cookies: [], origins: [] } });

const readLog = () => readFileSync(SERVER_LOG, 'utf8');

function linkForEmailAfter(
	offset: number,
	kind: 'magic link' | 'account deletion link',
	email: string,
) {
	const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(
		`\\[auth\\] ${kind} for ${escapedEmail}: (\\S+)\\r?\\n`,
		'g',
	);
	return [...readLog().slice(offset).matchAll(new RegExp(pattern.source, 'g'))]
		.map((match) => match[1])
		.at(0);
}

for (const viewport of [
	{ name: 'desktop', width: 1280, height: 800 },
	{ name: 'phone', width: 320, height: 720 },
]) {
	test(`${viewport.name} verifies an emailed deletion link, clears private data, and returns to Login`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		const email = `account-deletion-${viewport.name}-${randomUUID()}@press-start.local`;
		await page.goto('/');
		const signInOffset = readLog().length;
		await page.getByRole('textbox', { name: /magic link/i }).fill(email);
		await page.getByRole('button', { name: /sign-in link/i }).click();

		let signInLink: string | undefined;
		await expect
			.poll(
				() =>
					(signInLink = linkForEmailAfter(signInOffset, 'magic link', email)),
			)
			.toBeDefined();
		if (!signInLink) throw new Error('sign-in link missing after poll');
		await page.goto(signInLink);
		await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
		const [createdUser] = await d1Query<{ id: string }>(
			`SELECT id FROM user WHERE email = ${sq(email)};`,
		);
		if (!createdUser)
			throw new Error('signed-in deletion user missing from D1');
		const userId = createdUser.id;

		await d1Execute(
			`INSERT INTO setting (user_id, key, value) VALUES
			 (${sq(userId)}, 'deletion-e2e', 'private');`,
		);
		const sharedGameId = BASELINE_GAMES[0].id;
		const sharedBefore = await d1Query<{ id: string }>(
			`SELECT id FROM game WHERE id = ${sq(sharedGameId)};`,
		);
		expect(sharedBefore).toEqual([{ id: sharedGameId }]);

		await page.getByRole('button', { name: 'Settings' }).click();
		const panel = page.getByTestId('settings-panel');
		await expect(panel.getByText('ACCOUNT', { exact: true })).toBeVisible();
		await expect(
			panel.getByRole('heading', { name: 'Delete your account' }),
		).toBeVisible();
		const deleteButton = panel.getByRole('button', { name: 'Delete account' });
		expect((await deleteButton.boundingBox())?.height).toBeGreaterThanOrEqual(
			44,
		);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);

		await deleteButton.click();
		const confirm = page.getByRole('dialog', {
			name: 'Permanently delete your account?',
		});
		await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
		await expect(panel).toHaveJSProperty('inert', true);
		const deletionOffset = readLog().length;
		await confirm.getByRole('button', { name: 'Email deletion link' }).click();
		await expect(
			panel.getByText(/Your account remains until you open/),
		).toBeVisible();

		let deletionLink: string | undefined;
		await expect
			.poll(
				() =>
					(deletionLink = linkForEmailAfter(
						deletionOffset,
						'account deletion link',
						email,
					)),
			)
			.toBeDefined();
		if (!deletionLink)
			throw new Error('account-deletion link missing after poll');
		await page.goto(deletionLink);

		const loginInput = page.getByRole('textbox', { name: /magic link/i });
		await expect(loginInput).toBeVisible();
		await expect(loginInput).toBeFocused();
		const privateRows = await d1Query<{ n: number }>(
			`SELECT COUNT(*) AS n FROM setting WHERE user_id = ${sq(userId)};`,
		);
		expect(privateRows[0]?.n).toBe(0);
		const deletedUser = await d1Query<{ n: number }>(
			`SELECT COUNT(*) AS n FROM user WHERE id = ${sq(userId)};`,
		);
		expect(deletedUser[0]?.n).toBe(0);
		const sharedAfter = await d1Query<{ id: string }>(
			`SELECT id FROM game WHERE id = ${sq(sharedGameId)};`,
		);
		expect(sharedAfter).toEqual(sharedBefore);
	});
}
