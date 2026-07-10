import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { fetchGenreVocabulary } from './api';
import { LIVE_STATUSES, type ShelfFilter, toggleSelection } from './filters';
import './filter-row.css';

/**
 * The shelf filter row (Story 3.1, FR-20/21/22): a State multiselect (the four
 * live statuses) and a Genre multiselect (the full vocabulary, reused from the
 * `['genres']` query). Each dropdown is an ARIA menu button with
 * `menuitemcheckbox` rows — toggling a row does NOT close the menu, so several
 * values can be picked in one visit. The trigger carries the selected count and
 * a highlighted active state (FR-22), with `aria-expanded`/`aria-checked`
 * making both machine-readable — never color alone.
 *
 * Filter state lives in `Shelf`; this row only renders and toggles it. It never
 * touches the whole-library search path (separate query by design).
 */
export function FilterRow({
	filter,
	onChange,
}: {
	filter: ShelfFilter;
	onChange: (next: ShelfFilter) => void;
}) {
	const {
		data: genres = [],
		isError,
		isPending,
	} = useQuery({
		queryKey: ['genres'],
		queryFn: ({ signal }) => fetchGenreVocabulary(signal),
	});

	// A selected genre missing from the vocabulary (last game untagged, then a
	// refetch) must stay uncheckable-off — never a filter the user can't remove.
	const genreOptions = [
		...genres,
		...filter.genres.filter((g) => !genres.includes(g)),
	];

	return (
		<div className="filter-row" data-testid="filter-row">
			<FilterDropdown
				label="State"
				testid="filter-state"
				options={LIVE_STATUSES}
				selected={filter.states}
				onToggle={(state) =>
					onChange({ ...filter, states: toggleSelection(filter.states, state) })
				}
			/>
			<FilterDropdown
				label="Genre"
				testid="filter-genre"
				options={genreOptions}
				selected={filter.genres}
				// Failures surface, never silently: a dead vocabulary query must not
				// read as "no genres exist".
				emptyText={
					isError
						? 'Genres couldn’t load'
						: isPending
							? 'Loading genres…'
							: 'No genres yet'
				}
				onToggle={(genre) =>
					onChange({ ...filter, genres: toggleSelection(filter.genres, genre) })
				}
			/>
		</div>
	);
}

/** One multiselect dropdown: trigger button + checkbox menu. */
function FilterDropdown<T extends string>({
	label,
	options,
	selected,
	onToggle,
	testid,
	emptyText = 'No options',
}: {
	label: string;
	options: readonly T[];
	selected: T[];
	onToggle: (value: T) => void;
	testid: string;
	emptyText?: string;
}) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const menuId = useId();
	const active = selected.length > 0;

	const close = useCallback((returnFocus = true) => {
		setOpen(false);
		if (returnFocus) triggerRef.current?.focus();
	}, []);

	// Focus the first row once the menu is rendered (preventScroll: the scroll
	// handler below reads any scroll as outside activity — same rationale as
	// StatusPopover).
	useEffect(() => {
		if (!open) return;
		itemRefs.current[0]?.focus({ preventScroll: true });
	}, [open]);

	// Close on outside pointer press, scroll, or resize (anchored placement).
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (
				menuRef.current?.contains(target) ||
				triggerRef.current?.contains(target)
			) {
				return;
			}
			close(false);
		};
		const onScroll = (e: Event) => {
			if (menuRef.current?.contains(e.target as Node)) return;
			close(false);
		};
		const onResize = () => close(false);
		document.addEventListener('pointerdown', onPointerDown);
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onResize);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onResize);
		};
	}, [open, close]);

	const onTriggerKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setOpen(true);
		} else if (e.key === 'Escape' && open) {
			// The universal dismiss must work even when no row holds focus
			// (empty/pending vocabulary leaves focus on the trigger).
			e.preventDefault();
			close();
		}
	};

	const onMenuKeyDown = (e: React.KeyboardEvent, index: number) => {
		const last = options.length - 1;
		let target: number | null = null;
		switch (e.key) {
			case 'ArrowDown':
				target = index === last ? 0 : index + 1;
				break;
			case 'ArrowUp':
				target = index === 0 ? last : index - 1;
				break;
			case 'Home':
				target = 0;
				break;
			case 'End':
				target = last;
				break;
			case 'Escape':
				e.preventDefault();
				e.stopPropagation();
				close();
				return;
			case 'Tab':
				// Focus is leaving the menu — close behind it, let the browser move.
				close(false);
				return;
			default:
				return;
		}
		e.preventDefault();
		itemRefs.current[target]?.focus();
	};

	return (
		<span className="filter-row__dropdown">
			<button
				ref={triggerRef}
				type="button"
				className="filter-row__trigger tap-target"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				aria-label={
					active ? `${label} — ${selected.length} selected` : undefined
				}
				data-active={active || undefined}
				data-testid={testid}
				onClick={() => (open ? close() : setOpen(true))}
				onKeyDown={onTriggerKeyDown}
			>
				{label}
				{active && (
					<span className="filter-row__count" aria-hidden="true">
						{selected.length}
					</span>
				)}
			</button>

			{open && (
				<div
					ref={menuRef}
					id={menuId}
					role="menu"
					className="filter-row__menu"
					aria-label={`${label} filters`}
					data-testid={`${testid}-menu`}
				>
					{options.length === 0 && (
						// A menu must own menuitems — the placeholder is an inert one.
						<button
							type="button"
							role="menuitem"
							aria-disabled="true"
							tabIndex={-1}
							className="filter-row__empty"
						>
							{emptyText}
						</button>
					)}
					{options.map((option, index) => (
						<button
							key={option}
							ref={(el) => {
								itemRefs.current[index] = el;
							}}
							type="button"
							role="menuitemcheckbox"
							aria-checked={selected.includes(option)}
							tabIndex={-1}
							className="filter-row__item tap-target"
							onClick={() => onToggle(option)}
							onKeyDown={(e) => onMenuKeyDown(e, index)}
						>
							{option}
						</button>
					))}
				</div>
			)}
		</span>
	);
}
