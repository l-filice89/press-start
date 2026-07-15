import { expect, test } from '../support/merged-fixtures';

/**
 * The Settings surface after Epic 11 (stories 11.1/11.2): the credentialed
 * PSN flows are severed and the credential-token section is DELETED — this
 * file pins the surviving surface (region, FAB placement, PS+ claims,
 * About/Help), the absence of every credentialed entry point, and the
 * region-save live-region announcement that used to ride the token section.
 */

// The region tests mutate the SAME per-user setting key (one e2e user);
// parallel workers would race each other's saves.
test.describe.configure({ mode: 'serial' });

test('Settings renders NO credential surface — the token section is gone (Epic 11 story 11.2)', async ({
	page,
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();

	const panel = page.getByTestId('settings-panel');
	await expect(panel).toBeVisible();

	// The whole section list, exactly — nothing token-shaped survives, and a
	// new section cannot sneak a credential field in unnoticed.
	await expect(panel.getByRole('heading', { level: 3 })).toHaveText([
		'PlayStation region',
		'FAB placement',
		'PlayStation Plus',
		'About & Help',
	]);
	await expect(panel.getByText(/token/i)).toHaveCount(0);
	await expect(panel.locator('textarea')).toHaveCount(0);

	// And no expired-credential attention banner exists anywhere in the shell.
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

test('Settings names the PSN region, saves a normalized locale, and ANNOUNCES the save', async ({
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

	// The feedback is the dialog's `role="status"` LIVE REGION (Epic 11 story
	// 11.2 moved it here when the token section died) — announced, not just shown.
	const panel = page.getByTestId('settings-panel');
	// The feedback div carries role=status (the a11y announcement path); target
	// it by testid so a second live region elsewhere in the panel can't collide.
	const feedback = panel.getByTestId('psn-region-feedback');
	await expect(feedback).toHaveText('Region saved.');
	await expect(feedback).toHaveAttribute('role', 'status');
	// Normalized server-side, echoed back through the settings payload.
	await expect(page.getByTestId('psn-region-status')).toHaveText(
		/Your PS\+ catalog region is it-it/,
	);
	await expect(input).toHaveValue('');
});
