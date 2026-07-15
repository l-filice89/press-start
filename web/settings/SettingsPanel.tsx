import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useModalTrap } from '../components/useModalTrap';
import {
	cancelPsPlus,
	fetchSettings,
	saveFabHandedness,
	savePsnNpsso,
	savePsnRegion,
} from './api';
import './settings-panel.css';

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
					    role in this dialog. */}
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
