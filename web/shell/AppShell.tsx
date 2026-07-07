import { EmptyState } from '../components/EmptyState';
import { LiveRegionProvider } from '../components/LiveRegion';
import { ToastHost } from '../components/Toast';
import { Background } from './Background';
import { Header } from './Header';
import './app-shell.css';

/**
 * The app shell — the single responsive frame every authenticated surface
 * renders inside (EXPERIENCE.md: "The Shelf is home; everything else surfaces
 * over it"). This story builds the chrome + the shared feedback infrastructure
 * (live region, toast host) and mounts the shelf region as a placeholder;
 * Story 1.6 seeds data and Story 1.7 renders the real shelf in `<main>`.
 *
 * Providers wrap the tree so later stories can `useToast()` / `useAnnounce()`
 * from anywhere. The attention-banner slot sits under the header, fed later.
 */
export function AppShell({
	email,
	onSignOut,
	signOutFailed = false,
}: {
	email: string;
	onSignOut: () => void;
	signOutFailed?: boolean;
}) {
	return (
		<LiveRegionProvider>
			<ToastHost>
				<Background />
				<div className="app-shell">
					<Header
						email={email}
						onSignOut={onSignOut}
						signOutFailed={signOutFailed}
					/>
					{/* Attention-banner slot (fed by later stories). */}
					<main className="app-shell__main" id="shelf">
						<EmptyState variant="insert-games" />
					</main>
				</div>
			</ToastHost>
		</LiveRegionProvider>
	);
}
