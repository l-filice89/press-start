import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { EmptyState } from '../components/EmptyState';
import { useModalTrap } from '../components/useModalTrap';
import { fetchGame } from './api';
import { DetailPanel } from './DetailPanel';
import './detail-panel.css';

/**
 * The routed detail (Story 7.2, AD-25). `/game/:id` is STATE, not a message:
 * the old `OPEN_DETAIL` window event was fire-and-forget, so an intent fired
 * before the shelf mounted was swallowed (the Epic 6 mount-race). A URL is
 * still there when the listener arrives.
 *
 * It resolves through `GET /api/games/:id` — NEVER an id lookup in the
 * `['shelf']` list cache: 7.3's add-then-navigate lands on the new id before
 * that list refetches, and a cache lookup would render not-found on a game that
 * exists. A PENDING fetch is a loading state; only a RESOLVED 404 is not-found.
 *
 * Renders nothing off `/game/:id`, so the shell can mount it unconditionally
 * beside the shelf — which is what keeps the shelf from remounting when the
 * detail opens and closes.
 */
export function GameDetailRoute() {
	const match = useMatch('/game/:id');
	const id = match?.params.id;
	return id ? <GameDetail id={id} /> : null;
}

/**
 * The detail's overlay frame. Every state of `/game/:id` — pending, not-found,
 * failed — is a DIALOG over the destination, exactly like the resolved detail
 * (review, H4). They used to render as loose content BELOW the live shelf grid:
 * `/game/ghost` showed the whole grid with a stray "NO MATCH — no games match
 * the current filters" stapled underneath, which is neither true nor a detail.
 */
function DetailOverlay({
	label,
	onClose,
	children,
}: {
	label: string;
	onClose: () => void;
	children: ReactNode;
}) {
	// The SAME trap the resolved DetailPanel runs (Story 3.5 scaffold). Without
	// it the header SearchBox stayed keyboard-reachable through the pending/
	// error states, and a term typed there wrote `?q=` onto `/game/:id` — lost
	// on Close (deferred-work sweep, 2026-07-15).
	const dialogRef = useRef<HTMLDivElement>(null);
	const onKeyDown = useModalTrap(dialogRef, onClose);
	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss surface, not a control — Escape and the action buttons are the accessible paths; this only mirrors them for pointer users.
		<div
			className="detail-panel__backdrop"
			data-testid="detail-backdrop"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-label={label}
				tabIndex={-1}
				className="detail-panel detail-panel--fade"
				onKeyDown={onKeyDown}
			>
				{children}
			</div>
		</div>,
		document.body,
	);
}

export function GameDetail({ id }: { id: string }) {
	const navigate = useNavigate();
	const location = useLocation();
	const { data, isPending, error } = useQuery({
		queryKey: ['game', id],
		queryFn: ({ signal }) => fetchGame(id, signal),
		retry: false,
	});

	// Closing goes BACK only when THIS app opened the detail — a flag the opener
	// puts in the navigation state (review, H3). It used to be inferred from
	// `location.key === 'default'`, but the SearchBox writes `?q=` with
	// `{replace: true}` and a replace MINTS A NEW KEY: one keystroke on a cold
	// deep link turned Close into `navigate(-1)`, which walks out of the app and
	// back to the mail client the link came from. No opener flag → go to the
	// owning destination instead.
	//
	// Focus lands on the owning gridcell FIRST, then the navigation unmounts this
	// (UX-DR19 — the same order the pre-router shelf used): a node unmounting
	// fires no blur, so focus would otherwise silently fall to <body>. Looked up
	// by game id, not a captured node: the grid may have re-chunked while the
	// panel was open. A detail with no card behind it (a cold deep link, a
	// catalog add) has nowhere to hand focus back to, so the grid itself takes it —
	// and WHICH grid depends on the destination behind the overlay. Only one of the
	// two is ever mounted (the shell renders a single destination), so the pair can
	// be one selector: the catalog's cards carry `data-product-id`, not
	// `data-game-id`, so on `/catalog` there is no cell to aim at at all.
	const openedInApp =
		(location.state as { fromApp?: boolean } | null)?.fromApp === true;
	const close = useCallback(() => {
		const cell = document.querySelector<HTMLElement>(
			`[role="gridcell"][data-game-id="${CSS.escape(id)}"]`,
		);
		// …and `#main-content` as the LAST resort: both grids are conditionally
		// mounted (a shelf skeleton/empty/error, a no-region/empty catalog render no
		// grid at all), so a close over a gridless background would otherwise no-op
		// and drop focus to <body> — the UX-DR19 hazard this handoff exists to
		// prevent. `<main id="main-content">` is always mounted and focusable.
		(
			cell ??
			document.querySelector<HTMLElement>(
				'[data-testid="shelf-grid"], [data-testid="catalog-grid"]',
			) ??
			document.getElementById('main-content')
		)?.focus();
		if (openedInApp) void navigate(-1);
		else void navigate('/');
	}, [id, openedInApp, navigate]);

	if (isPending) {
		return (
			<DetailOverlay label="Loading game" onClose={close}>
				<p role="status" aria-busy="true" className="detail-panel__pending">
					Loading game…
				</p>
			</DetailOverlay>
		);
	}
	if (error) {
		const status = (error as Error & { status?: number }).status;
		// Only a RESOLVED miss is "not found"; anything else is a load failure.
		return status === 404 ? (
			<DetailOverlay label="Game not found" onClose={close}>
				<EmptyState
					variant="game-not-found"
					actions={[{ label: 'Back to shelf', onClick: close }]}
				/>
			</DetailOverlay>
		) : (
			<DetailOverlay label="Game details" onClose={close}>
				<p role="alert" className="shelf__error">
					That game couldn’t load. Refresh to try again.
				</p>
			</DetailOverlay>
		);
	}
	return <DetailPanel game={data} onClose={close} />;
}
