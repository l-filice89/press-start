import './attention-banner.css';

/**
 * Full-width needs-action notice under the header (UX-DR11). Persistent — it
 * never auto-dismisses; it stays until the underlying condition self-resolves
 * (that lifecycle is owned by later stories that feed it). This is NFR-4 made
 * visible. Reusable seam; rendered with no live data in this shell.
 *
 * Variants map to a tone (DESIGN.md): stragglers = amber, expired-cookie =
 * magenta, failed-refresh = steel.
 */
export type AttentionVariant =
	| 'stragglers'
	| 'expired-cookie'
	| 'failed-refresh';

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
			// Variant-scoped: two banners can coexist (expired cookie + sync
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
