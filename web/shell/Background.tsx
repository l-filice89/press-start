import './background.css';

/**
 * The signature void texture (DESIGN.md Colors/Brand): a near-black background
 * carrying a faint Tron light-grid and a subtle blue→magenta radial wash behind
 * the shelf. Purely decorative — `aria-hidden`, fixed behind all content, and
 * pointer-transparent. The grid/wash are static (no motion to cut).
 */
export function Background() {
	return <div className="app-background" aria-hidden="true" />;
}
