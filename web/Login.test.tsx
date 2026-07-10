import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiveRegionProvider } from './components/LiveRegion';
import Login from './Login';

/**
 * Story 3.4 (AC2): the session gate swaps the shell for this screen (401
 * re-auth or sign-out) and React silently drops focus to <body>. Login must
 * take focus into the form and announce the change — through the
 * LiveRegionProvider hoisted ABOVE the gate (main.tsx), which is why this
 * renders under a bare provider, not the AppShell.
 */
describe('Login', () => {
	it('focuses the email input and announces the swap on mount', async () => {
		render(
			<LiveRegionProvider>
				<Login />
			</LiveRegionProvider>,
		);

		expect(screen.getByLabelText(/Sign in with a magic link/)).toHaveFocus();
		await waitFor(() =>
			expect(screen.getByTestId('live-region')).toHaveTextContent(
				/Sign in with your email to continue\./,
			),
		);
	});
});
