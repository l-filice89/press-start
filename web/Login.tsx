import { type FormEvent, useState } from 'react';
import { authClient } from './auth-client';

/**
 * Magic-link login screen (FR-47): the only thing an unauthenticated visitor
 * sees. Functional-minimal on purpose — the PRESS START design system lands
 * with Story 1.5's app shell.
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
	// INVALID_TOKEN is the one code with a specific, user-actionable meaning;
	// anything else gets a generic message rather than a wrong-specific one.
	return error === 'INVALID_TOKEN'
		? 'That sign-in link is no longer valid — it may have expired or already been used. Request a new one below.'
		: "Sign-in didn't complete. Request a new link below.";
}

function Login() {
	const [phase, setPhase] = useState<Phase>('idle');
	const [email, setEmail] = useState('');
	const [error, setError] = useState<string | null>(verifyErrorFromUrl);

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

	return (
		<section
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				minHeight: '100vh',
				gap: '1rem',
				padding: '1rem',
				textAlign: 'center',
			}}
		>
			<h1>PRESS START</h1>
			{phase === 'sent' ? (
				<>
					<p>Check your email — a sign-in link is on its way.</p>
					<p>You can close this tab; the link signs you in directly.</p>
				</>
			) : (
				<form
					onSubmit={onSubmit}
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: '0.75rem',
						width: 'min(20rem, 100%)',
					}}
				>
					<label htmlFor="login-email">
						Sign in with a magic link — no password
					</label>
					<input
						id="login-email"
						type="email"
						required
						autoComplete="email"
						placeholder="you@example.com"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						disabled={phase === 'sending'}
						style={{ padding: '0.6rem', fontSize: '1rem' }}
					/>
					<button
						type="submit"
						className="counter"
						disabled={phase === 'sending'}
					>
						{phase === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
					</button>
				</form>
			)}
			{error && (
				<p role="alert" style={{ color: '#ff6b81' }}>
					{error}
				</p>
			)}
		</section>
	);
}

export default Login;
