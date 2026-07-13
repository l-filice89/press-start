import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type IgdbCandidate, searchIgdb } from './api';
import './stragglers-dialog.css';

/**
 * The one IGDB candidate picker (Story 6.6 / PV-6). Extracted from
 * `RematchDialog` once the add modal became the third caller — the trigger the
 * old "two callers ≠ three" comment named. Presentational by design: it owns
 * the search term, the committed query and the candidate list; every caller
 * keeps its own mutation and its own dialog shell/trap, because what a pick
 * *means* differs (re-point a game / resolve a straggler / overwrite a draft).
 *
 * The only UI consumer of `searchIgdb`.
 */
export function IgdbMatchPicker({
	initialTerm,
	onPick,
	onBack,
	backLabel = 'Back',
	pending = false,
	coverTestId,
}: {
	initialTerm: string;
	onPick: (candidate: IgdbCandidate) => void;
	onBack: () => void;
	backLabel?: string;
	pending?: boolean;
	/** The two migrated suites assert different cover ids — keep both green. */
	coverTestId?: string;
}) {
	const [term, setTerm] = useState(initialTerm);
	// Committed query — set on submit so a keystroke doesn't fire an IGDB call.
	const [query, setQuery] = useState(initialTerm);

	const {
		data: candidates = [],
		isFetching,
		isError,
	} = useQuery({
		queryKey: ['igdb-search', query],
		queryFn: ({ signal }) => searchIgdb(query, signal),
		enabled: query.trim() !== '',
		staleTime: 60_000,
		retry: false,
	});

	const empty = query.trim() !== '' && !isFetching && candidates.length === 0;

	return (
		<div className="stragglers__resolve-view">
			<form
				className="stragglers__search"
				onSubmit={(e) => {
					e.preventDefault();
					setQuery(term);
				}}
			>
				<label className="stragglers__field">
					<span>Search the games DB</span>
					<input
						type="text"
						value={term}
						maxLength={200}
						onChange={(e) => setTerm(e.target.value)}
					/>
				</label>
				<button type="submit" className="stragglers__search-btn tap-target">
					Search
				</button>
			</form>

			{isFetching && (
				<p className="stragglers__notice" role="status">
					Searching…
				</p>
			)}
			{(isError || empty) && (
				<p className="stragglers__notice" role="status">
					No games-DB match found — it may be down, or try a different name.
				</p>
			)}

			<ul className="stragglers__candidates">
				{candidates.map((c) => (
					<li key={c.igdbId} className="stragglers__candidate">
						{c.coverUrl && (
							<img
								className="stragglers__cover"
								src={c.coverUrl}
								alt=""
								data-testid={coverTestId}
							/>
						)}
						<span className="stragglers__candidate-name">
							{c.name}
							{c.releaseDate ? ` (${c.releaseDate.slice(0, 4)})` : ''}
						</span>
						<button
							type="button"
							className="stragglers__use tap-target"
							disabled={pending}
							onClick={() => onPick(c)}
						>
							Use this match
						</button>
					</li>
				))}
			</ul>

			<div className="stragglers__actions">
				<button
					type="button"
					className="stragglers__close tap-target"
					onClick={onBack}
				>
					{backLabel}
				</button>
			</div>
		</div>
	);
}
