---
title: 'Story 3.4: Focus & interaction hardening (deferred-work sweep)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: '8d7795631c407a5a36a6f970c0b4d6af0b67d42d'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Five deferred focus/race items (deferred-work.md, each tagged "Assigned to Story 3.4") became daily paths with Epic 3's filter churn: focus dies on grid re-chunk (resize) and on cards leaving the visible set; the login swap drops keyboard/SR users at document start; an open detail panel dies on any refetch re-chunk; toast UNDO bypasses the in-flight write guard.

**Approach:** One focus-restoration effect in `ShelfGrid` (covers resize re-chunk AND card-unmount-after-write); hoist `LiveRegionProvider` above the session gate and focus+announce on `<Login />` mount; hoist the open-panel game id from `Card` to `ShelfGrid` and render one panel looked up by id; one ref-backed pending guard shared by every mutation entry point including the UNDO closures. Convert the epic2-detail/epic3-reveal reopen-based e2e workarounds back to direct stays-open asserts.

## Boundaries & Constraints

**Always:**
- AC1: after a viewport resize changes the column count and re-chunks ARIA rows, keyboard focus lands back on the same card (restoration satisfies "no unmount-to-body"). Roving tabindex, reading-order traversal, and the N×1 jsdom row structure must survive unchanged (pinned tests).
- AC2: on the session gate swapping to `<Login />` (401 re-auth AND sign-out — one fix at the gate covers both), focus moves into the login form (email input) and the change announces via the live region. `LiveRegionProvider` must be hoisted above the gate — inside `AppShell` it unmounts with the shell and `useAnnounce()` no-ops.
- AC3: when a write removes the focused card from the visible set, focus lands on a deliberate target — the neighbor card at the clamped index, or the grid container (make it `tabIndex={-1}`) when none — from which the toast's UNDO is reachable by keyboard (Tab).
- AC4: open-panel state (`openGameId`) lives in `ShelfGrid`; one `<DetailPanel>` renders outside the rows, its game looked up by id from the grid's list each render (auto-refresh after refetch preserved). Close still returns focus to the owning gridcell; `onHidden` still closes. Panel survives any re-chunk.
- AC5: a single ref-backed `pendingRef` (all five mutations OR-ed, updated every render) guards EVERY mutation entry point at call time — including the status-UNDO and un-own-UNDO closures — reusing the existing "Still saving…" toast.
- e2e: convert epic2-detail reopen-based asserts (ownership type switch, post-UNDO, genres add/remove, date edit) and the epic3-reveal reopen test to direct on-open-panel asserts; each converted assert must run green in the full parallel suite (that's the hazard test for AC4). The `openStatusMenu` retry loop stays (menu state is still Card-local — log as new deferred entry).
- Hazard tests red→green per AC in jsdom where drivable (focus restore on re-chunk, focus after drop, login focus+announce, UNDO guard).
- Every AC maps to a COVERAGE.md row or Playwright test (standing rule).

**Block If:**
- The display:contents ARIA row structure cannot keep the pinned N×1 jsdom shape with the hoist/restoration in place.
- Playwright foundation broken.

**Never:**
- No virtual/aria-owns grid restructure; no new dependencies; no URL state; no server changes.
- Don't reintroduce per-Card panel state or per-entry-point pending booleans.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Resize re-chunk | Card focused, column count changes | Same card focused after re-chunk | No error |
| Drop from shelf | Focused card's game leaves visible set after write | Neighbor card (clamped index) focused; grid container if list empties | No error |
| Login swap | Session → null (401 or sign-out) | Email input focused; polite announcement | No error |
| Panel + refetch | Panel open, write re-chunks grid | Panel stays open, shows refetched game data | No error |
| Panel game vanishes | Open game leaves the grid's list entirely | Panel closes (existing onHidden covers write-driven; lookup-miss closes otherwise) | No error |
| UNDO during write | Pending mutation on the game, UNDO activated | "Still saving" toast, no second write | No error |

</intent-contract>

## Code Map

- `web/shelf/Shelf.tsx` (ShelfGrid) -- focus-restore effect (gridHadFocus ref via focus/blur capture; restore to `cardRefs[min(focusedIndex, len-1)]` else grid); `openGameId` state + hoisted `<DetailPanel>`; grid `tabIndex={-1}`
- `web/shelf/Card.tsx` -- drop `detailOpen` state; cover button calls new `onOpenDetail` prop
- `web/shelf/DetailPanel.tsx` -- unchanged API (`game`, `onClose`)
- `web/App.tsx` + `web/main.tsx` + `web/shell/AppShell.tsx` -- hoist `LiveRegionProvider` above the gate (remove from AppShell)
- `web/Login.tsx` -- mount effect: focus `#login-email`, `announce()` the swap
- `web/shelf/useTrackingMutations.ts` -- `pendingRef` + shared guard at every entry point incl. both `onUndo` closures
- `web/shelf/Shelf.test.tsx`, `Card.test.tsx`, `DetailPanel.test.tsx`, new `Login` test -- jsdom hazard tests; existing pinned focus tests must stay green
- `playwright/e2e/epic2-detail.spec.ts`, `epic3-reveal.spec.ts` -- direct stays-open asserts; `playwright/COVERAGE.md` + `deferred-work.md` (5 entries closed, 1 added)

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/useTrackingMutations.ts` -- ref-backed shared pending guard, all entry points + UNDO closures (jsdom hazard test: UNDO during pending write toasts Still saving, no fetch)
- [x] `web/shelf/Shelf.tsx` + `web/shelf/Card.tsx` -- hoist openGameId + single DetailPanel; focus-restore effect; grid tabIndex; update `Card.test.tsx`/`Shelf.test.tsx` (hazard tests: focus survives column-count change; focus lands on neighbor when focused card leaves the list; panel survives a games-array re-chunk)
- [x] `web/main.tsx` / `web/App.tsx` / `web/shell/AppShell.tsx` -- LiveRegionProvider hoist (announce reachable from Login)
- [x] `web/Login.tsx` + its test -- mount focus + announcement (hazard test: rendering Login focuses the email input and announces)
- [x] `playwright/e2e/epic2-detail.spec.ts` -- convert ownership/genres/date reopen asserts to direct on-open-panel asserts
- [x] `playwright/e2e/epic3-reveal.spec.ts` -- direct stays-open assert for the hidden-game milestone write
- [x] `playwright/e2e/epic3-focus.spec.ts` -- e2e: focus survives viewport resize re-chunk; focus lands deliberately after Dropped (UNDO Tab-reachable); login swap focuses the form (sign-out path)
- [x] `playwright/COVERAGE.md` + `deferred-work.md` -- 3.4 rows; mark the five swept entries done; add the popover-menu-remount deferred entry

**Acceptance Criteria:**
- Given a card holding keyboard focus, when a resize re-chunks the ARIA rows, then focus stays on that card (AC1).
- Given the session gate swaps to `<Login />`, when it mounts, then focus is in the login form and the change is announced (AC2).
- Given a card leaving the visible set after a write, when the refetch unmounts it, then focus lands on a neighbor card or the shelf container and the toast UNDO is keyboard-reachable (AC3).
- Given an open detail panel, when a write's refetch re-chunks the grid, then the panel stays open (AC4) — pinned by the converted direct e2e asserts running green in the parallel suite.
- Given a pending tracking mutation, when toast UNDO is activated, then it respects the shared ref-backed guard (AC5).

## Spec Change Log

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 4, low 6)
- defer: 2: (high 0, medium 1, low 1)
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[medium]` `[patch]` in-flight guard was per-hook-instance and stale for a render cycle — replaced with a module-level per-game `IN_FLIGHT` set, added synchronously before every `mutate()` and cleared in `onSettled`: shared across Card/StatusPopover/DetailPanel instances, race-proof against same-tick double activation, and no render-body ref writes (purity fixed)
  - `[medium]` `[patch]` stale `openGameId` on a lookup miss — the panel now closes deliberately (focus handoff included), so it can't resurrect uninvited or strand focus on <body>
  - `[medium]` `[patch]` hoisted panel looked its game up in the progressive WINDOW — now the full filtered list, closing the pagination-seam hole in AC4
  - `[medium]` `[patch]` `closeDetail` performed focus side effects inside the state updater — moved out (updater purity)
  - `[low]` `[patch]` Login announced "Signed out." on cold load — condition-neutral copy; a verify-error mount announces the error itself
  - `[low]` `[patch]` AC1 e2e: dropped the fragile 4,4-position click (programmatic focus drives the same capture path); comment fixed
  - `[low]` `[patch]` AC3 e2e: nondeterministic Tab-hunt replaced with a bounded loop; neighbor identity left to the jsdom clamped-index pin (parallel workers interleave cards)
  - `[low]` `[patch]` genres e2e: visibility asserted before count(0) (no vacuous pass on a detached panel)
  - `[low]` `[patch]` one reload-based persistence assert restored per converted flow (dates, genres) alongside the direct stays-open asserts; epic3-reveal re-asserts the card's Dropped state
  - `[low]` `[patch]` popover-menu ledger entry now also tracks removing the openStatusMenu retry loop with the future fix

## Design Notes

- One restore effect covers AC1+AC3: browsers move focus to `<body>` silently when the focused node unmounts (no blur event), so a `gridHadFocus` flag set via focus/blur capture stays true across the unmount and the post-commit effect can restore deliberately. Tab-away (toast, panel, header) fires blur capture and disarms it.
- Hoisted panel looks up its game in the grid's (filtered) list: modal focus trap means the filter can't change while open; write-driven hides route through `onHidden`.

## Auto Run Result

**Summary:** Story 3.4 implemented — the five deferred focus/race items closed: grid-level focus restoration (resize re-chunks and cards leaving the shelf land on the clamped-index neighbor; roving index syncs with pointer focus), LiveRegionProvider hoisted above the session gate with Login mount focus + announcement, open-panel state hoisted to ShelfGrid (one panel, full-list id lookup, deliberate close-on-miss), and a module-level per-game in-flight guard shared by every mutation entry point including toast UNDO. E2e reopen workarounds converted to direct stays-open asserts.

**Files changed:**
- `web/shelf/Shelf.tsx` — focus-restore effect + roving-index sync; hoisted `openGameId` + single `DetailPanel`; grid landing target
- `web/shelf/Card.tsx` — panel state removed; cover reports `onOpenDetail`
- `web/shelf/useTrackingMutations.ts` — `IN_FLIGHT` per-game set, `guardPending`/`beginWrite`/`onSettled` on all five mutations
- `web/main.tsx` / `web/shell/AppShell.tsx` / `web/Login.tsx` (+ new `Login.test.tsx`) — provider hoist, mount focus + announcement
- jsdom hazard tests in `Shelf.test.tsx` (neighbor focus, panel survives re-chunk), `StatusPopover.test.tsx` (UNDO guard), `DetailPanel.test.tsx` (GridHarness mirrors the hoist)
- `playwright/e2e/epic3-focus.spec.ts` (new, 3 tests), `epic2-detail.spec.ts` + `epic3-reveal.spec.ts` (direct asserts + one persistence reload each), `playwright/COVERAGE.md`, `deferred-work.md` (5 entries closed, 1 added)

**Review findings:** 10 patches (4 medium — guard scope/race/purity, stale panel id, pagination seam, updater purity; 6 low), 2 deferred (empty-shelf AC3 boundary; stale UNDO overwriting a newer settled write), 4 rejected.

**Verification:** lint + typecheck clean; Vitest 540/540; Playwright 46/46 twice consecutively.

**Residual risks:** AC3 boundary when the last visible card leaves (grid unmounts entirely — deferred); open status-popover menu still dies on Card remount (ledgered with the retry-loop removal tracked).

## Verification

**Commands:**
- `bun run lint && bun run typecheck` -- expected: clean
- `bun run test` -- expected: green incl. new hazard tests
- `bun run test:e2e` -- expected: green incl. converted direct asserts + epic3-focus.spec.ts
