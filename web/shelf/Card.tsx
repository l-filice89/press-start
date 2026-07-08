import { type KeyboardEvent, useState } from 'react';
import type { ShelfGame } from './api';
import { StatePill } from './StatePill';
import './card.css';

/**
 * A single shelf card (read-only in this epic — no flip, no edit). Cover-forward
 * (3:4), a top-left flag cluster, and an info strip below. Every visual signal
 * has an accessible text equivalent (flag glyphs are `aria-hidden` with a
 * visually-hidden label beside them), and the whole card is a single roving tab
 * stop in the grid (UX-DR19).
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
					<StatePill state={game.effectiveState} />
					{game.owned && <span className="card__owned">OWNED</span>}
				</div>
				{game.genres.length > 0 && (
					<p className="card__genres">{game.genres.join(' · ')}</p>
				)}
			</div>
		</div>
	);
}
