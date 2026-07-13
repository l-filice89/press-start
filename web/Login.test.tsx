import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authClient } from './auth-client';
import { LiveRegionProvider } from './components/LiveRegion';
import Login from './Login';

vi.mock('./auth-client', () => ({
	authClient: {
		signIn: {
			magicLink: vi.fn().mockResolvedValue({ error: null }),
			social: vi.fn().mockResolvedValue({ error: null }),
		},
	},
}));

const renderLogin = () =>
	render(
		<LiveRegionProvider>
			<Login />
		</LiveRegionProvider>,
	);

afterEach(() => {
	window.history.replaceState(null, '', '/');
	vi.clearAllMocks();
});

/**
 * Story 3.4 (AC2): the session gate swaps the shell for this screen (401
 * re-auth or sign-out) and React silently drops focus to <body>. Login must
 * take focus into the form and announce the change — through the
 * LiveRegionProvider hoisted ABOVE the gate (main.tsx), which is why this
 * renders under a bare provider, not the AppShell.
 */
describe('Login', () => {
	it('focuses the email input and announces the swap on mount', async () => {
		renderLogin();

		expect(screen.getByLabelText(/Sign in with a magic link/)).toHaveFocus();
		await waitFor(() =>
			expect(screen.getByTestId('live-region')).toHaveTextContent(
				/Sign in with your email to continue\./,
			),
		);
	});
});

/** Story 8.1 (B1a): Google ALONGSIDE magic link — neither replaces the other. */
describe('Login — Google (Story 8.1)', () => {
	it('offers both sign-in paths, and the Google button starts the OAuth flow', async () => {
		const user = userEvent.setup();
		renderLogin();

		expect(screen.getByLabelText(/Sign in with a magic link/)).toBeVisible();
		await user.click(
			screen.getByRole('button', { name: 'Continue with Google' }),
		);

		expect(authClient.signIn.social).toHaveBeenCalledWith({
			provider: 'google',
			callbackURL: '/',
			errorCallbackURL: '/',
		});
	});

	it('states the allowlist rejection rather than bouncing silently', async () => {
		window.history.replaceState(null, '', '/?error=ACCESS_DENIED');
		renderLogin();

		expect(await screen.findByRole('alert')).toHaveTextContent(
			/isn.t allowed to sign in/i,
		);
		// The param is consumed, so a reload can't resurface a stale rejection.
		expect(window.location.search).toBe('');
	});

	it('surfaces a failed OAuth start instead of a dead button', async () => {
		vi.mocked(authClient.signIn.social).mockResolvedValueOnce({
			error: { message: 'Provider not found' },
			// biome-ignore lint/suspicious/noExplicitAny: partial better-auth result shape is all this test needs.
		} as any);
		const user = userEvent.setup();
		renderLogin();

		await user.click(
			screen.getByRole('button', { name: 'Continue with Google' }),
		);

		// The library's own message never reaches the screen — an unauthenticated
		// visitor gets copy, not better-auth internals.
		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent(/Google sign-in couldn.t start/i);
		expect(alert).not.toHaveTextContent('Provider not found');
	});

	it('tells a cancelled consent apart from an allowlist rejection', async () => {
		// Google bounces a cancelled consent back with OAuth 2.0's LOWERCASE
		// access_denied; our allowlist rejection is the uppercase one. Calling a
		// cancellation a ban would be a lie.
		window.history.replaceState(null, '', '/?error=access_denied');
		renderLogin();

		expect(await screen.findByRole('alert')).toHaveTextContent(
			/sign-in was cancelled/i,
		);
	});
});
