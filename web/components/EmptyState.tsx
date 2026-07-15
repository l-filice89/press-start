import './empty-state.css';

/**
 * Arcade empty-state (EXPERIENCE.md Empty states). The one place, with the
 * wordmark, where personality is dialled up. Two variants:
 *  - `insert-games`: empty library → "INSERT GAMES" (shelf mount placeholder
 *    in this shell; Story 1.7 renders the real shelf, 1.6 seeds it).
 *  - `no-match`: filters/search matched nothing → "NO MATCH".
 *
 * Actions are optional and NOT rendered when omitted — no dead CTA buttons for
 * features that don't exist yet (Sync = Epic 4, Add = Epic 6).
 */
type EmptyVariant =
	| 'insert-games'
	| 'no-match'
	| 'no-region'
	| 'empty-catalog'
	| 'game-not-found'
	| 'page-not-found';

const COPY: Record<EmptyVariant, { headline: string; subtext: string }> = {
	'insert-games': {
		headline: 'INSERT GAMES',
		subtext: 'Your shelf is empty. Sync your library or add a game to begin.',
	},
	'no-match': {
		headline: 'NO MATCH',
		subtext: 'No games match the current filters.',
	},
	// The catalog's three causes get three answers (Story 7.2, NFR-4) — never a
	// blank grid, and never one shrug that covers all of them. The third cause (a
	// FAILED refresh) is the existing attention banner plus the stale grid, so it
	// has no variant here: an empty state would replace the catalog it still has.
	'no-region': {
		headline: 'NO REGION',
		subtext:
			'The PS+ catalog is per-region. Set your PlayStation region to see it.',
	},
	'empty-catalog': {
		headline: 'EMPTY CATALOG',
		subtext: 'Run Check PS+ Extra to load the catalog for your region.',
	},
	// A resolved 404 on `/game/:id` (Story 7.2 review, H4). It is NOT `no-match`:
	// no filter is involved, and "no games match the current filters" on a pasted
	// link is a lie. The game is gone (or never was) — say that.
	'game-not-found': {
		headline: 'GAME NOT FOUND',
		subtext: 'That game isn’t in your library — it may have been removed.',
	},
	// An unknown URL (review, M10) — `/catlog`, `/game/` with no id. Without this
	// the shelf rendered silently at whatever address you mistyped.
	'page-not-found': {
		headline: 'PAGE NOT FOUND',
		subtext: 'That address doesn’t exist. Head back to your shelf.',
	},
};

export type EmptyAction = { label: string; onClick: () => void };

export function EmptyState({
	variant,
	actions,
}: {
	variant: EmptyVariant;
	actions?: EmptyAction[];
}) {
	const { headline, subtext } = COPY[variant];
	return (
		<div className="empty-state" data-testid="empty-state">
			{/* tabIndex={-1}: the programmatic focus target when the shelf grid
			    unmounts to this state while holding focus (Story 3.5) and no action
			    button is rendered — focus must land somewhere deliberate, not <body>. */}
			<p className="empty-state__headline" tabIndex={-1}>
				{headline}
			</p>
			<p className="empty-state__subtext">{subtext}</p>
			{actions && actions.length > 0 && (
				<div className="empty-state__actions">
					{actions.map((a) => (
						<button
							key={a.label}
							type="button"
							className="empty-state__action tap-target"
							onClick={a.onClick}
						>
							{a.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
