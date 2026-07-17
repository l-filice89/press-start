import { useEffect, useRef, useState } from 'react';
// v8 ships one package: `react-router` (declarative/library mode — no Vite
// plugin, no framework mode). `react-router-dom` does not exist any more.
import { BrowserRouter } from 'react-router';
import { authClient } from './auth-client';
import { Skeleton } from './components/Skeleton';
import Login from './Login';
import { clearEtagCache } from './shelf/api';
import { AppShell } from './shell/AppShell';

/**
 * Session gate (FR-47): unauthenticated visitors see only the Login screen;
 * the authenticated app is the PRESS START shell (Story 1.5). The shelf itself
 * is still a placeholder here — real data lands with the seed (1.6) and the
 * read-only shelf (1.7).
 */
function App() {
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return (
			<div
				role="status"
				aria-busy="true"
				aria-label="Loading"
				style={{
					minHeight: '100svh',
					display: 'grid',
					placeItems: 'center',
					padding: 'var(--space-6)',
				}}
			>
				<Skeleton variant="cover" style={{ width: 'min(160px, 40vw)' }} />
			</div>
		);
	}

	if (!session) {
		return <Login />;
	}

	return <AuthenticatedApp email={session.user.email} />;
}

function AuthenticatedApp({ email }: { email: string }) {
	const [signOutFailed, setSignOutFailed] = useState(false);

	// Timezone policy (Epic 2 retro): capture the browser's IANA zone into
	// SETTING on login so date stamps record the user's calendar day, not
	// UTC's. `onlyIfUnset` means a user-edited value is never overwritten.
	// Fire-and-forget — on failure the server just keeps stamping in UTC.
	useEffect(() => {
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!timezone) return;
		void fetch('/api/settings/timezone', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ timezone, onlyIfUnset: true }),
		}).catch(() => {});
	}, []);
	// Guard against a double-click firing two concurrent sign-outs (a late second
	// response could otherwise flip state after the session already cleared).
	const signingOutRef = useRef(false);

	async function onSignOut() {
		if (signingOutRef.current) {
			return;
		}
		signingOutRef.current = true;
		setSignOutFailed(false);
		try {
			const result = await authClient.signOut();
			if (result.error) {
				setSignOutFailed(true);
			} else {
				// Review hygiene (8.6): no previous account's retained bodies.
				clearEtagCache();
			}
		} catch {
			setSignOutFailed(true);
		} finally {
			signingOutRef.current = false;
		}
	}

	// The router wraps the AUTHENTICATED app only (AD-25): the Login screen is a
	// single un-routed gate, and destinations exist only once you are inside.
	return (
		<BrowserRouter>
			<AppShell
				email={email}
				onSignOut={onSignOut}
				signOutFailed={signOutFailed}
			/>
		</BrowserRouter>
	);
}

export default App;
