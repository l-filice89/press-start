import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalTrap } from '../components/useModalTrap';
import type { SyncAttentionItem, SyncResult } from '../settings/api';
import { seedSearch } from '../shelf/SearchBox';
import './sync-summary-modal.css';

/**
 * The post-sync readout (Story 4.3, FR-37/UX-DR13): counts + the
 * needs-attention list, each item with a jump into the whole-library search.
 * Also reopened from the attention banner with only the persisted items —
 * counts belong to the run that produced them and aren't persisted, so
 * `result` is null on that path.
 */
export function SyncSummaryModal({
	result,
	attention,
	onClose,
}: {
	/** The sync run's counts; null when reopened from the banner. */
	result: SyncResult | null;
	attention: SyncAttentionItem[];
	onClose: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const titleId = useId();

	const onKeyDown = useModalTrap(dialogRef, onClose, {
		initialFocusRef: closeRef,
	});

	// This dialog auto-opens on async sync completion — a focus steal. Return
	// focus to wherever the user was on Close/Escape; a jump instead hands
	// focus to the search box deliberately (jumpedRef stands the restore down).
	const openerRef = useRef<HTMLElement | null>(null);
	const jumpedRef = useRef(false);
	useEffect(() => {
		openerRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		return () => {
			if (!jumpedRef.current) openerRef.current?.focus();
		};
	}, []);

	function jumpTo(title: string) {
		jumpedRef.current = true;
		onClose();
		seedSearch(title);
	}

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Close button are the accessible paths; this only mirrors them for pointer users.
		<div
			className="sync-summary__backdrop"
			data-testid="sync-summary-backdrop"
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
				data-testid="sync-summary"
			>
				<h2 id={titleId} className="sync-summary__title">
					{result ? 'Sync complete' : `Needs attention (${attention.length})`}
				</h2>

				{result && (
					<dl className="sync-summary__counts" data-testid="sync-counts">
						<div>
							<dt>Games added</dt>
							<dd>{result.added}</dd>
						</div>
						<div>
							<dt>Now owned</dt>
							<dd>{result.flipped}</dd>
						</div>
						<div>
							<dt>Membership entries skipped</dt>
							<dd>{result.skippedMembership}</dd>
						</div>
					</dl>
				)}

				{attention.length > 0 && (
					<section className="sync-summary__attention">
						{/* Only under the counts — the banner variant's h2 already
						    carries the same words (no duplicate heading for AT). */}
						{result && (
							<h3 className="sync-summary__attention-title">
								Needs attention ({attention.length})
							</h3>
						)}
						<ul className="sync-summary__attention-list">
							{attention.map((item, index) => (
								<li
									// biome-ignore lint/suspicious/noArrayIndexKey: items have no id and two failures can share title+reason; the list never reorders while open.
									key={index}
									className="sync-summary__attention-item"
								>
									<span className="sync-summary__attention-text">
										<strong>{item.title}</strong> — {item.reason}
									</span>
									<button
										type="button"
										className="sync-summary__jump tap-target"
										onClick={() => jumpTo(item.title)}
									>
										Find in library
									</button>
								</li>
							))}
						</ul>
					</section>
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
