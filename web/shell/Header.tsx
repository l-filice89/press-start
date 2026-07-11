import type { ReactNode } from 'react';
import { formatDisplayDate } from '../date';
import { Wordmark } from './Wordmark';
import './header.css';

/**
 * The shell header (EXPERIENCE.md IA + Responsive deltas). Holds the wordmark,
 * a persistent search slot (header-left on desktop, bottom-pinned on phone),
 * a library readout slot (full "PS+ CATALOG AS OF …" desktop / compact count
 * phone), and the sign-out control.
 *
 * The readout shows how fresh the PS+ Extra flags are (Story 5.3): the date of
 * the last successful refresh, full on desktop / compact on phone (the
 * `header.css` `@media` swap), em-dash until the first refresh.
 * The search slot renders whatever `search` node the shell passes (Story 1.7's
 * live combobox); with no node it falls back to a disabled placeholder so the
 * slot's design/placement still holds. Sign-out is the FR-47 live control.
 */
export function Header({
	email,
	onSignOut,
	onOpenSettings,
	signOutFailed = false,
	search,
	psPlusRefreshedAt = null,
}: {
	email: string;
	onSignOut: () => void;
	onOpenSettings?: () => void;
	signOutFailed?: boolean;
	search?: ReactNode;
	/** Date (YYYY-MM-DD) of the last successful PS+ Extra refresh, or null. */
	psPlusRefreshedAt?: string | null;
}) {
	// `||` (not `??`) so an empty/blank stored value also falls back to the dash.
	// Localize the ISO date so it can't be misread month-first (Story 5.3 fix).
	const refreshedAt = psPlusRefreshedAt
		? formatDisplayDate(psPlusRefreshedAt)
		: '—';
	return (
		<header className="app-header">
			<div className="app-header__brand">
				<Wordmark variant="compact" showTagline />
			</div>

			<div className="app-header__search">
				{search ?? (
					<input
						type="search"
						className="app-header__search-input"
						placeholder="Find or add a game"
						aria-label="Search your library (available once your shelf is set up)"
						disabled
					/>
				)}
			</div>

			<div className="app-header__meta">
				{/* Freshness readout (5.3) — em-dash until the first successful refresh. */}
				<span className="app-header__readout" data-testid="readout">
					<span className="app-header__readout-full">
						PS+ CATALOG AS OF {refreshedAt}
					</span>
					<span className="app-header__readout-compact">PS+ {refreshedAt}</span>
				</span>

				{signOutFailed && (
					<span role="alert" className="app-header__error">
						Sign-out failed — try again.
					</span>
				)}

				{/* Settings entry point (Story 4.1) — Epic 6 relocates this into
				    the FAB drawer's gear; the header button is the interim home. */}
				{onOpenSettings && (
					<button
						type="button"
						className="app-header__settings tap-target"
						onClick={onOpenSettings}
						aria-label="Settings"
						title="Settings"
					>
						⚙
					</button>
				)}

				<button
					type="button"
					className="app-header__signout tap-target"
					onClick={onSignOut}
					aria-label={`Sign out ${email}`}
					title={email}
				>
					Sign out
				</button>
			</div>
		</header>
	);
}
