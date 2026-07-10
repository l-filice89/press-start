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
type EmptyVariant = 'insert-games' | 'no-match';

const COPY: Record<EmptyVariant, { headline: string; subtext: string }> = {
	'insert-games': {
		headline: 'INSERT GAMES',
		subtext: 'Your shelf is empty. Sync your library or add a game to begin.',
	},
	'no-match': {
		headline: 'NO MATCH',
		subtext: 'No games match the current filters.',
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
