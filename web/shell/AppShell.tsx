import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router';
import { Catalog } from '../catalog/Catalog';
import { AttentionBanner } from '../components/AttentionBanner';
import { EmptyState } from '../components/EmptyState';
import { ToastHost } from '../components/Toast';
import {
	fetchSettings,
	type PsPlusCheckResult,
	type SyncAttentionItem,
	type SyncResult,
	type TrophySyncResult,
} from '../settings/api';
import { SettingsPanel } from '../settings/SettingsPanel';
import { useActiveDestination } from '../shelf/detail-navigation';
import { GameDetailRoute } from '../shelf/GameRoute';
import { SearchBox } from '../shelf/SearchBox';
import { Shelf } from '../shelf/Shelf';
import { StragglersDialog } from '../shelf/StragglersDialog';
import { Background } from './Background';
import { Fab } from './Fab';
import { Header } from './Header';
import { PsPlusCheckModal } from './PsPlusCheckModal';
import { SyncSummaryModal } from './SyncSummaryModal';
import { TrophySyncModal } from './TrophySyncModal';
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
 * query: a PSN-rejected token surfaces the refresh path (4.1), and persisted
 * sync needs-attention items surface the amber banner (4.3) — both survive
 * reloads until their condition self-resolves (NFR-4 — never one dismissed
 * modal away).
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
	// The summary surface has two sources (UX-DR13): a completed sync run
	// (with counts) or the banner reopening the persisted items (no counts).
	// Both snapshot their items at open time — a background settings refetch
	// must not swap or empty the list under the reader.
	const [summary, setSummary] = useState<{
		result: SyncResult | null;
		attention: SyncAttentionItem[];
	} | null>(null);
	// The PS+ check readout (5.1) — snapshot semantics match `summary`.
	const [psPlusResult, setPsPlusResult] = useState<PsPlusCheckResult | null>(
		null,
	);
	// The trophy-sync readout (Story 9.2) — snapshot semantics match `summary`.
	const [trophyResult, setTrophyResult] = useState<TrophySyncResult | null>(
		null,
	);
	const { data: settings } = useQuery({
		queryKey: ['settings'],
		queryFn: ({ signal }) => fetchSettings(signal),
	});
	const syncAttention = settings?.syncAttention ?? [];
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
				/>
				{settings?.psnAuthExpired && (
					<AttentionBanner
						variant="expired-token"
						message="PlayStation rejected the NPSSO token — open Settings, follow the “Get / refresh token” link, and paste the fresh token."
						action={{
							label: 'Update token',
							onClick: () => setSettingsOpen(true),
						}}
					/>
				)}
				{syncAttention.length > 0 && (
					<AttentionBanner
						variant="stragglers"
						message={`${syncAttention.length} sync ${syncAttention.length === 1 ? 'item needs' : 'items need'} attention — review, fix it in your library, then re-sync to clear this.`}
						action={{
							label: 'Review',
							onClick: () =>
								setSummary({ result: null, attention: syncAttention }),
						}}
					/>
				)}
				{settings?.psPlusRefreshFailed && (
					<AttentionBanner
						variant="failed-refresh"
						message="The monthly PS+ Extra catalog refresh didn't complete — it'll retry next month, or run Check PS+ Extra from the menu to try now."
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
			<Fab
				handedness={settings?.fabHandedness ?? 'right'}
				onSyncComplete={(result) =>
					setSummary({ result, attention: result.needsAttention })
				}
				onPsPlusCheckComplete={setPsPlusResult}
				onTrophySyncComplete={setTrophyResult}
			/>
			{settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
			{psPlusResult && (
				<PsPlusCheckModal
					result={psPlusResult}
					onClose={() => setPsPlusResult(null)}
				/>
			)}
			{trophyResult && (
				<TrophySyncModal
					result={trophyResult}
					onClose={() => setTrophyResult(null)}
				/>
			)}
			{stragglersOpen && (
				<StragglersDialog onClose={() => setStragglersOpen(false)} />
			)}
			{summary && (
				<SyncSummaryModal
					result={summary.result}
					attention={summary.attention}
					onClose={() => setSummary(null)}
				/>
			)}
		</ToastHost>
	);
}
