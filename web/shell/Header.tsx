import { type ReactNode, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatDisplayDate } from '../date';
import { useActiveDestination } from '../shelf/detail-navigation';
import { Wordmark } from './Wordmark';
import './header.css';

/** Primary destinations. Everything else surfaces over them. */
const DESTINATIONS = [
	{ path: '/', label: 'SHELF' },
	{ path: '/play-next', label: 'PLAY NEXT' },
	{ path: '/catalog', label: 'CATALOG' },
	{ path: '/stats', label: 'STATS' },
] as const;

/**
 * `SHELF | CATALOG | STATS` — the primary navigation control. Switching
 * navigates to the bare path, which is what CLEARS a live `?q=`: the search term
 * belongs to the destination you are looking at, and carrying it across would
 * rebuild "two live surfaces from one input" through the URL.
 *
 * REAL LINKS (review, L1). They were `<button>`s with no `href`, so ctrl/cmd-
 * click, middle-click and "open in a new tab" were dead on the app's only
 * navigation control — and the `role="tab"` they carried named a tablist with no
 * `aria-controls` and no tabpanel behind it. Two destinations you can link to
 * are NAVIGATION, so this is a `<nav>` of links with `aria-current`; arrow-key
 * traversal and the single-tab-stop roving index are kept.
 */
function DestinationToggle() {
	const navigate = useNavigate();
	// The destination BEHIND an open detail, not the detail's own path: a detail
	// opened from the catalog would otherwise highlight SHELF, because `/game/:id`
	// is neither destination's path. A COLD `/game/:id` has no background and falls
	// back to SHELF — today's behavior, and the honest one (the shelf is what
	// renders behind it).
	const { pathname } = useActiveDestination();
	const refs = useRef<(HTMLAnchorElement | null)[]>([]);
	const activeIndex = pathname.startsWith('/stats')
		? 3
		: pathname.startsWith('/catalog')
			? 2
			: pathname === '/play-next'
				? 1
				: 0;

	return (
		<nav className="destination-toggle" aria-label="Destination">
			{DESTINATIONS.map((destination, index) => (
				<Link
					key={destination.path}
					ref={(el) => {
						refs.current[index] = el;
					}}
					to={destination.path}
					className="destination-toggle__tab tap-target"
					aria-current={index === activeIndex ? 'page' : undefined}
					// Roving tabindex: the pair is ONE tab stop; arrows move within it.
					tabIndex={index === activeIndex ? 0 : -1}
					onKeyDown={(e) => {
						const step =
							e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
						if (step === 0) return;
						e.preventDefault();
						const next =
							(index + step + DESTINATIONS.length) % DESTINATIONS.length;
						refs.current[next]?.focus();
						void navigate(DESTINATIONS[next].path);
					}}
				>
					{destination.label}
				</Link>
			))}
		</nav>
	);
}

/**
 * The shell header (EXPERIENCE.md IA + Responsive deltas). Holds the wordmark,
 * a destination-aware search slot (header-left on desktop, bottom-pinned on phone),
 * a library readout slot (full "PS+ CATALOG AS OF …" desktop / compact count
 * phone), and the sign-out control.
 *
 * The readout shows how fresh the PS+ Extra flags are (Story 5.3): the date of
 * the last successful refresh, full on desktop / compact on phone (the
 * `header.css` `@media` swap), em-dash until the first refresh.
 * The search slot renders whatever `search` node the shell passes (Story 1.7's
 * live combobox); `null` removes it for Stats, while `undefined` retains the
 * disabled placeholder. Sign-out is the FR-47 live control.
 */
export function Header({
	email,
	onSignOut,
	onOpenSettings,
	signOutFailed = false,
	search,
	psPlusRefreshedAt = null,
	catalogRefreshing = false,
}: {
	email: string;
	onSignOut: () => void;
	onOpenSettings?: () => void;
	signOutFailed?: boolean;
	/** `null` removes the slot for destinations without search. */
	search?: ReactNode | null;
	/** Date (YYYY-MM-DD) of the last successful PS+ Extra refresh, or null. */
	psPlusRefreshedAt?: string | null;
	/** A guard-triggered refresh is in flight (Story 8.4) — suffix the readout. */
	catalogRefreshing?: boolean;
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

			<DestinationToggle />

			{search !== null && (
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
			)}

			<div className="app-header__meta">
				{/* Freshness readout (5.3) — em-dash until the first successful refresh. */}
				<span
					className="app-header__readout"
					data-testid="readout"
					aria-live="polite"
				>
					<span className="app-header__readout-full">
						PS+ CATALOG AS OF {refreshedAt}
						{catalogRefreshing ? ' — updating…' : ''}
					</span>
					<span className="app-header__readout-compact">
						PS+ {refreshedAt}
						{catalogRefreshing ? ' — updating…' : ''}
					</span>
				</span>

				{signOutFailed && (
					<span role="alert" className="app-header__error">
						Sign-out failed — try again.
					</span>
				)}

				{/* Permanent Settings entry point (Story 4.1). */}
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
