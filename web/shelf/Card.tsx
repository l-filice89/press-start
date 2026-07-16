import { type KeyboardEvent, useRef, useState } from 'react';
import { PlatinumTrophy } from '../components/PlatinumTrophy';
import type { ShelfGame } from './api';
import { OwnershipSourceDialog } from './OwnershipSourceDialog';
import { StatusPopover } from './StatusPopover';
import { useTrackingMutations } from './useTrackingMutations';
import './card.css';

/**
 * A single shelf card. The cover is the open-detail trigger (Story 2.3): a
 * non-control press flips the card open into the DetailPanel dialog, and
 * closing it returns focus to the owning gridcell. The status pill is the
 * interactive status menu. Cover-forward (3:4), a top-left flag cluster, and
 * an info strip below. Every visual signal has an accessible text equivalent
 * (flag glyphs are `aria-hidden` with a visually-hidden label beside them),
 * and the whole card is a single roving tab stop in the grid (UX-DR19).
 *
 * `tabIndex` and the rest of the roving-focus wiring are owned by the parent
 * grid (Shelf); the card just forwards the ref and keydown handler. The
 * open-detail state is ALSO owned by the grid (Story 3.4): a Card can remount
 * whenever a refetch re-chunks the rows, so a panel it owned would die
 * mid-interaction — the cover button only reports the intent upward.
 */
export function Card({
	game,
	tabIndex,
	cardRef,
	onKeyDown,
	onOpenDetail,
	statusMenuOpen,
	onStatusMenuOpenChange,
}: {
	game: ShelfGame;
	tabIndex: number;
	cardRef?: (el: HTMLDivElement | null) => void;
	onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
	onOpenDetail?: (gameId: string) => void;
	/** Status-menu open state lives in ShelfGrid (Story 3.6 — the 3.4 hoist
	 * pattern): a refetch re-chunk remounts this Card, and local menu state
	 * would die with it. Card only threads it down. */
	statusMenuOpen: boolean;
	onStatusMenuOpenChange: (open: boolean) => void;
}) {
	// A persisted cover_url that 404s / fails to load falls back to the same
	// graceful mark as a missing cover — never a broken-image glyph, no network.
	const [coverFailed, setCoverFailed] = useState(false);
	const coverRef = useRef<HTMLButtonElement>(null);

	// Ownership writes go through the same shared seam as every other tracking
	// mutation (AR-13) — un-owning toasts with UNDO, owning toasts plainly. A
	// manual own on a PS+-catalog game opens the buy-vs-claim prompt (Story 6.4).
	const { setOwnership, sourcePrompt, confirmSource, cancelSource } =
		useTrackingMutations(game);

	const onCoverKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
		if (e.key === 'Escape') {
			// Leave "widget mode": hand focus back to the owning gridcell (mirrors
			// the status pill's Escape).
			e.stopPropagation();
			coverRef.current?.closest<HTMLElement>('[role="gridcell"]')?.focus();
		}
	};
	const showCover = !!game.coverUrl && !coverFailed;
	const isPlaying = game.effectiveState === 'Playing';
	const milestone = game.hasPlatinum
		? {
				// Game-scoped testid: a fixed id would throw on `getByTestId` the
				// first time a test renders two platinum cards.
				glyph: <PlatinumTrophy data-testid={`platinum-trophy-${game.id}`} />,
				label: 'Platinum achieved',
				platinum: true,
			}
		: game.hasCompleted
			? { glyph: '✓', label: 'Story completed', platinum: false }
			: null;
	// Release-state flag: only shown until a game is released.
	const releaseFlag = game.released
		? null
		: game.releaseDate
			? { label: 'SOON', description: 'Not yet released' }
			: { label: 'TBA', description: 'Release date to be announced' };

	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: ARIA grid cell (not a table cell) for the roving-focus shelf (UX-DR19) */}
			<div
				ref={cardRef}
				className={`card${isPlaying ? ' card--playing' : ''}`}
				role="gridcell"
				tabIndex={tabIndex}
				aria-label={`${game.title} — ${game.effectiveState}`}
				data-testid="shelf-card"
				data-game-id={game.id}
				onKeyDown={onKeyDown}
			>
				<div className="card__cover">
					{/* tabIndex={-1} like the pill: the gridcell is the single tab stop;
				    widget-mode Tab (Shelf.tsx) and pointer both reach this. Matched on
				    the class by the grid's Tab-cycle, like the pill. */}
					<button
						ref={coverRef}
						type="button"
						className="card__cover-button"
						tabIndex={-1}
						aria-label={`Open details — ${game.title}`}
						data-testid="card-cover-button"
						onClick={() => onOpenDetail?.(game.id)}
						onKeyDown={onCoverKeyDown}
					>
						{showCover ? (
							<img
								className="card__cover-img"
								src={game.coverUrl ?? undefined}
								alt=""
								loading="lazy"
								decoding="async"
								data-testid="card-cover"
								onError={() => setCoverFailed(true)}
							/>
						) : (
							<div className="card__cover-fallback" aria-hidden="true">
								<span className="card__cover-fallback-mark">▹</span>
							</div>
						)}
					</button>

					{/* Top-right owned toggle (Story 2.4): reversible, no confirm. A
				    sibling of the cover trigger (not nested), so a press can never
				    activate the open-detail button — stopPropagation is belt and
				    braces. tabIndex={-1} like the pill/cover: the gridcell is the
				    single tab stop, and widget-mode Tab (Shelf.tsx) reaches it. */}
					<button
						type="button"
						className="card__owned-toggle tap-expander"
						tabIndex={-1}
						aria-pressed={game.owned}
						aria-label={`Owned — ${game.title}`}
						data-testid="card-owned-toggle"
						onClick={(e) => {
							e.stopPropagation();
							setOwnership({ owned: !game.owned });
						}}
						onKeyDown={(e) => {
							if (e.key === 'Escape') {
								// Leave "widget mode": hand focus back to the owning gridcell.
								e.stopPropagation();
								e.currentTarget
									.closest<HTMLElement>('[role="gridcell"]')
									?.focus();
							}
						}}
					>
						<span aria-hidden="true">{game.owned ? '◆' : '◇'}</span>
					</button>

					<div className="card__flags">
						{game.psPlusExtra && !game.owned && (
							<span className="card__flag card__flag--ps-extra">
								<span aria-hidden="true">PS+</span>
								<span className="sr-only">
									In the PlayStation Plus Extra catalog
								</span>
							</span>
						)}
						{releaseFlag && (
							<span className="card__flag card__flag--release">
								<span aria-hidden="true">{releaseFlag.label}</span>
								<span className="sr-only">{releaseFlag.description}</span>
							</span>
						)}
						{milestone && (
							<span
								className={`card__flag card__flag--milestone${
									milestone.platinum ? ' card__flag--platinum' : ''
								}`}
							>
								<span aria-hidden="true">{milestone.glyph}</span>
								<span className="sr-only">{milestone.label}</span>
							</span>
						)}
					</div>
				</div>

				{/* Info strip stacks one row per line — title, genres, status, owned —
			    and every row is always rendered (hidden/empty rows reserve their
			    line) so all cards are the same height regardless of content.
			    (Below 600px the genres row is display:none for every card, so
			    uniformity holds per breakpoint, not via reservation there.) */}
				<div className="card__info">
					<p className="card__title" title={game.title}>
						{game.title}
					</p>
					<p className="card__genres">{game.genres.join(' · ')}</p>
					{/* Reception scores (Story 10.1, VR-5): stored IGDB facts only —
				    a null renders NOTHING in its slot (never a zero); the row itself
				    always renders so card heights stay uniform. Counts live in the
				    sr-only text here and visibly in the detail panel. */}
					<p className="card__scores" data-testid="card-scores">
						{game.criticScore != null && (
							<span className="card__score card__score--critic">
								<span aria-hidden="true">◎ {Math.round(game.criticScore)}</span>
								<span className="sr-only">
									Critic score {Math.round(game.criticScore)} out of 100
									{game.criticScoreCount != null
										? ` from ${game.criticScoreCount} ${game.criticScoreCount === 1 ? 'review' : 'reviews'}`
										: ''}
								</span>
							</span>
						)}
						{game.userScore != null && (
							<span className="card__score card__score--user">
								<span aria-hidden="true">★ {Math.round(game.userScore)}</span>
								<span className="sr-only">
									User score {Math.round(game.userScore)} out of 100
									{game.userScoreCount != null
										? ` from ${game.userScoreCount} ${game.userScoreCount === 1 ? 'rating' : 'ratings'}`
										: ''}
								</span>
							</span>
						)}
					</p>
					<div className="card__meta">
						<StatusPopover
							game={game}
							open={statusMenuOpen}
							onOpenChange={onStatusMenuOpenChange}
						/>
					</div>
					<p className="card__owned-line">
						{/* visibility-hidden (CSS, via data-owned) when un-owned — keeps
					    the row height and drops the chip from the a11y tree. */}
						<span className="card__owned" data-owned={game.owned || undefined}>
							OWNED
							{/* FR-9 amended: a PS+ claim is owned but subscription-bound —
						    worth knowing at a glance (it vanishes if PS+ lapses). */}
							{game.ownedVia === 'membership' && (
								<span
									className="card__owned-via"
									data-testid="card-owned-via-membership"
								>
									<span aria-hidden="true"> · PS+</span>
									<span className="sr-only"> via PS Plus claim</span>
								</span>
							)}
						</span>
					</p>
				</div>
			</div>

			{sourcePrompt && (
				<OwnershipSourceDialog
					title={`Did you buy ${game.title}, or claim it with PS+?`}
					onPurchased={() => confirmSource('purchase')}
					onClaimed={() => confirmSource('membership')}
					onCancel={cancelSource}
				/>
			)}
		</>
	);
}
