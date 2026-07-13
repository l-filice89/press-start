import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalTrap } from '../components/useModalTrap';
import type { TrophySyncResult } from '../settings/api';
// ponytail: reuses the sync-summary stylesheet wholesale — same modal
// language, zero new CSS; split when the readouts visually diverge.
import './sync-summary-modal.css';

/**
 * The post-trophy-sync readout (Story 9.2, UX-DR13): what got counts, what had
 * no library game, and what was too ambiguous to write. Mirrors the
 * PsPlusCheckModal scaffold (trap, portal, backdrop dismiss, focus restore).
 * An unmatched title is NOT a failure — a demo or an unowned game will always
 * be there — so it is reported plainly, apart from needs-attention.
 */
function NameList({ heading, titles }: { heading: string; titles: string[] }) {
	return (
		<div className="sync-summary__group">
			<h3 className="sync-summary__group-title">
				{heading} <span className="sync-summary__count">({titles.length})</span>
			</h3>
			{titles.length > 0 && (
				<ul className="sync-summary__titles">
					{titles.map((title, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: two games can share a display title; the list never reorders while open.
						<li key={`${index}-${title}`}>{title}</li>
					))}
				</ul>
			)}
		</div>
	);
}

export function TrophySyncModal({
	result,
	onClose,
}: {
	result: TrophySyncResult;
	onClose: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const titleId = useId();

	// Auto-opens on async completion — a focus steal; the trap captures the
	// opener before focusing Close and restores it on unmount.
	const onKeyDown = useModalTrap(dialogRef, onClose, {
		initialFocusRef: closeRef,
		restoreFocus: true,
	});

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Close button are the accessible paths; this only mirrors them for pointer users.
		<div
			className="sync-summary__backdrop"
			data-testid="trophy-sync-backdrop"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="sync-summary"
				onKeyDown={onKeyDown}
				data-testid="trophy-sync-summary"
			>
				<h2 id={titleId} className="sync-summary__title">
					Trophy sync complete
				</h2>

				<p className="sync-summary__group-hint">
					{result.updated.length}{' '}
					{result.updated.length === 1 ? 'game' : 'games'} updated with trophy
					progress.
				</p>

				<div className="sync-summary__counts" data-testid="trophy-sync-counts">
					<NameList heading="Updated" titles={result.updated} />
					{/* Not an error: a trophy title with no library game (a demo, a game
					    you no longer own) is expected, and is only reported. */}
					<NameList heading="No library match" titles={result.unmatched} />
				</div>

				{result.needsAttention.length > 0 && (
					<div
						className="sync-summary__group"
						data-testid="trophy-sync-attention"
					>
						<h3 className="sync-summary__group-title">
							Needs attention{' '}
							<span className="sync-summary__count">
								({result.needsAttention.length})
							</span>
						</h3>
						<ul className="sync-summary__titles">
							{result.needsAttention.map((item) => (
								<li key={`${item.title}-${item.reason}`}>
									{item.title} — {item.reason}
								</li>
							))}
						</ul>
					</div>
				)}

				<div className="sync-summary__actions">
					<button
						ref={closeRef}
						type="button"
						className="sync-summary__close tap-target"
						onClick={onClose}
					>
						Close
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
