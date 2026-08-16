import { expect, test } from '../support/merged-fixtures';

/**
 * The Settings surface after Epic 11 (stories 11.1/11.2): the credentialed
 * PSN flows are severed and the credential-token section is DELETED — this
 * file pins the surviving surface (region, PS+ claims, CSV backup,
 * About/Help), the absence of every credentialed entry point and FAB, and the
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
		'IGDB platforms',
		'PlayStation Plus',
		'Keep your own copy',
		'About & Help',
		'Delete your account',
	]);
	await expect(panel.getByText(/token/i)).toHaveCount(0);
	await expect(panel.locator('textarea')).toHaveCount(0);

	// And no expired-credential attention banner exists anywhere in the shell.
	await expect(page.getByTestId('attention-banner-expired-token')).toHaveCount(
		0,
	);
});

test('IGDB platform selection saves and persists when Settings reopens', async ({
	page,
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();
	let panel = page.getByTestId('settings-panel');
	let psvr2 = panel.getByRole('checkbox', { name: 'PSVR 2' });
	// Keep reruns deterministic when the local E2E D1 retains this serial user's
	// prior save.
	if (await psvr2.isChecked()) {
		await psvr2.uncheck();
		await panel.getByTestId('save-igdb-platforms').click();
		await expect(panel.getByTestId('igdb-platforms-feedback')).toHaveText(
			'Platforms saved.',
		);
		await panel.getByRole('button', { name: 'Close' }).click();
		await page.getByRole('button', { name: 'Settings' }).click();
		panel = page.getByTestId('settings-panel');
		psvr2 = panel.getByRole('checkbox', { name: 'PSVR 2' });
	}
	await expect(psvr2).not.toBeChecked();
	await psvr2.check();
	await panel.getByTestId('save-igdb-platforms').click();
	await expect(panel.getByTestId('igdb-platforms-feedback')).toHaveText(
		'Platforms saved.',
	);
	await panel.getByRole('button', { name: 'Close' }).click();
	await page.getByRole('button', { name: 'Settings' }).click();
	await expect(
		page
			.getByTestId('settings-panel')
			.getByRole('checkbox', { name: 'PSVR 2' }),
	).toBeChecked();
});

test('phone Settings saves platforms without horizontal overflow', async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 720 });
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();
	let panel = page.getByTestId('settings-panel');
	let psp = panel.getByRole('checkbox', { name: 'PSP', exact: true });
	if (await psp.isChecked()) {
		await psp.uncheck();
		await panel.getByTestId('save-igdb-platforms').click();
		await expect(panel.getByTestId('igdb-platforms-feedback')).toHaveText(
			'Platforms saved.',
		);
		await panel.getByRole('button', { name: 'Close' }).click();
		await page.getByRole('button', { name: 'Settings' }).click();
		panel = page.getByTestId('settings-panel');
		psp = panel.getByRole('checkbox', { name: 'PSP', exact: true });
	}
	await expect(psp).not.toBeChecked();
	await psp.check();
	await panel.getByTestId('save-igdb-platforms').click();
	await expect(panel.getByTestId('igdb-platforms-feedback')).toHaveText(
		'Platforms saved.',
	);
	await panel.getByRole('button', { name: 'Close' }).click();
	await page.getByRole('button', { name: 'Settings' }).click();
	await expect(
		page
			.getByTestId('settings-panel')
			.getByRole('checkbox', { name: 'PSP', exact: true }),
	).toBeChecked();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
});

test('no destination renders a Chores FAB; Settings owns CSV export', async ({
	page,
}) => {
	for (const path of ['/', '/catalog', '/stats']) {
		await page.goto(path);
		await expect(page.getByRole('button', { name: 'Chores' })).toHaveCount(0);
		await expect(page.getByTestId('fab')).toHaveCount(0);
	}

	await page.getByRole('button', { name: 'Settings' }).click();
	const panel = page.getByTestId('settings-panel');
	await expect(panel.getByText('DATA BACKUP')).toBeVisible();
	await expect(
		panel.getByRole('heading', { name: 'Keep your own copy' }),
	).toBeVisible();
	await expect(panel.getByTestId('settings-export')).toHaveText('Export CSV');
	await expect(panel.getByText('FAB placement')).toHaveCount(0);
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
