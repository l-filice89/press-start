import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalTrap } from '../components/useModalTrap';
import { fetchGenreVocabulary } from './api';
import {
	EMPTY_FILTER,
	FLAGS,
	type FlagKey,
	LIVE_STATUSES,
	REVEAL_STATES,
	type ShelfFilter,
	summarizeFilter,
	TTB_BANDS,
	type TtbMetric,
	toggleSelection,
	ttbBandLabel,
} from './filters';
import './filter-row.css';

/**
 * The shelf filter row (Stories 3.1/3.2/3.5, FR-20/21/22 as amended): a State
 * multiselect (the four live statuses), a Genre multiselect (the full
 * vocabulary, reused from the `['genres']` query), four solid Flag pills
 * (each its own AND group), and three dashed reveal pills — an EXCLUSIVE view
 * of the selected hidden state(s). State and reveals are mutually exclusive:
 * toggling one group on clears the other (FR-21 amended); Genre/Flags still
 * AND. Shape encodes behavior (UX-DR9): solid narrows, dashed reveals.
 * Each dropdown is an ARIA menu button with `menuitemcheckbox` rows —
 * toggling a row does NOT close the menu, so several values can be picked in
 * one visit. Active controls highlight/glow with machine-readable state
 * (`aria-checked`/`aria-pressed`) — never color alone (FR-22).
 *
 * Filter state lives in `Shelf`; this row only renders and toggles it. It never
 * touches the whole-library search path (separate query by design).
 */
export function FilterRow({
	filter,
	onChange,
	visibleCount,
	showPsPlus = false,
	showLeavingSoon = false,
}: {
	filter: ShelfFilter;
	onChange: (next: ShelfFilter) => void;
	visibleCount: number;
	/** Show the "PS+" pill — true when the library holds an in-catalog,
	 *  unowned game (proxy for "has PS+"). Always shown while it's the active
	 *  filter, so a filter can't strand un-removable if the last such game leaves. */
	showPsPlus?: boolean;
	/** Same gating as `showPsPlus`: ≥1 un-owned game with a future leaving date. */
	showLeavingSoon?: boolean;
}) {
	// Hide the PS+/Leaving pills when the library has no matching game, but
	// never while one is the active filter — mirrors the genre
	// "uncheckable-off" guard.
	const flags = FLAGS.filter(
		(f) =>
			(f.key !== 'psPlusExtra' ||
				showPsPlus ||
				filter.flags.includes('psPlusExtra')) &&
			(f.key !== 'leavingSoon' ||
				showLeavingSoon ||
				filter.flags.includes('leavingSoon')),
	);
	const {
		data: genres = [],
		isError,
		isPending,
	} = useQuery({
		queryKey: ['genres'],
		queryFn: ({ signal }) => fetchGenreVocabulary(signal),
	});
	const [sheetOpen, setSheetOpen] = useState(false);
	const sheetTriggerRef = useRef<HTMLButtonElement>(null);

	// A selected genre missing from the vocabulary (last game untagged, then a
	// refetch) must stay uncheckable-off — never a filter the user can't remove.
	const genreOptions = [
		...genres,
		...filter.genres.filter((g) => !genres.includes(g)),
	];

	const activeCount =
		filter.states.length +
		filter.genres.length +
		filter.reveals.length +
		filter.flags.length +
		// Bands only — the metric toggle alone imposes no filter (Story 12.1).
		filter.ttb.bands.length;

	const closeSheet = useCallback(() => {
		setSheetOpen(false);
		sheetTriggerRef.current?.focus();
	}, []);

	return (
		<div className="filter-row" data-testid="filter-row">
			{/* Phone-only entry point (UX-DR26): one button, active-count badge. */}
			<button
				ref={sheetTriggerRef}
				type="button"
				className="filter-row__sheet-trigger tap-target"
				data-active={activeCount > 0 || undefined}
				data-testid="filter-sheet-trigger"
				aria-label={
					activeCount > 0 ? `Filters — ${activeCount} active` : 'Filters'
				}
				onClick={() => setSheetOpen(true)}
			>
				Filters
				{activeCount > 0 && (
					<span className="filter-row__count" aria-hidden="true">
						{activeCount}
					</span>
				)}
			</button>
			{sheetOpen && (
				<FilterSheet
					filter={filter}
					onChange={onChange}
					flags={flags}
					genreOptions={genreOptions}
					genreEmptyText={
						isError
							? 'Genres couldn’t load'
							: isPending
								? 'Loading genres…'
								: 'No genres yet'
					}
					visibleCount={visibleCount}
					onClose={closeSheet}
				/>
			)}
			{/* Full inline row — desktop only; the sheet is the phone surface. */}
			<div className="filter-row__desktop">
				<FilterDropdown
					label="State"
					testid="filter-state"
					options={LIVE_STATUSES}
					selected={filter.states}
					onToggle={(state) =>
						// A state selection leaves any exclusive reveal view (FR-21
						// amended: the two groups are mutually exclusive).
						onChange({
							...filter,
							reveals: [],
							states: toggleSelection(filter.states, state),
						})
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
						onChange({
							...filter,
							genres: toggleSelection(filter.genres, genre),
						})
					}
				/>
				<FilterDropdown
					label="Time"
					testid="filter-ttb"
					options={TTB_BAND_KEYS}
					selected={filter.ttb.bands}
					getOptionLabel={ttbBandLabel}
					getOptionTestId={(key) => `filter-ttb-${key}`}
					// The story/100% metric toggle is pinned at the menu top (signed-off
					// mock) as menuitemradio rows in the SAME roving focus list as the
					// bands: it re-aims every selected band, it is not a band itself.
					menuRadios={{
						testid: 'filter-ttb-metric',
						items: TTB_METRIC_OPTIONS,
						selected: filter.ttb.metric,
						onSelect: (metric) =>
							onChange({ ...filter, ttb: { ...filter.ttb, metric } }),
					}}
					onToggle={(key) =>
						onChange({
							...filter,
							ttb: {
								...filter.ttb,
								bands: toggleSelection(filter.ttb.bands, key),
							},
						})
					}
				/>
				{flags.map(({ key, label }) => (
					<button
						key={key}
						type="button"
						className="filter-row__pill filter-row__pill--flag tap-target"
						aria-pressed={filter.flags.includes(key)}
						data-active={filter.flags.includes(key) || undefined}
						data-testid={`filter-flag-${key}`}
						onClick={() =>
							onChange({ ...filter, flags: toggleSelection(filter.flags, key) })
						}
					>
						{label}
					</button>
				))}
				{REVEAL_STATES.map((state) => (
					<button
						key={state}
						type="button"
						className="filter-row__pill filter-row__pill--reveal tap-target"
						// The reveal semantics must be machine-readable, not shape-alone
						// (UX-DR9 + the never-color-alone floor) — and "Show X" also keeps
						// this button distinct from the milestone action named "X".
						aria-label={`Show only ${state} games`}
						aria-pressed={filter.reveals.includes(state)}
						data-active={filter.reveals.includes(state) || undefined}
						data-testid={`filter-reveal-${state.toLowerCase().replace(/ /g, '-')}`}
						onClick={() =>
							// Exclusive view: activating a reveal replaces the State group
							// entirely — state selections clear (FR-4/FR-21 amended).
							onChange({
								...filter,
								states: [],
								reveals: toggleSelection(filter.reveals, state),
							})
						}
					>
						{state}
					</button>
				))}
			</div>
			<FilterSummary filter={filter} />
		</div>
	);
}

/** Stable option list for the Time dropdown (a fresh array would re-render). */
const TTB_BAND_KEYS = TTB_BANDS.map((b) => b.key);

/** The two metric options, with explicit accessible names — "Story"/"100%"
 *  alone don't say what they aim at (Story 12.1). */
const TTB_METRIC_OPTIONS = [
	{ value: 'story', label: 'Story', ariaLabel: 'Story hours' },
	{ value: 'complete', label: '100%', ariaLabel: '100% hours' },
] as const satisfies readonly {
	value: TtbMetric;
	label: string;
	ariaLabel: string;
}[];

/**
 * The story/100% metric toggle for the PHONE SHEET (Story 12.1): a two-option
 * segmented control, `aria-pressed` carrying the state (never color alone).
 * It lives in filter state, not a global setting; with no bands selected it
 * imposes nothing. The desktop Time MENU does not use this — there the same
 * options render as `menuitemradio` rows inside the menu's roving focus list
 * (see `menuRadios` on FilterDropdown), because a menu may not own plain
 * `aria-pressed` buttons.
 */
function TtbMetricToggle({
	metric,
	onChange,
}: {
	metric: TtbMetric;
	onChange: (metric: TtbMetric) => void;
}) {
	return (
		// Biome's useSemanticElements wants <fieldset> for role="group"; fieldset
		// chrome fights the menu/pill styling — the two aria-pressed buttons carry
		// the state machine-readably on their own.
		<div className="filter-ttb__metric" data-testid="filter-ttb-metric">
			{TTB_METRIC_OPTIONS.map(({ value, label, ariaLabel }) => (
				<button
					key={value}
					type="button"
					className="filter-ttb__metric-option tap-target"
					aria-label={ariaLabel}
					aria-pressed={metric === value}
					data-active={metric === value || undefined}
					onClick={() => onChange(value)}
				>
					{label}
				</button>
			))}
		</div>
	);
}

/**
 * Live plain-English readback of the active filter (Story 3.3, UX-DR23):
 * literal "or"/"and" words, OR tinted glow-cyan and AND heat-magenta — color
 * redundant to the words. Nothing renders while no filter is active.
 */
function FilterSummary({ filter }: { filter: ShelfFilter }) {
	const parts = summarizeFilter(filter);
	if (parts.length === 0) return null;
	return (
		<p className="filter-summary" data-testid="filter-summary">
			{parts.map((part, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: parts are positional tokens of one sentence, re-derived wholesale on every filter change
					key={i}
					className={
						part.connector ? `filter-summary__${part.connector}` : undefined
					}
				>
					{i > 0 ? ' ' : ''}
					{part.text}
				</span>
			))}
		</p>
	);
}

/**
 * Phone bottom sheet (UX-DR26): the same filter state as the inline row, in a
 * grouped, logic-labeled layout. Focus-trapped modal dialog (ConfirmDialog
 * pattern); filters apply live — "Show N games" is the exit, Escape/backdrop
 * close the same way.
 */
function FilterSheet({
	filter,
	onChange,
	flags,
	genreOptions,
	genreEmptyText,
	visibleCount,
	onClose,
}: {
	filter: ShelfFilter;
	onChange: (next: ShelfFilter) => void;
	flags: readonly { key: FlagKey; label: string }[];
	genreOptions: string[];
	genreEmptyText: string;
	visibleCount: number;
	onClose: () => void;
}) {
	const sheetRef = useRef<HTMLDivElement>(null);
	const titleId = useId();

	// Shared modal scaffold (Story 3.5): focus-on-open (the container itself —
	// tabIndex=-1), document-capture Escape, and the Tab cycle.
	const onKeyDown = useModalTrap(sheetRef, onClose);

	// The page behind a modal sheet must not scroll under it (touch overscroll).
	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	}, []);

	// Crossing the breakpoint (rotate to landscape) hides the trigger and shows
	// the inline row — a still-open sheet over it is stale chrome. Same class of
	// problem the dropdowns solve by closing on resize.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	useEffect(() => {
		const mq = window.matchMedia?.('(min-width: 601px)');
		if (!mq) return;
		const onChangeMq = () => {
			if (mq.matches) onCloseRef.current();
		};
		mq.addEventListener('change', onChangeMq);
		return () => mq.removeEventListener('change', onChangeMq);
	}, []);

	const toggleRow = <T extends string>(
		value: T,
		selected: boolean,
		toggle: () => void,
		ariaLabel?: string,
	) => (
		<button
			key={value}
			type="button"
			className="filter-sheet__option tap-target"
			aria-label={ariaLabel}
			aria-pressed={selected}
			data-active={selected || undefined}
			onClick={toggle}
		>
			{value}
		</button>
	);

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the Show-games button are the accessible paths.
		<div
			className="filter-sheet__backdrop"
			data-testid="filter-sheet-backdrop"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={sheetRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="filter-sheet"
				data-testid="filter-sheet"
				onKeyDown={onKeyDown}
			>
				<p id={titleId} className="filter-sheet__title">
					Filters
				</p>
				<div className="filter-sheet__group">
					<p className="filter-sheet__group-label">State — any of (or)</p>
					{LIVE_STATUSES.map((state) =>
						toggleRow(state, filter.states.includes(state), () =>
							// Mirrors the desktop dropdown: leaves any reveal view.
							onChange({
								...filter,
								reveals: [],
								states: toggleSelection(filter.states, state),
							}),
						),
					)}
				</div>
				<div className="filter-sheet__group">
					<p className="filter-sheet__group-label">Genre — any of (or)</p>
					{genreOptions.length === 0 && (
						<p className="filter-sheet__empty">{genreEmptyText}</p>
					)}
					{genreOptions.map((genre) =>
						toggleRow(genre, filter.genres.includes(genre), () =>
							onChange({
								...filter,
								genres: toggleSelection(filter.genres, genre),
							}),
						),
					)}
				</div>
				<div className="filter-sheet__group">
					<p className="filter-sheet__group-label">
						Time to beat — any of (or)
					</p>
					{/* The metric toggle sits above the bands (signed-off mock) — its
					    own row, not a band option. */}
					<div className="filter-sheet__metric">
						<TtbMetricToggle
							metric={filter.ttb.metric}
							onChange={(metric) =>
								onChange({ ...filter, ttb: { ...filter.ttb, metric } })
							}
						/>
					</div>
					{TTB_BANDS.map(({ key, label }) =>
						toggleRow(label, filter.ttb.bands.includes(key), () =>
							onChange({
								...filter,
								ttb: {
									...filter.ttb,
									bands: toggleSelection(filter.ttb.bands, key),
								},
							}),
						),
					)}
				</div>
				<div className="filter-sheet__group">
					<p className="filter-sheet__group-label">Flags — all of (and)</p>
					{flags.map(({ key, label }) =>
						toggleRow(label, filter.flags.includes(key), () =>
							onChange({
								...filter,
								flags: toggleSelection(filter.flags, key),
							}),
						),
					)}
				</div>
				<div className="filter-sheet__group">
					<p className="filter-sheet__group-label">
						Reveal hidden states — show only (or)
					</p>
					{REVEAL_STATES.map((state) =>
						toggleRow(
							state,
							filter.reveals.includes(state),
							() =>
								// Exclusive view — state selections clear (FR-21 amended).
								onChange({
									...filter,
									states: [],
									reveals: toggleSelection(filter.reveals, state),
								}),
							// Same rationale as the desktop pills: machine-readable reveal
							// semantics, distinct from the milestone actions named "X".
							`Show only ${state} games`,
						),
					)}
				</div>
				{visibleCount === 0 && (
					<button
						type="button"
						className="filter-sheet__option tap-target"
						onClick={() => onChange(EMPTY_FILTER)}
					>
						Clear filters
					</button>
				)}
				<button
					type="button"
					className="filter-sheet__show tap-target"
					data-testid="filter-sheet-show"
					onClick={onClose}
				>
					Show {visibleCount} game{visibleCount === 1 ? '' : 's'}
				</button>
			</div>
		</div>,
		document.body,
	);
}

/** One multiselect dropdown: trigger button + checkbox menu. */
function FilterDropdown<T extends string, R extends string = never>({
	label,
	options,
	selected,
	onToggle,
	testid,
	emptyText = 'No options',
	menuRadios,
	getOptionLabel,
	getOptionTestId,
}: {
	label: string;
	options: readonly T[];
	selected: T[];
	onToggle: (value: T) => void;
	testid: string;
	emptyText?: string;
	/**
	 * Radio rows pinned above the option rows (Story 12.1: the Time metric
	 * toggle). Rendered as `menuitemradio` items in the SAME roving focus list
	 * as the checkbox rows — arrows/Home/End traverse radios + options as one
	 * list, and selecting a radio (click/Enter/Space) keeps the menu open,
	 * exactly like the checkbox rows.
	 */
	menuRadios?: {
		testid: string;
		items: readonly { value: R; label: string; ariaLabel: string }[];
		selected: R;
		onSelect: (value: R) => void;
	};
	/** Rendered row text when options are keys, not display labels. */
	getOptionLabel?: (value: T) => string;
	getOptionTestId?: (value: T) => string;
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

	// Radios and option rows share ONE roving focus list: radios first, then
	// the options, each row's index offset accordingly.
	const radioCount = menuRadios?.items.length ?? 0;

	const onMenuKeyDown = (e: React.KeyboardEvent, index: number) => {
		const last = radioCount + options.length - 1;
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
					{menuRadios && (
						// Presentational wrapper only (no role — Biome's
						// useSemanticElements rejects role="group" on a div): the
						// menuitemradio children are the menu's own items.
						<div className="filter-ttb__metric" data-testid={menuRadios.testid}>
							{menuRadios.items.map((item, index) => (
								<button
									key={item.value}
									ref={(el) => {
										itemRefs.current[index] = el;
									}}
									type="button"
									role="menuitemradio"
									aria-checked={menuRadios.selected === item.value}
									aria-label={item.ariaLabel}
									tabIndex={-1}
									className="filter-ttb__metric-option tap-target"
									data-active={menuRadios.selected === item.value || undefined}
									onClick={() => menuRadios.onSelect(item.value)}
									onKeyDown={(e) => onMenuKeyDown(e, index)}
								>
									{item.label}
								</button>
							))}
						</div>
					)}
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
								itemRefs.current[radioCount + index] = el;
							}}
							type="button"
							role="menuitemcheckbox"
							aria-checked={selected.includes(option)}
							tabIndex={-1}
							className="filter-row__item tap-target"
							data-testid={getOptionTestId?.(option)}
							onClick={() => onToggle(option)}
							onKeyDown={(e) => onMenuKeyDown(e, radioCount + index)}
						>
							{getOptionLabel?.(option) ?? option}
						</button>
					))}
				</div>
			)}
		</span>
	);
}
