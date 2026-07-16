import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useToast } from '../components/Toast';
import { useModalTrap } from '../components/useModalTrap';
import {
	addGame,
	candidateScores,
	fetchAddPreview,
	type IgdbCandidate,
} from './api';
import { toDetail, useActiveDestination } from './detail-navigation';
import { IgdbMatchPicker } from './IgdbMatchPicker';
import { ScoreBadges } from './ScoreBadges';
import './add-game-dialog.css';
import './stragglers-dialog.css';

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
	navigateToDetail = false,
	prefill,
}: {
	title: string;
	onClose: () => void;
	/** Land on the new game's detail after a successful add — the CATALOG add
	 * path (Story 7.2): there is no catalog detail page, so the real, editable
	 * one is where the flow ends. The shelf add stays where it is. */
	navigateToDetail?: boolean;
	/**
	 * Facts the CALLER already knows (Story 7.3). Two plain values, not a catalog
	 * row: a cover to show before IGDB answers (and to fall back on when its match
	 * has none), and a PS Store product id passed straight through to the add
	 * payload — which already carries it (`AddGamePayload.psnProductId`). The
	 * dialog never learns what a catalog is: no fetch, no product lookup, no
	 * catalog type imported. Any future caller with the same two facts gets the
	 * same behaviour.
	 */
	prefill?: { coverUrl?: string | null; psnProductId?: string };
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const titleRef = useRef<HTMLInputElement>(null);
	const headingId = useId();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	// The destination the dialog was opened OVER — the shelf when the search bar
	// raised it, the CATALOG when a catalog card did. Both detail navigations below
	// carry it, so the detail surfaces over the destination you are still on.
	const destination = useActiveDestination();
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
	const prefilledCover = prefill?.coverUrl ?? '';
	/** Opened from a store product (the catalog) — see the owned toggle below. */
	const fromProduct = Boolean(prefill?.psnProductId);
	const [draftTitle, setDraftTitle] = useState(title);
	const [releaseDate, setReleaseDate] = useState('');
	const [genresText, setGenresText] = useState('');
	const [coverUrl, setCoverUrl] = useState(prefilledCover);
	const [owned, setOwned] = useState(false);
	const seeded = useRef(false);
	// The candidate the user corrected to (Story 6.6 / PV-6) — it replaces the
	// auto-match wholesale, including the igdbId Save sends.
	const [picked, setPicked] = useState<IgdbCandidate | null>(null);
	const [picking, setPicking] = useState(false);

	function applyCandidate(candidate: IgdbCandidate) {
		// The prior draft was edits to the WRONG game — overwrite it whole, and
		// close the seeding gate so the in-flight preview can't clobber the pick.
		seeded.current = true;
		setDraftTitle(candidate.name);
		setReleaseDate(candidate.releaseDate ?? '');
		setGenresText(candidate.genres.join(', '));
		// A match with NO cover must not blank a cover the caller supplied — the
		// game would land on the shelf as a grey tile with an art URL one field away.
		setCoverUrl(candidate.coverUrl ?? prefilledCover);
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: seeds off the preview alone — applyCandidate is re-created every render and only ever writes state, so listing it would re-run this on every render for nothing (the `seeded` gate makes it a no-op anyway).
	useEffect(() => {
		const candidate = preview?.candidate;
		if (!candidate || seeded.current) return;
		applyCandidate(candidate);
	}, [preview]);

	const onKeyDown = useModalTrap(dialogRef, onClose, {
		initialFocusRef: titleRef,
		// The stacked picker owns Escape while it is open (Story 3.5 rule).
		enabled: !picking,
	});

	const mutation = useMutation({
		mutationFn: addGame,
		onSuccess: async (result) => {
			if (result.kind === 'duplicate') {
				// A duplicate may be a REVIVED discard: re-adding the name clears the
				// soft-delete tombstone server-side. Story 7.2 (AD-25): the detail is
				// ROUTED and resolves through `GET /api/games/:id`, so it no longer
				// depends on the game having landed in the `['shelf']` list cache —
				// the whole "hold the id while the shelf refetches" dance is gone with
				// the window event that needed it.
				toast({ message: 'Already in your library.' });
				queryClient.invalidateQueries({ queryKey: ['shelf'] });
				// …and the CATALOG (Epic 7 cross-story review, M3): the server anchors the
				// PSN_PRODUCT link on the duplicate path too — a catalog game that turned
				// out to be already tracked under a different title is now marked, and the
				// stale grid would keep reading ＋Add after you navigate back.
				queryClient.invalidateQueries({ queryKey: ['catalog'] });
				onClose();
				void navigate(...toDetail(result.gameId, destination));
				return;
			}
			toast({
				message: `${draftTitle.trim()} — added${owned ? '' : ' to wishlist'}`,
			});
			// Refetch before closing so the game is on the shelf when focus lands.
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['shelf'] }),
				queryClient.invalidateQueries({ queryKey: ['genres'] }),
				queryClient.invalidateQueries({ queryKey: ['catalog'] }),
			]);
			onClose();
			if (navigateToDetail) {
				void navigate(...toDetail(result.gameId, destination));
			}
		},
		onError: () => toast({ message: `Couldn’t add ${draftTitle}. Try again.` }),
	});

	function save() {
		// Block until the preview settles: saving mid-flight would POST name-only
		// and silently drop an IGDB match still in flight.
		if (mutation.isPending || previewPending || !draftTitle.trim()) return;
		const candidate = picked ?? preview?.candidate;
		mutation.mutate({
			title: draftTitle,
			// ponytail: the IGDB id sticks even if the title is edited — an
			// edition tweak keeps the right identity; retyping a different game
			// entirely is rare enough to not special-case yet.
			// Scores ride the candidate too (Story 10.1) — never user-edited, so
			// they come straight from the preview, not the form.
			...(candidate
				? { igdbId: candidate.igdbId, ...candidateScores(candidate) }
				: {}),
			// Forwarded, never interpreted: the server resolves it against the stored
			// catalog and writes the `PSN_PRODUCT` link (AD-20) — or, if it was pruned
			// meanwhile, ignores it and saves the title alone.
			...(prefill?.psnProductId ? { psnProductId: prefill.psnProductId } : {}),
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
	// The candidate Save would commit — the pick wins over the auto-match.
	const activeCandidate = picked ?? preview?.candidate ?? null;

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
				{/* The matched game's reception (Story 10.5): the "check ratings →
				    add if ~75+" decision happens HERE, on the primary path — not
				    only in the correction picker. Scores ride the candidate the
				    Save would commit (picked over auto-match), never the edited
				    draft. Absent when the candidate has none. */}
				{activeCandidate && (
					<ScoreBadges
						critic={activeCandidate.criticScore}
						criticCount={activeCandidate.criticScoreCount}
						user={activeCandidate.userScore}
						userCount={activeCandidate.userScoreCount}
						testId="add-game-preview-scores"
					/>
				)}
				{/* Correct a wrong auto-match BEFORE the row exists (Story 6.6 /
				    PV-6). Hidden when the games DB is unavailable — the picker's
				    search would answer [] every time, an always-empty dead end. */}
				{!previewPending && !unavailable && (
					<button
						type="button"
						className="add-game__rematch tap-target"
						data-testid="add-game-rematch"
						// Correcting mid-POST would rewrite the draft under an
						// already-sent payload: the row commits the OLD game while the
						// toast names the NEW one.
						disabled={mutation.isPending}
						onClick={() => setPicking(true)}
					>
						Not the right game?
					</button>
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
						{/* NOT offered on a catalog add (Story 7.3 review, H1): ticking it
						    wrote owned_via 'purchase' + today's bought_on for a PS+ EXTRA
						    title — wrong twice (it is not a purchase, and there is no
						    purchase date). A PS+ title counts as owned ONLY via
						    owned_via: 'membership', and ONLY when a sync observes the real
						    entitlement — the app cannot see the PS Store tab. The server
						    refuses `owned` alongside a product id regardless. */}
						{!fromProduct && (
							<label className="add-game__owned">
								<input
									type="checkbox"
									checked={owned}
									onChange={(e) => setOwned(e.target.checked)}
								/>
								<span>I own this game</span>
							</label>
						)}
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

			{picking && (
				<StackedPicker
					// A blanked Title would seed an empty term — no search, no list, no
					// notice. Fall back to the name the user typed to get here.
					initialTerm={draftTitle.trim() || title}
					onPick={(c) => {
						setPicked(c);
						applyCandidate(c);
						setPicking(false);
					}}
					onClose={() => setPicking(false)}
				/>
			)}
		</div>,
		document.body,
	);
}

/**
 * The picker stacked over the add modal: its own shell + trap, so Escape closes
 * it first and the add modal (and its draft) survives. Rendered in place rather
 * than in the shared picker because it is the only consumer that stacks.
 */
function StackedPicker({
	initialTerm,
	onPick,
	onClose,
}: {
	initialTerm: string;
	onPick: (candidate: IgdbCandidate) => void;
	onClose: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const headingId = useId();
	// restoreFocus: closing the picker (Escape, Back, or a pick) must land focus
	// back on the affordance — otherwise it falls to <body>, where the add
	// modal's Tab-cycle branch no-ops and focus walks out of the open dialog.
	const onKeyDown = useModalTrap(dialogRef, onClose, { restoreFocus: true });

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Back button are the accessible paths; this only mirrors them for pointer users.
		<div
			className="stragglers__backdrop"
			data-testid="add-game-picker-backdrop"
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
				data-testid="add-game-picker"
				onKeyDown={onKeyDown}
			>
				<h2 id={headingId} className="stragglers__heading">
					Pick the right match
				</h2>
				<IgdbMatchPicker
					initialTerm={initialTerm}
					coverTestId="add-game-candidate-cover"
					onPick={onPick}
					onBack={onClose}
				/>
			</div>
		</div>
	);
}
