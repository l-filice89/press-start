import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { runSync, type SyncResult } from '../settings/api';
import './fab.css';

/**
 * The FAB drawer (Story 4.2, EXPERIENCE.md "chores only"): a fixed
 * bottom-right toggle opening an upward item list. Need-scoped — Sync is the
 * only item; Epic 5/6 add their own (PS+ check, export, settings, about).
 * Long-op items show a spinner while running (UX-DR10). Escape and
 * outside-click close the drawer; icons-only on phone, icons+text desktop.
 */
export function Fab() {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const syncPendingRef = useRef(false);
	const menuId = useId();
	const queryClient = useQueryClient();
	const { toast } = useToast();

	const sync = useMutation({
		mutationFn: runSync,
		onSuccess: (result: SyncResult) => {
			// Full 4.3 summary modal comes next story; a toast reports the counts.
			const attention = result.needsAttention.length
				? ` ${result.needsAttention.length} need attention.`
				: '';
			toast({
				message: `Sync complete: ${result.added} added, ${result.flipped} now owned, ${result.skippedMembership} membership entries skipped.${attention}`,
			});
			queryClient.invalidateQueries({ queryKey: ['shelf'] });
			queryClient.invalidateQueries({ queryKey: ['shelf-search'] });
		},
		onError: (error: Error & { status?: number }) => {
			if (error.status === 401) {
				// The PSN cookie was rejected: the server persisted the expired
				// flag — refetching settings lights the banner without a reload.
				toast({
					message:
						'Sync failed — the PlayStation cookie expired. See the banner.',
				});
				queryClient.invalidateQueries({ queryKey: ['settings'] });
			} else {
				toast({ message: 'Sync failed — try again later.' });
			}
		},
		onSettled: () => setOpen(false),
	});
	syncPendingRef.current = sync.isPending;

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
		<div className="fab" ref={rootRef} data-testid="fab">
			{open && (
				<div className="fab__drawer" id={menuId} data-testid="fab-drawer">
					<button
						type="button"
						className="fab__item tap-target"
						onClick={() => sync.mutate()}
						disabled={sync.isPending}
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
