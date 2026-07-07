import { useRef, useState } from 'react';
import { authClient } from './auth-client';
import { Skeleton } from './components/Skeleton';
import Login from './Login';
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
			}
		} catch {
			setSignOutFailed(true);
		} finally {
			signingOutRef.current = false;
		}
	}

	return (
		<AppShell
			email={email}
			onSignOut={onSignOut}
			signOutFailed={signOutFailed}
		/>
	);
}

export default App;
