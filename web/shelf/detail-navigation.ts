import { type Location, useLocation } from 'react-router';

/**
 * Opening `/game/:id` over whatever destination you were already on — react
 * -router's background-location pattern, in the one place all of it lives.
 *
 * `/game/:id` used to hardcode the SHELF behind the overlay, so adding a game
 * from the catalog tore the catalog down, flashed the shelf in behind the
 * detail, and Close (`navigate(-1)`) snapped back to a destination the user
 * never left. The opener now records the destination it is leaving, the shell
 * renders its `<Routes>` against THAT location, and the overlay — which matches
 * on the real URL — surfaces over it (EXPERIENCE.md: everything else surfaces
 * *over* the active destination).
 *
 * Why a shared module and not three inline objects: three openers already
 * hand-rolled `fromApp`, and a fourth would have forgotten `background`. Three
 * READERS (the shell, the header toggle, the search box) each have to answer
 * "which destination am I actually on" — and they must all answer the same.
 */

/**
 * The navigation state `/game/:id` carries. This is a SHARED channel:
 * `SearchBox` reads `focusSearch` off the same object (written by
 * `SyncSummaryModal`'s jump-to-problem), so a state shape is EXTENDED here,
 * never replaced — a writer that clobbers the object silently kills the other
 * key's feature.
 */
export type DetailNavState = {
	/**
	 * Close's ONLY evidence that Back leads somewhere inside this app (review,
	 * H3). Absent on a cold deep link, which is what keeps Close from walking the
	 * user out to the mail client the link came from.
	 */
	fromApp: true;
	/**
	 * The destination the detail was opened FROM — a plain, serializable
	 * react-router `Location`, so it is safe in history state. Absent on a cold
	 * load (nothing in this app navigated there), and the shell falls back to the
	 * shelf: the URL alone cannot know where you came from.
	 */
	background: Location;
};

/**
 * The `navigate()` arguments that open a game's detail over `from`. Spread it:
 * `void navigate(...toDetail(id, from))`.
 *
 * `from.search` rides along so the destination BEHIND the overlay keeps the
 * `?q=` / `?genre=` it was filtered by — otherwise the grid re-renders unfiltered
 * under the dialog and loses the scroll position the user is about to come back
 * to — and so Back lands on that same filtered view.
 */
export function toDetail(gameId: string, from: Location) {
	return [
		{ pathname: `/game/${encodeURIComponent(gameId)}`, search: from.search },
		{ state: { fromApp: true, background: from } satisfies DetailNavState },
	] as const;
}

/**
 * The destination that is CURRENTLY VISIBLE — the background when a detail is
 * open over one, else the real location.
 *
 * Every surface that asks "which destination am I on" must get the same answer:
 * the header toggle highlights it, the search box scopes `?q=` to it. Read the
 * raw `pathname` instead and a detail over the catalog highlights SHELF while a
 * keystroke writes the term at a destination the user is not looking at — the
 * "two live surfaces, one input" bug class Story 7.2 closed, coming back in
 * through the overlay.
 *
 * Openers pass this (not the raw location) as the background, so a detail opened
 * from a detail cannot chain backgrounds into a growing history-state object.
 */
export function useActiveDestination(): Location {
	const location = useLocation();
	return (
		(location.state as Partial<DetailNavState> | null)?.background ?? location
	);
}
