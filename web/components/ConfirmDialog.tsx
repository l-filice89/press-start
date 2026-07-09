import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FOCUSABLE_SELECTOR } from './focusable';
import './confirm-dialog.css';

/**
 * Minimal confirm gate (UX-DR14): a focus-trapped `role="dialog"` with a
 * milestone-silver accent. Nothing is written until Confirm — Escape and Cancel
 * both resolve to `onCancel`. Focus moves to Cancel on open (the destructive-
 * lite default); the *caller* owns returning focus after either outcome, since
 * only it knows the originating control.
 */
export function ConfirmDialog({
	title,
	confirmLabel = 'Confirm',
	onConfirm,
	onCancel,
}: {
	title: string;
	confirmLabel?: string;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const titleId = useId();

	useEffect(() => {
		cancelRef.current?.focus();
	}, []);

	// Escape must work no matter where focus sits — if the user round-trips
	// through browser chrome and focus lands outside the dialog, a keydown
	// handler on the dialog div alone would go deaf.
	const onCancelRef = useRef(onCancel);
	onCancelRef.current = onCancel;
	useEffect(() => {
		const onDocKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			onCancelRef.current();
		};
		document.addEventListener('keydown', onDocKeyDown, true);
		return () => document.removeEventListener('keydown', onDocKeyDown, true);
	}, []);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key !== 'Tab') return;
		// Tab cycles inside the dialog, never out of it — the shared selector
		// (focusable.ts) keeps both dialogs' trap boundaries from drifting.
		const focusables =
			dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
		if (!focusables?.length) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	};

	// Portaled to <body>: consumers render this from inside ARIA composites
	// (gridcells, menus) where a dialog is invalid content.
	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Cancel button are the accessible paths; this only mirrors them for pointer users.
		<div
			className="confirm-dialog__backdrop"
			data-testid="confirm-backdrop"
			onMouseDown={(e) => {
				// A press on the dim area (not the dialog) dismisses without writing,
				// and stops focus from silently landing behind an `aria-modal` dialog.
				if (e.target === e.currentTarget) onCancel();
			}}
		>
			{/* tabIndex={-1} makes the dialog root click-focusable: a press on the
			    title text keeps focus inside the trap instead of dropping it to
			    <body>, where Tab would walk the page behind the modal. */}
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="confirm-dialog"
				onKeyDown={onKeyDown}
			>
				<p id={titleId} className="confirm-dialog__title">
					{title}
				</p>
				<div className="confirm-dialog__actions">
					<button
						ref={cancelRef}
						type="button"
						className="confirm-dialog__cancel tap-target"
						onClick={onCancel}
					>
						Cancel
					</button>
					<button
						type="button"
						className="confirm-dialog__confirm tap-target"
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
