import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../components/Toast';
import { useModalTrap } from '../components/useModalTrap';
import { addGame, fetchAddPreview } from './api';
import { openDetail } from './open-detail';
import './add-game-dialog.css';

/**
 * The add-by-name preview (Story 6.1, FR-41/43, UX-DR16/18): opened from the
 * search bar's `＋ Add "<name>"` row, pre-filled from IGDB, everything
 * editable, nothing committed until Save. The CTA names the outcome ("Add to
 * wishlist" / "Add as owned"); a duplicate answer (409) opens the existing
 * game's detail view instead of erroring (FR-42). When the games DB is down
 * or has no match, the fields stay name-only and Save still works — the
 * unenriched path Story 6.2's stragglers list builds on (NFR-4).
 */
export function AddGameDialog({
	title,
	onClose,
}: {
	title: string;
	onClose: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const titleRef = useRef<HTMLInputElement>(null);
	const headingId = useId();
	const queryClient = useQueryClient();
	const { toast } = useToast();

	const {
		data: preview,
		isPending: previewPending,
		isError: previewError,
	} = useQuery({
		queryKey: ['add-preview', title],
		queryFn: ({ signal }) => fetchAddPreview(title, signal),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});

	// Editable draft, seeded from the typed name and re-seeded ONCE when the
	// IGDB candidate arrives (the preview resolves in well under a second, so
	// clobbering pre-arrival edits is a non-issue at this scale).
	const [draftTitle, setDraftTitle] = useState(title);
	const [releaseDate, setReleaseDate] = useState('');
	const [genresText, setGenresText] = useState('');
	const [coverUrl, setCoverUrl] = useState('');
	const [owned, setOwned] = useState(false);
	const seeded = useRef(false);
	useEffect(() => {
		const candidate = preview?.candidate;
		if (!candidate || seeded.current) return;
		seeded.current = true;
		setDraftTitle(candidate.name);
		setReleaseDate(candidate.releaseDate ?? '');
		setGenresText(candidate.genres.join(', '));
		setCoverUrl(candidate.coverUrl ?? '');
	}, [preview]);

	const onKeyDown = useModalTrap(dialogRef, onClose, {
		initialFocusRef: titleRef,
	});

	const mutation = useMutation({
		mutationFn: addGame,
		onSuccess: async (result) => {
			if (result.kind === 'duplicate') {
				// A duplicate may be a REVIVED discard: re-adding the name clears the
				// soft-delete tombstone server-side, so the just-revived card isn't in
				// the shelf cache yet. Kick the refetch FIRST (marks the shelf query
				// fetching), THEN open detail — the shelf holds a not-yet-present id
				// while it is refetching and opens the panel once the revived card
				// lands (Shelf.tsx stale-id guard). Not awaited, so the open is queued
				// against the in-flight fetch rather than a settled empty payload.
				toast({ message: 'Already in your library.' });
				queryClient.invalidateQueries({ queryKey: ['shelf'] });
				onClose();
				openDetail(result.gameId);
				return;
			}
			toast({
				message: `${draftTitle.trim()} — added${owned ? '' : ' to wishlist'}`,
			});
			// Refetch before closing so the game is on the shelf when focus lands.
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['shelf'] }),
				queryClient.invalidateQueries({ queryKey: ['genres'] }),
			]);
			onClose();
		},
		onError: () => toast({ message: `Couldn’t add ${draftTitle}. Try again.` }),
	});

	function save() {
		// Block until the preview settles: saving mid-flight would POST name-only
		// and silently drop an IGDB match still in flight.
		if (mutation.isPending || previewPending || !draftTitle.trim()) return;
		const candidate = preview?.candidate;
		mutation.mutate({
			title: draftTitle,
			// ponytail: the IGDB id sticks even if the title is edited — an
			// edition tweak keeps the right identity; retyping a different game
			// entirely is rare enough to not special-case yet.
			...(candidate ? { igdbId: candidate.igdbId } : {}),
			coverUrl: coverUrl.trim() || null,
			releaseDate: releaseDate || null,
			genres: genresText
				.split(',')
				.map((g) => g.trim())
				.filter(Boolean),
			owned,
		});
	}

	// A thrown preview fetch (network/5xx) is the same story as a graceful
	// {available:false}: no candidate, save the name only (NFR-4) — show the
	// notice instead of a bare, unexplained form.
	const unavailable = previewError || (preview && !preview.available);
	const noMatch = preview?.available && !preview.candidate;

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Cancel button are the accessible paths; this only mirrors them for pointer users.
		<div
			className="add-game__backdrop"
			data-testid="add-game-backdrop"
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
				className="add-game"
				data-testid="add-game-dialog"
				onKeyDown={onKeyDown}
			>
				<h2 id={headingId} className="add-game__heading">
					Add a game
				</h2>

				{previewPending && (
					<p className="add-game__notice" role="status">
						Checking the games DB…
					</p>
				)}
				{unavailable && (
					<p className="add-game__notice" role="status">
						Games DB unavailable — saving the name only. You can enrich it
						later.
					</p>
				)}
				{noMatch && (
					<p className="add-game__notice" role="status">
						No games-DB match — saving the name only.
					</p>
				)}

				<div className="add-game__body">
					{coverUrl.trim() !== '' && (
						<img
							className="add-game__cover"
							src={coverUrl}
							alt=""
							data-testid="add-game-cover"
						/>
					)}
					<div className="add-game__fields">
						<label className="add-game__field">
							<span>Title</span>
							<input
								ref={titleRef}
								type="text"
								value={draftTitle}
								maxLength={200}
								onChange={(e) => setDraftTitle(e.target.value)}
							/>
						</label>
						<label className="add-game__field">
							<span>Release date</span>
							<input
								type="date"
								value={releaseDate}
								onChange={(e) => setReleaseDate(e.target.value)}
							/>
						</label>
						<label className="add-game__field">
							<span>Genres (comma-separated)</span>
							<input
								type="text"
								value={genresText}
								onChange={(e) => setGenresText(e.target.value)}
							/>
						</label>
						<label className="add-game__field">
							<span>Cover URL</span>
							<input
								type="url"
								value={coverUrl}
								onChange={(e) => setCoverUrl(e.target.value)}
							/>
						</label>
						<label className="add-game__owned">
							<input
								type="checkbox"
								checked={owned}
								onChange={(e) => setOwned(e.target.checked)}
							/>
							<span>I own this game</span>
						</label>
					</div>
				</div>

				<div className="add-game__actions">
					<button
						type="button"
						className="add-game__cancel tap-target"
						onClick={onClose}
					>
						Cancel
					</button>
					<button
						type="button"
						className="add-game__save tap-target"
						disabled={
							mutation.isPending || previewPending || !draftTitle.trim()
						}
						onClick={save}
					>
						{owned ? 'Add as owned' : 'Add to wishlist'}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
