import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { PlayNextIntent, PlayNextSuggestion } from '../../src/core';
import { EMPTY_PLAY_NEXT_INTENT, getPlayNextSuggestions } from '../../src/core';
import { useAnnounce } from '../components/LiveRegion';
import { SkeletonGrid } from '../components/Skeleton';
import { fetchShelf, type ShelfGame } from '../shelf/api';
import { toDetail } from '../shelf/detail-navigation';
import { SuggestionCard } from './SuggestionCard';
import { TunePanel } from './TunePanel';
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
	const [visitGames, setVisitGames] = useState<typeof data>(undefined);
	const [draftIntent, setDraftIntent] = useState<PlayNextIntent>(() => ({
		...EMPTY_PLAY_NEXT_INTENT,
	}));
	const [activeIntent, setActiveIntent] = useState<PlayNextIntent>(() => ({
		...EMPTY_PLAY_NEXT_INTENT,
	}));
	const [seenGameIds, setSeenGameIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [resetArmed, setResetArmed] = useState(false);
	const [tuneOpen, setTuneOpen] = useState(false);
	const [pendingGameIds, setPendingGameIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const generationRef = useRef(0);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const shuffleRef = useRef<HTMLButtonElement>(null);
	const announce = useAnnounce();
	const navigate = useNavigate();
	const location = useLocation();
	useEffect(() => {
		headingRef.current?.focus();
	}, []);
	useEffect(() => {
		if (data && suggestions === null) {
			const initial = getPlayNextSuggestions(data, {
				referenceIso,
				visitSeed,
			});
			setVisitGames(data);
			setSuggestions(initial);
			setSeenGameIds(new Set(initial.map((item) => item.game.id)));
		}
	}, [data, referenceIso, suggestions, visitSeed]);
	const activeLabels = useMemo(
		() => intentLabels(activeIntent),
		[activeIntent],
	);
	const activeCount = activeLabels.length;
	const draftDirty =
		JSON.stringify(draftIntent) !== JSON.stringify(activeIntent);
	const applyDraft = () => {
		if (!visitGames) return;
		generationRef.current += 1;
		const next = getPlayNextSuggestions(visitGames, {
			referenceIso,
			visitSeed: `${visitSeed}:tune:${generationRef.current}`,
			intent: draftIntent,
		});
		setActiveIntent({ ...draftIntent });
		setSuggestions(next);
		setSeenGameIds((seen) => unionIds(seen, next));
		setResetArmed(false);
		setTuneOpen(false);
		announce(
			`${next.length} ${next.length === 1 ? 'suggestion' : 'suggestions'} ready.`,
		);
	};
	const slate = suggestions ?? [];
	const shuffle = () => {
		if (!visitGames || slate.length === 0) return;
		generationRef.current += 1;
		const visibleIds = new Set(slate.map((item) => item.game.id));
		const next = getPlayNextSuggestions(visitGames, {
			referenceIso,
			visitSeed: `${visitSeed}:shuffle:${generationRef.current}`,
			intent: activeIntent,
			excludedGameIds: resetArmed ? visibleIds : seenGameIds,
		});
		if (next.length === 0) {
			setResetArmed(true);
			announce('0 new suggestions ready. Current picks kept.');
			shuffleRef.current?.focus();
			return;
		}
		setSuggestions(next);
		const nextSeen = resetArmed
			? new Set(next.map((item) => item.game.id))
			: unionIds(seenGameIds, next);
		setSeenGameIds(nextSeen);
		const hasFurtherUnseen =
			getPlayNextSuggestions(visitGames, {
				referenceIso,
				visitSeed: `${visitSeed}:shuffle:${generationRef.current}:probe`,
				limit: 1,
				intent: activeIntent,
				excludedGameIds: nextSeen,
			}).length > 0;
		setResetArmed(next.length < 3 && !hasFurtherUnseen);
		announce(
			`${next.length} ${next.length === 1 ? 'suggestion' : 'suggestions'} ready.`,
		);
		shuffleRef.current?.focus();
	};
	const suggestionsLoading = isPending || (!isError && suggestions === null);
	const setCardPending = useCallback((gameId: string, pending: boolean) => {
		setPendingGameIds((current) => {
			const next = new Set(current);
			if (pending) next.add(gameId);
			else next.delete(gameId);
			return next;
		});
	}, []);

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
					<span className="play-next__applied">APPLIED INTENT</span>
					<span className="play-next__mode">
						{activeLabels.length > 0 ? activeLabels.join(' · ') : 'SURPRISE ME'}
					</span>
				</div>
				<div className="play-next__controls">
					<div className="play-next__command-row">
						<button
							ref={shuffleRef}
							type="button"
							className="play-next__shuffle"
							disabled={
								!visitGames || slate.length === 0 || pendingGameIds.size > 0
							}
							onClick={shuffle}
						>
							SHUFFLE
						</button>
						<button
							type="button"
							className="tune-trigger"
							data-active={activeCount > 0 || undefined}
							aria-haspopup="dialog"
							aria-expanded={tuneOpen}
							aria-controls="play-next-tune-dialog"
							aria-label={
								activeCount > 0
									? `Tune the picks — ${activeCount} active`
									: 'Tune the picks'
							}
							disabled={!visitGames || pendingGameIds.size > 0}
							onClick={() => setTuneOpen(true)}
						>
							<span className="tune-trigger__label">TUNE THE PICKS</span>
							{activeCount > 0 && (
								<span className="tune-trigger__count" aria-hidden="true">
									{activeCount}
								</span>
							)}
						</button>
					</div>
					{resetArmed && (
						<p className="play-next__shuffle-warning" role="status">
							You’ve seen every other match. Next Shuffle starts a fresh pool.
						</p>
					)}
					<p>Three picks from your Shelf</p>
				</div>
			</header>
			{tuneOpen && (
				<TunePanel
					draft={draftIntent}
					dirty={draftDirty}
					onChange={setDraftIntent}
					onApply={applyDraft}
					onClose={() => setTuneOpen(false)}
				/>
			)}
			{suggestionsLoading ? (
				<SkeletonGrid label="Loading Play Next suggestions" />
			) : isError ? (
				<p role="alert" className="play-next__error">
					Your shelf couldn’t load. Refresh to try again.
				</p>
			) : slate.length === 0 ? (
				<div className="play-next__empty">
					<h2>NO PICKS YET</h2>
					<p>
						{activeCount > 0
							? 'No eligible Shelf games match the applied intent.'
							: 'Add an owned or currently available PS+ game to your Shelf.'}
					</p>
				</div>
			) : (
				<>
					{slate.length < 3 && !resetArmed && (
						<p className="play-next__notice" role="status">
							{`Only ${slate.length} ${slate.length === 1 ? 'suggestion fits' : 'suggestions fit'} the current eligibility rules.`}
						</p>
					)}
					<div className="play-next__grid">
						{slate.map((suggestion) => (
							<SuggestionCard
								key={suggestion.game.id}
								suggestion={reconcileOwnership(
									suggestion,
									data?.find((game) => game.id === suggestion.game.id),
								)}
								referenceIso={referenceIso}
								onPlayed={() =>
									void navigate('/', {
										state: { playNextFocusGameId: suggestion.game.id },
									})
								}
								onOpenDetails={() =>
									void navigate(...toDetail(suggestion.game.id, location))
								}
								onPendingChange={setCardPending}
							/>
						))}
					</div>
				</>
			)}
		</section>
	);
}

function unionIds(
	seen: ReadonlySet<string>,
	suggestions: readonly PlayNextSuggestion[],
): ReadonlySet<string> {
	const next = new Set(seen);
	for (const suggestion of suggestions) next.add(suggestion.game.id);
	return next;
}

/** Keep recommendation facts/reasons frozen to the visit snapshot. Only the
 * ownership control's own mutable state may reconcile after its guarded write. */
function reconcileOwnership(
	suggestion: PlayNextSuggestion,
	liveGame: ShelfGame | undefined,
): PlayNextSuggestion {
	if (!liveGame || liveGame.owned === suggestion.game.owned) return suggestion;
	const accessTag = liveGame.owned
		? 'OWNED'
		: liveGame.psPlusExtra
			? 'PS+ EXTRA'
			: liveGame.wishlisted
				? 'DISCOVER'
				: null;
	// An un-own that removes all access makes this visit snapshot stale. Preserve
	// its internally consistent card until the next generation instead of
	// inventing a NO ACCESS recommendation or changing the slate under focus.
	if (!accessTag) return suggestion;
	return {
		...suggestion,
		accessTag,
		game: {
			...suggestion.game,
			owned: liveGame.owned,
			ownedVia: liveGame.ownedVia,
			ownershipType: liveGame.ownershipType,
		} as ShelfGame,
	};
}

function intentLabels(intent: PlayNextIntent): string[] {
	return [
		intent.genre,
		intent.time,
		intent.backlogAge,
		intent.priority,
		intent.progress,
		intent.includeWishlist ? 'INCLUDE WISHLIST' : null,
	]
		.filter((label): label is string => label !== null)
		.map((label) => label.toUpperCase());
}
