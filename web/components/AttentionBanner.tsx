import './attention-banner.css';

/**
 * Full-width needs-action notice under the header (UX-DR11). Persistent — it
 * never auto-dismisses; it stays until the underlying condition self-resolves
 * (that lifecycle is owned by later stories that feed it). This is NFR-4 made
 * visible. Reusable seam; rendered with no live data in this shell.
 *
 * Variants map to a tone (DESIGN.md): stragglers = amber, failed-refresh =
 * steel. `enrich` (Story 6.2) is a second amber source — games needing a
 * games-DB match — kept distinct from `stragglers` (sync conflicts) so the two
 * attention sources address unambiguously. (`expired-token` died with the PSN
 * credential surface, Epic 11 story 11.2.)
 */
export type AttentionVariant =
	| 'stragglers'
	| 'enrich'
	| 'failed-refresh'
	// Story 10.1: the scheduled IGDB score refresh failed (steel, same tone
	// family as the PS+ failed-refresh — a background job, not a user task).
	| 'failed-score-refresh';

export function AttentionBanner({
	variant,
	message,
	action,
}: {
	variant: AttentionVariant;
	message: string;
	action?: { label: string; onClick: () => void };
}) {
	return (
		<div
			className={`attention-banner attention-banner--${variant}`}
			role="status"
			aria-live="polite"
			// Variant-scoped: two banners can coexist (expired token + sync
			// needs-attention) and tests must address one unambiguously.
			data-testid={`attention-banner-${variant}`}
		>
			<span className="attention-banner__message">{message}</span>
			{action && (
				<button
					type="button"
					className="attention-banner__action tap-target"
					onClick={action.onClick}
				>
					{action.label}
				</button>
			)}
		</div>
	);
}
