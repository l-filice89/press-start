import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router';
import { Catalog } from '../catalog/Catalog';
import { AttentionBanner } from '../components/AttentionBanner';
import { EmptyState } from '../components/EmptyState';
import { ToastHost } from '../components/Toast';
import { fetchSettings } from '../settings/api';
import { SettingsPanel } from '../settings/SettingsPanel';
import { useActiveDestination } from '../shelf/detail-navigation';
import { GameDetailRoute } from '../shelf/GameRoute';
import { SearchBox } from '../shelf/SearchBox';
import { Shelf } from '../shelf/Shelf';
import { StragglersDialog } from '../shelf/StragglersDialog';
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
 * query — each banner survives reloads until its condition self-resolves
 * (NFR-4 — never one dismissed modal away).
 */
/** The explicit not-found destination (review, M10) — never a shelf at /catlog. */
function NotFound() {
	const navigate = useNavigate();
	return (
		<EmptyState
			variant="page-not-found"
			actions={[{ label: 'Back to shelf', onClick: () => void navigate('/') }]}
		/>
	);
}

export function AppShell({
	email,
	onSignOut,
	signOutFailed = false,
}: {
	email: string;
	onSignOut: () => void;
	signOutFailed?: boolean;
}) {
	// The location the routes render AGAINST: the background behind an open detail,
	// or the real location when there is none. This is ALWAYS a location object,
	// NEVER `undefined` — and that is load-bearing, not lazy. `<Routes>` toggling
	// between "has a location prop" and "has none" remounts the matched route
	// element, so a `background ?? undefined` would tear the shelf grid down every
	// time a detail closes — destroying the card node the close handoff just moved
	// focus to (e2e epic2-detail 2.3e) and losing scroll/roving index. A stable,
	// always-present prop keeps the destination mounted across open/close; the cost
	// is that `<Routes location>` re-renders its subtree on every AppShell render,
	// which is the deliberate price of the non-remount guarantee.
	const destination = useActiveDestination();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [stragglersOpen, setStragglersOpen] = useState(false);
	const { data: settings } = useQuery({
		queryKey: ['settings'],
		queryFn: ({ signal }) => fetchSettings(signal),
	});
	const stragglerCount = settings?.stragglerCount ?? 0;

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
					psPlusRefreshedAt={settings?.psPlusRefreshedAt ?? null}
					catalogRefreshing={settings?.catalogRefreshing ?? false}
				/>
				{settings?.scoresRefreshFailed && (
					<AttentionBanner
						variant="failed-score-refresh"
						message="The scheduled game-score refresh didn't complete — stored scores may be stale. It retries on the next scheduled run."
					/>
				)}
				{stragglerCount > 0 && (
					<AttentionBanner
						variant="enrich"
						message={`${stragglerCount} ${stragglerCount === 1 ? 'game needs' : 'games need'} a games-DB match — Resolve to search and link each one, which clears this.`}
						action={{
							label: 'Resolve',
							onClick: () => setStragglersOpen(true),
						}}
					/>
				)}
				{/* Only <main> swaps between destinations (AD-25): the header, the
				    banners, the toast host, the FAB, and every modal are SHARED chrome
				    that surfaces OVER whichever destination is active.
				    The routes render against the BACKGROUND location when a detail was
				    opened from inside the app — react-router's background-location
				    pattern. `/game/:id` used to hardcode the shelf as the thing behind
				    the overlay, so an add from the catalog tore the catalog down and
				    Close snapped back to it through a shelf flash. Now the destination
				    behind the detail is simply the one you were on.
				    `<GameDetailRoute />` sits BESIDE the routes, not inside a route
				    element: it matches on the REAL url (`useMatch` reads router context,
				    not the `location` prop given to <Routes>) and renders null off
				    `/game/:id`. That asymmetry is the whole trick — <Routes> shows the
				    background while the overlay still sees the detail — and it is also
				    what keeps the destination from remounting when the detail opens and
				    closes (focus, scroll, roving index all survive).
				    `/game/:id` keeps a route entry rendering the shelf ALONE, for the
				    COLD case: a pasted link or a reload has no background in state, and
				    the URL by itself cannot know where you came from.
				    The routes are EXPLICIT (review, M10): the shelf used to sit on the
				    catch-all, so `/catlog`, `/game/` and `/anything` silently rendered
				    it at whatever address you mistyped. An unknown URL is a NOT FOUND. */}
				{/* `tabIndex={-1}`: the close-detail focus handoff falls back here when the
				    background renders no grid (GameRoute.close) — a bare <main> is not
				    focusable, so without this the fallback would still land on <body>. */}
				<main className="app-shell__main" id="main-content" tabIndex={-1}>
					<Routes location={destination}>
						<Route
							path="/catalog"
							element={<Catalog onOpenSettings={() => setSettingsOpen(true)} />}
						/>
						<Route path="/" element={<Shelf />} />
						<Route path="/game/:id" element={<Shelf />} />
						<Route path="*" element={<NotFound />} />
					</Routes>
					<GameDetailRoute />
				</main>
			</div>
			<Fab handedness={settings?.fabHandedness ?? 'right'} />
			{settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
			{stragglersOpen && (
				<StragglersDialog onClose={() => setStragglersOpen(false)} />
			)}
		</ToastHost>
	);
}
