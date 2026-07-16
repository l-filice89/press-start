import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { startGenreSweep } from '../catalog/api';
import { useAnnounce } from '../components/LiveRegion';
import { useToast } from '../components/Toast';
import { type PsPlusCheckResult, runPsPlusCheck } from '../settings/api';
import { serverMessage } from '../shelf/api';
import { useActiveDestination } from '../shelf/detail-navigation';
import './fab.css';

/**
 * The FAB drawer (EXPERIENCE.md "chores only"): a fixed bottom-right toggle
 * opening an upward item list. Need-scoped — Check PS+ Extra (5.1) and
 * Export CSV (6.3); the credentialed sync items were severed by Epic 11.
 * Long-op items show a spinner while running (UX-DR10). Escape and
 * outside-click close the drawer; every item shows icon + text on all sizes.
 */
export function Fab({
	onPsPlusCheckComplete,
	handedness = 'right',
}: {
	/** Receives every completed PS+ check's result — AppShell opens its readout (FR-38). */
	onPsPlusCheckComplete: (result: PsPlusCheckResult) => void;
	/** FAB placement (Story 6.3, UX-DR10) — bottom-right (default) or bottom-left. */
	handedness?: 'left' | 'right';
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const checkPendingRef = useRef(false);
	const menuId = useId();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const announce = useAnnounce();
	// Export CSV exports the LIBRARY (FR-49) — offering it on the catalog view
	// misleads. The ACTIVE destination (the background when a detail overlay is
	// open), not the raw pathname, decides — same rule as the header toggle.
	const onCatalog = useActiveDestination().pathname.startsWith('/catalog');

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
			// The check rewrote the snapshot (and its prune cascades genre rows) —
			// both catalog reads must refetch NOW, not only if the sweep succeeds,
			// or the FAB path drifts from Catalog.tsx's (review #2).
			queryClient.invalidateQueries({ queryKey: ['catalog'] });
			queryClient.invalidateQueries({ queryKey: ['catalog-genres'] });
			// The snapshot is in; now tag it — otherwise the genre filter stays
			// empty until the monthly cron converges (Story 7.1's "do it now" loop).
			startGenreSweep(queryClient, result.generation);
		},
		onError: (error: Error) => {
			// The server's own message when it carries one — a bad-region 409 names
			// the actual fix; "try again later" would send the user in a circle.
			toast({
				message: serverMessage(error) ?? 'PS+ check failed — try again later.',
			});
		},
		onSettled: () => setOpen(false),
	});

	const psnBusy = check.isPending;
	checkPendingRef.current = psnBusy;

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
			if (e.key === 'Escape' && !checkPendingRef.current) setOpen(false);
		};
		const onDocPointerDown = (e: PointerEvent) => {
			// A stray tap must not hide the running op's spinner (UX-DR10) —
			// while the PS+ check is pending the drawer stays until it settles.
			if (checkPendingRef.current) return;
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
					{!onCatalog && (
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
					)}
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
