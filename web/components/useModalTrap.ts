import { type RefObject, useEffect, useRef } from 'react';
import { FOCUSABLE_SELECTOR } from './focusable';

/**
 * The one modal focus-trap (Story 3.5 — closes the three-way scaffold drift:
 * ConfirmDialog, DetailPanel, and FilterSheet each hand-rolled this). Owns:
 *  - focus-on-open: `initialFocusRef` if given, else the container itself
 *    (which must carry `tabIndex={-1}`);
 *  - document-capture Escape → `onDismiss`, working no matter where focus
 *    sits — with an `enabled` stand-down for stacked dialogs (a DetailPanel
 *    under a milestone confirm must leave Escape to the confirm), which also
 *    marks the covered dialog `inert` so AT can't reach it;
 *  - a Tab-cycle `onKeyDown` for the container, bounded by the shared
 *    FOCUSABLE_SELECTOR, including the container-self branch: focus can sit
 *    on the `tabIndex={-1}` root (open, or a click on static text), where an
 *    unguarded Shift+Tab would walk out of the aria-modal dialog.
 *
 * Backdrop dismiss, portals, and scroll locks stay with the consumers — they
 * differ per surface; the trap is what must never drift.
 */
export function useModalTrap(
	containerRef: RefObject<HTMLElement | null>,
	onDismiss: () => void,
	{
		enabled = true,
		initialFocusRef,
		restoreFocus = false,
		preventRestoreRef,
	}: {
		enabled?: boolean;
		initialFocusRef?: RefObject<HTMLElement | null>;
		/** Restore focus to the opener on unmount. Opt-in: grid-owned surfaces
		 * (DetailPanel) already have their focus returned by the grid's roving
		 * restoration; only surfaces that auto-open and steal focus with no
		 * external owner (the summary modals) need this. */
		restoreFocus?: boolean;
		/** Read at unmount when restoreFocus is on: if truthy, focus is NOT
		 * restored (a deliberate hand-off elsewhere, e.g. jumping to search). */
		preventRestoreRef?: RefObject<boolean>;
	} = {},
): (e: React.KeyboardEvent) => void {
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design — focus moves into the dialog once, on open.
	useEffect(() => {
		// Capture the opener BEFORE the trap steals focus — else the modal's own
		// Close button is already active and restore falls to <body> on close.
		const opener =
			restoreFocus && document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		(initialFocusRef?.current ?? containerRef.current)?.focus();
		return () => {
			if (restoreFocus && !preventRestoreRef?.current) opener?.focus();
		};
	}, []);

	// A stacked dialog covers this one (`enabled: false`): `inert` takes the
	// covered layer out of the tab order AND out of the accessibility tree, so a
	// screen-reader user can't reach the fields underneath the top dialog. The
	// Escape stand-down alone left it live to AT.
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		el.inert = !enabled;
		return () => {
			el.inert = false;
		};
	}, [enabled, containerRef]);

	const onDismissRef = useRef(onDismiss);
	onDismissRef.current = onDismiss;
	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;
	useEffect(() => {
		const onDocKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || !enabledRef.current) return;
			e.preventDefault();
			e.stopPropagation();
			onDismissRef.current();
		};
		document.addEventListener('keydown', onDocKeyDown, true);
		return () => document.removeEventListener('keydown', onDocKeyDown, true);
	}, []);

	return (e: React.KeyboardEvent) => {
		if (e.key !== 'Tab') return;
		const focusables =
			containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
		if (!focusables?.length) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (document.activeElement === containerRef.current) {
			e.preventDefault();
			(e.shiftKey ? last : first).focus();
			return;
		}
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	};
}
