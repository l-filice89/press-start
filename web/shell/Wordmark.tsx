import './wordmark.css';

/**
 * The PRESS START wordmark (DESIGN.md Brand): Orbitron 900, neon glow, with a
 * blinking cursor (the blink stops under prefers-reduced-motion). Optional
 * tagline "Want it! Own it! Beat it!" in tracked JetBrains Mono — the game
 * lifecycle in three beats.
 *
 * Legal hard rule: no "PlayStation"/Sony marks in the wordmark or chrome.
 *
 * `variant="hero"` for the login/empty splash; `compact` for the shell header.
 */
export function Wordmark({
	variant = 'compact',
	showTagline = false,
}: {
	variant?: 'hero' | 'compact';
	showTagline?: boolean;
}) {
	return (
		<div className={`wordmark wordmark--${variant}`}>
			<span className="wordmark__lockup">
				<span className="wordmark__text">PRESS START</span>
				<span className="wordmark__cursor" aria-hidden="true" />
			</span>
			{showTagline && (
				<span className="wordmark__tagline">Want it! Own it! Beat it!</span>
			)}
		</div>
	);
}
