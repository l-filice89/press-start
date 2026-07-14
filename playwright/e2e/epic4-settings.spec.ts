import { deleteSetting, seedSetting } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

/**
 * Stories 4.1 + 4.2, re-credentialed in 9.1b (FR-36/FR-33, UX-DR10/11): the
 * Settings panel edits the PSN NPSSO token (presence-only readback, never the
 * value) and carries the ssocookie deep link, a persisted `psn_auth = expired`
 * state surfaces the refresh instructions in the attention banner until a fresh
 * token is saved, and the FAB drawer's Sync item drives the live missing-token
 * → 401 → flag → banner wiring. All in ONE serial file: every test mutates
 * the same per-user PSN setting keys.
 */

// Both tests mutate the SAME per-user setting keys (one e2e user); parallel
// workers would race each other's saves and cleanups.
test.describe.configure({ mode: 'serial' });

test.afterEach(async () => {
	// Settings are keyed per user and shared across parallel workers — always
	// return the Epic 4 keys to their absent baseline.
	await deleteSetting('psn_npsso');
	await deleteSetting('psn_auth');
	await deleteSetting('sync_attention');
});

test('the header gear opens Settings; saving a token flips presence without echoing the value', async ({
	page,
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();

	const panel = page.getByTestId('settings-panel');
	await expect(panel).toBeVisible();
	await expect(page.getByTestId('psn-npsso-status')).toHaveText(
		/No token saved yet/,
	);

	const input = page.getByLabel('PlayStation NPSSO token');
	await input.fill('e2e-psn-npsso-value');
	await page.getByRole('button', { name: 'Save token' }).click();

	await expect(panel.getByRole('status')).toHaveText('Token saved.');
	await expect(page.getByTestId('psn-npsso-status')).toHaveText(
		/A token is saved/,
	);
	// Presence only: the field is cleared and the secret never rides back.
	await expect(input).toHaveValue('');

	// The saved state survives a full reload (it lives in SETTING, not memory).
	await page.reload();
	await page.getByRole('button', { name: 'Settings' }).click();
	await expect(page.getByTestId('psn-npsso-status')).toHaveText(
		/A token is saved/,
	);
});

test('a token carrying a character the Cookie header cannot hold is refused at SAVE (Story 9.5)', {
	// The 400 IS the flow under test — opt out of the network-error monitor.
	annotation: [{ type: 'skipNetworkMonitoring' }],
}, async ({ page }) => {
	// HTTP headers are Latin1. An emoji (or a smart quote, or a checkmark) pasted
	// along with the token cannot be encoded into the outbound `Cookie:` at all —
	// so it must fail HERE, visibly, not silently at sync time as a 502.
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();

	await page.getByLabel('PlayStation NPSSO token').fill('bad-token😀');
	await page.getByRole('button', { name: 'Save token' }).click();

	const panel = page.getByTestId('settings-panel');
	await expect(panel.getByRole('status')).toHaveText(/Saving failed/);
	// And nothing was stored — presence still reads as empty.
	await expect(page.getByTestId('psn-npsso-status')).toHaveText(
		/No token saved yet/,
	);
});

test('the token field carries the "Get / refresh token" deep link, opening Sony in a new tab', async ({
	page,
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();

	// CORS forbids reading the token cross-origin — the only affordance is a
	// deep link the user copies the value from.
	const link = page.getByTestId('psn-npsso-link');
	await expect(link).toHaveAttribute(
		'href',
		'https://ca.account.sony.com/api/v1/ssocookie',
	);
	await expect(link).toHaveAttribute('target', '_blank');
	await expect(link).toHaveAttribute('rel', 'noreferrer');
	await expect(link).toHaveText('Get / refresh token');
});

test('an expired PSN auth state feeds the attention banner until a fresh token is saved', async ({
	page,
}) => {
	await seedSetting('psn_auth', 'expired');
	await page.goto('/');

	// Persistent banner (UX-DR11) with the refresh path, not a dismissable toast.
	const banner = page.getByTestId('attention-banner-expired-token');
	await expect(banner).toBeVisible();
	await expect(banner).toHaveText(/NPSSO token/);
	await expect(banner).toHaveClass(/attention-banner--expired-token/);

	// Its action jumps straight into the fix.
	await banner.getByRole('button', { name: 'Update token' }).click();
	const panel = page.getByTestId('settings-panel');
	await expect(panel).toBeVisible();

	// Saving a fresh token is the banner's one exit.
	await page.getByLabel('PlayStation NPSSO token').fill('renewed-npsso');
	await page.getByRole('button', { name: 'Save token' }).click();
	await expect(panel.getByRole('status')).toHaveText('Token saved.');
	await expect(banner).toBeHidden();

	// And it stays gone across a reload — the flag was cleared server-side.
	await page.reload();
	await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
	await expect(page.getByTestId('attention-banner-expired-token')).toHaveCount(
		0,
	);
});

test('Sync from the FAB with no token configured lights the expired-token banner (4.2 → 4.1c live wiring)', {
	// The 401 IS the flow under test — opt out of the network-error monitor.
	annotation: [{ type: 'skipNetworkMonitoring' }],
}, async ({ page }) => {
	// No psn_npsso setting and no env seed in the e2e Worker: the provider fails
	// as PsnAuthError before any outbound PSN call — not even the authorize leg.
	await page.goto('/');
	await expect(page.getByTestId('attention-banner-expired-token')).toHaveCount(
		0,
	);

	const toggle = page.getByRole('button', { name: 'Chores' });
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await toggle.click();
	await page.getByTestId('fab-sync').click();

	// The failure surfaces (toast) and the persisted flag feeds the banner.
	await expect(page.getByTestId('toast')).toHaveText(/Sync failed/);
	const banner = page.getByTestId('attention-banner-expired-token');
	await expect(banner).toBeVisible();
	await expect(banner).toHaveClass(/attention-banner--expired-token/);
	// Its action opens Settings — recovery is one tap from the failure.
	await banner.getByRole('button', { name: 'Update token' }).click();
	await expect(page.getByTestId('settings-panel')).toBeVisible();
});

test('Sync trophies from the FAB with no token configured lights the expired-token banner (Story 9.2)', {
	// The 401 IS the flow under test — opt out of the network-error monitor.
	annotation: [{ type: 'skipNetworkMonitoring' }],
}, async ({ page }) => {
	// Lives HERE, not in epic9-trophies.spec.ts: it mutates the same per-user
	// PSN setting keys as every test in this serial file, and a parallel
	// worker's cleanup would wipe the flag mid-assert.
	await page.goto('/');
	await expect(page.getByTestId('attention-banner-expired-token')).toHaveCount(
		0,
	);

	await page.getByRole('button', { name: 'Chores' }).click();
	await page.getByTestId('fab-trophy-sync').click();

	// The trophy sync fails as PsnAuthError before any outbound PSN call, the
	// server persists the flag, and the banner lights — no retry, and no trophy
	// count anywhere was written.
	await expect(page.getByTestId('toast')).toHaveText(/Trophy sync failed/);
	const banner = page.getByTestId('attention-banner-expired-token');
	await expect(banner).toBeVisible();
	await expect(banner).toHaveClass(/attention-banner--expired-token/);
	// Recovery is one tap from the failure.
	await banner.getByRole('button', { name: 'Update token' }).click();
	await expect(page.getByTestId('settings-panel')).toBeVisible();
});

test('persisted sync needs-attention feeds the amber banner; Review reopens the summary and jumps to search (4.3)', async ({
	page,
}) => {
	// Items persisted by a sync run (seeded directly — a live conflicted sync
	// needs PSN, which the e2e Worker cannot stub).
	await seedSetting(
		'sync_attention',
		JSON.stringify([
			{ title: 'Doppelganger', reason: 'ambiguous match — not merged' },
		]),
	);
	await page.goto('/');

	// Survives reloads and sessions: present on a fresh page load (AR-22).
	const banner = page.getByTestId('attention-banner-stragglers');
	await expect(banner).toBeVisible();
	await expect(banner).toHaveClass(/attention-banner--stragglers/);
	await expect(banner).toHaveText(/1 sync item needs attention/);

	// Review reopens the items summary (no counts — banner-sourced).
	await banner.getByRole('button', { name: 'Review' }).click();
	const summary = page.getByTestId('sync-summary');
	await expect(summary).toBeVisible();
	await expect(summary).toHaveText(/Doppelganger/);
	await expect(page.getByTestId('sync-counts')).toHaveCount(0);

	// Jump-to-problem: the whole-library search is seeded and focused.
	await summary.getByRole('button', { name: 'Find in library' }).click();
	await expect(summary).toBeHidden();
	const search = page.getByRole('searchbox', { name: 'Search your library' });
	await expect(search).toHaveValue('Doppelganger');
	await expect(search).toBeFocused();

	// No dismissal affordance exists by design — only a clean sync resolves
	// the items, so the banner is still there on a fresh load.
	await page.reload();
	await expect(page.getByTestId('attention-banner-stragglers')).toBeVisible();
});

/*
 * The "a game owned via PS+ claim carries the PS+ tag on its card" test moved to
 * `epic6.spec.ts`'s serial "Story 6.4 ownership source" group (Story 9.5). It
 * seeds an `owned_via='membership'` row — and 6.4d's "I cancelled PS+" un-owns
 * EVERY membership row of the single shared e2e user. That group is serial for
 * exactly this reason, but serial mode does not cross FILES: from here, in a
 * parallel worker, the cancel wiped this test's claim mid-assert (it failed on
 * ~2 of 5 full-suite runs). One file owns the membership rows, as one file owns
 * the PSN setting keys.
 */

/*
 * Moved here from `epic9-trophies.spec.ts` (Story 9.5): the platinum backfill is
 * one of the three PSN long-ops under the per-user single-flight lock, and this
 * suite has ONE user — a backfill click in a parallel worker and the FAB sync
 * below refuse each other with the lock's own 409. Every PSN-op flow belongs in
 * this serial file.
 */
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
