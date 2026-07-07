import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

/**
 * Polite live region (UX-DR21 / a11y floor): status changes, milestone logs,
 * and toasts announce here so screen-reader users get non-visual feedback.
 * Reusable seam — later stories call `announce()` from their handlers.
 *
 * The region is visually hidden but present in the accessibility tree. To make
 * repeated identical messages re-announce, we clear the text then set it on the
 * next frame (a screen reader only speaks on a *change* of text content).
 *
 * Announcements are **queued and played out one at a time**: two `announce()`
 * calls in the same tick (e.g. two toasts mounting in one commit) would otherwise
 * clobber each other and only the last would ever be spoken. Each message is held
 * briefly before the next is released so assistive tech registers every change.
 */

type AnnounceFn = (message: string) => void;

const AnnounceContext = createContext<AnnounceFn | null>(null);

// How long each queued message stays in the region before the next is released.
const HOLD_MS = 150;

const srOnly: React.CSSProperties = {
	position: 'absolute',
	width: '1px',
	height: '1px',
	padding: 0,
	margin: '-1px',
	overflow: 'hidden',
	clip: 'rect(0, 0, 0, 0)',
	whiteSpace: 'nowrap',
	border: 0,
};

export function LiveRegionProvider({ children }: { children: ReactNode }) {
	const [message, setMessage] = useState('');
	const queue = useRef<string[]>([]);
	const flushing = useRef(false);
	const rafRef = useRef<number | undefined>(undefined);
	const holdRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// Drain one queued message: clear, set on the next frame, hold, then recurse.
	const pump = useCallback(() => {
		if (flushing.current) {
			return;
		}
		const next = queue.current.shift();
		if (next === undefined) {
			return;
		}
		flushing.current = true;
		// Clear first so an identical repeat message still registers as a change.
		setMessage('');
		rafRef.current = requestAnimationFrame(() => {
			setMessage(next);
			holdRef.current = setTimeout(() => {
				flushing.current = false;
				pump();
			}, HOLD_MS);
		});
	}, []);

	const announce = useCallback<AnnounceFn>(
		(next) => {
			queue.current.push(next);
			pump();
		},
		[pump],
	);

	// Cancel any pending frame/timer if the provider unmounts mid-announcement.
	useEffect(
		() => () => {
			if (rafRef.current !== undefined) {
				cancelAnimationFrame(rafRef.current);
			}
			if (holdRef.current !== undefined) {
				clearTimeout(holdRef.current);
			}
		},
		[],
	);

	const value = useMemo(() => announce, [announce]);

	return (
		<AnnounceContext.Provider value={value}>
			{children}
			<div
				aria-live="polite"
				aria-atomic="true"
				data-testid="live-region"
				style={srOnly}
			>
				{message}
			</div>
		</AnnounceContext.Provider>
	);
}

/**
 * Returns the polite `announce()` function. Outside a provider it returns a
 * no-op, so components (and their unit tests) never crash for lack of one.
 */
export function useAnnounce(): AnnounceFn {
	const ctx = useContext(AnnounceContext);
	return ctx ?? noop;
}

function noop() {
	/* no live region mounted */
}
