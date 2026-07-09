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
import { useAnnounce } from './LiveRegion';
import './toast.css';

/**
 * Transient bottom confirmation (UX-DR12/17): status change / add / milestone.
 * Auto-dismisses after ~3s (~6s when undoable) and announces via the polite
 * live region. Reversible risky actions (mark Dropped, un-own) pass `onUndo`
 * to render a one-tap UNDO that cancels the dismiss (milestones are already
 * confirm-gated, so they need no undo). Reusable seam — later stories call
 * `useToast().toast(...)`.
 */
export const TOAST_DURATION_MS = 3000;
/** Undoable toasts stay longer — 3s is too short to spot and reach UNDO. */
export const UNDO_TOAST_DURATION_MS = 6000;

type ToastSpec = {
	message: string;
	undo?: { label?: string; onUndo: () => void };
};

/** A single toast that owns its own dismiss timer + announcement. */
export function Toast({
	message,
	onUndo,
	undoLabel = 'Undo',
	onDismiss,
	duration,
}: {
	message: string;
	onUndo?: () => void;
	undoLabel?: string;
	onDismiss?: () => void;
	/** Explicit value always wins; the default depends on undoability. */
	duration?: number;
}) {
	duration ??= onUndo ? UNDO_TOAST_DURATION_MS : TOAST_DURATION_MS;
	const announce = useAnnounce();
	const dismissedRef = useRef(false);
	const announcedRef = useRef(false);
	// Latest onDismiss without making it an effect dep — the host passes a fresh
	// closure on every render, and depending on it would reset a visible toast's
	// timer (and re-announce it) every time a *sibling* toast is enqueued.
	const onDismissRef = useRef(onDismiss);
	onDismissRef.current = onDismiss;

	// Hover/focus pauses auto-dismiss so keyboard/AT users can reach UNDO before
	// it vanishes (WCAG 2.2.1 Timing Adjustable); it resumes on leave/blur.
	const [paused, setPaused] = useState(false);

	const dismiss = useCallback(() => {
		if (dismissedRef.current) {
			return;
		}
		dismissedRef.current = true;
		onDismissRef.current?.();
	}, []);

	// Announce exactly once per toast — guarded so React StrictMode's dev-only
	// remount doesn't double-speak it.
	useEffect(() => {
		if (announcedRef.current) {
			return;
		}
		announcedRef.current = true;
		announce(message);
	}, [announce, message]);

	// Auto-dismiss timer; suspended while paused. `dismiss` is stable, so this
	// runs once per (re)start rather than on every sibling render.
	useEffect(() => {
		if (paused) {
			return;
		}
		const id = setTimeout(dismiss, duration);
		return () => clearTimeout(id);
	}, [dismiss, duration, paused]);

	return (
		<>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: these handlers only pause a dismissal timer (a non-essential WCAG 2.2.1 enhancement); the toast is intentionally NOT a live region (LiveRegion owns the single announcement channel) and carries no other interactive semantics, so no ARIA role applies. */}
			<div
				className="toast"
				data-testid="toast"
				onMouseEnter={() => setPaused(true)}
				onMouseLeave={() => setPaused(false)}
				onFocus={() => setPaused(true)}
				onBlur={() => setPaused(false)}
			>
				<span className="toast__message">{message}</span>
				{onUndo && (
					<button
						type="button"
						className="toast__undo tap-target"
						onClick={() => {
							onUndo();
							dismiss();
						}}
					>
						{undoLabel}
					</button>
				)}
			</div>
		</>
	);
}

/* ---- App-wide toast host ---- */

type ToastFn = (spec: ToastSpec) => void;
const ToastContext = createContext<ToastFn | null>(null);

type Entry = ToastSpec & { id: number };

export function ToastHost({ children }: { children: ReactNode }) {
	const [entries, setEntries] = useState<Entry[]>([]);
	const nextId = useRef(0);

	const toast = useCallback<ToastFn>((spec) => {
		const id = nextId.current++;
		setEntries((prev) => [...prev, { ...spec, id }]);
	}, []);

	const remove = useCallback((id: number) => {
		setEntries((prev) => prev.filter((e) => e.id !== id));
	}, []);

	const value = useMemo(() => toast, [toast]);

	return (
		<ToastContext.Provider value={value}>
			{children}
			<div className="toast-host" data-testid="toast-host">
				{entries.map((e) => (
					<Toast
						key={e.id}
						message={e.message}
						onUndo={e.undo?.onUndo}
						undoLabel={e.undo?.label}
						onDismiss={() => remove(e.id)}
					/>
				))}
			</div>
		</ToastContext.Provider>
	);
}

/** Returns `{ toast }`. Outside a host it's a no-op (safe in isolated tests). */
export function useToast(): { toast: ToastFn } {
	const ctx = useContext(ToastContext);
	return { toast: ctx ?? noop };
}

function noop() {
	/* no toast host mounted */
}
