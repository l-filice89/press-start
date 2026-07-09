import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useToast } from '../components/Toast';
import {
	changePlayStatus,
	type EffectiveState,
	logMilestone,
	type Milestone,
	type PlayStatus,
	type ShelfGame,
} from './api';

// UI-orchestration mirror of the server's default-shelf filter (AD-7 computes
// state server-side; this only predicts "the card is about to unmount" so an
// open detail panel can close itself instead of vanishing mid-interaction).
const HIDDEN_STATES: readonly EffectiveState[] = [
	'Dropped',
	'Story completed',
	'Platinum achieved',
];

/** Labels for the two milestone actions, keyed off the wire vocabulary. */
export const MILESTONE_LABELS: Record<Milestone, string> = {
	completed: 'Story completed',
	platinum: 'Platinum achieved',
};

export interface MilestoneRow {
	milestone: Milestone;
	achieved: boolean;
	date: string | null;
}

/**
 * The single status/milestone mutation seam shared by the shelf popover
 * (Stories 2.1/2.2) and the detail panel (Story 2.3) — AR-13/AR-21: neither
 * surface hand-rolls its own transition. Owns the status mutation (onError
 * toast, `['shelf']` invalidation, Dropped-UNDO toast, in-flight guard +
 * "Still saving" toast) and the milestone flow (confirming state, no-UNDO
 * toast, achieved-row feedback). Nothing here recomputes effective state
 * (AD-7): every write invalidates the shelf query and the server re-bakes.
 *
 * `onConfirmClose` runs when the confirm dialog resolves (confirm or cancel) —
 * the caller owns returning focus, since only it knows the originating control.
 * `onHidden` runs after a successful write whose new effective state is hidden
 * from the default shelf (the card is about to unmount) — the detail panel
 * closes itself on it rather than vanishing under the user.
 */
export function useTrackingMutations(
	game: ShelfGame,
	{
		onConfirmClose,
		onHidden,
	}: { onConfirmClose?: () => void; onHidden?: () => void } = {},
) {
	// Which milestone the confirm dialog is gating; null = no dialog.
	const [confirming, setConfirming] = useState<Milestone | null>(null);

	const queryClient = useQueryClient();
	const { toast } = useToast();

	const mutation = useMutation({
		mutationFn: (status: PlayStatus | null) =>
			changePlayStatus(game.id, status),
		onSuccess: (state) => {
			queryClient.invalidateQueries({ queryKey: ['shelf'] });
			if (HIDDEN_STATES.includes(state)) onHidden?.();
		},
		// A 401 routes to sign-in centrally (query-client.ts). Everything else must
		// say so — a status change that silently did nothing is worse than an
		// error, because the shelf still shows the old pill and the user walks away
		// believing it stuck. Covers the UNDO write too, which uses this same
		// mutation. A 409 is the completion-invariant refusal — retrying can never
		// fix it and it means this card's cache is stale, so say why and refetch.
		onError: (error) => {
			if ((error as Error & { status?: number }).status === 409) {
				toast({
					message: `Can’t clear ${game.title} — no milestone logged.`,
				});
				queryClient.invalidateQueries({ queryKey: ['shelf'] });
				return;
			}
			toast({ message: `Couldn’t update ${game.title}. Try again.` });
		},
	});
	// `mutate` is stable across renders; naming it keeps the callbacks below from
	// depending on the whole mutation object.
	const { mutate, isPending } = mutation;

	const milestoneMutation = useMutation({
		mutationFn: (milestone: Milestone) => logMilestone(game.id, milestone),
		onSuccess: (state) => {
			queryClient.invalidateQueries({ queryKey: ['shelf'] });
			if (HIDDEN_STATES.includes(state)) onHidden?.();
		},
		onError: () =>
			toast({ message: `Couldn’t update ${game.title}. Try again.` }),
	});
	const { mutate: mutateMilestone, isPending: milestonePending } =
		milestoneMutation;

	const selectStatus = useCallback(
		(next: PlayStatus | null) => {
			if (next === game.playStatus) return;
			// A second selection while any write is in flight would race — including
			// a milestone POST, whose server-side status auto-clear the PATCH could
			// overwrite. Dropping it silently is the same failure the `onError`
			// toast exists to prevent, so say so.
			if (isPending || milestonePending) {
				toast({
					message: `Still saving ${game.title}. Try again in a moment.`,
				});
				return;
			}
			const previous = game.playStatus;
			mutate(next, {
				onSuccess: () => {
					// Dropped — and clearing to a milestone state — hide the card from
					// the default shelf: reversible risky actions, so both get an UNDO
					// (EXPERIENCE.md feedback rules).
					const undo =
						(next === 'Dropped' || next === null) && previous
							? { onUndo: () => mutate(previous) }
							: undefined;
					toast({
						message: next
							? `${game.title} — ${next}`
							: `${game.title} — status cleared`,
						undo,
					});
				},
			});
		},
		[game.playStatus, game.title, mutate, toast, isPending, milestonePending],
	);

	// The two gated milestone actions. `achieved` disables the row: the first
	// achievement stands (FR-6), so an already-dated milestone is inert here.
	const milestoneRows: MilestoneRow[] = [
		{
			milestone: 'completed',
			achieved: game.hasCompleted,
			date: game.completedOn,
		},
		{
			milestone: 'platinum',
			achieved: game.hasPlatinum,
			date: game.platinumOn,
		},
	];

	// A milestone row opens the confirm gate — nothing is written until Confirm
	// (FR-7). An achieved row stays inert (FR-6) but must not be a dead-end:
	// activating it says why.
	const activateMilestoneRow = useCallback(
		(row: MilestoneRow) => {
			if (row.achieved) {
				toast({
					message: `${MILESTONE_LABELS[row.milestone]} already logged${row.date ? ` on ${row.date}` : ''}.`,
				});
				return;
			}
			setConfirming(row.milestone);
		},
		[toast],
	);

	const cancelConfirm = useCallback(() => {
		setConfirming(null);
		onConfirmClose?.();
	}, [onConfirmClose]);

	const confirmMilestone = useCallback(() => {
		const milestone = confirming;
		if (!milestone) return;
		// Same race guard as `selectStatus`: a confirm while another write is in
		// flight would let the slower response win. But this intent was explicitly
		// confirmed — keep the dialog open so retrying is one tap, not a full
		// re-navigation through menu and modal.
		if (isPending || milestonePending) {
			toast({ message: `Still saving ${game.title}. Try again in a moment.` });
			return;
		}
		setConfirming(null);
		onConfirmClose?.();
		mutateMilestone(milestone, {
			// Confirm-gated already, so the toast carries no UNDO.
			onSuccess: () =>
				toast({ message: `${game.title} — ${MILESTONE_LABELS[milestone]}` }),
		});
	}, [
		confirming,
		game.title,
		isPending,
		milestonePending,
		mutateMilestone,
		onConfirmClose,
		toast,
	]);

	return {
		selectStatus,
		milestoneRows,
		activateMilestoneRow,
		confirming,
		confirmMilestone,
		cancelConfirm,
	};
}
