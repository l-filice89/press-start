import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useModalTrap } from '../components/useModalTrap';
import {
	candidateScores,
	fetchStragglers,
	type IgdbCandidate,
	ignoreStraggler,
	resolveStraggler,
	type Straggler,
	setDiscarded,
} from './api';
import { IgdbMatchPicker } from './IgdbMatchPicker';
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
	const [selected, setSelected] = useState<Straggler | null>(null);
	// The import row awaiting the ignore confirm gate (null = no gate open).
	const [confirmingIgnore, setConfirmingIgnore] = useState<Straggler | null>(
		null,
	);
	const onKeyDown = useModalTrap(dialogRef, onClose, {
		// The ignore confirm stacks on top: hand it Escape (Story 3.5 rule).
		enabled: !confirmingIgnore,
	});

	const { data: stragglers = [], isPending } = useQuery({
		queryKey: ['stragglers'],
		queryFn: ({ signal }) => fetchStragglers(signal),
	});

	// Refresh every surface a resolve/discard can change: the list, the shelf (a
	// discarded game leaves it), and settings (the amber banner count keys off the
	// straggler total).
	const refreshLists = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: ['stragglers'] }),
			queryClient.invalidateQueries({ queryKey: ['shelf'] }),
			queryClient.invalidateQueries({ queryKey: ['settings'] }),
		]);

	// Discard a name-only mistake (unenriched kind only — import staging rows are
	// not games). Reversible: an UNDO toast revives it (soft-delete tombstone),
	// same shape as the shelf's un-own undo. Re-adding the name also revives.
	// ponytail: a bare mutation, not the shelf's IN_FLIGHT/WRITE_GEN guards — this
	// modal has no other write path to the same row and no shared-state race, so
	// the shelf's cross-surface machinery would be dead weight here.
	const discardMutation = useMutation({
		mutationFn: ({ id, discarded }: { id: string; discarded: boolean }) =>
			setDiscarded(id, discarded),
	});

	const discardStraggler = (s: Straggler) =>
		discardMutation.mutate(
			{ id: s.id, discarded: true },
			{
				onSuccess: async () => {
					await refreshLists();
					toast({
						message: `${s.title} — removed`,
						undo: {
							onUndo: () =>
								discardMutation.mutate(
									{ id: s.id, discarded: false },
									{
										onSuccess: refreshLists,
										// A failed revive must not be silent (it would leave the
										// game gone with no signal) — same as the forward discard.
										onError: () =>
											toast({
												message: `Couldn’t restore ${s.title}. Try again.`,
											}),
									},
								),
						},
					});
				},
				onError: () =>
					toast({ message: `Couldn’t remove ${s.title}. Try again.` }),
			},
		);

	// Ignore an import staging row (import kind only). Unlike the unenriched
	// discard this is a HARD delete of the Notion data — no undo — so it's gated
	// behind ConfirmDialog. A plain toast confirms; onError surfaces a failure.
	const ignoreMutation = useMutation({
		mutationFn: (s: Straggler) => ignoreStraggler(s.id),
	});

	const ignoreImport = (s: Straggler) => {
		setConfirmingIgnore(null);
		ignoreMutation.mutate(s, {
			onSuccess: async () => {
				await refreshLists();
				toast({ message: `${s.title} — ignored` });
			},
			onError: () =>
				toast({ message: `Couldn’t ignore ${s.title}. Try again.` }),
		});
	};

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
								queryClient.invalidateQueries({ queryKey: ['settings'] }),
								queryClient.invalidateQueries({ queryKey: ['genres'] }),
							]);
						}}
						onError={(error) => {
							// 409: that IGDB game is already in the library under another
							// row, so retrying the same pick can never work — say what to do
							// instead (pick a different match, or discard this row).
							const conflict =
								(error as { status?: number } | null)?.status === 409;
							toast({
								message: conflict
									? `That game is already in your library. Pick a different match, or discard “${selected.title}”.`
									: `Couldn’t resolve ${selected.title}. Try again.`,
							});
							setSelected(null);
							queryClient.invalidateQueries({ queryKey: ['stragglers'] });
						}}
					/>
				) : (
					<>
						{isPending && <p className="stragglers__notice">Loading…</p>}
						{/* The two kinds confuse users — name the difference and what
							    each row's actions mean before they act. */}
						<p className="stragglers__notice">
							Import rows come from your Notion library — match one to keep its
							history, or ignore it. Name-only rows are games you added by name.
						</p>
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
									{/* Ignore an import staging row — hard-deletes its Notion
									    data, so it's confirm-gated (no undo). */}
									{s.kind === 'import' && (
										<button
											type="button"
											className="stragglers__discard tap-target"
											disabled={ignoreMutation.isPending}
											onClick={() => setConfirmingIgnore(s)}
										>
											Ignore
										</button>
									)}
									{/* Discard only a name-only add (a real game the user can
									    have added by mistake). Import staging rows aren't games
									    — they carry a Notion payload and resolve or stay. */}
									{s.kind === 'unenriched' && (
										<button
											type="button"
											className="stragglers__discard tap-target"
											disabled={discardMutation.isPending}
											onClick={() => discardStraggler(s)}
										>
											Discard
										</button>
									)}
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
			{confirmingIgnore && (
				<ConfirmDialog
					title={`Ignore “${confirmingIgnore.title}”? Its imported status and dates will be discarded.`}
					confirmLabel="Ignore"
					onConfirm={() => ignoreImport(confirmingIgnore)}
					onCancel={() => setConfirmingIgnore(null)}
				/>
			)}
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
	onError: (error: unknown) => void;
}) {
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
				...candidateScores(candidate),
			}),
		onSuccess: onResolved,
		// A stale straggler (404 — resolved elsewhere), a rejected field (400), or
		// a network drop must not silently no-op: tell the user and refresh the
		// list so a dead row drops out.
		onError,
	});

	// The search/candidate UI is the shared picker (Story 6.6); the resolve
	// mutation and the straggler kinds stay page-side.
	return (
		<IgdbMatchPicker
			initialTerm={straggler.title}
			pending={mutation.isPending}
			coverTestId="straggler-candidate-cover"
			onPick={(c) => mutation.mutate(c)}
			onBack={onCancel}
		/>
	);
}
