import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../components/Toast';
import { useModalTrap } from '../components/useModalTrap';
import {
	fetchStragglers,
	type IgdbCandidate,
	resolveStraggler,
	type Straggler,
	searchIgdb,
} from './api';
import './stragglers-dialog.css';

/**
 * The stragglers list + resolution flow (Story 6.2, FR-28/29). Opened from the
 * amber attention banner. One portal holds two views: the list of games needing
 * a match (import staging rows + name-only adds) and — once one is picked — a
 * manual IGDB search where the user chooses the right match. Confirming resolves
 * it (permanent IGDB link server-side) and refreshes the shelf/banner. When
 * IGDB is down/unset the search returns nothing and says so — the straggler
 * stays put (NFR-4).
 */
export function StragglersDialog({ onClose }: { onClose: () => void }) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const headingId = useId();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const onKeyDown = useModalTrap(dialogRef, onClose);

	const [selected, setSelected] = useState<Straggler | null>(null);

	const { data: stragglers = [], isPending } = useQuery({
		queryKey: ['stragglers'],
		queryFn: ({ signal }) => fetchStragglers(signal),
	});

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Close button are the accessible paths; this only mirrors them for pointer users.
		<div
			className="stragglers__backdrop"
			data-testid="stragglers-backdrop"
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
				data-testid="stragglers-dialog"
				onKeyDown={onKeyDown}
			>
				<h2 id={headingId} className="stragglers__heading">
					{selected
						? `Find a match for “${selected.title}”`
						: 'Resolve stragglers'}
				</h2>

				{selected ? (
					<ResolveView
						straggler={selected}
						onCancel={() => setSelected(null)}
						onResolved={async () => {
							toast({ message: `${selected.title} — matched` });
							setSelected(null);
							await Promise.all([
								queryClient.invalidateQueries({ queryKey: ['stragglers'] }),
								queryClient.invalidateQueries({ queryKey: ['shelf'] }),
								queryClient.invalidateQueries({ queryKey: ['shelf-search'] }),
								queryClient.invalidateQueries({ queryKey: ['settings'] }),
								queryClient.invalidateQueries({ queryKey: ['genres'] }),
							]);
						}}
						onError={() => {
							toast({
								message: `Couldn’t resolve ${selected.title}. Try again.`,
							});
							setSelected(null);
							queryClient.invalidateQueries({ queryKey: ['stragglers'] });
						}}
					/>
				) : (
					<>
						{isPending && <p className="stragglers__notice">Loading…</p>}
						{!isPending && stragglers.length === 0 && (
							<p className="stragglers__notice" role="status">
								Nothing to resolve — every game has a match.
							</p>
						)}
						<ul className="stragglers__list">
							{stragglers.map((s) => (
								<li key={`${s.kind}:${s.id}`} className="stragglers__row">
									<span className="stragglers__title">{s.title}</span>
									<span className="stragglers__kind">
										{s.kind === 'import' ? 'import' : 'name-only'}
									</span>
									<button
										type="button"
										className="stragglers__resolve tap-target"
										onClick={() => setSelected(s)}
									>
										Find a match
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
								Close
							</button>
						</div>
					</>
				)}
			</div>
		</div>,
		document.body,
	);
}

function ResolveView({
	straggler,
	onCancel,
	onResolved,
	onError,
}: {
	straggler: Straggler;
	onCancel: () => void;
	onResolved: () => void | Promise<void>;
	onError: () => void;
}) {
	const [term, setTerm] = useState(straggler.title);
	// Committed query — set on submit so a keystroke doesn't fire an IGDB call.
	const [query, setQuery] = useState(straggler.title);

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
			resolveStraggler({
				id: straggler.id,
				kind: straggler.kind,
				igdbId: candidate.igdbId,
				name: candidate.name,
				coverUrl: candidate.coverUrl,
				releaseDate: candidate.releaseDate,
				genres: candidate.genres,
			}),
		onSuccess: onResolved,
		// A stale straggler (404 — resolved elsewhere), a rejected field (400), or
		// a network drop must not silently no-op: tell the user and refresh the
		// list so a dead row drops out.
		onError,
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
								data-testid="straggler-candidate-cover"
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
					onClick={onCancel}
				>
					Back
				</button>
			</div>
		</div>
	);
}
