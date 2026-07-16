import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useModalTrap } from '../components/useModalTrap';
import {
	type DateEdits,
	fetchGenreVocabulary,
	OWNERSHIP_TYPES,
	PLAY_STATUSES,
	type ShelfGame,
} from './api';
import { showLeaving } from './leaving';
import { OwnershipSourceDialog } from './OwnershipSourceDialog';
import { RematchDialog } from './RematchDialog';
import { scoreGrade } from './score-grade';
import { formatTtbHours } from './ttb';
import { MILESTONE_LABELS, useTrackingMutations } from './useTrackingMutations';
import './detail-panel.css';

/** FR-16 fallback: a store search by title when no product URL is persisted. */
function storeHref(game: ShelfGame): string {
	return (
		game.storeUrl ??
		`https://store.playstation.com/search/${encodeURIComponent(game.title)}`
	);
}

/**
 * One editable lifecycle date row (Story 2.4, FR-45): a native
 * `<input type="date">` — no picker dependency. Edits accumulate in a local
 * draft and commit on blur: React's `onChange` fires per segment keystroke
 * (typing a year emits `0002-…` as a complete value), so saving there would
 * PATCH garbage intermediates and drop the real edit on the pending guard.
 * The draft re-seeds from the DTO, so a server refusal (409) snaps the input
 * back to the stored value; clearing the input sends `null`.
 */
function DateRow({
	label,
	field,
	date,
	onSave,
}: {
	label: string;
	field: keyof DateEdits;
	date: string | null;
	onSave: (edits: DateEdits) => void;
}) {
	const [draft, setDraft] = useState(date ?? '');
	useEffect(() => setDraft(date ?? ''), [date]);
	return (
		<label className="detail-panel__date-row">
			<span className="detail-panel__date-label">{label}</span>
			<input
				type="date"
				className="detail-panel__date-input"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => {
					const next = draft === '' ? null : draft;
					if (next !== date) onSave({ [field]: next });
				}}
			/>
		</label>
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
	const genreListId = useId();

	const queryClient = useQueryClient();
	const { toast } = useToast();

	// The add input's draft; cleared only after a successful add.
	const [genreDraft, setGenreDraft] = useState('');

	// The rematch picker (PV-4) is stacked on top when open.
	const [rematching, setRematching] = useState(false);

	// Vocabulary suggestions for the datalist (Story 2.5). Persisted data only
	// (NFR-3) — the API reads D1, never IGDB. Writes invalidate ['genres'].
	const { data: vocabulary } = useQuery({
		queryKey: ['genres'],
		queryFn: ({ signal }) => fetchGenreVocabulary(signal),
	});

	const {
		selectStatus,
		setOwnership,
		sourcePrompt,
		confirmSource,
		cancelSource,
		saveDates,
		editGenre,
		discard,
		milestoneRows,
		activateMilestoneRow,
		confirming,
		confirmMilestone,
		cancelConfirm,
	} = useTrackingMutations(game, {
		// After the confirm dialog resolves, focus returns into the panel.
		onConfirmClose: () => closeRef.current?.focus(),
		// A STATUS write (Dropped, a cleared status) or discard that hides the
		// game closes the panel deliberately instead of letting the dialog
		// vanish under the user with focus stranded on <body>. Milestones
		// (platinum, story completed) never close it: the routed panel resolves
		// the game by id, so it survives the card unmounting and shows the new
		// milestone state (UX sweep 2026-07-16).
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

	// Shared modal scaffold (Story 3.5): the close button takes focus on open;
	// Escape resolves to onClose from anywhere — but while the milestone
	// confirm is stacked on top, Escape belongs to it alone (`enabled` stands
	// this trap's Escape down).
	const onKeyDown = useModalTrap(dialogRef, onClose, {
		// While the milestone confirm, the buy-vs-claim source prompt, OR the
		// rematch picker is stacked on top, Escape belongs to it alone (Story 3.5
		// stacking rule).
		enabled: !confirming && !sourcePrompt && !rematching,
		initialFocusRef: closeRef,
	});

	// PV-4: the picked match overwrote this game's cover/title/genres, so the
	// card DTO feeding this panel is stale — refresh the shelf/genres and close
	// (onClose returns focus to the card, which re-renders with the new facts).
	const onRematched = async () => {
		setRematching(false);
		toast({ message: `${game.title} — match updated` });
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ['shelf'] }),
			queryClient.invalidateQueries({ queryKey: ['genres'] }),
		]);
		onClose();
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
						<div className="detail-panel__heading-block">
							<h2 id={titleId} className="detail-panel__title">
								{game.title}
							</h2>
							{/* Story 10.4 follow-on: the departure date in full — under the
							    title, beside the cover (Luca 2026-07-16), so the banner
							    never reflows the two-column body below. Same gates as the
							    card pill (un-owned, future date). */}
							{showLeaving(game.psPlusLeavingOn, game.owned) && (
								<p
									className="detail-panel__leaving"
									data-testid="detail-leaving"
								>
									Leaving PS+ Extra on {game.psPlusLeavingOn}
								</p>
							)}
						</div>
						{/* Close stays FIRST in the DOM so it remains the focus-trap's
						    first tab stop (and initial focus); CSS `order` puts the ✕
						    back top-right and the rematch button to its left. */}
						<button
							ref={closeRef}
							type="button"
							className="detail-panel__close tap-target"
							aria-label="Close details"
							onClick={onClose}
						>
							✕
						</button>
						{/* PV-4: correct a wrong IGDB match (wrong cover/genres from a
						    same-name entry) — opens the games-DB picker. */}
						<button
							type="button"
							className="detail-panel__rematch tap-target"
							onClick={() => setRematching(true)}
						>
							Wrong match?
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

					{/* Reception scores (Story 10.1, VR-5) + time-to-beat (Story 10.3,
					    VR-8): stored IGDB facts with their sample counts — 3 reviews or
					    4 submissions must not read like 300. Stacked one fact family
					    per line (Luca 2026-07-16): reviews, then story, then 100%.
					    The whole section is ABSENT when IGDB has neither a score nor
					    an hour (never a zero, and 100% never stands in for story). */}
					{(game.criticScore != null ||
						game.userScore != null ||
						game.ttbStorySeconds != null ||
						game.ttbCompleteSeconds != null) && (
						<section
							className="detail-panel__section"
							data-testid="detail-scores"
						>
							<h3 className="detail-panel__heading">Scores & time to beat</h3>
							<div className="detail-panel__scores">
								{(game.criticScore != null || game.userScore != null) && (
									<p className="detail-panel__score">
										{game.criticScore != null && (
											<span className="detail-panel__score-slot">
												<span
													className={`detail-panel__score-value score-grade--${scoreGrade(game.criticScore)}`}
												>
													{Math.round(game.criticScore)}
												</span>{' '}
												Critics
												{game.criticScoreCount != null && (
													<span className="detail-panel__score-count">
														{' '}
														({game.criticScoreCount}{' '}
														{game.criticScoreCount === 1 ? 'review' : 'reviews'}
														)
													</span>
												)}
											</span>
										)}
										{game.userScore != null && (
											<span className="detail-panel__score-slot">
												<span
													className={`detail-panel__score-value score-grade--${scoreGrade(game.userScore)}`}
												>
													{Math.round(game.userScore)}
												</span>{' '}
												Players
												{game.userScoreCount != null && (
													<span className="detail-panel__score-count">
														{' '}
														({game.userScoreCount}{' '}
														{game.userScoreCount === 1 ? 'rating' : 'ratings'})
													</span>
												)}
											</span>
										)}
									</p>
								)}
								{/* Story 10.3: hours under the reviews, story vs 100%
								    unmistakable, submission count visible (4 ≠ 400). The
								    count rides WHICHEVER figure exists (review: a
								    complete-only game must not read like 400 submissions). */}
								{game.ttbStorySeconds != null && (
									<p className="detail-panel__score">
										<span className="detail-panel__score-value">
											{formatTtbHours(game.ttbStorySeconds)}
										</span>{' '}
										Story
										{game.ttbCount != null && (
											<span className="detail-panel__score-count">
												{' '}
												({game.ttbCount}{' '}
												{game.ttbCount === 1 ? 'submission' : 'submissions'})
											</span>
										)}
									</p>
								)}
								{game.ttbCompleteSeconds != null && (
									<p className="detail-panel__score">
										<span className="detail-panel__score-value">
											{formatTtbHours(game.ttbCompleteSeconds)}
										</span>{' '}
										100%
										{game.ttbStorySeconds == null && game.ttbCount != null && (
											<span className="detail-panel__score-count">
												{' '}
												({game.ttbCount}{' '}
												{game.ttbCount === 1 ? 'submission' : 'submissions'})
											</span>
										)}
									</p>
								)}
							</div>
						</section>
					)}

					<section className="detail-panel__section">
						<h3 className="detail-panel__heading">Dates</h3>
						<div className="detail-panel__dates">
							<DateRow
								label="Wishlisted"
								field="wishlistedOn"
								date={game.wishlistedOn}
								onSave={saveDates}
							/>
							<DateRow
								label="Bought"
								field="boughtOn"
								date={game.boughtOn}
								onSave={saveDates}
							/>
							<DateRow
								label="Started"
								field="startedOn"
								date={game.startedOn}
								onSave={saveDates}
							/>
							<DateRow
								label="Story completed"
								field="completedOn"
								date={game.completedOn}
								onSave={saveDates}
							/>
							<DateRow
								label="Platinum"
								field="platinumOn"
								date={game.platinumOn}
								onSave={saveDates}
							/>
						</div>
					</section>

					<section className="detail-panel__section">
						<h3 className="detail-panel__heading">Genres</h3>
						{/* FR-25: add and remove only — no merge/rename tool in v1. */}
						{game.genres.length > 0 && (
							<ul className="detail-panel__genre-chips">
								{game.genres.map((name) => (
									<li key={name} className="detail-panel__genre-chip">
										{name}
										<button
											type="button"
											className="detail-panel__genre-remove tap-target"
											aria-label={`Remove ${name}`}
											onClick={() => editGenre({ kind: 'remove', name })}
										>
											<span aria-hidden="true">×</span>
										</button>
									</li>
								))}
							</ul>
						)}
						<form
							className="detail-panel__genre-add"
							onSubmit={(e) => {
								e.preventDefault();
								const name = genreDraft.trim();
								if (!name) return;
								editGenre({ kind: 'add', name }, () => setGenreDraft(''));
							}}
						>
							<input
								className="detail-panel__genre-input"
								list={genreListId}
								value={genreDraft}
								onChange={(e) => setGenreDraft(e.target.value)}
								aria-label={`Add genre to ${game.title}`}
								placeholder="Add genre"
							/>
							{/* Native suggestions (no picker dependency); a name outside
							    the vocabulary is still submittable — FR-24 auto-creates. */}
							<datalist id={genreListId}>
								{(vocabulary ?? []).map((name) => (
									<option key={name} value={name} />
								))}
							</datalist>
							<button
								type="submit"
								className="detail-panel__genre-submit tap-target"
							>
								Add
							</button>
						</form>
					</section>

					<section className="detail-panel__section">
						<h3 className="detail-panel__heading">Ownership</h3>
						{game.owned ? (
							<>
								{/* Acquisition source is the STATE (FR-9 amended): a claim is
								    owned but subscription-bound. Always states owned-ness;
								    adds the source qualifier when known (NULL = legacy/manual). */}
								<p
									className="detail-panel__owned-via"
									data-testid="detail-owned-via"
								>
									{game.ownedVia === 'membership'
										? 'Owned · via PS+'
										: game.ownedVia === 'purchase'
											? 'Owned · purchased'
											: 'Owned'}
								</p>
								<fieldset
									aria-label={`Ownership type for ${game.title}`}
									className="detail-panel__ownership-types"
								>
									{OWNERSHIP_TYPES.map((type) => (
										<button
											key={type}
											type="button"
											aria-pressed={game.ownershipType === type}
											className="detail-panel__ownership-type tap-target"
											onClick={() => {
												if (game.ownershipType !== type) {
													setOwnership({ ownershipType: type });
												}
											}}
										>
											{type}
										</button>
									))}
								</fieldset>
								{/* Claim → purchase upgrade: a game left PS+ (or you just bought
								    it) is now a permanent purchase. Stamps bought_on write-once
								    server-side; NOT shown for an already-purchased game. */}
								{game.ownedVia === 'membership' && (
									<button
										type="button"
										className="detail-panel__own-purchased tap-target"
										onClick={() =>
											setOwnership({
												owned: true,
												via: 'purchase',
												// A PS+ claim is digital by nature; only seed the type
												// when the row carries none, so a manual choice survives.
												...(game.ownershipType
													? {}
													: { ownershipType: 'digital' }),
											})
										}
									>
										I bought this — mark as purchased
									</button>
								)}
								{/* Un-own is a command, not the status. Reversible: UNDO toast. */}
								<button
									type="button"
									className="detail-panel__unown tap-target"
									onClick={() => setOwnership({ owned: false })}
								>
									Mark as not owned
								</button>
							</>
						) : (
							<>
								{/* Own is a clear CTA, separate from the state above (a PS+
								    game routes through the buy-vs-claim prompt, Story 6.4). */}
								<button
									type="button"
									className="detail-panel__own tap-target"
									onClick={() => setOwnership({ owned: true })}
								>
									Mark as owned
								</button>
								{/* Persisted data only (NFR-3): the product URL when known, a
								    store search by title otherwise — never a third-party call. */}
								<a
									className="detail-panel__store-link tap-target"
									href={storeHref(game)}
									target="_blank"
									rel="noopener"
								>
									View on PS Store
								</a>
							</>
						)}
					</section>

					{/* Remove a mistakenly-added game. Reversible (soft-delete tombstone
					    + UNDO toast, same as un-own), so no confirm gate; discarding
					    closes the panel via `onHidden` and re-adding the name revives it. */}
					<section className="detail-panel__section">
						<button
							type="button"
							className="detail-panel__discard tap-target"
							onClick={discard}
						>
							Remove from library
						</button>
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

			{sourcePrompt && (
				<OwnershipSourceDialog
					title={`Did you buy ${game.title}, or claim it with PS+?`}
					onPurchased={() => confirmSource('purchase')}
					onClaimed={() => confirmSource('membership')}
					onCancel={cancelSource}
				/>
			)}

			{rematching && (
				<RematchDialog
					game={{ id: game.id, title: game.title }}
					onClose={() => setRematching(false)}
					onRematched={onRematched}
				/>
			)}
		</>
	);

	// Portaled out of the owning gridcell: an `aria-modal` dialog inside
	// `role="grid"` is invalid grid content, and SRs that don't honor
	// `aria-modal` would otherwise read the whole shelf behind it.
	return createPortal(body, document.body);
}
