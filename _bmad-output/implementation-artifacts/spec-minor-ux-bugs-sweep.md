---
title: 'Minor UX bugs sweep: detail stays open on milestones, scroll-jump fix, catalog FAB export, zero-count pills'
type: 'bugfix'
created: '2026-07-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: '7a5124b9a7d04eb7cbcea3333dc4c23f58e4c8d0'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Four small UX defects: (1) marking a game Platinum (or Story completed) closes the routed detail panel; (2) any tracking write (status change/clear, rematch) collapses the shelf's progressive list back to 48 cards, yanking scroll position way up; (3) the FAB offers "Export CSV" on the catalog view, but it exports the library — misleading there; (4) the catalog renders genre pills with 0 games (prod shows several).

**Approach:** Remove the milestone→auto-close wiring (routed panel no longer depends on the shelf card); stop `useProgressiveList` from resetting its window on data refetches — reset only when the filter context changes; hide the Export CSV item when the active destination is `/catalog`; filter zero-count genres out of the server facet response.

## Boundaries & Constraints

**Always:**
- Milestone actions (Platinum, Story completed) keep the detail panel OPEN, showing the updated state.
- Discard still closes the panel (the game is gone). Dropped / Clear status keep their current close behavior.
- Changing shelf FILTERS still resets the progressive window to page 1 (scroll-to-top on filter change is correct); only data refetches of the same view must preserve the window.
- Keyboard focus restoration on panel close (`GameRoute.tsx` `close()`) stays intact — it's a11y, not the scroll bug.
- Export CSV stays available on the shelf (`/`) — FR-49 user-held backup.

**Ask First:**
- Any change to server-side hidden-state semantics or `HIDDEN_STATES`/`REVEAL_STATES` vocabularies.

**Never:**
- No time-to-beat filters (deferred to /bmad-correct-course epic).
- No prod data repair in this spec (genre-sweep gap investigated out-of-band).
- Don't switch `listCatalogGenreFacets` back to SQL GROUP BY counting (edition-collapse mismatch tombstone).
- Don't remove the "frozen sweep vocabulary" union logic — only filter zeros from the final response.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Platinum from detail | Detail open, mark Platinum | Panel stays open, shows Platinum state; shelf refetches behind it | N/A |
| Clear status from detail | Detail open over scrolled shelf (150+ cards rendered), clear status | Panel closes (existing behavior); shelf keeps rendered window, no scroll jump | N/A |
| Rematch from detail | Detail open, rematch game | Panel behavior unchanged; shelf window preserved | N/A |
| Filter change | User toggles a state/genre filter | Window resets to first page (existing reset behavior preserved) | N/A |
| Refetch shrinks list | Window at 150, game leaves filtered view | Rendered count clamps to new list length, no reset to 48 | N/A |
| FAB on catalog | Navigate to `/catalog`, open FAB | No Export CSV item; Check PS+ Extra still present | N/A |
| FAB on catalog w/ detail open | `/game/:id` over catalog background | Export CSV still hidden (background destination is catalog) | N/A |
| Genre facets | Sweep key with 0 tagged snapshot rows | Key absent from `/api/ps-plus-catalog/genres` response | N/A |

</frozen-after-approval>

## Code Map

- `web/shelf/useTrackingMutations.ts` -- `onHidden` fires on milestone success (`:173-179`), status→hidden (`:144-151`), discard (`:478`); stale "vanishing under the user" comment `:78-82`
- `web/shelf/DetailPanel.tsx` -- wires `onHidden: onClose` (`:125-134`); stale rationale comment
- `web/shelf/useProgressiveList.ts` -- reset effect keyed on `items` reference (`:27-29`) — the scroll-jump root cause
- `web/shelf/Shelf.tsx` -- computes `visible` (`:83-89`), calls `useProgressiveList(games, 48)` (`:281`); filter state lives here
- `web/shell/Fab.tsx` -- FAB drawer with Export CSV item (`:139-155`); imports no router hook yet
- `web/shelf/detail-navigation.ts` -- `useActiveDestination()` (`:74-79`) returns background location when detail overlay open
- `src/services/psplus-browse.ts` -- `listCatalogGenreFacets` (`:316-350`); zero-count keys emitted at `:342-349`
- Tests co-located: `useProgressiveList.test.tsx`, `DetailPanel.test.tsx`, `Fab.test.tsx`, `web/catalog/Catalog.test.tsx`; server tests under `src/**`

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/useTrackingMutations.ts` -- stop calling `onHidden` from `milestoneMutation.onSuccess`; keep it for status-change-to-hidden and discard; update the stale comment -- milestones must not close the routed panel
- [x] `web/shelf/DetailPanel.tsx` -- adjust `onHidden` wiring comment to the narrowed semantics -- keep intent readable
- [x] `web/shelf/useProgressiveList.ts` -- replace items-reference reset with: clamp `count` to `items.length` (never below one page) on data change; full reset to `pageSize` only when a new `resetKey` param changes -- root-cause scroll fix
- [x] `web/shelf/Shelf.tsx` -- pass a filter-signature `resetKey` (serialized active filters + search) to `useProgressiveList` -- filter changes still snap to page 1
- [x] `web/shell/Fab.tsx` -- hide Export CSV item when `useActiveDestination().pathname === '/catalog'` -- library export is misleading on catalog
- [x] `src/services/psplus-browse.ts` -- filter `count > 0` in `listCatalogGenreFacets` final map; note in comment this hides not-yet-swept keys by product decision -- no dead pills
- [x] Update co-located tests: milestone keeps panel open (`DetailPanel.test.tsx`), window-preserve + resetKey (`useProgressiveList.test.tsx`), FAB hidden on catalog (`Fab.test.tsx`), zero-count facet filtered (server test for `listCatalogGenreFacets`)

**Acceptance Criteria:**
- Given the detail panel open, when the user marks Platinum or Story completed, then the panel remains open showing the new milestone state.
- Given the shelf scrolled deep (>1 progressive page), when a tracking write or rematch refetches the shelf, then the rendered card window and scroll position are preserved.
- Given the shelf scrolled deep, when the user changes any filter or search, then the list resets to the first page.
- Given the catalog view (including with a detail overlay open above it), when the FAB drawer opens, then Export CSV is absent; on the shelf it is present.
- Given a sweep genre key with zero tagged rows in the current snapshot, when `/api/ps-plus-catalog/genres` responds, then that key is omitted.

## Spec Change Log

## Verification

**Commands:**
- `bun run typecheck` -- expected: clean
- `bun run lint` -- expected: clean
- `bun run test` -- expected: all vitest projects pass, including new/updated tests

**Manual checks (if no CLI):**
- Local dev: scroll shelf deep, change a game's status from detail — no jump. Mark platinum — panel stays. Visit /catalog — FAB has no Export CSV; no 0-count pills.

## Suggested Review Order

**Scroll-jump root cause (progressive window)**

- Window survives refetch; clamp on shrink, full reset only on `resetKey` change
  [`useProgressiveList.ts:31`](../../web/shelf/useProgressiveList.ts#L31)
- Filter/search signature is the reset key — refetch of the same view keeps scroll
  [`Shelf.tsx:249`](../../web/shelf/Shelf.tsx#L249)

**Milestones keep the detail panel open**

- `onHidden` removed from milestone success — routed panel resolves by id, survives card unmount
  [`useTrackingMutations.ts:182`](../../web/shelf/useTrackingMutations.ts#L182)
- Narrowed wiring comment: status/discard still close, milestones never
  [`DetailPanel.tsx:134`](../../web/shelf/DetailPanel.tsx#L134)

**Zero-count catalog pills**

- Server drops zero-count facet keys (also hides not-yet-swept keys, by product decision)
  [`psplus-browse.ts:353`](../../src/services/psplus-browse.ts#L353)
- Review patch: selected key missing from a NON-empty vocabulary keeps its pressed chip (M9 extension)
  [`Catalog.tsx:305`](../../web/catalog/Catalog.tsx#L305)

**FAB Export CSV hidden on catalog**

- Active destination (background under a detail overlay), `startsWith` matches the header rule
  [`Fab.tsx:37`](../../web/shell/Fab.tsx#L37)
- The conditional render
  [`Fab.tsx:141`](../../web/shell/Fab.tsx#L141)

**Tests**

- Platinum keeps the dialog open
  [`DetailPanel.test.tsx:552`](../../web/shelf/DetailPanel.test.tsx#L552)
- Window preserved / clamped-as-leading-slice / resetKey reset
  [`useProgressiveList.test.tsx:40`](../../web/shelf/useProgressiveList.test.tsx#L40)
- Orphaned selected chip beside a non-empty vocabulary
  [`Catalog.test.tsx:181`](../../web/catalog/Catalog.test.tsx#L181)
- Hidden on catalog, hidden over catalog overlay, kept over shelf overlay
  [`Fab.test.tsx:88`](../../web/shell/Fab.test.tsx#L88)
- Zero-count key omitted even when the sweep vocabulary names it
  [`psplus-browse.test.ts:349`](../../test/integration/psplus-browse.test.ts#L349)
