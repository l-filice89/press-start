import { deleteSetting, seedSetting } from '../support/helpers/d1';
import { expect, test } from '../support/merged-fixtures';

/**
 * Stories 4.1 + 4.2 (FR-36/FR-33, UX-DR10/11): the Settings panel edits the
 * PSN session cookie (presence-only readback, never the value), a persisted
 * `psn_auth = expired` state surfaces the refresh instructions in the
 * attention banner until a fresh cookie is saved, and the FAB drawer's Sync
 * item drives the live missing-cookie → 401 → flag → banner wiring. All in
 * ONE serial file: every test mutates the same per-user PSN setting keys.
 */

// Both tests mutate the SAME per-user setting keys (one e2e user); parallel
// workers would race each other's saves and cleanups.
test.describe.configure({ mode: 'serial' });

test.afterEach(async () => {
	// Settings are keyed per user and shared across parallel workers — always
	// return the two Story 4.1 keys to their absent baseline.
	await deleteSetting('psn_cookie');
	await deleteSetting('psn_auth');
});

test('the header gear opens Settings; saving a cookie flips presence without echoing the value', async ({
	page,
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();

	const panel = page.getByTestId('settings-panel');
	await expect(panel).toBeVisible();
	await expect(page.getByTestId('psn-cookie-status')).toHaveText(
		/No cookie saved yet/,
	);

	const input = page.getByLabel('PlayStation session cookie');
	await input.fill('e2e-psn-cookie-value');
	await page.getByRole('button', { name: 'Save cookie' }).click();

	await expect(panel.getByRole('status')).toHaveText('Cookie saved.');
	await expect(page.getByTestId('psn-cookie-status')).toHaveText(
		/A cookie is saved/,
	);
	// Presence only: the field is cleared and the secret never rides back.
	await expect(input).toHaveValue('');

	// The saved state survives a full reload (it lives in SETTING, not memory).
	await page.reload();
	await page.getByRole('button', { name: 'Settings' }).click();
	await expect(page.getByTestId('psn-cookie-status')).toHaveText(
		/A cookie is saved/,
	);
});

test('an expired PSN auth state feeds the attention banner until a fresh cookie is saved', async ({
	page,
}) => {
	await seedSetting('psn_auth', 'expired');
	await page.goto('/');

	// Persistent banner (UX-DR11) with the refresh path, not a dismissable toast.
	const banner = page.getByTestId('attention-banner');
	await expect(banner).toBeVisible();
	await expect(banner).toHaveText(/library\.playstation\.com/);
	await expect(banner).toHaveClass(/attention-banner--expired-cookie/);

	// Its action jumps straight into the fix.
	await banner.getByRole('button', { name: 'Update cookie' }).click();
	const panel = page.getByTestId('settings-panel');
	await expect(panel).toBeVisible();

	// Saving a fresh cookie is the banner's one exit.
	await page.getByLabel('PlayStation session cookie').fill('renewed-cookie');
	await page.getByRole('button', { name: 'Save cookie' }).click();
	await expect(panel.getByRole('status')).toHaveText('Cookie saved.');
	await expect(banner).toBeHidden();

	// And it stays gone across a reload — the flag was cleared server-side.
	await page.reload();
	await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
	await expect(page.getByTestId('attention-banner')).toHaveCount(0);
});

test('Sync from the FAB with no cookie configured lights the expired-cookie banner (4.2 → 4.1c live wiring)', {
	// The 401 IS the flow under test — opt out of the network-error monitor.
	annotation: [{ type: 'skipNetworkMonitoring' }],
}, async ({ page }) => {
	// No psn_cookie setting and no env seed in the e2e Worker: the provider
	// fails as PsnAuthError before any outbound PSN call — deterministic.
	await page.goto('/');
	await expect(page.getByTestId('attention-banner')).toHaveCount(0);

	const toggle = page.getByRole('button', { name: 'Chores' });
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await toggle.click();
	await page.getByTestId('fab-sync').click();

	// The failure surfaces (toast) and the persisted flag feeds the banner.
	await expect(page.getByTestId('toast')).toHaveText(/Sync failed/);
	const banner = page.getByTestId('attention-banner');
	await expect(banner).toBeVisible();
	await expect(banner).toHaveClass(/attention-banner--expired-cookie/);
	// Its action opens Settings — recovery is one tap from the failure.
	await banner.getByRole('button', { name: 'Update cookie' }).click();
	await expect(page.getByTestId('settings-panel')).toBeVisible();
});
