import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useToast } from '../components/Toast';
import {
	addGenre,
	changeOwnership,
	changePlayStatus,
	type DateEdits,
	type EffectiveState,
	editDates,
	logMilestone,
	type Milestone,
	type OwnershipType,
	type PlayStatus,
	removeGenre,
	type ShelfGame,
	setDiscarded,
} from './api';
import { REVEAL_STATES } from './filters';

// Games with a tracking write currently in flight — MODULE scope, keyed by
// game id, so the guard is one truth shared across every hook instance
// (Card toggle, StatusPopover, DetailPanel) and every entry point including
// toast UNDO closures (Story 3.4, AC5). Added synchronously before each
// mutate() and cleared in onSettled, so even a same-tick double activation
// can't slip two writes through.
const IN_FLIGHT = new Set<string>();

// Per-game write generation (Story 3.6, AC2): bumped on every beginWrite.
// A toast UNDO closure captures the generation of ITS OWN write; a differing
// value at activation time means newer intent exists (settled or in flight),
// so the stale undo must not fire. DELIBERATELY broad, like IN_FLIGHT: ANY
// later write on the game — a date save, a genre add, even one that failed —
// expires its undos. Conservative on purpose: a spuriously expired undo is a
// re-doable inconvenience; a stale undo overwriting newer intent is silent
// data loss. Module scope for the same reason as IN_FLIGHT: one truth across
// every hook instance and closure.
const WRITE_GEN = new Map<string, number>();

/**
 * Test-only escape hatch: module state (the in-flight set AND the write
 * generations) outlives unmounted components, so tests that leave writes
 * hanging or bump generations must clear both between cases.
 */
export function resetInFlightWrites() {
	IN_FLIGHT.clear();
	WRITE_GEN.clear();
}

// UI-orchestration mirror of the server's default-shelf filter (AD-7 computes
// state server-side; this only predicts "the card is about to unmount" so an
// open detail panel can close itself instead of vanishing mid-interaction).
// One client-side list: the hidden states ARE the revealable states.
const HIDDEN_STATES: readonly EffectiveState[] = REVEAL_STATES;

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
 * `onHidden` runs after a successful STATUS write (or discard) whose outcome
 * hides the game from the default shelf — the detail panel closes itself on it
 * rather than vanishing under the user. Milestone writes never fire it: the
 * routed panel (Story 7.2) resolves the game by id, not through the shelf
 * card, so a platinum can hide the card while the panel stays open showing
 * the new state.
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
	// True while the buy-vs-claim source prompt is open (Story 6.4, gate
	// dropped 2026-07-23): EVERY manual own of a not-yet-owned game gates
	// here — no write until the user chooses.
	const [sourcePrompt, setSourcePrompt] = useState(false);

	const queryClient = useQueryClient();
	const { toast } = useToast();

	// ONE in-flight guard for every mutation entry point (Story 3.4, AC5),
	// read at CALL time from the module-level per-game set — render-scoped
	// `isPending` booleans go stale inside toast UNDO closures, and a
	// hook-local ref wouldn't see a write started from another surface.
	const guardPending = useCallback(() => {
		if (!IN_FLIGHT.has(game.id)) return false;
		toast({ message: `Still saving ${game.title}. Try again in a moment.` });
		return true;
	}, [toast, game.id, game.title]);
	const beginWrite = useCallback(() => {
		IN_FLIGHT.add(game.id);
		WRITE_GEN.set(game.id, (WRITE_GEN.get(game.id) ?? 0) + 1);
	}, [game.id]);
	const settleWrite = useCallback(() => IN_FLIGHT.delete(game.id), [game.id]);
	// Stale-intent guard for toast UNDO closures (Story 3.6, AC2): captured
	// right after the undone write began, checked at activation. A newer write
	// on the same game — settled or still in flight — expires the undo; saying
	// so beats silently doing nothing (NFR-4).
	const guardStaleUndo = useCallback(
		(gen: number) => {
			if (WRITE_GEN.get(game.id) === gen) return false;
			toast({
				message: `Undo expired — ${game.title} was changed again.`,
			});
			return true;
		},
		[toast, game.id, game.title],
	);
	// One invalidation seam for every write path: the shelf query is the single
	// source the grid (and its client-side search/filter) renders from. 409 paths
	// refresh through here too. Story 7.2 adds the ROUTED detail's own by-id query
	// (`['game', id]`) — the panel no longer reads the shelf list, so a write made
	// from inside it would otherwise leave the panel showing its own stale DTO.
	const invalidateShelfQueries = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: ['shelf'] });
		queryClient.invalidateQueries({ queryKey: ['game', game.id] });
	}, [queryClient, game.id]);

	// `onHidden` fires only on a visible→hidden TRANSITION (Story 3.2, FR-4/17):
	// a write on an already-hidden game (reached via reveal pill or search) that
	// leaves it hidden must not auto-close the panel — visibility never changed.
	const becameHidden = (state: EffectiveState) =>
		!HIDDEN_STATES.includes(game.effectiveState) &&
		HIDDEN_STATES.includes(state);

	const mutation = useMutation({
		mutationFn: (status: PlayStatus | null) =>
			changePlayStatus(game.id, status),
		onSettled: settleWrite,
		onSuccess: (state) => {
			invalidateShelfQueries();
			if (becameHidden(state)) onHidden?.();
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
				invalidateShelfQueries();
				return;
			}
			toast({ message: `Couldn’t update ${game.title}. Try again.` });
		},
	});
	// `mutate` is stable across renders; naming it keeps the callbacks below from
	// depending on the whole mutation object.
	const { mutate } = mutation;

	const milestoneMutation = useMutation({
		mutationFn: (milestone: Milestone) => logMilestone(game.id, milestone),
		onSettled: settleWrite,
		// No `onHidden` here (UX sweep 2026-07-16): a milestone may hide the CARD
		// (platinum, or a milestone on a status-less game), but the routed panel
		// reads its own by-id query — it must stay open showing the new state.
		onSuccess: invalidateShelfQueries,
		onError: () =>
			toast({ message: `Couldn’t update ${game.title}. Try again.` }),
	});
	const { mutate: mutateMilestone } = milestoneMutation;

	const selectStatus = useCallback(
		(next: PlayStatus | null) => {
			if (next === game.playStatus) return;
			// A second selection while any write is in flight would race — including
			// a milestone POST, whose server-side status auto-clear (platinum) the
			// PATCH could overwrite. Deliberately broad: one shared guard for all
			// writes stays simple. Dropping it silently is the same failure the
			// `onError` toast exists to prevent, so the guard says so.
			if (guardPending()) return;
			const previous = game.playStatus;
			beginWrite();
			// This write's generation — the undo below is valid only while no
			// newer write on this game has begun (Story 3.6, AC2).
			const gen = WRITE_GEN.get(game.id) ?? 0;
			mutate(next, {
				onSuccess: () => {
					// Dropped — and clearing to a milestone state — hide the card from
					// the default shelf: reversible risky actions, so both get an UNDO
					// (EXPERIENCE.md feedback rules). A null previous status (auto-
					// cleared by a milestone) restores through the same write path —
					// the route accepts null and the milestone satisfies the
					// completion invariant (Story 3.2, FR-2/FR-3).
					const undo =
						next === 'Dropped' || next === null
							? {
									// The UNDO respects the same call-time guard as every
									// other entry point (Story 3.4, AC5) — and expires when a
									// newer write on this game exists (Story 3.6, AC2).
									onUndo: () => {
										if (guardPending() || guardStaleUndo(gen)) return;
										beginWrite();
										mutate(previous);
									},
								}
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
		[
			game.playStatus,
			game.title,
			game.id,
			mutate,
			toast,
			guardPending,
			guardStaleUndo,
			beginWrite,
		],
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

	// Ownership writes (Story 2.4): the card toggle and the panel's ownership
	// section share this one path. Ownership never changes effective state, so
	// no `onHidden` — invalidation alone keeps the shelf honest.
	const ownershipMutation = useMutation({
		mutationFn: (change: {
			owned?: boolean;
			ownershipType?: OwnershipType;
			via?: 'purchase' | 'membership';
		}) => changeOwnership(game.id, change),
		onSettled: settleWrite,
		onSuccess: () => invalidateShelfQueries(),
		onError: () =>
			toast({ message: `Couldn’t update ${game.title}. Try again.` }),
	});
	const { mutate: mutateOwnership } = ownershipMutation;

	const setOwnership = useCallback(
		(change: {
			owned?: boolean;
			ownershipType?: OwnershipType;
			via?: 'purchase' | 'membership';
		}) => {
			// Same shared race guard as `selectStatus` (Story 3.4, AC5).
			if (guardPending()) return;
			// A manual own on a not-yet-owned game is ambiguous — buy or claim?
			// With sync gone, EVERY game can be a PS+ claim (Essential monthly
			// titles are not in the Extra catalog), so the prompt is no longer
			// gated on `psPlusExtra`. Gate on the source prompt (Story 6.4 AC1),
			// mirroring the milestone `confirming` pattern; the write happens in
			// `confirmSource`. Every un-own / type switch, and a redundant
			// re-own, writes straight through.
			if (change.owned === true && !game.owned) {
				setSourcePrompt(true);
				return;
			}
			const previousType = game.ownershipType;
			const previousVia = game.ownedVia;
			beginWrite();
			// Same stale-intent token as the status undo (Story 3.6, AC2).
			const gen = WRITE_GEN.get(game.id) ?? 0;
			mutateOwnership(change, {
				onSuccess: () => {
					if (change.owned === false) {
						// Un-owning is a reversible risky action: UNDO restores the flag,
						// the previous type AND the provenance (`via`) — otherwise a
						// re-owned claim would silently revive as a purchase (Story 6.4).
						// `bought_on` needs no restore — un-owning never touched it
						// (write-once server-side), and a membership revive re-sends its
						// `via` so no `bought_on` is stamped either.
						toast({
							message: `${game.title} — no longer owned`,
							undo: {
								onUndo: () => {
									if (guardPending() || guardStaleUndo(gen)) return;
									beginWrite();
									mutateOwnership({
										owned: true,
										...(previousType ? { ownershipType: previousType } : {}),
										...(previousVia ? { via: previousVia } : {}),
									});
								},
							},
						});
						return;
					}
					toast({
						message:
							change.owned === true
								? // A via change on an already-owned game is a provenance
									// correction (claim→purchase upgrade, or purchase→claim for a
									// free Essential title), not a fresh own — say so.
									game.owned && change.via === 'purchase'
									? `${game.title} — marked as purchased`
									: game.owned && change.via === 'membership'
										? `${game.title} — claimed with PS+`
										: `${game.title} — owned`
								: `${game.title} — ${change.ownershipType}`,
					});
				},
			});
		},
		[
			game.title,
			game.ownershipType,
			game.ownedVia,
			game.owned,
			game.id,
			mutateOwnership,
			guardPending,
			guardStaleUndo,
			beginWrite,
			toast,
		],
	);

	// The buy-vs-claim choice resolves the source prompt into the owning write
	// (Story 6.4 AC1/AC2) — a plain owned toast, no UNDO (owning isn't risky).
	const confirmSource = useCallback(
		(via: 'purchase' | 'membership') => {
			// Guard BEFORE dismissing: a write in flight keeps the prompt open so the
			// choice survives a retry rather than being silently discarded.
			if (guardPending()) return;
			setSourcePrompt(false);
			beginWrite();
			mutateOwnership(
				{ owned: true, via },
				{ onSuccess: () => toast({ message: `${game.title} — owned` }) },
			);
		},
		[game.title, guardPending, beginWrite, mutateOwnership, toast],
	);
	const cancelSource = useCallback(() => setSourcePrompt(false), []);

	// Lifecycle-date corrections (Story 2.4, FR-45): deliberate overrides. A 409
	// is the completion-invariant refusal, same as clearing a status — explain
	// it and refetch (the client's picture of the row was stale or wrong).
	const datesMutation = useMutation({
		mutationFn: (edits: DateEdits) => editDates(game.id, edits),
		onSettled: settleWrite,
		onSuccess: () => invalidateShelfQueries(),
		onError: (error) => {
			if ((error as Error & { status?: number }).status === 409) {
				toast({
					message: `Can’t clear the last milestone of ${game.title} — set a play status first.`,
				});
				invalidateShelfQueries();
				return;
			}
			toast({ message: `Couldn’t update ${game.title}. Try again.` });
		},
	});
	const { mutate: mutateDates } = datesMutation;

	const saveDates = useCallback(
		(edits: DateEdits) => {
			// Same shared race guard as `selectStatus` (Story 3.4, AC5).
			if (guardPending()) return;
			beginWrite();
			mutateDates(edits, {
				onSuccess: () => toast({ message: `${game.title} — date saved` }),
			});
		},
		[game.title, mutateDates, guardPending, beginWrite, toast],
	);

	// Genre edits (Story 2.5): plain toasts — removing a genre is reversed by a
	// trivial re-add, so no UNDO. Writes invalidate the shelf (chips + cards
	// re-bake) and the vocabulary (an auto-created genre becomes a suggestion).
	const genreMutation = useMutation({
		mutationFn: (op: { kind: 'add' | 'remove'; name: string }) =>
			op.kind === 'add'
				? addGenre(game.id, op.name)
				: removeGenre(game.id, op.name),
		onSettled: settleWrite,
		onSuccess: () => {
			invalidateShelfQueries();
			queryClient.invalidateQueries({ queryKey: ['genres'] });
		},
		onError: () =>
			toast({ message: `Couldn’t update ${game.title}. Try again.` }),
	});
	const { mutate: mutateGenre } = genreMutation;

	const editGenre = useCallback(
		(op: { kind: 'add' | 'remove'; name: string }, onDone?: () => void) => {
			// Same shared race guard as `selectStatus` (Story 3.4, AC5).
			if (guardPending()) return;
			beginWrite();
			mutateGenre(op, {
				onSuccess: () => {
					toast({
						message: `${game.title} — ${op.name} ${op.kind === 'add' ? 'added' : 'removed'}`,
					});
					onDone?.();
				},
			});
		},
		[game.title, guardPending, beginWrite, mutateGenre, toast],
	);

	// Discard (soft-delete) — a reversible risky action, same feedback shape as
	// un-owning: UNDO toast that revives the row. Discarding always hides the
	// card from the default shelf, so `onHidden` fires unconditionally (the
	// detail panel closes itself rather than vanishing under the user). The UNDO
	// respects the shared in-flight + stale-intent guards.
	const discardMutation = useMutation({
		mutationFn: (discarded: boolean) => setDiscarded(game.id, discarded),
		onSettled: settleWrite,
		// A discarded game 404s on `/api/games/:id`, so the by-id query must be
		// REMOVED, not invalidated — invalidating races the panel's unmount and
		// refetches a guaranteed 404 (CI-visible under load). Un-discard (UNDO)
		// goes back through the normal invalidation seam.
		onSuccess: (_state, discarded) => {
			if (discarded) {
				queryClient.invalidateQueries({ queryKey: ['shelf'] });
				queryClient.removeQueries({ queryKey: ['game', game.id] });
			} else {
				invalidateShelfQueries();
			}
		},
		onError: () =>
			toast({ message: `Couldn’t update ${game.title}. Try again.` }),
	});
	const { mutate: mutateDiscard } = discardMutation;

	const discard = useCallback(() => {
		if (guardPending()) return;
		beginWrite();
		const gen = WRITE_GEN.get(game.id) ?? 0;
		mutateDiscard(true, {
			onSuccess: () => {
				toast({
					message: `${game.title} — removed from library`,
					undo: {
						onUndo: () => {
							if (guardPending() || guardStaleUndo(gen)) return;
							beginWrite();
							mutateDiscard(false);
						},
					},
				});
				onHidden?.();
			},
		});
	}, [
		game.title,
		game.id,
		mutateDiscard,
		guardPending,
		guardStaleUndo,
		beginWrite,
		toast,
		onHidden,
	]);

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
		if (guardPending()) return;
		setConfirming(null);
		onConfirmClose?.();
		beginWrite();
		mutateMilestone(milestone, {
			// Confirm-gated already, so the toast carries no UNDO.
			onSuccess: () =>
				toast({ message: `${game.title} — ${MILESTONE_LABELS[milestone]}` }),
		});
	}, [
		confirming,
		game.title,
		guardPending,
		beginWrite,
		mutateMilestone,
		onConfirmClose,
		toast,
	]);

	return {
		selectStatus,
		setOwnership,
		sourcePrompt,
		confirmSource,
		cancelSource,
		saveDates,
		editGenre,
		discard,
		milestoneRows,
		activateMilestoneRow,
		confirming,
		confirmMilestone,
		cancelConfirm,
	};
}
