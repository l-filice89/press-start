import { useMutation } from '@tanstack/react-query';
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../components/Toast';
import { useModalTrap } from '../components/useModalTrap';
import { candidateScores, type IgdbCandidate, rematchGame } from './api';
import { IgdbMatchPicker } from './IgdbMatchPicker';
import './stragglers-dialog.css';

/**
 * Rematch a wrongly-matched game (PV-4) — the detail-panel correction for a
 * same-name mismatch (PV-1) and the cleanup path for already-wrong covers
 * (PV-5). A title-seeded IGDB search; picking a candidate re-points the game's
 * IGDB link and overwrites its cover/date/title/genres in place.
 *
 * The shell (portal, backdrop, trap) and the rematch mutation stay here; the
 * candidate search/list is the shared `<IgdbMatchPicker>` (Story 6.6).
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

	const mutation = useMutation({
		mutationFn: (candidate: IgdbCandidate) =>
			rematchGame(game.id, {
				igdbId: candidate.igdbId,
				name: candidate.name,
				coverUrl: candidate.coverUrl,
				releaseDate: candidate.releaseDate,
				genres: candidate.genres,
				...candidateScores(candidate),
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

				<IgdbMatchPicker
					initialTerm={game.title}
					pending={mutation.isPending}
					coverTestId="rematch-candidate-cover"
					onPick={(c) => mutation.mutate(c)}
					onBack={onClose}
				/>
			</div>
		</div>,
		document.body,
	);
}
