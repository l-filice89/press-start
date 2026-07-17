import { type FormEvent, useEffect, useRef, useState } from 'react';
import { authClient } from './auth-client';
import { useAnnounce } from './components/LiveRegion';
import { Background } from './shell/Background';
import { Wordmark } from './shell/Wordmark';
import './login.css';

/**
 * Magic-link login screen (FR-47): the only thing an unauthenticated visitor
 * sees. Now dressed in the PRESS START design system (Story 1.5) — the wordmark
 * over the void, tokened form. Auth logic is unchanged.
 *
 * A failed link verification (expired/used token) redirects back here as
 * `/?error=...` (better-auth's error callback), surfaced as the initial
 * error message.
 */

type Phase = 'idle' | 'sending' | 'sent';

function verifyErrorFromUrl(): string | null {
	const params = new URLSearchParams(window.location.search);
	const error = params.get('error');
	if (!error) {
		return null;
	}
	// Consume the param so a reload doesn't resurface a stale error.
	params.delete('error');
	const rest = params.toString();
	window.history.replaceState(
		null,
		'',
		`${window.location.pathname}${rest ? `?${rest}` : ''}`,
	);
	// INVALID_TOKEN, EMAIL_NOT_VERIFIED and Google's own access_denied are the
	// codes with a specific, user-actionable meaning; anything else gets a
	// generic message rather than a wrong-specific one. (The allowlist's
	// uppercase ACCESS_DENIED died with the allowlist — registration is open,
	// AD-29; the lowercase `access_denied` is OAuth 2.0's cancelled-consent
	// bounce and stays.)
	if (error === 'EMAIL_NOT_VERIFIED') {
		return "Google hasn't verified that email address, so it can't be used to sign in. Use the email link below instead.";
	}
	if (error === 'access_denied') {
		return 'Google sign-in was cancelled.';
	}
	// better-auth's LINK-path refusal (an unverified provider email matching an
	// existing account) arrives as its own literal, not our hook's code.
	if (error === 'account_not_linked') {
		return "That Google account couldn't be linked — its email address isn't verified. Sign in with the email link below instead.";
	}
	return error === 'INVALID_TOKEN'
		? 'That sign-in link is no longer valid — it may have expired or already been used. Request a new one below.'
		: "Sign-in didn't complete. Request a new link below.";
}

function Login() {
	const [phase, setPhase] = useState<Phase>('idle');
	const [email, setEmail] = useState('');
	const [error, setError] = useState<string | null>(verifyErrorFromUrl);
	// The OAuth start hands the tab to Google; until it does, a second click
	// would open a second flow (and mint a second state row).
	const [redirecting, setRedirecting] = useState(false);
	const emailRef = useRef<HTMLInputElement>(null);
	const announce = useAnnounce();

	// Story 3.4 (AC2): the session gate swaps the whole shell for this screen
	// (401 re-auth or sign-out) and React drops focus to <body> silently. Move
	// focus into the form and announce the screen — one fix here covers both
	// entry points (and a cold load, where focusing the only input is what a
	// login page should do anyway, hence the condition-neutral copy). A
	// verify-error mount announces the error itself instead. Depends on the
	// hoisted LiveRegionProvider in main.tsx.
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — re-announcing on re-render would spam.
	useEffect(() => {
		emailRef.current?.focus();
		announce(error ?? 'Sign in with your email to continue.');
	}, []);

	async function onSubmit(event: FormEvent) {
		event.preventDefault();
		setPhase('sending');
		setError(null);
		try {
			const result = await authClient.signIn.magicLink({
				email,
				callbackURL: '/',
				errorCallbackURL: '/',
			});
			if (result.error) {
				setPhase('idle');
				setError(
					result.error.message ??
						"The sign-in link couldn't be sent. Try again.",
				);
				return;
			}
			setPhase('sent');
		} catch {
			setPhase('idle');
			setError('Network error — the request never made it. Try again.');
		}
	}

	// Google (Story 8.1 / B1a): the OAuth round-trip leaves the SPA, so there is
	// no success branch to render here — the browser comes back either signed in
	// or at `/?error=…` (the allowlist rejection included). Only a request that
	// never left needs surfacing.
	async function signInWithGoogle() {
		if (redirecting) return;
		setError(null);
		setRedirecting(true);
		try {
			const result = await authClient.signIn.social({
				provider: 'google',
				callbackURL: '/',
				errorCallbackURL: '/',
			});
			if (result.error) {
				// Deliberately NOT the library's message: a failed start means the
				// provider isn't configured (or better-auth is unhappy), and its
				// internals are not copy for an unauthenticated visitor.
				setRedirecting(false);
				setError("Google sign-in couldn't start. Try again.");
			}
		} catch {
			setRedirecting(false);
			setError('Network error — the request never made it. Try again.');
		}
	}

	return (
		<>
			<Background />
			<main className="login">
				<div className="login__card">
					<Wordmark variant="hero" showTagline />

					{phase === 'sent' ? (
						<div className="login__sent">
							<p>Check your email — a sign-in link is on its way.</p>
							<p className="login__hint">
								You can close this tab; the link signs you in directly.
							</p>
						</div>
					) : (
						<form className="login__form" onSubmit={onSubmit}>
							<label className="login__label" htmlFor="login-email">
								Sign in with a magic link — no password
							</label>
							<input
								ref={emailRef}
								id="login-email"
								className="login__input"
								type="email"
								required
								autoComplete="email"
								placeholder="you@example.com"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								disabled={phase === 'sending'}
							/>
							<button
								type="submit"
								className="login__submit tap-target"
								disabled={phase === 'sending'}
							>
								{phase === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
							</button>
						</form>
					)}

					{phase !== 'sent' && (
						<>
							<p className="login__divider" aria-hidden="true">
								or
							</p>
							<button
								type="button"
								className="login__google tap-target"
								disabled={phase === 'sending' || redirecting}
								onClick={signInWithGoogle}
							>
								{redirecting ? 'Taking you to Google…' : 'Continue with Google'}
							</button>
						</>
					)}

					{error && (
						<p role="alert" className="login__error">
							{error}
						</p>
					)}
				</div>
			</main>
		</>
	);
}

export default Login;
