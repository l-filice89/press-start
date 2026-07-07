import { Wordmark } from './Wordmark';
import './header.css';

/**
 * The shell header (EXPERIENCE.md IA + Responsive deltas). Holds the wordmark,
 * a persistent search slot (header-left on desktop, bottom-pinned on phone),
 * a library readout slot (full "PS+ CATALOG AS OF …" desktop / compact count
 * phone), and the sign-out control.
 *
 * Search + readout are placeholders in this shell — there's no library data
 * until the seed (1.6) and no search until 1.7. The search field is rendered
 * disabled (not a dead action) purely to establish its design + responsive
 * placement; sign-out is the one live control (preserves FR-47).
 */
export function Header({
	email,
	onSignOut,
	signOutFailed = false,
}: {
	email: string;
	onSignOut: () => void;
	signOutFailed?: boolean;
}) {
	return (
		<header className="app-header">
			<div className="app-header__brand">
				<Wordmark variant="compact" showTagline />
			</div>

			{/* Search slot — 1.7 replaces this disabled placeholder with the real
			    find-or-add combobox. */}
			<div className="app-header__search">
				<input
					type="search"
					className="app-header__search-input"
					placeholder="Find or add a game"
					aria-label="Search your library (available once your shelf is set up)"
					disabled
				/>
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
