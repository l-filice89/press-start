import { useEffect, useRef, useState } from 'react';
import { AddGameDialog } from './AddGameDialog';
import './search-box.css';

/**
 * Seed the shelf search from anywhere (Story 4.3 jump-to-problem): fills the
 * field, focuses it, and (via the debounce shortcut) filters the shelf. A
 * window event, not context — the SearchBox owns its state and callers shouldn't.
 */
export const SEED_SEARCH_EVENT = 'shelf:seed-search';

export function seedSearch(query: string): void {
	window.dispatchEvent(new CustomEvent(SEED_SEARCH_EVENT, { detail: query }));
}

/**
 * Lift the live search term to the visible shelf (Story 6.5). The shelf grid is
 * a sibling under AppShell, so — like SEED/OPEN_DETAIL — the term travels by a
 * window event, not a threaded prop. Payload is the already-debounced/trimmed
 * value; the shelf narrows (or, with no filter, whole-library searches) its
 * cards by title substring.
 */
export const SHELF_SEARCH_EVENT = 'shelf:search-term';

// A window CustomEvent has no retained last value, so a shelf that mounts (or
// remounts after a refetch drops it to the skeleton) AFTER the last dispatch
// would start unfiltered while the input still shows a term. Mirror the last
// broadcast term in module scope — the same one-truth-across-instances pattern
// as useTrackingMutations' IN_FLIGHT — so a fresh FilteredShelf seeds from it.
let lastBroadcastTerm = '';
export function currentShelfSearchTerm(): string {
	return lastBroadcastTerm;
}

/**
 * The persistent shelf search (FR-19, UX-DR16) — and the sole Add entry point
 * (Story 6.1, FR-41/42). A plain search input that live-filters the visible
 * shelf (Story 6.5): with no filter active it searches the WHOLE library
 * (hidden states included, done shelf-side); with a filter it narrows within
 * it. There is no suggestion dropdown — the shelf grid IS the one result
 * surface, so two competing surfaces can't confuse (redesign 2026-07-12).
 *
 * A pinned `＋ Add "<term>"` bar sits under the field for ANY non-empty term —
 * matches or not — so the original "Final Fantasy" is always addable even when
 * FF2–16 match (the old zero-matches-only Add row couldn't reach it). Add is
 * dedup-safe: AddGameDialog answers a 409 by opening the existing game.
 *
 * A global "/" shortcut focuses the field (unless already typing in a form
 * control), per the accessibility floor.
 */
export function SearchBox() {
	const [value, setValue] = useState('');
	const [debounced, setDebounced] = useState('');
	const [addTitle, setAddTitle] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	// Debounce so the shelf re-filters per pause, not per keystroke.
	useEffect(() => {
		const trimmed = value.trim();
		const timer = setTimeout(() => setDebounced(trimmed), 200);
		return () => clearTimeout(timer);
	}, [value]);

	// Re-broadcast every settled term to the shelf grid (Story 6.5), and mirror it
	// in module scope so a shelf that mounts between dispatches still picks it up
	// (a live listener can't be relied on across the shelf's skeleton→grid gap).
	useEffect(() => {
		lastBroadcastTerm = debounced;
		window.dispatchEvent(
			new CustomEvent(SHELF_SEARCH_EVENT, { detail: debounced }),
		);
	}, [debounced]);

	// Clear the module mirror when the box unmounts (logout/teardown) so a next
	// session's shelf can't seed a stale term before this remounts and re-emits.
	useEffect(() => {
		return () => {
			lastBroadcastTerm = '';
		};
	}, []);

	// Jump-to-problem seed (Story 4.3): fill, skip the debounce, focus.
	useEffect(() => {
		function onSeed(e: Event) {
			const query = (e as CustomEvent<string>).detail?.trim();
			if (!query) return;
			setValue(query);
			setDebounced(query);
			inputRef.current?.focus();
		}
		window.addEventListener(SEED_SEARCH_EVENT, onSeed);
		return () => window.removeEventListener(SEED_SEARCH_EVENT, onSeed);
	}, []);

	// Global "/" focus shortcut.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key !== '/') return;
			const el = e.target as HTMLElement | null;
			const tag = el?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable)
				return;
			e.preventDefault();
			inputRef.current?.focus();
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	return (
		<div className="search-box">
			<input
				ref={inputRef}
				type="search"
				className="search-box__input"
				placeholder="Search your library"
				aria-label="Search your library"
				value={value}
				onChange={(e) => setValue(e.target.value)}
			/>
			{debounced !== '' && (
				// Pinned Add bar (redesign 2026-07-12): reachable for ANY non-empty
				// term, matches or not — the FF fix. Seeds the same IGDB-prefilled
				// preview dialog; a name that already exists 409s → opens it (FR-42).
				<button
					type="button"
					className="search-box__add tap-target"
					data-testid="search-add-option"
					onClick={() => setAddTitle(debounced)}
				>
					＋ Add “{debounced}”
				</button>
			)}
			{addTitle !== null && (
				<AddGameDialog
					title={addTitle}
					onClose={() => {
						setAddTitle(null);
						inputRef.current?.focus();
					}}
				/>
			)}
		</div>
	);
}
