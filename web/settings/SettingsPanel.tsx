import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useModalTrap } from '../components/useModalTrap';
import { callApi } from '../shelf/api';
import {
	cancelPsPlus,
	fetchSettings,
	type PlayStationPlatform,
	saveIgdbPlatforms,
	savePsnRegion,
} from './api';
import './settings-panel.css';

const PLATFORM_OPTIONS: { value: PlayStationPlatform; label: string }[] = [
	{ value: 'PS1', label: 'PS1' },
	{ value: 'PS2', label: 'PS2' },
	{ value: 'PS3', label: 'PS3' },
	{ value: 'PS4', label: 'PS4' },
	{ value: 'PS5', label: 'PS5' },
	{ value: 'PSP', label: 'PSP' },
	{ value: 'PSVita', label: 'PS Vita' },
	{ value: 'PSVR', label: 'PSVR 1' },
	{ value: 'PSVR2', label: 'PSVR 2' },
];

/**
 * The Settings surface (Story 4.1, stripped of the PSN credential surface by
 * Epic 11 story 11.2): a focus-trapped modal editing the PS+ region and claim
 * state, with a status-aware CSV backup action.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const exportAbortRef = useRef<AbortController | null>(null);
	const titleId = useId();
	const queryClient = useQueryClient();
	const { toast } = useToast();

	const { data: settings } = useQuery({
		queryKey: ['settings'],
		queryFn: ({ signal }) => fetchSettings(signal),
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

	const [platforms, setPlatforms] = useState<PlayStationPlatform[]>([]);
	const [platformsDirty, setPlatformsDirty] = useState(false);
	const platformsHydrated = useRef(false);
	useEffect(() => {
		if (settings && (!platformsHydrated.current || !platformsDirty)) {
			setPlatforms(settings.igdbPlatforms);
			platformsHydrated.current = true;
		}
	}, [settings, platformsDirty]);
	const savePlatforms = useMutation({
		mutationFn: saveIgdbPlatforms,
		onSuccess: (_data, savedPlatforms) => {
			queryClient.setQueryData(['settings'], (current: typeof settings) =>
				current ? { ...current, igdbPlatforms: savedPlatforms } : current,
			);
			setPlatforms(savedPlatforms);
			setPlatformsDirty(false);
			queryClient.invalidateQueries({ queryKey: ['settings'] });
			queryClient.invalidateQueries({ queryKey: ['add-preview'] });
			queryClient.invalidateQueries({ queryKey: ['igdb-search'] });
		},
	});
	const platformsChanged = settings
		? platforms.length !== settings.igdbPlatforms.length ||
			!platforms.every((platform) => settings.igdbPlatforms.includes(platform))
		: false;

	const exportCsv = useMutation({
		mutationFn: async () => {
			const controller = new AbortController();
			exportAbortRef.current = controller;
			try {
				const response = await fetch('/api/export.csv', {
					signal: controller.signal,
				});
				if (!response.ok) {
					const error = new Error(`export failed (${response.status})`);
					(error as Error & { status?: number }).status = response.status;
					throw error;
				}
				if (!response.headers.get('content-type')?.includes('text/csv')) {
					throw new Error('export returned a non-CSV response');
				}
				return response.blob();
			} finally {
				if (exportAbortRef.current === controller) {
					exportAbortRef.current = null;
				}
			}
		},
		onSuccess: (blob) => {
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = 'press-start-library.csv';
			anchor.click();
			// Chromium can emit the download event before it has consumed the Blob.
			// Keep the URL alive briefly, then release it once the read has started.
			setTimeout(() => URL.revokeObjectURL(url), 1_000);
		},
		onError: (error) => {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			toast({ message: 'Export failed — try again later.' });
		},
	});
	const closePanel = () => {
		exportAbortRef.current?.abort();
		onClose();
	};
	useEffect(() => () => exportAbortRef.current?.abort(), []);

	// "I cancelled PS+" (Story 6.4 AC4): count-confirmed bulk un-own of PS+
	// claims. The button is inert with no claims; the confirm names the count.
	const claimCount = settings?.psPlusClaimCount ?? 0;
	const [confirmingCancel, setConfirmingCancel] = useState(false);
	const [confirmingDeletion, setConfirmingDeletion] = useState(false);
	const [deletionEmailSent, setDeletionEmailSent] = useState(false);
	const deleteButtonRef = useRef<HTMLButtonElement>(null);
	const deletionRequestRef = useRef(false);
	const restoreDeleteFocusRef = useRef(false);
	const requestDeletion = useMutation({
		mutationFn: () =>
			callApi('/api/auth/delete-user', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ callbackURL: '/' }),
			}),
		onSuccess: () => {
			restoreDeleteFocusRef.current = true;
			setConfirmingDeletion(false);
			setDeletionEmailSent(true);
		},
		onSettled: () => {
			deletionRequestRef.current = false;
		},
	});
	const requestDeletionEmail = () => {
		if (deletionRequestRef.current) return;
		deletionRequestRef.current = true;
		setDeletionEmailSent(false);
		requestDeletion.mutate();
	};
	const cancelDeletion = () => {
		requestDeletion.reset();
		restoreDeleteFocusRef.current = true;
		setConfirmingDeletion(false);
	};
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

	const onKeyDown = useModalTrap(dialogRef, closePanel, {
		// The count-confirm stacks on top: hand Escape to it (Story 3.5 rule).
		enabled: !confirmingCancel && !confirmingDeletion,
		initialFocusRef: inputRef,
	});
	useEffect(() => {
		if (!confirmingDeletion && restoreDeleteFocusRef.current) {
			restoreDeleteFocusRef.current = false;
			if (dialogRef.current) dialogRef.current.inert = false;
			// Backdrop dismissal starts on mousedown; restore after the remaining
			// pointer events so their default focus move cannot land on <body>.
			setTimeout(() => deleteButtonRef.current?.focus(), 0);
		}
	}, [confirmingDeletion]);

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Close button are the accessible paths; this only mirrors them for pointer users.
		<div
			className="settings-panel__backdrop"
			data-testid="settings-backdrop"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) closePanel();
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
					<h3 className="settings-panel__heading">PlayStation region</h3>
					<p className="settings-panel__status" data-testid="psn-region-status">
						{settings?.region
							? `Your PS+ catalog region is ${settings.region}.`
							: 'No region set — the PS+ catalog needs one.'}{' '}
						Store locales are language-country: en-us for the US, en-gb for the
						UK, it-it for Italy.
					</p>
					<input
						ref={inputRef}
						type="text"
						className="settings-panel__text-input"
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
					<div
						className="settings-panel__feedback"
						role="status"
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
					<h3 className="settings-panel__heading">IGDB platforms</h3>
					<fieldset
						className="settings-panel__platforms"
						disabled={!settings || savePlatforms.isPending}
					>
						<legend>Limit new IGDB matches to releases on:</legend>
						<div className="settings-panel__platform-options">
							{PLATFORM_OPTIONS.map(({ value, label }) => (
								<label key={value} className="settings-panel__platform-option">
									<input
										type="checkbox"
										checked={platforms.includes(value)}
										onChange={(event) => {
											setPlatforms((current) =>
												event.target.checked
													? [...current, value]
													: current.filter((item) => item !== value),
											);
											setPlatformsDirty(true);
											savePlatforms.reset();
										}}
									/>
									{label}
								</label>
							))}
						</div>
					</fieldset>
					<button
						type="button"
						className="settings-panel__save tap-target"
						data-testid="save-igdb-platforms"
						disabled={
							!settings ||
							platforms.length === 0 ||
							savePlatforms.isPending ||
							!platformsChanged
						}
						onClick={() => savePlatforms.mutate(platforms)}
					>
						{savePlatforms.isPending ? 'Saving…' : 'Save platforms'}
					</button>
					<div
						className="settings-panel__feedback"
						role="status"
						aria-live="polite"
						data-testid="igdb-platforms-feedback"
					>
						{platforms.length === 0 && 'Select at least one platform.'}
						{savePlatforms.isSuccess && 'Platforms saved.'}
						{savePlatforms.isError && 'Saving failed — try again.'}
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

				<section className="settings-panel__section settings-panel__backup">
					<p className="settings-panel__eyebrow">DATA BACKUP</p>
					<h3 className="settings-panel__heading">Keep your own copy</h3>
					<p className="settings-panel__status">
						Download your complete library as CSV, including statuses, dates,
						genres, and ownership.
					</p>
					<button
						type="button"
						className="settings-panel__export tap-target"
						data-testid="settings-export"
						disabled={exportCsv.isPending}
						aria-busy={exportCsv.isPending}
						onClick={() => exportCsv.mutate()}
					>
						{exportCsv.isPending ? 'Exporting…' : 'Export CSV'}
					</button>
					<span className="sr-only" aria-live="polite" aria-atomic="true">
						{exportCsv.isPending ? 'Exporting your library.' : ''}
					</span>
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

				<section className="settings-panel__section settings-panel__account">
					<p className="settings-panel__eyebrow">ACCOUNT</p>
					<h3 className="settings-panel__heading">Delete your account</h3>
					<p className="settings-panel__status">
						Permanently deletes your private library and settings. Export your
						CSV first if you want to keep a copy. This cannot be undone.
					</p>
					<button
						ref={deleteButtonRef}
						type="button"
						className="settings-panel__delete tap-target"
						onClick={() => {
							requestDeletion.reset();
							setConfirmingDeletion(true);
						}}
					>
						Delete account
					</button>
					<p
						className="settings-panel__feedback"
						role="status"
						aria-live="polite"
					>
						{deletionEmailSent &&
							'Check your email. Your account remains until you open the deletion link.'}
					</p>
				</section>

				<div className="settings-panel__actions">
					<button
						type="button"
						className="settings-panel__close tap-target"
						onClick={closePanel}
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
			{confirmingDeletion && (
				<ConfirmDialog
					title="Permanently delete your account?"
					description="Opening the emailed link deletes your account and private library. This cannot be undone."
					status={
						requestDeletion.isError
							? 'Couldn’t send the deletion email. Try again.'
							: requestDeletion.isPending
								? 'Sending deletion email…'
								: undefined
					}
					confirmLabel={
						requestDeletion.isPending ? 'Sending…' : 'Email deletion link'
					}
					confirmDisabled={requestDeletion.isPending}
					dismissDisabled={requestDeletion.isPending}
					onConfirm={requestDeletionEmail}
					onCancel={cancelDeletion}
				/>
			)}
		</div>,
		document.body,
	);
}
