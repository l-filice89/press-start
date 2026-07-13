import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../components/Toast';
import { useModalTrap } from '../components/useModalTrap';
import { type IgdbCandidate, rematchGame, searchIgdb } from './api';
import './stragglers-dialog.css';

/**
 * Rematch a wrongly-matched game (PV-4) — the detail-panel correction for a
 * same-name mismatch (PV-1) and the cleanup path for already-wrong covers
 * (PV-5). A title-seeded IGDB search; picking a candidate re-points the game's
 * IGDB link and overwrites its cover/date/title/genres in place. Reuses the
 * games-DB search seam and the stragglers picker's markup/CSS.
 *
 * ponytail: deliberately near-duplicates StragglersDialog's ResolveView rather
 * than sharing a component — that view is entangled with the import/unenriched
 * straggler kinds and its own resolve mutation. Two callers ≠ three; extract a
 * shared `<IgdbMatchPicker>` only if a third picker appears.
 */
export function RematchDialog({
	game,
	onClose,
	onRematched,
}: {
	game: { id: string; title: string };
	onClose: () => void;
	onRematched: () => void | Promise<void>;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const headingId = useId();
	const { toast } = useToast();
	const onKeyDown = useModalTrap(dialogRef, onClose);

	const [term, setTerm] = useState(game.title);
	// Committed query — set on submit so a keystroke doesn't fire an IGDB call.
	const [query, setQuery] = useState(game.title);

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

	const mutation = useMutation({
		mutationFn: (candidate: IgdbCandidate) =>
			rematchGame(game.id, {
				igdbId: candidate.igdbId,
				name: candidate.name,
				coverUrl: candidate.coverUrl,
				releaseDate: candidate.releaseDate,
				genres: candidate.genres,
			}),
		onSuccess: onRematched,
		// A 409 means the pick already anchors another library game (AD-20) — say
		// so specifically; any other failure (404/network) gets the generic retry.
		onError: (err) => {
			const status = (err as { status?: number }).status;
			toast({
				message:
					status === 409
						? 'That game is already in your library under a different entry.'
						: `Couldn’t update ${game.title}. Try again.`,
			});
		},
	});

	const empty = query.trim() !== '' && !isFetching && candidates.length === 0;

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Back button are the accessible paths; this only mirrors them for pointer users.
		<div
			className="stragglers__backdrop"
			data-testid="rematch-backdrop"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				tabIndex={-1}
				className="stragglers"
				data-testid="rematch-dialog"
				onKeyDown={onKeyDown}
			>
				<h2 id={headingId} className="stragglers__heading">
					Pick the right match for “{game.title}”
				</h2>

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
										data-testid="rematch-candidate-cover"
									/>
								)}
								<span className="stragglers__candidate-name">
									{c.name}
									{c.releaseDate ? ` (${c.releaseDate.slice(0, 4)})` : ''}
								</span>
								<button
									type="button"
									className="stragglers__use tap-target"
									disabled={mutation.isPending}
									onClick={() => mutation.mutate(c)}
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
							onClick={onClose}
						>
							Back
						</button>
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
