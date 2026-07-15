import { deleteSetting, seedSetting } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

/**
 * Story 4.1, re-credentialed in 9.1b (FR-36, UX-DR10/11): the Settings panel
 * edits the PSN NPSSO token (presence-only readback, never the value) and
 * carries the ssocookie deep link, and a persisted `psn_auth = expired` state
 * surfaces the refresh instructions in the attention banner until a fresh
 * token is saved. The credentialed sync/trophy/backfill flows were severed by
 * Epic 11 story 11.1 — the FAB-surface test below pins their absence. All in
 * ONE serial file: every test mutates the same per-user PSN setting keys.
 */

// Both tests mutate the SAME per-user setting keys (one e2e user); parallel
// workers would race each other's saves and cleanups.
test.describe.configure({ mode: 'serial' });

test.afterEach(async () => {
	// Settings are keyed per user and shared across parallel workers — always
	// return the Epic 4 keys to their absent baseline.
	await deleteSetting('psn_npsso');
	await deleteSetting('psn_auth');
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

test('the FAB drawer offers exactly Check PS+ Extra and Export CSV — no credentialed sync control exists (Epic 11 story 11.1)', async ({
	page,
}) => {
	// The severed routes' UI entry points must be GONE, not disabled: a chores
	// drawer with a dead sync item would still read as "this app syncs".
	await page.goto('/');

	const toggle = page.getByRole('button', { name: 'Chores' });
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await toggle.click();

	const drawer = page.getByTestId('fab-drawer');
	await expect(drawer).toBeVisible();
	await expect(page.getByTestId('fab-psplus-check')).toBeVisible();
	await expect(page.getByTestId('fab-export')).toBeVisible();
	// Exactly two items — nothing else can trigger anything.
	await expect(drawer.getByRole('button')).toHaveCount(2);
	await expect(page.getByTestId('fab-sync')).toHaveCount(0);
	await expect(page.getByTestId('fab-trophy-sync')).toHaveCount(0);
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

test('Settings names the PSN region and saves a normalized locale', async ({
	page,
}) => {
	// The e2e Worker seeds PSN_REGION=it-it, and epic5/epic7 files read the
	// region in PARALLEL workers — so this journey saves the SAME locale
	// (uppercased) to exercise the write path + normalization without ever
	// flipping the effective region under another file's feet.
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();

	await expect(page.getByTestId('psn-region-status')).toHaveText(
		/Your PS\+ catalog region is it-it/,
	);

	const input = page.getByLabel('PlayStation region');
	await input.fill('IT-IT');
	await page.getByTestId('save-psn-region').click();

	await expect(page.getByTestId('psn-region-feedback')).toHaveText(
		'Region saved.',
	);
	// Normalized server-side, echoed back through the settings payload.
	await expect(page.getByTestId('psn-region-status')).toHaveText(
		/Your PS\+ catalog region is it-it/,
	);
	await expect(input).toHaveValue('');
});
