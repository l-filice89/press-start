import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useAnnounce } from '../components/LiveRegion';
import { AddGameDialog } from './AddGameDialog';
import { searchShelf } from './api';
import { openDetail } from './open-detail';
import './search-box.css';

/**
 * Seed the whole-library search from anywhere (Story 4.3 jump-to-problem):
 * fills the field, focuses it, and opens the listbox. A window event, not
 * context — the SearchBox owns its state and callers shouldn't.
 */
export const SEED_SEARCH_EVENT = 'shelf:seed-search';

export function seedSearch(query: string): void {
	window.dispatchEvent(new CustomEvent(SEED_SEARCH_EVENT, { detail: query }));
}

/**
 * Lift the live search term to the visible shelf (Story 6.5). The shelf grid is
 * a sibling under AppShell, so — like SEED/OPEN_DETAIL — the term travels by a
 * window event, not a threaded prop. Payload is the already-debounced/trimmed
 * value; the shelf narrows its cards by title substring, distinct from the
 * combobox suggestions this box drives against the server.
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
 * The persistent whole-library search (FR-19, UX-DR16) — and the sole Add
 * entry point (Story 6.1, FR-41/42). A combobox querying the dedicated
 * `/api/shelf/search` endpoint (matches every game, ignoring active filters
 * and hidden states). Picking a match opens its detail view instead of ever
 * creating a duplicate; when nothing matches, the one option is
 * `＋ Add "<name>"`, which opens the IGDB-prefilled preview dialog.
 *
 * A global "/" shortcut focuses the field (unless the user is already typing in
 * a form control), per the accessibility floor.
 */
export function SearchBox() {
	const [value, setValue] = useState('');
	const [debounced, setDebounced] = useState('');
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [addTitle, setAddTitle] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const listboxId = useId();
	const announce = useAnnounce();

	// Debounce so a dedicated query fires per pause, not per keystroke.
	useEffect(() => {
		const trimmed = value.trim();
		const timer = setTimeout(() => setDebounced(trimmed), 200);
		return () => clearTimeout(timer);
	}, [value]);

	const { data: matches = [], isFetching } = useQuery({
		queryKey: ['shelf-search', debounced],
		queryFn: ({ signal }) => searchShelf(debounced, signal),
		enabled: debounced !== '',
	});

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

	// Jump-to-problem seed (Story 4.3): fill, skip the debounce, focus, open.
	useEffect(() => {
		function onSeed(e: Event) {
			const query = (e as CustomEvent<string>).detail?.trim();
			if (!query) return;
			setValue(query);
			setDebounced(query);
			setOpen(true);
			setActiveIndex(-1);
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

	const showPopup = open && debounced !== '';
	const hasMatches = matches.length > 0;
	// Only offer Add once the query has actually settled — otherwise the row
	// flashes while the dedicated search request is still in flight (FR-41:
	// the row appears only when there is NO library match).
	const showAddRow = showPopup && !hasMatches && !isFetching;
	// One flat option list: library matches, or the single Add row.
	const optionCount = hasMatches ? matches.length : showAddRow ? 1 : 0;

	// Announce the settled result set via the polite live region (UX-DR16):
	// listbox contents alone aren't spoken while typing.
	const lastAnnounced = useRef('');
	useEffect(() => {
		if (!showPopup || isFetching || debounced === '') return;
		const message = hasMatches
			? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}.`
			: `No library match. Add "${debounced}" available.`;
		if (lastAnnounced.current === message) return;
		lastAnnounced.current = message;
		announce(message);
	}, [showPopup, isFetching, hasMatches, matches.length, debounced, announce]);

	function selectOption(index: number) {
		if (hasMatches) {
			const game = matches[index];
			if (!game) return;
			// A library match opens its detail view — never a duplicate (FR-42).
			openDetail(game.id);
		} else {
			setAddTitle(debounced);
		}
		setOpen(false);
		setActiveIndex(-1);
	}

	function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setOpen(true);
			if (optionCount > 0)
				setActiveIndex((i) => Math.min(i + 1, optionCount - 1));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (optionCount > 0) setActiveIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === 'Enter') {
			if (showPopup && activeIndex >= 0) {
				e.preventDefault();
				selectOption(activeIndex);
			}
		} else if (e.key === 'Escape') {
			setOpen(false);
			setActiveIndex(-1);
		}
	}

	return (
		<div className="search-box">
			<input
				ref={inputRef}
				type="search"
				role="combobox"
				className="search-box__input"
				placeholder="Search your library"
				aria-label="Search your library"
				aria-expanded={showPopup}
				aria-controls={listboxId}
				aria-autocomplete="list"
				aria-activedescendant={
					showPopup && activeIndex >= 0
						? `${listboxId}-opt-${activeIndex}`
						: undefined
				}
				value={value}
				onChange={(e) => {
					setValue(e.target.value);
					setOpen(true);
					setActiveIndex(-1);
				}}
				onFocus={() => setOpen(true)}
				// Close the listbox when focus leaves the field. Option activation
				// happens on mousedown (with preventDefault), so it wins over this.
				onBlur={() => setOpen(false)}
				onKeyDown={onInputKeyDown}
			/>
			{showPopup && (
				<div className="search-box__listbox" role="listbox" id={listboxId}>
					{matches.map((game, index) => (
						<div
							key={game.id}
							id={`${listboxId}-opt-${index}`}
							role="option"
							tabIndex={-1}
							aria-selected={index === activeIndex}
							className={`search-box__option${index === activeIndex ? ' search-box__option--active' : ''}`}
							// mousedown, not click: it runs before the input's blur closes
							// the listbox, and preventDefault keeps focus in the field.
							onMouseDown={(e) => {
								e.preventDefault();
								selectOption(index);
							}}
						>
							{game.title}
						</div>
					))}
					{showAddRow && (
						// The one selectable row when nothing matches (FR-41): a real
						// option, keyboard-reachable via the combobox.
						<div
							id={`${listboxId}-opt-0`}
							role="option"
							tabIndex={-1}
							aria-selected={activeIndex === 0}
							className={`search-box__option search-box__option--add${activeIndex === 0 ? ' search-box__option--active' : ''}`}
							data-testid="search-add-option"
							onMouseDown={(e) => {
								e.preventDefault();
								selectOption(0);
							}}
						>
							＋ Add “{debounced}”
						</div>
					)}
				</div>
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
