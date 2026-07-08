import type { EffectiveState } from './api';
import './state-pill.css';

/**
 * The effective-state pill — the always-present text indicator of a card's
 * state (UX accessibility floor: no color-alone signaling, so the label is the
 * signal and color is seasoning). Translucent tint background + light/dark ink
 * per state; never white-on-neon.
 */
const PILL: Record<EffectiveState, { label: string; modifier: string }> = {
	Playing: { label: 'Playing', modifier: 'playing' },
	Paused: { label: 'Paused', modifier: 'paused' },
	'Up next': { label: 'Up next', modifier: 'up-next' },
	'Not started': { label: 'Not started', modifier: 'not-started' },
	Dropped: { label: 'Dropped', modifier: 'dropped' },
	'Platinum achieved': { label: 'Platinum', modifier: 'milestone' },
	'Story completed': { label: 'Completed', modifier: 'milestone' },
};

export function StatePill({ state }: { state: EffectiveState }) {
	const { label, modifier } = PILL[state];
	return (
		<span
			className={`state-pill state-pill--${modifier}`}
			data-testid="state-pill"
		>
			{label}
		</span>
	);
}
