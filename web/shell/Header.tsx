import type { ReactNode } from 'react';
import { Wordmark } from './Wordmark';
import './header.css';

/**
 * The shell header (EXPERIENCE.md IA + Responsive deltas). Holds the wordmark,
 * a persistent search slot (header-left on desktop, bottom-pinned on phone),
 * a library readout slot (full "PS+ CATALOG AS OF …" desktop / compact count
 * phone), and the sign-out control.
 *
 * The readout stays a placeholder — the `PS+ CATALOG AS OF …` date is Epic 5.
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
}: {
	email: string;
	onSignOut: () => void;
	onOpenSettings?: () => void;
	signOutFailed?: boolean;
	search?: ReactNode;
}) {
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
				{/* Readout slot — dashes until the seed populates the library. */}
				<span className="app-header__readout" data-testid="readout">
					<span className="app-header__readout-full">PS+ CATALOG AS OF —</span>
					<span className="app-header__readout-compact">— · — OWNED</span>
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
