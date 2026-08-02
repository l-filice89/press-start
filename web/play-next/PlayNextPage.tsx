import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { PlayNextSuggestion } from '../../src/core';
import { getPlayNextSuggestions } from '../../src/core';
import { SkeletonGrid } from '../components/Skeleton';
import { fetchShelf } from '../shelf/api';
import { toDetail } from '../shelf/detail-navigation';
import { SuggestionCard } from './SuggestionCard';
import './play-next.css';

export function PlayNextPage() {
	const { data, isPending, isError } = useQuery({
		queryKey: ['shelf'],
		queryFn: ({ signal }) => fetchShelf(signal),
	});
	const [referenceIso] = useState(() => new Date().toISOString().slice(0, 10));
	const [visitSeed] = useState(() => crypto.randomUUID());
	const [suggestions, setSuggestions] = useState<
		readonly PlayNextSuggestion[] | null
	>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const navigate = useNavigate();
	const location = useLocation();
	useEffect(() => {
		headingRef.current?.focus();
	}, []);
	useEffect(() => {
		if (data && suggestions === null) {
			setSuggestions(
				getPlayNextSuggestions(data, {
					referenceIso,
					visitSeed,
				}),
			);
		}
	}, [data, referenceIso, suggestions, visitSeed]);
	const slate = suggestions ?? [];
	const suggestionsLoading = isPending || (!isError && suggestions === null);

	return (
		<section
			className="play-next"
			aria-labelledby="play-next-heading"
			data-play-next-visit={visitSeed}
		>
			<header className="play-next__header">
				<div>
					<h1 id="play-next-heading" ref={headingRef} tabIndex={-1}>
						WHAT NEXT?
					</h1>
					<span className="play-next__mode">SURPRISE ME</span>
				</div>
				<p>Three picks from your Shelf</p>
			</header>
			{suggestionsLoading ? (
				<SkeletonGrid label="Loading Play Next suggestions" />
			) : isError ? (
				<p role="alert" className="play-next__error">
					Your shelf couldn’t load. Refresh to try again.
				</p>
			) : slate.length === 0 ? (
				<div className="play-next__empty">
					<h2>NO PICKS YET</h2>
					<p>Add an owned or currently available PS+ game to your Shelf.</p>
				</div>
			) : (
				<>
					{slate.length < 3 && (
						<p className="play-next__notice" role="status">
							{`Only ${slate.length} ${slate.length === 1 ? 'suggestion fits' : 'suggestions fit'} the current eligibility rules.`}
						</p>
					)}
					<div className="play-next__grid">
						{slate.map((suggestion) => (
							<SuggestionCard
								key={suggestion.game.id}
								suggestion={suggestion}
								referenceIso={referenceIso}
								onPlayed={() => void navigate('/')}
								onOpenDetails={() =>
									void navigate(...toDetail(suggestion.game.id, location))
								}
							/>
						))}
					</div>
				</>
			)}
		</section>
	);
}
