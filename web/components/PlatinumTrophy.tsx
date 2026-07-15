import type { SVGProps } from 'react';

/**
 * The platinum trophy mark: a stroke-only trophy in the app's neon outline
 * style (the emoji renders full-color gold and a grayscale filter reads flat
 * against the glow language). `currentColor` strokes so the caller's colour +
 * glow apply; the small diamond in the cup echoes the owned ◆. Renders the
 * card's platinum badge (its FAB trophy-sync sibling died with Epic 11).
 * Spread props onto the `<svg>` so a caller can add its own `data-testid`.
 */
export function PlatinumTrophy(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			viewBox="0 0 24 24"
			width="1.2em"
			height="1.2em"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		>
			{/* cup */}
			<path d="M7 4h10v4.5a5 5 0 0 1-10 0V4Z" />
			{/* handles */}
			<path d="M7 5.5H4.75V7a3 3 0 0 0 3 3" />
			<path d="M17 5.5h2.25V7a3 3 0 0 1-3 3" />
			{/* stem + base */}
			<path d="M12 13.5V17" />
			<path d="M8.5 20h7" />
			<path d="M10 17h4" />
			{/* the ◆, platinum-sized */}
			<path d="m12 6 1.2 1.75L12 9.5l-1.2-1.75L12 6Z" />
		</svg>
	);
}
