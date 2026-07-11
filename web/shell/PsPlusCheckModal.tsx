import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalTrap } from '../components/useModalTrap';
import type { PsPlusCheckResult } from '../settings/api';
// ponytail: reuses the sync-summary stylesheet wholesale — same modal
// language, zero new CSS; split when the two readouts visually diverge.
import './sync-summary-modal.css';

/**
 * The post-check readout (Story 5.1, UX-DR13): which tracked non-owned games
 * entered/left the region's PS+ Extra catalog this run. Mirrors the
 * SyncSummaryModal scaffold (trap, portal, backdrop dismiss, focus restore).
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

export function PsPlusCheckModal({
	result,
	onClose,
}: {
	result: PsPlusCheckResult;
	onClose: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const titleId = useId();

	const onKeyDown = useModalTrap(dialogRef, onClose, {
		initialFocusRef: closeRef,
	});

	// Auto-opens on async completion — a focus steal; give focus back on close.
	const openerRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		openerRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		return () => openerRef.current?.focus();
	}, []);

	const noChanges = result.flagged.length === 0 && result.cleared.length === 0;

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Close button are the accessible paths; this only mirrors them for pointer users.
		<div
			className="sync-summary__backdrop"
			data-testid="psplus-check-backdrop"
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
				data-testid="psplus-check-summary"
			>
				<h2 id={titleId} className="sync-summary__title">
					PS+ Extra check complete
				</h2>

				<p className="sync-summary__group-hint">
					{result.checked} non-owned {result.checked === 1 ? 'game' : 'games'}{' '}
					checked against the {result.region} catalog.
				</p>

				{noChanges ? (
					<p
						className="sync-summary__group-hint"
						data-testid="psplus-no-changes"
					>
						No flag changes — your shelf already matches the catalog.
					</p>
				) : (
					<div className="sync-summary__counts" data-testid="psplus-counts">
						<NameList heading="Now in PS+ Extra" titles={result.flagged} />
						<NameList heading="Left PS+ Extra" titles={result.cleared} />
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
