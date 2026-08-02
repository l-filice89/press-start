import { useState } from 'react';
import type { PlayNextSuggestion } from '../../src/core';
import type { ShelfGame } from '../shelf/api';
import { formatLeavingDate, showLeaving } from '../shelf/leaving';
import { OwnershipSourceDialog } from '../shelf/OwnershipSourceDialog';
import { useTrackingMutations } from '../shelf/useTrackingMutations';

function hours(seconds: number): string {
	return `${Math.round(seconds / 3600)}h story`;
}

export function SuggestionCard({
	suggestion,
	referenceIso,
	onOpenDetails,
	onPlayed,
}: {
	suggestion: PlayNextSuggestion;
	referenceIso: string;
	onOpenDetails: () => void;
	onPlayed: () => void;
}) {
	const game = suggestion.game as ShelfGame;
	const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
	const {
		selectStatus,
		statusPending,
		setOwnership,
		sourcePrompt,
		confirmSource,
		cancelSource,
	} = useTrackingMutations(game, { onStatusSuccess: onPlayed });
	const showCover = !!game.coverUrl && failedCoverUrl !== game.coverUrl;
	const facts = [
		game.genres[0] ? { key: 'genre', value: game.genres[0] } : null,
		game.ttbStorySeconds !== null &&
		Number.isFinite(game.ttbStorySeconds) &&
		game.ttbStorySeconds >= 0
			? { key: 'ttb', value: hours(game.ttbStorySeconds) }
			: null,
		game.criticScore !== null
			? { key: 'critic', value: `Critic ${Math.round(game.criticScore)}` }
			: null,
		game.userScore !== null
			? { key: 'user', value: `User ${Math.round(game.userScore)}` }
			: null,
		game.psPlusLeavingOn && game.psPlusLeavingOn >= referenceIso
			? { key: 'leaving', value: `Leaves ${game.psPlusLeavingOn}` }
			: null,
	].filter((fact): fact is { key: string; value: string } => fact !== null);

	return (
		<>
			<article
				className="play-next-card"
				data-play-next-game-id={game.id}
				tabIndex={-1}
			>
				<div className="play-next-card__cover">
					<button
						type="button"
						className="play-next-card__cover-button"
						aria-label={`Open details — ${game.title}`}
						onClick={onOpenDetails}
					>
						{showCover ? (
							<img
								className="play-next-card__cover-img"
								src={game.coverUrl ?? undefined}
								alt=""
								loading="lazy"
								decoding="async"
								onError={() => setFailedCoverUrl(game.coverUrl)}
							/>
						) : (
							<span
								className="play-next-card__cover-fallback"
								aria-hidden="true"
							>
								▹
							</span>
						)}
					</button>
					<button
						type="button"
						className="play-next-card__owned-toggle"
						aria-pressed={game.owned}
						aria-label={`Owned — ${game.title}`}
						onClick={() => setOwnership({ owned: !game.owned })}
					>
						<span aria-hidden="true">{game.owned ? '◆' : '◇'}</span>
					</button>
					<div className="play-next-card__flags">
						{game.psPlusExtra && !game.owned && (
							<span className="play-next-card__flag play-next-card__flag--ps-extra">
								<span aria-hidden="true">◈ PS+</span>
								<span className="sr-only">
									In the PlayStation Plus Extra catalog
								</span>
							</span>
						)}
						{showLeaving(game.psPlusLeavingOn, game.owned) && (
							<span className="play-next-card__flag play-next-card__flag--leaving">
								<span aria-hidden="true">
									LEAVING {formatLeavingDate(game.psPlusLeavingOn)}
								</span>
								<span className="sr-only">
									Leaving the PlayStation Plus Extra catalog on{' '}
									{game.psPlusLeavingOn}
								</span>
							</span>
						)}
					</div>
				</div>
				<div className="play-next-card__content">
					<div className="play-next-card__title-row">
						<h2 title={game.title}>{game.title}</h2>
						<span className="play-next-card__access">
							{suggestion.accessTag}
						</span>
					</div>
					<p className="play-next-card__reason">{suggestion.primaryReason}</p>
					{suggestion.closestMatch && (
						<p className="play-next-card__closest">CLOSEST MATCH</p>
					)}
					{facts.length > 0 && (
						<ul className="play-next-card__facts" aria-label="Known facts">
							{facts.map((fact) => (
								<li key={fact.key}>{fact.value}</li>
							))}
						</ul>
					)}
					<p className="play-next-card__explanation">
						{suggestion.explanation}
					</p>
					<ul className="play-next-card__factors" aria-label="Score factors">
						{suggestion.factors.map((factor) => (
							<li key={factor.code}>{`${factor.code} +${factor.points}`}</li>
						))}
					</ul>
					<div className="play-next-card__actions">
						<button
							type="button"
							disabled={statusPending}
							onClick={() => selectStatus('Playing')}
						>
							Play this
						</button>
						<button
							type="button"
							disabled={statusPending}
							onClick={onOpenDetails}
						>
							Open details
						</button>
					</div>
				</div>
			</article>
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
