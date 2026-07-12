import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalTrap } from '../components/useModalTrap';
import '../components/confirm-dialog.css';

/**
 * Buy-vs-claim source prompt (Story 6.4 AC1): a manual own on a PS+-catalog
 * game is ambiguous — did the user buy it or claim it with PS+? Two affirmative
 * choices, not a confirm/cancel, so it reuses `confirm-dialog.css` +
 * `useModalTrap` rather than bending the shared 2-button `ConfirmDialog`.
 * Cancel dismisses with no write; focus lands on Cancel, Escape resolves to it.
 */
export function OwnershipSourceDialog({
	title,
	onPurchased,
	onClaimed,
	onCancel,
}: {
	title: string;
	onPurchased: () => void;
	onClaimed: () => void;
	onCancel: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const titleId = useId();

	const onKeyDown = useModalTrap(dialogRef, onCancel, {
		initialFocusRef: cancelRef,
	});

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Cancel button are the accessible paths; this only mirrors them for pointer users.
		<div
			className="confirm-dialog__backdrop"
			data-testid="ownership-source-backdrop"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onCancel();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="confirm-dialog"
				data-testid="ownership-source-dialog"
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
						onClick={onClaimed}
					>
						Claimed with PS+
					</button>
					<button
						type="button"
						className="confirm-dialog__confirm tap-target"
						onClick={onPurchased}
					>
						Purchased
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
