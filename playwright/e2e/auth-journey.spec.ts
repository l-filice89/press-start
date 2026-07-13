import { readFileSync } from 'node:fs';
import { BASELINE_GAMES, d1Query } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';
import { E2E_EMAIL, MAGIC_LINK_RE, SERVER_LOG } from '../support/server';

/**
 * The full user journey through the browser (Epic 2.5 TR-1, AC5): open app →
 * login gate → request a magic link → follow the console-captured link →
 * shelf renders the seeded baseline. Unlike every other spec (pre-authed via
 * storage state from global-setup's API bootstrap), this one starts signed
 * out and clicks through the real UI. The link is captured from the server
 * log file global-setup mirrors stdout into — no real email is ever sent
 * (`.dev.vars.e2e` has no RESEND_API_KEY, so the console provider is active).
 */

test.use({ storageState: { cookies: [], origins: [] } });

const readLog = () => readFileSync(SERVER_LOG, 'utf8');

/** First magic-link URL appearing in the server log after char `offset`. */
function linkAfter(offset: number): string | undefined {
	const tail = readLog().slice(offset);
	return [...tail.matchAll(new RegExp(MAGIC_LINK_RE.source, 'g'))].map(
		(m) => m[1],
	)[0];
}

test('signs in via the console-captured magic link and sees the seeded shelf', async ({
	page,
}) => {
	await page.goto('/');

	// Login gate: unauthenticated visitors see the form, not the shelf.
	const email = page.getByRole('textbox', { name: /magic link/i });
	await expect(email).toBeVisible();
	await expect(page.getByTestId('shelf-card')).toHaveCount(0);

	// Request the link through the UI; capture only links emitted after this
	// point so a link from global-setup's bootstrap can't be picked up.
	const offset = readLog().length; // char units, matching linkAfter's slice
	await email.fill(E2E_EMAIL);
	await page.getByRole('button', { name: /sign-in link/i }).click();
	await expect(page.getByText(/check your email/i)).toBeVisible();

	let link: string | undefined;
	await expect
		.poll(() => (link = linkAfter(offset)), {
			message: 'magic link in server log (console email provider)',
			timeout: 15_000,
		})
		.toBeDefined();
	if (!link) throw new Error('unreachable: poll resolved without a link');

	// Follow the link exactly as the email recipient would.
	await page.goto(link);

	// Signed in: login form gone, baseline fixture on the shelf.
	await expect(page.getByRole('textbox', { name: /magic link/i })).toHaveCount(
		0,
	);
	for (const game of BASELINE_GAMES) {
		await expect(
			page.getByTestId('shelf-card').filter({ hasText: game.title }),
		).toBeVisible();
	}
});

test('baseline fixture is exact — reset leaves no residue from prior runs', async () => {
	// Hazard test (TR-1 determinism): without resetDb() the e2e D1 would
	// accumulate across runs. Baseline games scoped to the 'Baseline %'
	// prefix so parallel specs' factory games can't race it; the user table
	// must hold exactly the one account global-setup's sign-in created
	// (accumulating users is the residue a PK-crash on games wouldn't show).
	const games = await d1Query<{ n: number }>(
		"SELECT COUNT(*) AS n FROM game WHERE title LIKE 'Baseline %';",
	);
	expect(games[0]?.n).toBe(BASELINE_GAMES.length);
	const users = await d1Query<{ n: number }>('SELECT COUNT(*) AS n FROM user;');
	expect(users[0]?.n).toBe(1);
});

/**
 * Story 8.1 (B1a): both sign-in paths are offered on the gate. The Google
 * round-trip itself is NOT drivable here — the e2e env has no Google
 * credentials and Playwright can't (and shouldn't) drive Google's consent
 * screen — so the OAuth allowlist gate is pinned in `auth.test.ts`
 * (real workerd + D1). What the browser CAN prove is that adding Google didn't
 * displace the magic link: both CTAs render on the same gate.
 */
test('the login gate offers Google alongside the magic link (8.1)', async ({
	page,
}) => {
	await page.goto('/');

	await expect(page.getByRole('textbox', { name: /magic link/i })).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Email me a sign-in link' }),
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Continue with Google' }),
	).toBeVisible();
});
