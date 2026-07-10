import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalTrap } from './useModalTrap';
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

	// Shared modal scaffold (Story 3.5): Cancel takes focus on open (the
	// destructive-lite default); Escape resolves to onCancel from anywhere.
	const onKeyDown = useModalTrap(dialogRef, onCancel, {
		initialFocusRef: cancelRef,
	});

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
