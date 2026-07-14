import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { AddGameDialog } from './AddGameDialog';
import './search-box.css';

/**
 * The persistent search (FR-19, UX-DR16) — and, on the Shelf, the sole Add
 * entry point (Story 6.1, FR-41/42).
 *
 * Story 7.2 (AD-25): the term is `?q=` in the URL, not a window CustomEvent.
 * `SEED_SEARCH_EVENT` / `SHELF_SEARCH_EVENT` are DELETED — a fire-and-forget
 * event is swallowed when its listener has not mounted yet (the Epic 6
 * mount-race), while a URL is still there when the reader arrives. That is also
 * why the module-scope "last broadcast term" mirror is gone: the URL *is* the
 * retained value.
 *
 * The term belongs to the ACTIVE DESTINATION. One box in the header, but it
 * writes only the current route's `?q=` — and the header toggle navigates to the
 * bare path, so switching destinations CLEARS it. One input feeding two
 * destinations' params would rebuild "two live surfaces from one input" through
 * the URL, which is the very bug class the router refactor closes.
 *
 * The pinned `＋ Add "<term>"` bar is SHELF-ONLY: you cannot conjure a game into
 * Sony's catalog by typing it, so the Catalog answers a miss with NO MATCH.
 *
 * A global "/" shortcut focuses the field (unless already typing in a form
 * control), per the accessibility floor.
 */
export function SearchBox() {
	const [searchParams, setSearchParams] = useSearchParams();
	const location = useLocation();
	const pathname = location.pathname;
	const onCatalog = pathname.startsWith('/catalog');
	const term = searchParams.get('q') ?? '';

	const [value, setValue] = useState(term);
	const [addTitle, setAddTitle] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	// The destination the CURRENT keystrokes were typed on. A pending debounce
	// belongs to that destination and to no other (review, H1).
	const typedOn = useRef(pathname);

	// The URL is the source of truth: a destination switch (term cleared), a
	// jump-to-problem navigation (Story 4.3, now `/?q=<title>`), or Back all
	// re-seed the field. Local state exists only so typing is not a round trip.
	//
	// Re-seeds ONLY when the URL says something different from what is typed
	// (review, H2): `?q=` holds the TRIMMED term, so an unconditional overwrite
	// would delete the trailing space of "Final " out from under the caret the
	// moment the debounce landed, and the next keystroke would read "FinalF".
	// Keyed on the PATHNAME as well: a term typed but not yet settled has no `?q=`
	// to change, so on a destination switch `term` is '' on both sides and the
	// field would keep showing the shelf's word while searching the catalog.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a TRIGGER, not a read — a destination switch with no settled term must still clear the field.
	useEffect(() => {
		setValue((current) => (current.trim() === term ? current : term));
	}, [term, pathname]);

	// Debounce so the destination re-filters per pause, not per keystroke. The
	// write REPLACES the history entry — typing must not stack 12 Back steps.
	//
	// A route change between the keystroke and the timer ABANDONS the write: the
	// term belongs to the destination it was typed on, and switching within the
	// debounce window must not carry a stale shelf term into `/catalog?q=`
	// (review, H1 — the guarantee this story exists to make).
	useEffect(() => {
		const trimmed = value.trim();
		if (typedOn.current !== pathname) return;
		if (trimmed === term) return;
		const timer = setTimeout(() => {
			setSearchParams(
				(prev) => {
					const next = new URLSearchParams(prev);
					if (trimmed) next.set('q', trimmed);
					else next.delete('q');
					return next;
				},
				{ replace: true },
			);
		}, 200);
		return () => clearTimeout(timer);
	}, [value, term, pathname, setSearchParams]);

	// The routed jump (Story 4.3): the sync summary navigates to `/?q=<title>`
	// with `focusSearch`, and the field takes focus once the term lands. Routed
	// state, not an event — a modal closing before the box mounts can't lose it.
	// Keyed on `location.key` as well as the flag (review, L2): the flag is `true`
	// on every jump, so with the flag alone the effect fires ONCE and a second
	// "Find in library" — the banner reopened on another item — would not focus.
	const focusSearch = (location.state as { focusSearch?: boolean } | null)
		?.focusSearch;
	const locationKey = location.key;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `locationKey` is the TRIGGER — the flag itself never changes value, so every jump needs a new key to re-focus.
	useEffect(() => {
		if (focusSearch) inputRef.current?.focus();
	}, [focusSearch, locationKey]);

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

	const label = onCatalog ? 'Search the catalog' : 'Search your library';
	const trimmed = value.trim();

	return (
		<div className="search-box">
			<input
				ref={inputRef}
				type="search"
				className="search-box__input"
				placeholder={label}
				aria-label={label}
				value={value}
				onChange={(e) => {
					typedOn.current = pathname;
					setValue(e.target.value);
				}}
			/>
			{/* Shelf-only Add bar (redesign 2026-07-12): reachable for ANY non-empty
			    term, matches or not — the FF fix. Seeds the IGDB-prefilled preview
			    dialog; a name that already exists 409s → routes to its detail (FR-42). */}
			{!onCatalog && trimmed !== '' && (
				<button
					type="button"
					className="search-box__add tap-target"
					data-testid="search-add-option"
					onClick={() => setAddTitle(trimmed)}
				>
					＋ Add “{trimmed}”
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
