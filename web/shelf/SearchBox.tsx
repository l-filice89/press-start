import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { searchShelf } from './api';
import './search-box.css';

/**
 * The persistent whole-library search (FR-19, UX-DR16). A combobox that queries
 * a dedicated `/api/shelf/search` endpoint — separate from the shelf query, so
 * it matches every game ignoring active filters and hidden states — and lists
 * the matches in a popup listbox. Read-only in this epic: there is no detail
 * view yet (Epic 2), so selecting an option is a no-op; the value is that
 * matches are found and keyboard-reachable.
 *
 * A global "/" shortcut focuses the field (unless the user is already typing in
 * a form control), per the accessibility floor.
 */
export function SearchBox() {
	const [value, setValue] = useState('');
	const [debounced, setDebounced] = useState('');
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const listboxId = useId();

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
	// Only declare NO MATCH once the query has actually settled — otherwise the
	// empty result flashes while the dedicated search request is still in flight.
	const showNoMatch = !hasMatches && !isFetching;

	function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setOpen(true);
			if (matches.length > 0)
				setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (matches.length > 0) setActiveIndex((i) => Math.max(i - 1, 0));
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
				// Close the listbox when focus leaves the field (selecting is a no-op
				// this epic, so no option can steal the blur).
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
						>
							{game.title}
						</div>
					))}
					{showNoMatch && (
						// A status message, not a selectable option — so AT doesn't
						// count "NO MATCH" as a choosable listbox entry.
						<div className="search-box__empty" role="presentation">
							NO MATCH
						</div>
					)}
				</div>
			)}
		</div>
	);
}
