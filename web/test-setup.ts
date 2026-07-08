import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Lives under web/ (not test/) so it compiles under tsconfig.app's DOM lib;
// test/ is the Worker/D1 project, which has no DOM.

// Unmount React trees between tests so timers/effects don't leak across cases.
afterEach(cleanup);

/**
 * jsdom ships no `matchMedia`, but the reduced-motion paths (and any future
 * responsive hooks) read it. Default to "no preference"; individual tests can
 * override the return value.
 */
if (!window.matchMedia) {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}));
}

// The LiveRegion announcer uses requestAnimationFrame; guarantee it exists and
// is timer-backed so tests drive it deterministically.
if (!window.requestAnimationFrame) {
	window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
		setTimeout(() => cb(Date.now()), 0) as unknown as number;
	window.cancelAnimationFrame = (id: number): void =>
		clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}
