import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useAnnounce } from '../components/LiveRegion';
import { useToast } from '../components/Toast';
import {
	type PsPlusCheckResult,
	runPsPlusCheck,
	runSync,
	runTrophySync,
	type SyncResult,
	type TrophySyncResult,
} from '../settings/api';
import './fab.css';

/**
 * The FAB drawer (Story 4.2, EXPERIENCE.md "chores only"): a fixed
 * bottom-right toggle opening an upward item list. Need-scoped — Sync (4.2)
 * and Check PS+ Extra (5.1); Epic 6 adds its own (export, settings, about).
 * Long-op items show a spinner while running (UX-DR10). Escape and
 * outside-click close the drawer; icons-only on phone, icons+text desktop.
 */
export function Fab({
	onSyncComplete,
	onPsPlusCheckComplete,
	onTrophySyncComplete,
	handedness = 'right',
}: {
	/** Receives every completed run's result — AppShell opens the summary modal (FR-37). */
	onSyncComplete: (result: SyncResult) => void;
	/** Receives every completed PS+ check's result — AppShell opens its readout (FR-38). */
	onPsPlusCheckComplete: (result: PsPlusCheckResult) => void;
	/** Receives every completed trophy sync's result — AppShell opens its readout (Story 9.2). */
	onTrophySyncComplete: (result: TrophySyncResult) => void;
	/** FAB placement (Story 6.3, UX-DR10) — bottom-right (default) or bottom-left. */
	handedness?: 'left' | 'right';
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const syncPendingRef = useRef(false);
	const menuId = useId();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const announce = useAnnounce();

	const sync = useMutation({
		mutationFn: runSync,
		onSuccess: (result: SyncResult) => {
			// Every completed run resolves into the summary modal (FR-37) —
			// counts and needs-attention are not toast material (UX-DR13). The
			// modal steals focus, so announce the completion politely too.
			announce('Sync complete.');
			onSyncComplete(result);
			queryClient.invalidateQueries({ queryKey: ['shelf'] });
			// needs-attention items were persisted server-side; refetch so the
			// banner state matches this run.
			queryClient.invalidateQueries({ queryKey: ['settings'] });
		},
		onError: (error: Error & { status?: number }) => {
			if (error.status === 401) {
				// The PSN token was rejected: the server persisted the expired
				// flag — refetching settings lights the banner without a reload.
				toast({
					message:
						'Sync failed — the PlayStation token expired. See the banner.',
				});
				queryClient.invalidateQueries({ queryKey: ['settings'] });
			} else {
				toast({ message: 'Sync failed — try again later.' });
			}
		},
		onSettled: () => setOpen(false),
	});

	const check = useMutation({
		mutationFn: runPsPlusCheck,
		onSuccess: (result: PsPlusCheckResult) => {
			announce('PS plus check complete.');
			onPsPlusCheckComplete(result);
			// Flags feed playableNow — the shelf must re-derive.
			queryClient.invalidateQueries({ queryKey: ['shelf'] });
			// A successful check clears any failed-cron flag (5.2) — refetch
			// settings so the failed-refresh banner disappears without a reload.
			queryClient.invalidateQueries({ queryKey: ['settings'] });
		},
		onError: () => {
			toast({ message: 'PS+ check failed — try again later.' });
		},
		onSettled: () => setOpen(false),
	});

	// Trophy sync (Story 9.2): same shape as the library sync — a 401 means the
	// server already persisted the expired flag, so refetching settings lights
	// the banner; the counts land in a summary readout, never a toast.
	const trophies = useMutation({
		mutationFn: runTrophySync,
		onSuccess: (result: TrophySyncResult) => {
			announce('Trophy sync complete.');
			onTrophySyncComplete(result);
			// The counts feed the card's %/grade — the shelf must re-derive.
			queryClient.invalidateQueries({ queryKey: ['shelf'] });
			queryClient.invalidateQueries({ queryKey: ['settings'] });
		},
		onError: (error: Error & { status?: number }) => {
			if (error.status === 401) {
				toast({
					message:
						'Trophy sync failed — the PlayStation token expired. See the banner.',
				});
				queryClient.invalidateQueries({ queryKey: ['settings'] });
			} else {
				toast({ message: 'Trophy sync failed — try again later.' });
			}
		},
		onSettled: () => setOpen(false),
	});

	const psnBusy = sync.isPending || check.isPending || trophies.isPending;
	syncPendingRef.current = psnBusy;

	const exportCsv = useMutation({
		// A bare <a download> can't see the HTTP status: a lapsed session would
		// silently save the 401 JSON body as "press-start-library.csv" and the
		// user would believe they hold a backup. Fetch first, download only a 200.
		mutationFn: async () => {
			const res = await fetch('/api/export.csv');
			if (!res.ok) throw new Error(`export failed (${res.status})`);
			return res.blob();
		},
		onSuccess: (blob) => {
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'press-start-library.csv';
			a.click();
			URL.revokeObjectURL(url);
		},
		onError: () => toast({ message: 'Export failed — try again later.' }),
		onSettled: () => setOpen(false),
	});

	useEffect(() => {
		if (!open) return;
		const onDocKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !syncPendingRef.current) setOpen(false);
		};
		const onDocPointerDown = (e: PointerEvent) => {
			// A stray tap must not hide the running op's spinner (UX-DR10) —
			// while sync is pending the drawer stays until it settles.
			if (syncPendingRef.current) return;
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('keydown', onDocKeyDown);
		document.addEventListener('pointerdown', onDocPointerDown);
		return () => {
			document.removeEventListener('keydown', onDocKeyDown);
			document.removeEventListener('pointerdown', onDocPointerDown);
		};
	}, [open]);

	return (
		<div
			className={`fab${handedness === 'left' ? ' fab--left' : ''}`}
			ref={rootRef}
			data-testid="fab"
		>
			{open && (
				<div className="fab__drawer" id={menuId} data-testid="fab-drawer">
					<button
						type="button"
						className="fab__item tap-target"
						onClick={() => sync.mutate()}
						disabled={psnBusy}
						aria-label="Sync library"
						data-testid="fab-sync"
					>
						<span className="fab__item-icon" aria-hidden="true">
							{sync.isPending ? (
								<span className="fab__spinner" data-testid="fab-sync-spinner" />
							) : (
								'⟳'
							)}
						</span>
						<span className="fab__item-label">
							{sync.isPending ? 'Syncing…' : 'Sync library'}
						</span>
					</button>
					<button
						type="button"
						className="fab__item tap-target"
						onClick={() => check.mutate()}
						disabled={psnBusy}
						aria-label="Check PS+ Extra"
						data-testid="fab-psplus-check"
					>
						<span className="fab__item-icon" aria-hidden="true">
							{check.isPending ? (
								<span
									className="fab__spinner"
									data-testid="fab-psplus-spinner"
								/>
							) : (
								'✦'
							)}
						</span>
						<span className="fab__item-label">
							{check.isPending ? 'Checking…' : 'Check PS+ Extra'}
						</span>
					</button>
					<button
						type="button"
						className="fab__item tap-target"
						onClick={() => trophies.mutate()}
						disabled={psnBusy}
						aria-label="Sync trophies"
						data-testid="fab-trophy-sync"
					>
						<span className="fab__item-icon" aria-hidden="true">
							{trophies.isPending ? (
								<span
									className="fab__spinner"
									data-testid="fab-trophy-spinner"
								/>
							) : (
								// A monochrome text glyph, like every other item: the trophy
								// emoji renders full-color gold and reads flat against the
								// neon-outline language (same reason Card.tsx strokes an SVG).
								'★'
							)}
						</span>
						<span className="fab__item-label">
							{trophies.isPending ? 'Syncing trophies…' : 'Sync trophies'}
						</span>
					</button>
					<button
						type="button"
						className="fab__item tap-target"
						onClick={() => exportCsv.mutate()}
						disabled={exportCsv.isPending}
						aria-label="Export CSV"
						data-testid="fab-export"
					>
						<span className="fab__item-icon" aria-hidden="true">
							{exportCsv.isPending ? (
								<span
									className="fab__spinner"
									data-testid="fab-export-spinner"
								/>
							) : (
								'⤓'
							)}
						</span>
						<span className="fab__item-label">
							{exportCsv.isPending ? 'Exporting…' : 'Export CSV'}
						</span>
					</button>
				</div>
			)}
			<button
				type="button"
				className="fab__toggle tap-target"
				aria-label="Chores"
				aria-expanded={open}
				// only reference the drawer while it exists in the DOM
				aria-controls={open ? menuId : undefined}
				onClick={() => setOpen((v) => !v)}
			>
				<span aria-hidden="true">{open ? '✕' : '＋'}</span>
			</button>
		</div>
	);
}
