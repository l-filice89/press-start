import type { PlayNextSuggestion } from '../../src/core';
import type { ShelfGame } from '../shelf/api';
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
	const { selectStatus, statusPending } = useTrackingMutations(game, {
		onStatusSuccess: onPlayed,
	});
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
		<article
			className="play-next-card"
			data-play-next-game-id={game.id}
			tabIndex={-1}
		>
			<div className="play-next-card__cover">
				{game.coverUrl ? (
					<img src={game.coverUrl} alt="" loading="lazy" decoding="async" />
				) : (
					<span aria-hidden="true">▹</span>
				)}
			</div>
			<div className="play-next-card__content">
				<div className="play-next-card__title-row">
					<h2>{game.title}</h2>
					<span className="play-next-card__access">{suggestion.accessTag}</span>
				</div>
				<p className="play-next-card__reason">{suggestion.primaryReason}</p>
				{facts.length > 0 && (
					<ul className="play-next-card__facts" aria-label="Known facts">
						{facts.map((fact) => (
							<li key={fact.key}>{fact.value}</li>
						))}
					</ul>
				)}
				<p className="play-next-card__explanation">{suggestion.explanation}</p>
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
	);
}
