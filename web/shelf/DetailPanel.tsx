import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PLAY_STATUSES, type ShelfGame } from './api';
import { MILESTONE_LABELS, useTrackingMutations } from './useTrackingMutations';
import './detail-panel.css';

/** FR-16 fallback: a store search by title when no product URL is persisted. */
function storeHref(game: ShelfGame): string {
	return (
		game.storeUrl ??
		`https://store.playstation.com/search/${encodeURIComponent(game.title)}`
	);
}

/** One read-only lifecycle date row; "—" when the date was never recorded. */
function DateRow({ label, date }: { label: string; date: string | null }) {
	return (
		<div className="detail-panel__date-row">
			<dt>{label}</dt>
			<dd>{date ?? '—'}</dd>
		</div>
	);
}

/**
 * The flip-to-detail dialog (Story 2.3): one game whole — status control,
 * milestone rows + dates, lifecycle dates, genres, ownership, store link.
 * Fed entirely from the card DTO already in the query cache (no detail
 * endpoint); every write goes through the same `useTrackingMutations` seam as
 * the shelf popover (AR-13/AR-21), so the two surfaces can never disagree.
 *
 * Focus-trapped `role="dialog"` labelled by the game title (UX-DR19): focus
 * moves in on open, Tab cycles inside (the ConfirmDialog technique generalized
 * to N focusables), Escape/close/backdrop all resolve to `onClose` — the
 * caller owns returning focus to the originating card. Full-screen <760px,
 * centered otherwise; flip-then-grow entry, cross-fade under
 * `prefers-reduced-motion`.
 *
 * Display only for ownership/dates/genres — editing those is Stories 2.4/2.5.
 */
export function DetailPanel({
	game,
	onClose,
}: {
	game: ShelfGame;
	onClose: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const titleId = useId();

	const {
		selectStatus,
		milestoneRows,
		activateMilestoneRow,
		confirming,
		confirmMilestone,
		cancelConfirm,
	} = useTrackingMutations(game, {
		// After the confirm dialog resolves, focus returns into the panel.
		onConfirmClose: () => closeRef.current?.focus(),
		// A write that hides the card from the default shelf (Dropped, a cleared
		// status, a logged milestone) unmounts the owning Card on refetch — close
		// the panel deliberately instead of letting the dialog vanish under the
		// user with focus stranded on <body>.
		onHidden: onClose,
	});

	// Reduced motion swaps the flip/grow transform for a fast cross-fade. A
	// class switch (not only a CSS media query) so the choice is assertable;
	// jsdom has no `matchMedia`, hence the guard. Read once on mount — the
	// entry animation has already played, so mid-open preference flips must not
	// swap the class and replay it.
	const [reducedMotion] = useState(
		() =>
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches,
	);

	// Focus moves into the dialog on open.
	useEffect(() => {
		closeRef.current?.focus();
	}, []);

	// Escape must work no matter where focus sits (same rationale as
	// ConfirmDialog) — but while the milestone confirm is stacked on top, Escape
	// belongs to it alone, so this handler stands down.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const confirmingRef = useRef(confirming);
	confirmingRef.current = confirming;
	useEffect(() => {
		const onDocKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || confirmingRef.current) return;
			e.preventDefault();
			e.stopPropagation();
			onCloseRef.current();
		};
		document.addEventListener('keydown', onDocKeyDown, true);
		return () => document.removeEventListener('keydown', onDocKeyDown, true);
	}, []);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key !== 'Tab') return;
		// N-focusable trap: Tab cycles inside the dialog, never out of it. The
		// roving-tabindex radios (tabindex="-1") are excluded — they're reached by
		// arrow keys, not Tab, and counting them would put the trap's boundaries
		// on elements Tab can never land on.
		const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
			'button:not([tabindex="-1"]), a[href]',
		);
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

	// ARIA radio pattern (roving tabindex): the group is one tab stop — the
	// checked status (or the first) — and arrows move focus between statuses
	// WITHOUT selecting. Selection here is a server write, so select-on-arrow
	// would fire a PATCH per keystroke; Enter/Space (native button activation)
	// selects the focused status deliberately.
	const statusRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const tabbableStatusIndex = game.playStatus
		? PLAY_STATUSES.indexOf(game.playStatus)
		: 0;
	const onStatusKeyDown = (e: React.KeyboardEvent, index: number) => {
		const last = PLAY_STATUSES.length - 1;
		let target: number | null = null;
		switch (e.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				target = index === last ? 0 : index + 1;
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				target = index === 0 ? last : index - 1;
				break;
			default:
				return;
		}
		e.preventDefault();
		statusRefs.current[target]?.focus();
	};

	const body = (
		<>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the close button are the accessible paths; this only mirrors them for pointer users. */}
			<div
				className="detail-panel__backdrop"
				data-testid="detail-backdrop"
				onMouseDown={(e) => {
					// A press on the dim area (not the panel) dismisses without writing.
					if (e.target === e.currentTarget) onClose();
				}}
			>
				{/* tabIndex={-1} makes the dialog root click-focusable: a press on
				    non-interactive panel text keeps focus inside the trap instead of
				    dropping it to <body>, where Tab would walk the page behind the
				    modal. */}
				<div
					ref={dialogRef}
					role="dialog"
					aria-modal="true"
					aria-labelledby={titleId}
					tabIndex={-1}
					className={`detail-panel ${
						reducedMotion ? 'detail-panel--fade' : 'detail-panel--flip'
					}`}
					data-testid="detail-panel"
					onKeyDown={onKeyDown}
				>
					<header className="detail-panel__header">
						{game.coverUrl && (
							<img
								className="detail-panel__cover"
								src={game.coverUrl}
								alt=""
								decoding="async"
							/>
						)}
						<h2 id={titleId} className="detail-panel__title">
							{game.title}
						</h2>
						<button
							ref={closeRef}
							type="button"
							className="detail-panel__close tap-target"
							aria-label="Close details"
							onClick={onClose}
						>
							✕
						</button>
					</header>

					<section className="detail-panel__section">
						<h3 className="detail-panel__heading">Play status</h3>
						<div
							role="radiogroup"
							aria-label={`Play status for ${game.title}`}
							className="detail-panel__statuses"
						>
							{PLAY_STATUSES.map((status, index) => (
								// biome-ignore lint/a11y/useSemanticElements: a segmented control of buttons carrying radio semantics — a native <input type="radio"> can't be styled as arcade segments and would fight the roving-grid focus model.
								<button
									key={status}
									ref={(el) => {
										statusRefs.current[index] = el;
									}}
									type="button"
									role="radio"
									aria-checked={status === game.playStatus}
									tabIndex={index === tabbableStatusIndex ? 0 : -1}
									className="detail-panel__status tap-target"
									onClick={() => selectStatus(status)}
									onKeyDown={(e) => onStatusKeyDown(e, index)}
								>
									{status}
								</button>
							))}
						</div>
						{/* Rendered only when a milestone exists AND there is a status to
						    clear — but the API is the enforcement (FR-3), not this
						    condition. */}
						{(game.hasCompleted || game.hasPlatinum) &&
							game.playStatus != null && (
								<button
									type="button"
									className="detail-panel__clear tap-target"
									onClick={() => selectStatus(null)}
								>
									Clear status
								</button>
							)}
					</section>

					<section className="detail-panel__section">
						<h3 className="detail-panel__heading">Milestones</h3>
						{milestoneRows.map((row) => (
							<button
								key={row.milestone}
								type="button"
								aria-disabled={row.achieved || undefined}
								className="detail-panel__milestone tap-target"
								onClick={() => activateMilestoneRow(row)}
							>
								{MILESTONE_LABELS[row.milestone]}
								<span className="detail-panel__milestone-date">
									{row.achieved ? row.date : '—'}
								</span>
							</button>
						))}
					</section>

					<section className="detail-panel__section">
						<h3 className="detail-panel__heading">Dates</h3>
						<dl className="detail-panel__dates">
							<DateRow label="Wishlisted" date={game.wishlistedOn} />
							<DateRow label="Bought" date={game.boughtOn} />
							<DateRow label="Started" date={game.startedOn} />
							<DateRow label="Story completed" date={game.completedOn} />
							<DateRow label="Platinum" date={game.platinumOn} />
						</dl>
					</section>

					<section className="detail-panel__section">
						<h3 className="detail-panel__heading">Genres</h3>
						<p className="detail-panel__genres">
							{game.genres.length > 0 ? game.genres.join(' · ') : '—'}
						</p>
					</section>

					<section className="detail-panel__section">
						<h3 className="detail-panel__heading">Ownership</h3>
						<p className="detail-panel__ownership">
							{game.owned
								? `Owned${game.ownershipType ? ` · ${game.ownershipType}` : ''}`
								: 'Wishlisted'}
						</p>
						{!game.owned && (
							// Persisted data only (NFR-3): the product URL when known, a
							// store search by title otherwise — never a third-party call.
							<a
								className="detail-panel__store-link tap-target"
								href={storeHref(game)}
								target="_blank"
								rel="noopener"
							>
								View on PS Store
							</a>
						)}
					</section>
				</div>
			</div>

			{confirming && (
				<ConfirmDialog
					title={`Log ${MILESTONE_LABELS[confirming]} for ${game.title}? This is permanent.`}
					confirmLabel="Confirm"
					onConfirm={confirmMilestone}
					onCancel={cancelConfirm}
				/>
			)}
		</>
	);

	// Portaled out of the owning gridcell: an `aria-modal` dialog inside
	// `role="grid"` is invalid grid content, and SRs that don't honor
	// `aria-modal` would otherwise read the whole shelf behind it.
	return createPortal(body, document.body);
}
