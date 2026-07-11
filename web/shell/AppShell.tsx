import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AttentionBanner } from '../components/AttentionBanner';
import { ToastHost } from '../components/Toast';
import {
	fetchSettings,
	type PsPlusCheckResult,
	type SyncAttentionItem,
	type SyncResult,
} from '../settings/api';
import { SettingsPanel } from '../settings/SettingsPanel';
import { SearchBox } from '../shelf/SearchBox';
import { Shelf } from '../shelf/Shelf';
import { StragglersDialog } from '../shelf/StragglersDialog';
import { Background } from './Background';
import { Fab } from './Fab';
import { Header } from './Header';
import { PsPlusCheckModal } from './PsPlusCheckModal';
import { SyncSummaryModal } from './SyncSummaryModal';
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
 * query: a PSN-rejected cookie surfaces the refresh path (4.1), and persisted
 * sync needs-attention items surface the amber banner (4.3) — both survive
 * reloads until their condition self-resolves (NFR-4 — never one dismissed
 * modal away).
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
						variant="expired-cookie"
						message="PlayStation rejected the session cookie — sign in at library.playstation.com, copy the fresh cookie from DevTools, and paste it in Settings."
						action={{
							label: 'Update cookie',
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
				<main className="app-shell__main" id="shelf">
					<Shelf />
				</main>
			</div>
			<Fab
				handedness={settings?.fabHandedness ?? 'right'}
				onSyncComplete={(result) =>
					setSummary({ result, attention: result.needsAttention })
				}
				onPsPlusCheckComplete={setPsPlusResult}
			/>
			{settingsOpen && (
				<SettingsPanel
					onClose={() => setSettingsOpen(false)}
					onSignOut={onSignOut}
				/>
			)}
			{psPlusResult && (
				<PsPlusCheckModal
					result={psPlusResult}
					onClose={() => setPsPlusResult(null)}
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
