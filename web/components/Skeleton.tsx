import { useMemo } from 'react';
import './skeleton.css';

/**
 * Cover-shaped shimmer placeholder shown on first load (UX-DR12). Decorative:
 * marked `aria-hidden` and the container is `aria-busy`, so assistive tech
 * announces "busy" rather than reading empty boxes. Under prefers-reduced-
 * motion the shimmer sweep is dropped for a static placeholder (UX-DR24, via
 * the CSS query in skeleton.css).
 *
 * `variant="cover"` (default) holds a 3:4 aspect box for the shelf; `text`
 * renders a short line; `block` fills its container.
 */
type SkeletonVariant = 'cover' | 'text' | 'block';

// Monotonic source of stable, unique keys for placeholder tiles — avoids array
// index keys (Biome) without depending on `crypto.randomUUID`, which throws in
// non-secure contexts (e.g. testing the PWA over http://<lan-ip> on a phone).
let skeletonKeySeq = 0;

export function Skeleton({
	variant = 'cover',
	className,
	style,
}: {
	variant?: SkeletonVariant;
	className?: string;
	style?: React.CSSProperties;
}) {
	return (
		<div
			className={`skeleton skeleton--${variant}${className ? ` ${className}` : ''}`}
			aria-hidden="true"
			data-testid="skeleton"
			style={style}
		/>
	);
}

/**
 * A grid of cover skeletons — the shelf's first-load state. `aria-busy` lives
 * on the region so the load is announced once, not per-tile. Story 1.7 swaps
 * this for the real shelf.
 */
export function SkeletonGrid({
	count = 12,
	label = 'Loading your shelf',
}: {
	count?: number;
	label?: string;
}) {
	// Stable, non-index keys for the fixed set of identical placeholders.
	const keys = useMemo(
		() => Array.from({ length: count }, () => `skeleton-${skeletonKeySeq++}`),
		[count],
	);
	return (
		<div
			className="skeleton-grid"
			role="status"
			aria-busy="true"
			aria-label={label}
			data-testid="skeleton-grid"
		>
			{keys.map((key) => (
				<Skeleton key={key} variant="cover" />
			))}
		</div>
	);
}
