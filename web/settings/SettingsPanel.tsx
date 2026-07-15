import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useModalTrap } from '../components/useModalTrap';
import { serverMessage } from '../shelf/api';
import {
	backfillPartial,
	cancelPsPlus,
	fetchSettings,
	type PlatinumBackfillResult,
	releaseBackfillLock,
	runPlatinumBackfill,
	saveFabHandedness,
	savePsnNpsso,
	savePsnRegion,
} from './api';
import './settings-panel.css';

/**
 * Client-side brake on the backfill's chunk loop (Story 9.3). The server's
 * cursor strictly advances past every row it saw, so the loop terminates on its
 * own; this only stops a cursor regression from spinning the browser forever.
 * 40 chunks × 15 candidates = 600 platinum titles. Tripping it means the run is
 * INCOMPLETE — the summary says so rather than reading as a finished backfill.
 */
const MAX_BACKFILL_CHUNKS = 40;

type BackfillRows = Pick<PlatinumBackfillResult, 'filled' | 'skipped'>;

type BackfillState =
	| { phase: 'idle' }
	| { phase: 'running'; filled: number; skipped: number }
	| ({
			phase: 'done';
			hasTrophyData: boolean;
			/** The chunk brake tripped: more candidates remain. */
			stoppedEarly: boolean;
	  } & BackfillRows)
	// A failed run still WROTE the rows it got through (platinum_on is write-once
	// — nothing rolls back), so the failure carries them instead of erasing them.
	| ({ phase: 'error'; message: string } & BackfillRows);

/**
 * The backfill summary (Story 9.3, FR-37). Every ending is DISTINCT: a run that
 * filled nothing because PSN had no trophy record for a single candidate is not
 * a completed backfill of a hopeless library, and "no candidates" means one of
 * two different things depending on whether the trophy sync has ever run.
 */
function doneSummary(state: Extract<BackfillState, { phase: 'done' }>): string {
	const { filled, skipped, hasTrophyData, stoppedEarly } = state;
	const early = stoppedEarly
		? ' Stopped early — run it again to continue.'
		: '';
	if (filled.length === 0 && skipped.length === 0) {
		return hasTrophyData
			? 'Nothing to recover — every platinum you have already carries its date.'
			: 'No trophy data yet — run the trophy sync first, then come back and recover the dates.';
	}
	if (
		filled.length === 0 &&
		skipped.every((item) => item.code === 'not-found')
	) {
		return `PlayStation returned no trophy record for any of these ${skipped.length} — the trophy sync may need re-running.${early}`;
	}
	// Each skip carries its OWN reason (no date on record, no trophy record, a
	// PSN failure on that one title) — collapsing them into "no date" would tell
	// the user a title is undateable when PSN merely fell over on it.
	return `Recovered ${filled.length} platinum date${
		filled.length === 1 ? '' : 's'
	}${
		skipped.length > 0
			? `; skipped ${skipped.length} (${skipped
					.map((item) => `${item.title} — ${item.reason}`)
					.join('; ')})`
			: ''
	}.${early}`;
}

/** What a FAILED run still recovered — written, permanent, and not lost here. */
function partialSummary(
	state: Extract<BackfillState, { phase: 'error' }>,
): string {
	if (state.filled.length === 0 && state.skipped.length === 0) return '';
	return ` It had already recovered ${state.filled.length} platinum date${
		state.filled.length === 1 ? '' : 's'
	} (kept), and skipped ${state.skipped.length}.`;
}

/**
 * The Settings surface (Story 4.1, re-credentialed in 9.1b, FR-36): a
 * focus-trapped modal editing the PlayStation NPSSO token. The stored value is
 * never shown — the field is always empty and saving replaces the token
 * wholesale. The token cannot be read from Sony cross-origin (CORS), so the
 * "Get / refresh token" control is a plain deep link the user copies from.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const titleId = useId();
	const instructionsId = useId();
	const [npsso, setNpsso] = useState('');
	const queryClient = useQueryClient();
	const { toast } = useToast();

	const { data: settings } = useQuery({
		queryKey: ['settings'],
		queryFn: ({ signal }) => fetchSettings(signal),
	});

	const save = useMutation({
		mutationFn: savePsnNpsso,
		// A failed token save already says so inline, below the button.
		onSuccess: () => {
			setNpsso('');
			queryClient.invalidateQueries({ queryKey: ['settings'] });
		},
	});

	// PSN store region (the PS+ catalog is per-region — the catalog's NO REGION
	// empty state points here). Saving invalidates the catalog queries so the
	// browse page re-renders into its "run the check" state for the new region.
	const [region, setRegion] = useState('');
	const saveRegion = useMutation({
		mutationFn: savePsnRegion,
		onSuccess: () => {
			setRegion('');
			queryClient.invalidateQueries({ queryKey: ['settings'] });
			queryClient.invalidateQueries({ queryKey: ['catalog'] });
			queryClient.invalidateQueries({ queryKey: ['catalog-genres'] });
		},
	});
	const trimmedRegion = region.trim().toLowerCase();
	// Mirrors the server guard — a disabled button beats a 400 round-trip.
	const regionValid = /^[a-z]{2}(-[a-z]{2,4})?-[a-z]{2}$/.test(trimmedRegion);

	const handedness = settings?.fabHandedness ?? 'right';
	const setHandedness = useMutation({
		mutationFn: saveFabHandedness,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
		// Not optimistic, so the toggle never lies about the stored side — but a
		// failure was silent until now (NFR-4).
		onError: () => toast({ message: 'Couldn’t save that setting. Try again.' }),
	});

	// "I cancelled PS+" (Story 6.4 AC4): count-confirmed bulk un-own of PS+
	// claims. The button is inert with no claims; the confirm names the count.
	const claimCount = settings?.psPlusClaimCount ?? 0;
	const [confirmingCancel, setConfirmingCancel] = useState(false);
	const cancelClaims = useMutation({
		mutationFn: cancelPsPlus,
		onSuccess: () => {
			setConfirmingCancel(false);
			// Un-owning re-flags psPlusExtra and clears owned — refresh both the
			// settings count and the shelf so the pill re-shows without a reload.
			queryClient.invalidateQueries({ queryKey: ['settings'] });
			queryClient.invalidateQueries({ queryKey: ['shelf'] });
		},
		onError: () => {
			setConfirmingCancel(false);
			toast({ message: 'Couldn’t un-claim your PS+ games. Try again.' });
		},
	});

	// The one-off platinum-date backfill (Story 9.3). It LOOPS the chunked
	// endpoint on its cursor — one PSN call per platinum title is more fan-out
	// than a single Worker invocation may issue — and always ends in a summary
	// naming what was filled and what PSN could not date (FR-37).
	const [backfill, setBackfill] = useState<BackfillState>({ phase: 'idle' });
	const runBackfill = async () => {
		setBackfill({ phase: 'running', filled: 0, skipped: 0 });
		const filled: PlatinumBackfillResult['filled'] = [];
		const skipped: PlatinumBackfillResult['skipped'] = [];
		let cursor: string | null = null;
		// The single-flight lock this loop holds (Story 9.5) — handed back on every
		// continuation to renew it. Without it the next chunk reads as a fresh run.
		let lockToken: string | null = null;
		let hasTrophyData = true;
		let stoppedEarly = false;
		try {
			for (let chunk = 0; ; chunk++) {
				if (chunk >= MAX_BACKFILL_CHUNKS) {
					stoppedEarly = true;
					// Deliberate stop, not a crash: give the lock back, or the "run it
					// again to continue" the summary offers would be refused for the
					// next two minutes with "a sync is already running" (Story 9.5).
					if (lockToken) await releaseBackfillLock(lockToken);
					break;
				}
				const result: PlatinumBackfillResult = await runPlatinumBackfill(
					cursor,
					lockToken,
				);
				lockToken = result.lockToken ?? null;
				filled.push(...result.filled);
				skipped.push(...result.skipped);
				hasTrophyData = result.hasTrophyData;
				setBackfill({
					phase: 'running',
					filled: filled.length,
					skipped: skipped.length,
				});
				cursor = result.nextCursor;
				if (!cursor) break;
			}
		} catch (error) {
			// The rows EARLIER chunks recovered are already written and permanent —
			// and so are the ones the FAILED chunk got through before it died (the
			// server reports those in the error body). Report all of them: a run that
			// recovered 40 dates and then hit an expired token did not recover none.
			const partial = backfillPartial(error);
			if (partial) {
				filled.push(...partial.filled);
				skipped.push(...partial.skipped);
			}
			const status = (error as { status?: number }).status;
			setBackfill({
				phase: 'error',
				filled,
				skipped,
				message:
					status === 401
						? 'PlayStation rejected the token — save a fresh one above, then try again.'
						: // Both 409s carry a message worth reading verbatim: no timezone
							// (the run would misdate permanently) and another PSN op already
							// running (the 9.5 single-flight lock).
							status === 409
							? (serverMessage(error) ??
								'Set your timezone first, then try again.')
							: 'Couldn’t reach PlayStation. Try again later.',
			});
			// The server persisted the expired flag — refetch settings so the banner
			// lights without a reload (same as both sync handlers, AD-14).
			if (status === 401)
				queryClient.invalidateQueries({ queryKey: ['settings'] });
			// Whatever was written before the failure still changes the cards.
			if (filled.length > 0)
				queryClient.invalidateQueries({ queryKey: ['shelf'] });
			return;
		}
		setBackfill({
			phase: 'done',
			filled,
			skipped,
			hasTrophyData,
			stoppedEarly,
		});
		// The recovered dates land on the cards (the platinum date the shelf shows,
		// and the completed_on the heuristic fills). play_status is NOT touched by
		// the backfill — a game you are replaying keeps saying "Playing".
		queryClient.invalidateQueries({ queryKey: ['shelf'] });
	};

	const onKeyDown = useModalTrap(dialogRef, onClose, {
		// The count-confirm stacks on top: hand Escape to it (Story 3.5 rule).
		enabled: !confirmingCancel,
		initialFocusRef: inputRef,
	});

	const trimmed = npsso.trim();

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Close button are the accessible paths; this only mirrors them for pointer users.
		<div
			className="settings-panel__backdrop"
			data-testid="settings-backdrop"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="settings-panel"
				onKeyDown={onKeyDown}
				data-testid="settings-panel"
			>
				<h2 id={titleId} className="settings-panel__title">
					Settings
				</h2>

				<section className="settings-panel__section">
					<h3 className="settings-panel__heading">PlayStation NPSSO token</h3>
					<p className="settings-panel__status" data-testid="psn-npsso-status">
						{settings?.psnNpssoSet
							? 'A token is saved. Pasting a new one replaces it.'
							: 'No token saved yet.'}
					</p>
					<ol className="settings-panel__instructions" id={instructionsId}>
						<li>
							Sign in to PlayStation, then open{' '}
							<a
								href="https://ca.account.sony.com/api/v1/ssocookie"
								target="_blank"
								rel="noreferrer"
								data-testid="psn-npsso-link"
							>
								Get / refresh token
							</a>
						</li>
						<li>
							Copy the <code>npsso</code> value from the page
						</li>
						<li>Paste it below and save — it lasts about 60 days</li>
					</ol>
					<textarea
						ref={inputRef}
						className="settings-panel__token-input"
						aria-label="PlayStation NPSSO token"
						aria-describedby={instructionsId}
						placeholder="Paste the npsso token value"
						rows={3}
						maxLength={4096}
						value={npsso}
						onChange={(e) => {
							setNpsso(e.target.value);
							save.reset();
						}}
					/>
					<button
						type="button"
						className="settings-panel__save tap-target"
						disabled={!trimmed || save.isPending}
						onClick={() => save.mutate(trimmed)}
					>
						{save.isPending ? 'Saving…' : 'Save token'}
					</button>
					<div
						className="settings-panel__feedback"
						role="status"
						aria-live="polite"
					>
						{save.isSuccess && 'Token saved.'}
						{save.isError && 'Saving failed — try again.'}
					</div>
				</section>

				<section className="settings-panel__section">
					<h3 className="settings-panel__heading">PlayStation region</h3>
					<p className="settings-panel__status" data-testid="psn-region-status">
						{settings?.region
							? `Your PS+ catalog region is ${settings.region}.`
							: 'No region set — the PS+ catalog needs one.'}{' '}
						Store locales are language-country: en-us for the US, en-gb for the
						UK, it-it for Italy.
					</p>
					<input
						type="text"
						className="settings-panel__token-input"
						aria-label="PlayStation region"
						placeholder="it-it"
						value={region}
						onChange={(e) => {
							setRegion(e.target.value);
							saveRegion.reset();
						}}
					/>
					<button
						type="button"
						className="settings-panel__save tap-target"
						data-testid="save-psn-region"
						disabled={!regionValid || saveRegion.isPending}
						onClick={() => saveRegion.mutate(trimmedRegion)}
					>
						{saveRegion.isPending ? 'Saving…' : 'Save region'}
					</button>
					{/* aria-live WITHOUT role=status — the NPSSO feedback above owns that
					    role in this dialog (same rule as the backfill summary below). */}
					<div
						className="settings-panel__feedback"
						aria-live="polite"
						data-testid="psn-region-feedback"
					>
						{saveRegion.isSuccess && 'Region saved.'}
						{saveRegion.isError && 'Saving failed — try again.'}
						{!regionValid &&
							region.trim() !== '' &&
							'Use a language-country store locale, like en-us or en-gb.'}
					</div>
				</section>

				<section className="settings-panel__section">
					<h3 className="settings-panel__heading">FAB placement</h3>
					<p className="settings-panel__status">
						Put the chores button on your dominant side.
					</p>
					{/* biome-ignore lint/a11y/useSemanticElements: this is a two-option toggle group, not a form radiogroup; aria-pressed buttons carry the state. */}
					<div
						className="settings-panel__handedness"
						role="group"
						aria-label="FAB placement"
					>
						{(['left', 'right'] as const).map((side) => (
							<button
								key={side}
								type="button"
								className="settings-panel__hand-option tap-target"
								aria-pressed={handedness === side}
								disabled={setHandedness.isPending}
								data-testid={`handedness-${side}`}
								onClick={() => setHandedness.mutate(side)}
							>
								{side === 'left' ? 'Bottom-left' : 'Bottom-right'}
							</button>
						))}
					</div>
				</section>

				<section className="settings-panel__section">
					<h3 className="settings-panel__heading">PlayStation Plus</h3>
					<p className="settings-panel__status">
						{claimCount === 0
							? 'You have no games claimed with PS+.'
							: `You have ${claimCount} game${claimCount === 1 ? '' : 's'} claimed with PS+. Cancelled your subscription? Un-own them — your purchases stay owned.`}
					</p>
					<button
						type="button"
						className="settings-panel__signout tap-target"
						data-testid="cancel-ps-plus"
						disabled={claimCount === 0 || cancelClaims.isPending}
						onClick={() => setConfirmingCancel(true)}
					>
						{claimCount === 0 ? 'No PS+ claims' : 'I cancelled PS+'}
					</button>
				</section>

				<section className="settings-panel__section">
					<h3 className="settings-panel__heading">Platinum dates</h3>
					<p className="settings-panel__status">
						PlayStation knows when you earned each platinum. Recover those dates
						for games that have none — it never changes a date you already have.
					</p>
					<button
						type="button"
						className="settings-panel__save tap-target"
						data-testid="backfill-platinum-dates"
						disabled={backfill.phase === 'running'}
						onClick={runBackfill}
					>
						{backfill.phase === 'running'
							? 'Recovering…'
							: 'Recover platinum dates'}
					</button>
					{/* aria-live WITHOUT role=status: the token-save feedback above already
					    owns that role in this dialog, and a second one is ambiguous to a
					    screen reader (and to `getByRole('status')`). */}
					<div
						className="settings-panel__feedback"
						aria-live="polite"
						data-testid="backfill-summary"
					>
						{backfill.phase === 'running' &&
							`Recovering… ${backfill.filled} filled, ${backfill.skipped} skipped so far.`}
						{backfill.phase === 'error' &&
							`${backfill.message}${partialSummary(backfill)}`}
						{backfill.phase === 'done' && doneSummary(backfill)}
					</div>
					{backfill.phase !== 'idle' &&
						backfill.phase !== 'running' &&
						backfill.filled.length > 0 && (
							<ul
								className="settings-panel__instructions"
								data-testid="backfill-filled"
							>
								{/* Titles COLLIDE in this app (the whole trophy-matching design
								    exists because they do) — the game id is the only stable key. */}
								{backfill.filled.map((item) => (
									<li key={item.gameId}>
										{item.title} — {item.date}
									</li>
								))}
							</ul>
						)}
				</section>

				<section className="settings-panel__section">
					<h3 className="settings-panel__heading">About &amp; Help</h3>
					<p className="settings-panel__status">
						Press Start is your personal game library — search to add a game,
						track what you own and play, and export your library to CSV as your
						own backup. Add a game by name from the search bar; games needing a
						match surface in the amber banner.
					</p>
				</section>

				<div className="settings-panel__actions">
					<button
						type="button"
						className="settings-panel__close tap-target"
						onClick={onClose}
					>
						Close
					</button>
				</div>
			</div>

			{confirmingCancel && (
				<ConfirmDialog
					title={`Un-own ${claimCount} game${
						claimCount === 1 ? '' : 's'
					} claimed with PS+? Your purchases stay owned.`}
					confirmLabel="Un-own claims"
					onConfirm={() => cancelClaims.mutate()}
					onCancel={() => setConfirmingCancel(false)}
				/>
			)}
		</div>,
		document.body,
	);
}
