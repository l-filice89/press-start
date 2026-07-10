import { useCallback, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PLAY_STATUSES, type PlayStatus, type ShelfGame } from './api';
import { StatePill } from './StatePill';
import {
	MILESTONE_LABELS,
	type MilestoneRow,
	useTrackingMutations,
} from './useTrackingMutations';
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
 * All mutation/toast/confirm logic lives in `useTrackingMutations` — the one
 * seam this popover shares with the detail panel (AR-13/AR-21). Nothing here
 * recomputes effective state (AD-7).
 *
 * `open` is CONTROLLED by ShelfGrid (Story 3.6, AC3 — the 3.4 panel-hoist
 * pattern): a refetch that re-chunks the rows remounts this component, and
 * Card-local open-state would die with it. The menu DOM still remounts, but
 * the hoisted boolean re-opens it and the `open`-keyed effects re-run
 * (anchor, initial row focus) — the menu survives the write.
 */
export function StatusPopover({
	game,
	open,
	onOpenChange,
}: {
	game: ShelfGame;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const pillRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const menuId = useId();

	const focusPill = useCallback(() => pillRef.current?.focus(), []);
	const {
		selectStatus,
		milestoneRows,
		activateMilestoneRow,
		confirming,
		confirmMilestone,
		cancelConfirm,
	} = useTrackingMutations(game, { onConfirmClose: focusPill });

	const close = useCallback(
		(returnFocus = true) => {
			onOpenChange(false);
			if (returnFocus) pillRef.current?.focus();
		},
		[onOpenChange],
	);

	// The checked row is the RAW play status, never the effective state: a
	// replayed game reads `Playing` while carrying `completed_on`.
	const checkedIndex = game.playStatus
		? PLAY_STATUSES.indexOf(game.playStatus)
		: -1;

	// Focus the checked row (or the first) once the menu is rendered. Keyed on
	// `open` alone: a refetch that changes `checkedIndex` while the menu is open
	// must not yank focus off whatever row the user has arrowed to. (A refetch
	// that REMOUNTS this component — grid re-chunk, Story 3.6 — re-runs this on
	// the fresh instance: the menu survives but the arrowed position resets to
	// the checked row. Known trade-off; hoisting the row index too is the
	// upgrade path if it ever bites.)
	// `preventScroll` because a menu opened near the viewport edge would
	// otherwise scroll itself into view, and the scroll handler below reads any
	// scroll as "outside activity" and closes the menu we just opened.
	// Keep the menu on screen: default placement is below/left-aligned; when
	// that runs off the viewport, flip to whichever side has more room and cap
	// the menu's height to that side (CSS adds overflow-y for the capped case,
	// so short viewports scroll inside the menu instead of clipping rows).
	// CSS reads the data attrs. Layout effect so it lands before paint — no
	// flicker. The menu unmounts on close, so attrs and inline style reset.
	useLayoutEffect(() => {
		if (!open) return;
		const menu = menuRef.current;
		const pill = pillRef.current;
		if (!menu || !pill) return;
		const rect = menu.getBoundingClientRect();
		const pillRect = pill.getBoundingClientRect();
		const margin = 8;
		const spaceBelow = window.innerHeight - pillRect.bottom - margin;
		const spaceAbove = pillRect.top - margin;
		if (rect.height > spaceBelow) {
			const flipUp = spaceAbove > spaceBelow;
			if (flipUp) menu.dataset.flip = 'up';
			const available = flipUp ? spaceAbove : spaceBelow;
			if (rect.height > available) menu.style.maxHeight = `${available}px`;
		}
		// clientWidth, not innerWidth — a classic scrollbar eats into the latter.
		if (rect.right > document.documentElement.clientWidth) {
			menu.dataset.align = 'right';
		}
	}, [open]);

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
		// Ignore scrolls inside the menu itself (a height-capped menu scrolls
		// internally); anything else is outside activity. Resize gets the same
		// treatment — the anchored placement is stale after either.
		const onScroll = (e: Event) => {
			if (menuRef.current?.contains(e.target as Node)) return;
			close(false);
		};
		const onResize = () => close(false);
		document.addEventListener('pointerdown', onPointerDown);
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onResize);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onResize);
		};
	}, [open, close]);

	const select = useCallback(
		(next: PlayStatus) => {
			close();
			selectStatus(next);
		},
		[close, selectStatus],
	);

	// A milestone row closes the menu (focus back to the pill) and opens the
	// confirm gate; an achieved row stays inert (the hook toasts why) and the
	// menu stays open.
	const onMilestoneRow = useCallback(
		(row: MilestoneRow) => {
			if (!row.achieved) close();
			activateMilestoneRow(row);
		},
		[close, activateMilestoneRow],
	);

	const onPillKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
			e.preventDefault();
			e.stopPropagation();
			onOpenChange(true);
		} else if (e.key === 'Escape') {
			// Leave "widget mode": hand focus back to the owning gridcell.
			e.stopPropagation();
			pillRef.current?.closest<HTMLElement>('[role="gridcell"]')?.focus();
		}
	};

	const onMenuKeyDown = (e: React.KeyboardEvent, index: number) => {
		// Traversal spans the whole menu: five status radios + two milestone rows.
		const last = PLAY_STATUSES.length + milestoneRows.length - 1;
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
				onClick={() => (open ? close() : onOpenChange(true))}
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

					{/* Native separator: implicit `role="separator"` with no ARIA to hand-wire. */}
					<hr className="status-popover__separator" />

					{milestoneRows.map((row, offset) => {
						const index = PLAY_STATUSES.length + offset;
						const label = MILESTONE_LABELS[row.milestone];
						return (
							<button
								key={row.milestone}
								ref={(el) => {
									itemRefs.current[index] = el;
								}}
								type="button"
								role="menuitem"
								aria-disabled={row.achieved || undefined}
								tabIndex={-1}
								className="status-popover__item status-popover__item--milestone tap-target"
								onClick={() => onMilestoneRow(row)}
								onKeyDown={(e) => onMenuKeyDown(e, index)}
							>
								{label}
								{row.achieved && row.date && (
									<span className="status-popover__item-date">{row.date}</span>
								)}
							</button>
						);
					})}
				</div>
			)}

			{confirming && (
				<ConfirmDialog
					title={`Log ${MILESTONE_LABELS[confirming]} for ${game.title}? This is permanent.`}
					confirmLabel="Confirm"
					onConfirm={confirmMilestone}
					onCancel={cancelConfirm}
				/>
			)}
		</span>
	);
}
