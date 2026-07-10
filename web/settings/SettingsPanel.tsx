import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalTrap } from '../components/useModalTrap';
import { fetchSettings, savePsnCookie } from './api';
import './settings-panel.css';

/**
 * The Settings surface (Story 4.1, FR-36): a focus-trapped modal editing the
 * PlayStation session cookie. The stored value is never shown — the field is
 * always empty and saving replaces the cookie wholesale. Epic 6 moves the
 * entry point into the FAB drawer's gear; until then the header gear opens it.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const titleId = useId();
	const instructionsId = useId();
	const [cookie, setCookie] = useState('');
	const queryClient = useQueryClient();

	const { data: settings } = useQuery({
		queryKey: ['settings'],
		queryFn: ({ signal }) => fetchSettings(signal),
	});

	const save = useMutation({
		mutationFn: savePsnCookie,
		onSuccess: () => {
			setCookie('');
			queryClient.invalidateQueries({ queryKey: ['settings'] });
		},
	});

	const onKeyDown = useModalTrap(dialogRef, onClose, {
		initialFocusRef: inputRef,
	});

	const trimmed = cookie.trim();

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
					<h3 className="settings-panel__heading">
						PlayStation session cookie
					</h3>
					<p className="settings-panel__status" data-testid="psn-cookie-status">
						{settings?.psnCookieSet
							? 'A cookie is saved. Pasting a new one replaces it.'
							: 'No cookie saved yet.'}
					</p>
					<ol className="settings-panel__instructions" id={instructionsId}>
						<li>
							Log in at{' '}
							<a
								href="https://library.playstation.com"
								target="_blank"
								rel="noreferrer"
							>
								library.playstation.com
							</a>
						</li>
						<li>
							Open DevTools (F12) → Application → Cookies →
							https://library.playstation.com
						</li>
						<li>
							Copy the value of the <code>pdccws_p</code> cookie
						</li>
						<li>Paste it below and save</li>
					</ol>
					<textarea
						ref={inputRef}
						className="settings-panel__cookie-input"
						aria-label="PlayStation session cookie"
						aria-describedby={instructionsId}
						placeholder="Paste the pdccws_p cookie value"
						rows={3}
						maxLength={4096}
						value={cookie}
						onChange={(e) => {
							setCookie(e.target.value);
							save.reset();
						}}
					/>
					<div
						className="settings-panel__feedback"
						role="status"
						aria-live="polite"
					>
						{save.isSuccess && 'Cookie saved.'}
						{save.isError && 'Saving failed — try again.'}
					</div>
				</section>

				<div className="settings-panel__actions">
					<button
						type="button"
						className="settings-panel__close tap-target"
						onClick={onClose}
					>
						Close
					</button>
					<button
						type="button"
						className="settings-panel__save tap-target"
						disabled={!trimmed || save.isPending}
						onClick={() => save.mutate(trimmed)}
					>
						{save.isPending ? 'Saving…' : 'Save cookie'}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
