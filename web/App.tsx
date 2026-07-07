import { useState } from 'react';
import cloudflareLogo from './assets/cloudflare.svg';
import heroImg from './assets/hero.png';
import reactLogo from './assets/react.svg';
import viteLogo from './assets/vite.svg';
import './App.css';
import { authClient } from './auth-client';
import Login from './Login';

/**
 * Session gate (FR-47): unauthenticated visitors see only the login screen —
 * none of the app content below renders without a session. The authenticated
 * view is still Story 1.1's scaffold placeholder; the real shelf is Story
 * 1.7, and the sign-out control moves into Settings with Story 1.5's shell.
 */
function App() {
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		// Minimal session-check placeholder; the skeleton loader is Story 1.5.
		return (
			<p aria-busy="true" style={{ textAlign: 'center', padding: '2rem' }}>
				Loading…
			</p>
		);
	}

	if (!session) {
		return <Login />;
	}

	return <AuthenticatedApp email={session.user.email} />;
}

function AuthenticatedApp({ email }: { email: string }) {
	const [count, setCount] = useState(0);
	const [health, setHealth] = useState('unknown');
	const [signOutFailed, setSignOutFailed] = useState(false);

	async function onSignOut() {
		setSignOutFailed(false);
		try {
			const result = await authClient.signOut();
			if (result.error) {
				setSignOutFailed(true);
			}
		} catch {
			setSignOutFailed(true);
		}
	}

	return (
		<>
			<header
				style={{
					display: 'flex',
					justifyContent: 'flex-end',
					alignItems: 'center',
					gap: '1rem',
					padding: '0.75rem 1rem',
				}}
			>
				{signOutFailed && (
					<span role="alert" style={{ color: '#ff6b81' }}>
						Sign-out failed — try again.
					</span>
				)}
				<span>{email}</span>
				<button type="button" className="counter" onClick={onSignOut}>
					Sign out
				</button>
			</header>
			<section id="center">
				<div className="hero">
					<img src={heroImg} className="base" width="170" height="179" alt="" />
					<img src={reactLogo} className="framework" alt="React logo" />
					<img src={viteLogo} className="vite" alt="Vite logo" />
				</div>
				<div>
					<h1>Get started with Cloudflare</h1>
					<p>
						Edit <code>web/App.tsx</code> or <code>worker/index.ts</code> and
						save to test <code>HMR</code>
					</p>
				</div>
				<ul
					style={{
						display: 'flex',
						gap: '1rem',
						listStyle: 'none',
						padding: 0,
					}}
				>
					<li>
						<button
							type="button"
							className="counter"
							onClick={() => setCount((count) => count + 1)}
						>
							Count is {count}
						</button>
					</li>
					<li>
						<button
							type="button"
							className="counter"
							onClick={() => {
								fetch('/api/health')
									.then((res) => res.json())
									.then((data: { status: string }) => setHealth(data.status))
									.catch(() => setHealth('error'));
							}}
							aria-label="check API health"
						>
							API health is: {health}
						</button>
					</li>
				</ul>
			</section>

			<div className="ticks"></div>

			<section id="next-steps">
				<div id="docs">
					<svg className="icon" role="presentation" aria-hidden="true">
						<use href="/icons.svg#documentation-icon"></use>
					</svg>
					<h2>Documentation</h2>
					<p>Your questions, answered</p>
					<ul>
						<li>
							<a href="https://vite.dev/" target="_blank" rel="noopener">
								<img className="logo" src={viteLogo} alt="" />
								Explore Vite
							</a>
						</li>
						<li>
							<a href="https://react.dev/" target="_blank" rel="noopener">
								<img className="button-icon" src={reactLogo} alt="" />
								Learn more about React
							</a>
						</li>
						<li>
							<a
								href="https://workers.cloudflare.com/"
								target="_blank"
								rel="noopener"
							>
								<img className="button-icon" src={cloudflareLogo} alt="" />
								Workers Docs
							</a>
						</li>
					</ul>
				</div>
				<div id="social">
					<svg className="icon" role="presentation" aria-hidden="true">
						<use href="/icons.svg#social-icon"></use>
					</svg>
					<h2>Connect with us</h2>
					<p>Join the Vite community</p>
					<ul>
						<li>
							<a
								href="https://github.com/vitejs/vite"
								target="_blank"
								rel="noopener"
							>
								<svg
									className="button-icon"
									role="presentation"
									aria-hidden="true"
								>
									<use href="/icons.svg#github-icon"></use>
								</svg>
								GitHub
							</a>
						</li>
						<li>
							<a href="https://chat.vite.dev/" target="_blank" rel="noopener">
								<svg
									className="button-icon"
									role="presentation"
									aria-hidden="true"
								>
									<use href="/icons.svg#discord-icon"></use>
								</svg>
								Discord
							</a>
						</li>
						<li>
							<a href="https://x.com/vite_js" target="_blank" rel="noopener">
								<svg
									className="button-icon"
									role="presentation"
									aria-hidden="true"
								>
									<use href="/icons.svg#x-icon"></use>
								</svg>
								X.com
							</a>
						</li>
						<li>
							<a
								href="https://bsky.app/profile/vite.dev"
								target="_blank"
								rel="noopener"
							>
								<svg
									className="button-icon"
									role="presentation"
									aria-hidden="true"
								>
									<use href="/icons.svg#bluesky-icon"></use>
								</svg>
								Bluesky
							</a>
						</li>
					</ul>
				</div>
			</section>

			<div className="ticks"></div>
			<section id="spacer"></section>
		</>
	);
}

export default App;
