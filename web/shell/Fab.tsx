import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { useActiveDestination } from '../shelf/detail-navigation';
import './fab.css';

/**
 * The FAB drawer (EXPERIENCE.md "chores only"): a fixed bottom-right toggle
 * opening an upward item list. Need-scoped — Export CSV (6.3); the credentialed
 * sync items were severed by Epic 11, and the manual Check PS+ Extra by Story
 * 8.4 (refreshes are automatic now). Long-op items show a spinner while running
 * (UX-DR10). Escape and outside-click close the drawer; every item shows
 * icon + text on all sizes.
 */
export function Fab({
	handedness = 'right',
}: {
	/** FAB placement (Story 6.3, UX-DR10) — bottom-right (default) or bottom-left. */
	handedness?: 'left' | 'right';
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const menuId = useId();
	const { toast } = useToast();
	// Export CSV exports the LIBRARY (FR-49) — offering it on the catalog view
	// misleads. The ACTIVE destination (the background when a detail overlay is
	// open), not the raw pathname, decides — same rule as the header toggle.
	// With the manual PS+ check gone (Story 8.4) export is the only chore left,
	// so on the catalog the whole FAB goes: a toggle over an empty drawer is
	// worse than no button.
	const onCatalog = useActiveDestination().pathname.startsWith('/catalog');

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
			if (e.key === 'Escape') setOpen(false);
		};
		const onDocPointerDown = (e: PointerEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('keydown', onDocKeyDown);
		document.addEventListener('pointerdown', onDocPointerDown);
		return () => {
			document.removeEventListener('keydown', onDocKeyDown);
			document.removeEventListener('pointerdown', onDocPointerDown);
		};
	}, [open]);

	if (onCatalog) return null;

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
