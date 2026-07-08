import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import {
	changePlayStatus,
	PLAY_STATUSES,
	type PlayStatus,
	type ShelfGame,
} from './api';
import { StatePill } from './StatePill';
import './status-popover.css';

/**
 * The status pill as an ARIA menu button (Story 2.1). Tapping it opens a
 * popover of the five play statuses; selecting one applies instantly (no
 * confirm — status is freely mutable) and toasts. `Dropped` removes the card
 * from the default shelf, so its toast carries a one-tap UNDO.
 *
 * Menu semantics per the a11y floor: `aria-haspopup`/`aria-expanded` on the
 * pill, `role="menu"` with `menuitemradio` rows, arrow/Home/End traversal, and
 * Escape closes and returns focus to the pill.
 *
 * The pill is `tabIndex={-1}` on purpose: the card is a `role="gridcell"` with
 * roving tabindex, and the ARIA grid pattern reaches a cell's widget by
 * pressing Enter on the focused cell (Shelf.tsx wires that), not by adding a
 * second tab stop per card.
 *
 * Nothing here recomputes effective state (AD-7) — the mutation invalidates the
 * shelf query and the server re-bakes label, ordering and visibility.
 */
export function StatusPopover({ game }: { game: ShelfGame }) {
	const [open, setOpen] = useState(false);
	const pillRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const menuId = useId();

	const queryClient = useQueryClient();
	const { toast } = useToast();

	const mutation = useMutation({
		mutationFn: (status: PlayStatus) => changePlayStatus(game.id, status),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shelf'] }),
		// A 401 routes to sign-in centrally (query-client.ts). Everything else must
		// say so — a status change that silently did nothing is worse than an
		// error, because the shelf still shows the old pill and the user walks away
		// believing it stuck. Covers the UNDO write too, which uses this same
		// mutation.
		onError: () =>
			toast({ message: `Couldn’t update ${game.title}. Try again.` }),
	});
	// `mutate` is stable across renders; naming it keeps the callbacks below from
	// depending on the whole mutation object.
	const { mutate, isPending } = mutation;

	const close = useCallback((returnFocus = true) => {
		setOpen(false);
		if (returnFocus) pillRef.current?.focus();
	}, []);

	// The checked row is the RAW play status, never the effective state: a
	// replayed game reads `Playing` while carrying `completed_on`.
	const checkedIndex = game.playStatus
		? PLAY_STATUSES.indexOf(game.playStatus)
		: -1;

	// Focus the checked row (or the first) once the menu is rendered. Keyed on
	// `open` alone: a refetch that changes `checkedIndex` while the menu is open
	// must not yank focus off whatever row the user has arrowed to.
	// `preventScroll` because a menu opened near the viewport edge would
	// otherwise scroll itself into view, and the scroll handler below reads any
	// scroll as "outside activity" and closes the menu we just opened.
	const initialFocusIndex = useRef(0);
	initialFocusIndex.current = Math.max(0, checkedIndex);
	useEffect(() => {
		if (!open) return;
		itemRefs.current[initialFocusIndex.current]?.focus({ preventScroll: true });
	}, [open]);

	// Close on an outside pointer press or on scroll (the popover is anchored).
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (
				menuRef.current?.contains(target) ||
				pillRef.current?.contains(target)
			) {
				return;
			}
			// An outside press moves focus itself — don't yank it back to the pill.
			close(false);
		};
		const onScroll = () => close(false);
		document.addEventListener('pointerdown', onPointerDown);
		window.addEventListener('scroll', onScroll, true);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('scroll', onScroll, true);
		};
	}, [open, close]);

	const select = useCallback(
		(next: PlayStatus) => {
			close();
			if (next === game.playStatus) return;
			// A second selection while the first write is in flight would race: both
			// PATCH, and whichever response lands last wins — not necessarily the
			// status the user picked last. Dropping it silently is the same failure
			// the `onError` toast exists to prevent, so say so.
			if (isPending) {
				toast({
					message: `Still saving ${game.title}. Try again in a moment.`,
				});
				return;
			}
			const previous = game.playStatus;
			mutate(next, {
				onSuccess: () => {
					// Dropped hides the card from the default shelf — a reversible
					// risky action, so it gets an UNDO (EXPERIENCE.md feedback rules).
					const undo =
						next === 'Dropped' && previous
							? { onUndo: () => mutate(previous) }
							: undefined;
					toast({ message: `${game.title} — ${next}`, undo });
				},
			});
		},
		[close, game.playStatus, game.title, mutate, toast, isPending],
	);

	const onPillKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
			e.preventDefault();
			e.stopPropagation();
			setOpen(true);
		} else if (e.key === 'Escape') {
			// Leave "widget mode": hand focus back to the owning gridcell.
			e.stopPropagation();
			pillRef.current?.closest<HTMLElement>('[role="gridcell"]')?.focus();
		}
	};

	const onMenuKeyDown = (e: React.KeyboardEvent, index: number) => {
		const last = PLAY_STATUSES.length - 1;
		let target: number | null = null;
		switch (e.key) {
			case 'ArrowDown':
				target = index === last ? 0 : index + 1;
				break;
			case 'ArrowUp':
				target = index === 0 ? last : index - 1;
				break;
			case 'Home':
				target = 0;
				break;
			case 'End':
				target = last;
				break;
			case 'Escape':
				e.preventDefault();
				// Never let a grid-navigation key escape the popover (Shelf.tsx also
				// guards, but the menu owns its own keys).
				e.stopPropagation();
				close();
				return;
			case 'Tab':
				// Focus is leaving the menu — an open `role="menu"` the user has
				// tabbed out of would keep `aria-expanded="true"` and lie. Let the
				// browser move focus; just close behind it.
				close(false);
				return;
			default:
				return;
		}
		e.preventDefault();
		e.stopPropagation();
		itemRefs.current[target]?.focus();
	};

	return (
		<span className="status-popover">
			<button
				ref={pillRef}
				type="button"
				className="status-popover__pill tap-expander"
				tabIndex={-1}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				aria-label={`${game.effectiveState} — change status`}
				data-testid="status-pill-button"
				onClick={() => (open ? close() : setOpen(true))}
				onKeyDown={onPillKeyDown}
			>
				<StatePill state={game.effectiveState} />
			</button>

			{open && (
				<div
					ref={menuRef}
					id={menuId}
					role="menu"
					className="status-popover__menu"
					aria-label={`Play status for ${game.title}`}
					data-testid="status-menu"
				>
					{PLAY_STATUSES.map((status, index) => (
						<button
							key={status}
							ref={(el) => {
								itemRefs.current[index] = el;
							}}
							type="button"
							role="menuitemradio"
							aria-checked={status === game.playStatus}
							tabIndex={-1}
							className="status-popover__item tap-target"
							onClick={() => select(status)}
							onKeyDown={(e) => onMenuKeyDown(e, index)}
						>
							{status}
						</button>
					))}
				</div>
			)}
		</span>
	);
}
