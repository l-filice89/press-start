---
title: 'The game detail overlays the destination you opened it from'
type: 'bugfix'
created: '2026-07-15'
status: 'done'
baseline_commit: '34ded57'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/game/:id` hardcodes `<Shelf />` as the thing rendered behind the detail overlay (`web/shell/AppShell.tsx`). So adding a game from the catalog — which navigates to the new game's detail — tears the catalog down, mounts the shelf behind the overlay, and then Close (`navigate(-1)`) snaps you back to the catalog: a visible shelf flash, a lost catalog scroll position, and a destination change the user never asked for. It contradicts the UX spine's governing rule that modals and overlays surface **over the active destination** (EXPERIENCE.md: "Everything else still surfaces *over* the active destination").

**Approach:** Adopt react-router's background-location pattern. The opener records the destination it is leaving in the navigation state; the shell renders its `<Routes>` against that background location, so the destination behind the detail is whichever one you were on. The detail overlay itself is hoisted out of the route elements and mounted once, keyed on the real URL. A cold deep link (no background) keeps today's behavior: the shelf renders behind it.

## Boundaries & Constraints

**Always:**
- The URL after a catalog add stays `/game/:id` — the detail is a real routed destination, deep-linkable and reloadable (AD-25). This fix changes what renders *behind* it, never the address.
- The background location travels in **navigation state**, alongside the existing `fromApp` flag — the same channel, set by the same openers. It is not a new global, not a context, and never a `window` CustomEvent (AD-25: a new cross-tree event is an architecture violation).
- A **cold deep link to `/game/:id` has no background** — no state, because nothing in this app navigated there. It must keep rendering the shelf behind the detail and Close must keep going to `/` (the existing `fromApp` rule, review H3). Reload on `/game/:id` opened from the catalog is also a cold load and correctly falls back to the shelf.
- Close still hands focus back before navigating (UX-DR19): to the owning gridcell when there is one, and to the active destination's grid otherwise — `[data-testid="shelf-grid"]` on the shelf, `[data-testid="catalog-grid"]` on the catalog. A node that unmounts fires no blur, so focus must never be left to fall to `<body>`.
- Every one of the three openers is fixed at once: `Shelf.openDetail`, and **both** `AddGameDialog` navigations (the post-save path AND the duplicate-detected path — a catalog game that turns out to be already tracked lands on the detail too, and today it lands over the shelf).
- **Every surface that asks "which destination am I on" must get the same answer.** The background is the active destination, so the header toggle (`Header.tsx`, which highlights SHELF/CATALOG from `pathname`) and the search box (`SearchBox.tsx`, which scopes `?q=` by `pathname`) must resolve it through the background when one exists — otherwise the detail over the catalog highlights SHELF, and a keystroke in the search box writes the term at the wrong destination. One shared resolver, used by all of them.

**Ask First:**
- If the background-location pattern turns out to require changing the `*` NotFound route, the `/api/*` `run_worker_first` carve-out, or the SPA `not_found_handling` in `wrangler.jsonc` — it should not.

**Never:**
- No catalog detail page and no second detail component. One `GameDetail`, one overlay, rendered over whichever destination is behind it.
- Do not make the detail read the game from the `['shelf']` list cache to avoid mounting the shelf — it resolves by id through `GET /api/games/:id` (AD-25), and that stays true.
- Do not fix this by keeping the shelf mounted and hiding it with CSS. The catalog must be the live destination behind the overlay, not a hidden shelf.
- Do not delete or weaken the tests that pin the cold-deep-link and Close-goes-to-shelf behavior (review H3's regression net).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Add from the catalog | On `/catalog`, ＋ Add → preview → Save | URL becomes `/game/:id`; the **catalog** stays rendered behind the overlay (scroll intact); no shelf is mounted | Add failure surfaces in the dialog; no navigation |
| Close that detail | Detail open over the catalog | Returns to `/catalog`, same scroll position; no shelf flash; focus lands on the catalog grid | — |
| Catalog add of an ALREADY-tracked game | The add resolves to an existing game (duplicate path) | Same: detail over the catalog, Close returns to the catalog | — |
| Open a detail from the shelf | On `/`, tap a card | Unchanged: detail over the shelf, Close returns to the filtered shelf and focus lands on the owning gridcell | — |
| Cold deep link | `/game/:id` pasted into a fresh tab | No background in state → the shelf renders behind the detail; Close goes to `/` | Pending = loading; only a resolved 404 is not-found |
| Reload while the detail is open over the catalog | F5 on `/game/:id` | Treated as a cold load: shelf behind, Close → `/`. Acceptable and honest — the URL alone cannot know where you came from | — |
| Unknown `/game/:id` | Resolved 404 | Not-found renders inside the detail dialog, over whichever destination is behind it | Not-found |
| Header toggle with a detail open over the catalog | `/game/:id`, background `/catalog` | The toggle shows **CATALOG** as current — it follows the destination behind the overlay, not the detail's own path | — |
| Header toggle on a cold `/game/:id` | No background | SHELF stays current — today's behavior, pinned by `Header.test.tsx:154` | — |
| Typing in the search box with a detail open | `/game/:id` over a background | The term is written to the **background destination's** `?q=` (the shelf's library search, or the catalog's) — never orphaned on the `/game/:id` path | — |

</frozen-after-approval>

## Code Map

- `web/shell/AppShell.tsx:148-174` -- the `<main>` `<Routes>` block. `/` and `/game/:id` BOTH render `<><Shelf /><GameDetailRoute /></>`; `/catalog` renders `<Catalog />` with no detail. This duplication IS the bug. `<Routes>` gains an explicit `location`, and `<GameDetailRoute />` is hoisted to sit beside `<Routes>` so it overlays every destination.
- `web/shelf/GameRoute.tsx:25-29` -- `GameDetailRoute` matches on `useMatch('/game/:id')`, which reads the REAL location from router context (not the `location` prop given to `<Routes>`), so it still fires when `<Routes>` is rendering the background. Renders `null` off-route, which is what makes hoisting it safe.
- `web/shelf/GameRoute.tsx:96-107` -- `close()`: the `fromApp` state flag decides `navigate(-1)` vs `navigate('/')`, and the focus handoff queries `[role="gridcell"][data-game-id]` then `[data-testid="shelf-grid"]`. Needs the catalog grid as a third fallback.
- `web/shelf/Shelf.tsx:292-304` -- `openDetail`: navigates with `{ state: { fromApp: true } }` and carries `?q=`. Adds the background.
- `web/shelf/AddGameDialog.tsx:122-124` and `:137-141` -- the TWO detail navigations (duplicate-detected, and post-save behind `navigateToDetail`). Both add the background.
- `web/shell/Header.tsx:28-33` -- the SHELF/CATALOG toggle reads `useLocation().pathname` and deliberately treats `/game/:id` as "over the shelf". With a background it must read the BACKGROUND's pathname, or a detail over the catalog highlights SHELF.
- `web/shelf/SearchBox.tsx:31,71-82` -- scopes which destination's `?q=` it writes by `pathname`. On `/game/:id` that is neither `/` nor `/catalog`. It also reads `location.state.focusSearch` (SyncSummaryModal's jump) — a SECOND state key, so the navigation state is a shared channel: adding `background` must not clobber it.
- `web/catalog/Catalog.tsx:233` -- `data-testid="catalog-grid"`, the focus-return target on the catalog (mirrors `shelf-grid`). Catalog cards carry `data-product-id`, NOT `role="gridcell"`/`data-game-id`, so the shelf's per-card focus return has nothing to aim at here — the grid is the target.
- `web/shelf/Shelf.test.tsx:488-694` -- the routed-detail suite (refetch survival, deep link, in-flight, non-404, "Close on a COLD deep link goes to the shelf even after a keystroke"). These mount `Shelf` + `GameDetailRoute` directly in a `MemoryRouter`, so they pin behavior the fix must preserve.
- `playwright/e2e/epic7-catalog.spec.ts:251` -- the catalog-add e2e. It asserts the post-save URL, then does a fresh `page.goto('/catalog')` — it never presses Close, which is exactly why this shipped. It gains the Close assertion.

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/detail-navigation.ts` -- **new, small.** The single seam: (a) a helper that builds the detail navigation state `{ fromApp: true, background: <the location being left> }` + target path, and (b) a `useActiveDestination()` (or equivalent) hook returning the location whose destination is CURRENTLY VISIBLE — the background when one exists, else the real location. Export the state type; it must EXTEND the existing state shape, not replace it (`focusSearch` shares this channel). -- Three openers already hand-roll `fromApp`; a fourth would forget the background. And three readers (shell, header, search box) must not each re-derive "which destination is behind the overlay" differently.
- [x] `web/shelf/Shelf.tsx` + `web/shelf/AddGameDialog.tsx` (both call sites) -- Open the detail through the helper, passing the current `location`. -- The duplicate path is a real catalog entry point, not a corner case (Epic 7 cross-story review, M3).
- [x] `web/shell/AppShell.tsx` -- Render `<Routes location={background ?? location}>` and hoist `<GameDetailRoute />` out of the route elements to sit beside `<Routes>` inside `<main>`. `/game/:id` keeps a route entry rendering `<Shelf />` alone, for the cold-deep-link case. -- The background makes the destination behind the overlay the one you were on; hoisting the overlay is what lets it appear over `/catalog`, whose route element has no detail in it today.
- [x] `web/shell/Header.tsx` + `web/shelf/SearchBox.tsx` -- Resolve the active destination through the shared hook instead of the raw `pathname`. -- Otherwise a detail over the catalog highlights SHELF in the toggle, and a keystroke in the search box writes `?q=` against a destination the user is not looking at — the exact "two live surfaces, one input" bug class Story 7.2 closed, coming back through the overlay.
- [x] `web/shelf/GameRoute.tsx` -- Extend `close()`'s focus handoff with the catalog grid as the final fallback, so closing a detail over the catalog does not drop focus to `<body>`. -- UX-DR19; the shelf-only fallback (`[data-testid="shelf-grid"]`) is invisible on `/catalog`, and catalog cards carry no `data-game-id` to aim at.
- [x] `web/shell/AppShell.test.tsx` -- **new.** The `<Routes>` block is unit-untested today. Cover the matrix: a detail opened with a `/catalog` background renders the catalog (not the shelf) behind it and Close returns to `/catalog`; a cold `/game/:id` with NO background still renders the shelf and Close goes to `/`; the header toggle follows the background. -- The cold-load fallback is the one that silently regresses.
- [x] `playwright/e2e/epic7-catalog.spec.ts` -- Extend the existing catalog-add test: after Save, assert the catalog grid is still in the DOM behind the dialog and the shelf grid is NOT, then press Close and assert you land back on `/catalog` with the card now reading `In library`. -- The shipped test's `page.goto('/catalog')` is what hid this bug; pressing Close is the assertion that would have caught it.

**Acceptance Criteria:**
- Given I add a game from the catalog, when the detail opens, then the catalog is still the destination behind it — no shelf is mounted, and the catalog's scroll position survives.
- Given that detail is open, when I close it, then I am back on `/catalog` exactly where I was, with no intermediate shelf render and with focus on the catalog grid.
- Given a `/game/:id` link opened cold (a fresh tab, or a reload), when it loads, then the shelf renders behind the detail and Close goes to the shelf — the behavior that exists today, unchanged.
- Given I open a detail from the shelf, when I close it, then the filtered shelf and the owning card's focus are restored exactly as they are today.
- Given a detail is open over the catalog, when I look at the header, then CATALOG is the current destination and the search box searches the catalog — every surface agrees on which destination I am on.

## Design Notes

The canonical react-router modal pattern, and it is small:

```tsx
// AppShell
const destination = useActiveDestination();  // background ?? real location — ALWAYS a location
<main>
  {/* `location` is ALWAYS a location object, never undefined: toggling the prop's
      presence remounts the matched route, tearing down the grid (and the focus/
      scroll it holds) every time a detail closes. Stable presence keeps it mounted. */}
  <Routes location={destination}>
    <Route path="/" element={<Shelf />} />
    <Route path="/catalog" element={<Catalog … />} />
    <Route path="/game/:id" element={<Shelf />} />  {/* cold deep link only */}
    <Route path="*" element={<NotFound />} />
  </Routes>
  <GameDetailRoute />   {/* keyed on the REAL url; null when off /game/:id */}
</main>
```

`useMatch` inside `GameDetailRoute` reads the router's real location, not the `location` prop passed to `<Routes>` — that asymmetry is the whole trick: `<Routes>` renders the background while the overlay still sees `/game/:id`.

`background` is a react-router `Location`, which is a plain serializable object — safe to put in history state.

## Verification

**Commands:**
- `bun run lint` -- expected: Biome clean.
- `bun run typecheck` -- expected: `tsc -b` clean.
- `bun run test` -- expected: green, including the routed-detail suite and the new background/cold-load cases.
- `bun run test:e2e` -- expected: green (the Epic 6 export spec's Windows `EPERM` in Playwright's artifact layer is pre-existing and unrelated).

**Manual checks:**
- On `/catalog`, scroll a few rows down, add a game, close the detail: you are back on the catalog at the same scroll offset, and at no point does the shelf appear.

## Review Triage Log

### 2026-07-15 — Review pass 1 (Blind Hunter + Edge Case Hunter, parallel, no shared context)
Core architecture confirmed sound by both reviewers (verified against react-router v8 internals): `<Routes location>` overrides the location context for its subtree while the hoisted `<GameDetailRoute>` matches the real URL via `useMatch`. No intent_gap, no bad_spec — findings are implementation-level seams, patched in place.

- `[reject, after a reverted patch attempt]` **RE-RENDER STORM** — BH flagged that `<Routes location={destination}>` (always a location prop) allocates a fresh location context per render, so AppShell state changes re-render the subtree. TRUE, but the proposed fix — pass `undefined` when no detail is open — is WORSE: toggling the `location` prop's presence remounts the matched route element, tearing down the shelf grid on every detail-close. That destroys the card node the close handoff just focused (caught by e2e `epic2-detail` 2.3e and `epic3-reveal`) and loses scroll + roving index — the exact non-remount guarantee the feature is built on. The always-present prop is deliberate; the re-render cost is its price. The blast radius is also smaller than stated: only actual `useLocation`/`useSearchParams`/`useMatch` consumers re-render on a context change, not memoized cards. Patch attempted, reverted after the e2e break; keeping the original always-a-location form.
- `[patch]` **PERPETUAL FOCUS-STEAL** — the `?q=` debounced write carried `location.state` whole to preserve `background`/`fromApp`, but that also re-propagated `focusSearch`. A `{replace}` mints a fresh `location.key` per keystroke, so after a Story 4.3 "Find in library" jump the focus-steal effect re-fired on every keystroke, yanking focus off the ＋Add button. Fixed: carry ONLY `fromApp`/`background`, drop `focusSearch` so it clears after one write (computed inside the timer off the stable `location.state`, not a render-fresh object).
- `[patch]` **FOCUS TO `<body>` ON CLOSE** — the close focus handoff no-ops when the background renders no grid (shelf skeleton/empty/error; no-region/empty catalog), dropping focus to `<body>` (UX-DR19). Largely unreachable via the add flow (you cannot open a detail from a gridless catalog), and the shelf case pre-existed — but the fix is strictly better: `#main-content` as the final fallback, made focusable with `tabIndex={-1}`.
- `[patch]` **STALE CSS COMMENT** — the button-stack change left `.catalog-card__actions` claiming "all cards the same height," which the stacked layout made false (not-tracked ≈96px vs floored 72px). Comment corrected to state the real behavior; uniform height rejected (it would strand a lone Owned marker over empty space).
- `[defer]` search term written onto `/game/:id` while a detail's NON-trapped pending/error overlay covers a destination (only the resolved `DetailPanel` traps focus). Real but transient; the proper fix is a search-while-detail-open design decision, not a mechanical patch. See `deferred-work.md`.
- `[reject]` speculative latent traps with no current consumer: `useActiveDestination` shape-checking an arbitrary `background` key, `navigationType` pinned to POP for the background subtree, the redundant `toDetail` search write. No live defect.

## Suggested Review Order

**The shared seam (start here)**

- The whole pattern in one file: `toDetail` builds the nav state, `useActiveDestination` resolves the visible destination.
  [`detail-navigation.ts:53`](../../web/shelf/detail-navigation.ts#L53)

**The shell wiring — background behind, overlay hoisted**

- `location` is ALWAYS a location object (never undefined) so the grid never remounts on close; the comment says why.
  [`AppShell.tsx:73`](../../web/shell/AppShell.tsx#L73)

- `<GameDetailRoute>` hoisted beside `<Routes>` — matches the real URL, overlays whichever destination rendered.
  [`AppShell.tsx:176`](../../web/shell/AppShell.tsx#L176)

**The four openers — all route through the seam**

- Shelf card open carries the active destination as background.
  [`Shelf.tsx:293`](../../web/shelf/Shelf.tsx#L293)

- Both catalog-add navigations (post-save and duplicate-detected) do the same.
  [`AddGameDialog.tsx:127`](../../web/shelf/AddGameDialog.tsx#L127)

**The "which destination am I on" readers**

- Header toggle follows the background, not the `/game/:id` path.
  [`Header.tsx:34`](../../web/shell/Header.tsx#L34)

- Search scopes `?q=` to the visible destination and carries ONLY detail-nav state (drops `focusSearch`, the review's focus-steal fix).
  [`SearchBox.tsx:88`](../../web/shelf/SearchBox.tsx#L88)

**Close & focus**

- Focus handoff: owning cell → the visible grid → `#main-content` last, so it never falls to `<body>`.
  [`GameRoute.tsx:102`](../../web/shelf/GameRoute.tsx#L102)

- Catalog grid made focusable for that handoff.
  [`Catalog.tsx:238`](../../web/catalog/Catalog.tsx#L238)

**Tests**

- New unit coverage for the routed background matrix (detail-over-catalog, cold load, header follows background).
  [`AppShell.test.tsx:130`](../../web/shell/AppShell.test.tsx#L130)

- The focus-steal regression, proven red-then-green.
  [`SyncSummaryModal.test.tsx:174`](../../web/shell/SyncSummaryModal.test.tsx#L174)

- The catalog-add e2e now presses Close and asserts the catalog is behind, not the shelf.
  [`epic7-catalog.spec.ts:251`](../../playwright/e2e/epic7-catalog.spec.ts#L251)
