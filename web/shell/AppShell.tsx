import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AttentionBanner } from '../components/AttentionBanner';
import { ToastHost } from '../components/Toast';
import { fetchSettings } from '../settings/api';
import { SettingsPanel } from '../settings/SettingsPanel';
import { SearchBox } from '../shelf/SearchBox';
import { Shelf } from '../shelf/Shelf';
import { Background } from './Background';
import { Fab } from './Fab';
import { Header } from './Header';
import './app-shell.css';

/**
 * The app shell — the single responsive frame every authenticated surface
 * renders inside (EXPERIENCE.md: "The Shelf is home; everything else surfaces
 * over it"). It provides the chrome + shared feedback infrastructure (live
 * region, toast host) and, as of Story 1.7, mounts the real read-only shelf in
 * `<main>` and the live whole-library search combobox in the header.
 *
 * Providers wrap the tree so surfaces can `useToast()` / `useAnnounce()` from
 * anywhere. The attention-banner slot under the header is fed by the settings
 * query (Story 4.1): a PSN-rejected cookie surfaces the refresh path and stays
 * until a fresh cookie is saved (NFR-4 — never one dismissed modal away).
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
	const [settingsOpen, setSettingsOpen] = useState(false);
	const { data: settings } = useQuery({
		queryKey: ['settings'],
		queryFn: ({ signal }) => fetchSettings(signal),
	});

	// LiveRegionProvider is mounted above the session gate (main.tsx) so the
	// login swap can announce — the shell only hosts the toast layer now.
	return (
		<ToastHost>
			<Background />
			<div className="app-shell">
				<Header
					email={email}
					onSignOut={onSignOut}
					onOpenSettings={() => setSettingsOpen(true)}
					signOutFailed={signOutFailed}
					search={<SearchBox />}
				/>
				{settings?.psnAuthExpired && (
					<AttentionBanner
						variant="expired-cookie"
						message="PlayStation rejected the session cookie — sign in at library.playstation.com, copy the fresh cookie from DevTools, and paste it in Settings."
						action={{
							label: 'Update cookie',
							onClick: () => setSettingsOpen(true),
						}}
					/>
				)}
				<main className="app-shell__main" id="shelf">
					<Shelf />
				</main>
			</div>
			<Fab />
			{settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
		</ToastHost>
	);
}
