import { type KeyboardEvent, useCallback, useRef, useState } from 'react';
import type { ShelfGame } from './api';
import { DetailPanel } from './DetailPanel';
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
 * grid (Shelf); the card just forwards the ref and keydown handler.
 */
export function Card({
	game,
	tabIndex,
	cardRef,
	onKeyDown,
}: {
	game: ShelfGame;
	tabIndex: number;
	cardRef?: (el: HTMLDivElement | null) => void;
	onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
	// A persisted cover_url that 404s / fails to load falls back to the same
	// graceful mark as a missing cover — never a broken-image glyph, no network.
	const [coverFailed, setCoverFailed] = useState(false);
	const [detailOpen, setDetailOpen] = useState(false);
	const coverRef = useRef<HTMLButtonElement>(null);

	// Ownership writes go through the same shared seam as every other tracking
	// mutation (AR-13) — un-owning toasts with UNDO, owning toasts plainly.
	const { setOwnership } = useTrackingMutations(game);

	// Closing the panel returns focus to the originating card's gridcell
	// (UX-DR19) — the panel itself doesn't know where it was opened from.
	const closeDetail = useCallback(() => {
		setDetailOpen(false);
		coverRef.current?.closest<HTMLElement>('[role="gridcell"]')?.focus();
	}, []);

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
		? { glyph: '🏆', label: 'Platinum achieved' }
		: game.hasCompleted
			? { glyph: '✓', label: 'Story completed' }
			: null;
	// Release-state flag: only shown until a game is released.
	const releaseFlag = game.released
		? null
		: game.releaseDate
			? { label: 'SOON', description: 'Not yet released' }
			: { label: 'TBA', description: 'Release date to be announced' };

	return (
		// biome-ignore lint/a11y/useSemanticElements: ARIA grid cell (not a table cell) for the roving-focus shelf (UX-DR19)
		<div
			ref={cardRef}
			className={`card${isPlaying ? ' card--playing' : ''}`}
			role="gridcell"
			tabIndex={tabIndex}
			aria-label={`${game.title} — ${game.effectiveState}`}
			data-testid="shelf-card"
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
					onClick={() => setDetailOpen(true)}
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
							<span aria-hidden="true">◈</span>
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
						<span className="card__flag card__flag--milestone">
							<span aria-hidden="true">{milestone.glyph}</span>
							<span className="sr-only">{milestone.label}</span>
						</span>
					)}
				</div>
			</div>

			<div className="card__info">
				<p className="card__title" title={game.title}>
					{game.title}
				</p>
				<div className="card__meta">
					<StatusPopover game={game} />
					{game.owned && <span className="card__owned">OWNED</span>}
				</div>
				{game.genres.length > 0 && (
					<p className="card__genres">{game.genres.join(' · ')}</p>
				)}
			</div>

			{detailOpen && <DetailPanel game={game} onClose={closeDetail} />}
		</div>
	);
}
