import { type RefObject, useEffect, useRef } from 'react';
import { FOCUSABLE_SELECTOR } from './focusable';

/**
 * The one modal focus-trap (Story 3.5 — closes the three-way scaffold drift:
 * ConfirmDialog, DetailPanel, and FilterSheet each hand-rolled this). Owns:
 *  - focus-on-open: `initialFocusRef` if given, else the container itself
 *    (which must carry `tabIndex={-1}`);
 *  - document-capture Escape → `onDismiss`, working no matter where focus
 *    sits — with an `enabled` stand-down for stacked dialogs (a DetailPanel
 *    under a milestone confirm must leave Escape to the confirm);
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
	}: {
		enabled?: boolean;
		initialFocusRef?: RefObject<HTMLElement | null>;
	} = {},
): (e: React.KeyboardEvent) => void {
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design — focus moves into the dialog once, on open.
	useEffect(() => {
		(initialFocusRef?.current ?? containerRef.current)?.focus();
	}, []);

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
