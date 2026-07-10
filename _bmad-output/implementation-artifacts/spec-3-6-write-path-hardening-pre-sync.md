---
title: 'Story 3.6: Write-path hardening (pre-sync)'
type: 'feature'
created: '2026-07-10'
status: 'in-review'
baseline_revision: '3e03f478e94059a7e50ea7738d60c976a5f05538'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** Three write-path seams become real hazards once Epic 4 sync writes concurrently: tracking mutations invalidate only `['shelf']` (an open search listbox renders stale after any write); a toast UNDO clicked after a NEWER write on the same game settled silently overwrites the newer intent (the IN_FLIGHT guard blocks only concurrent writes, not stale intent); an open status-popover menu dies when a refetch re-chunk remounts its Card (papered over by the `openStatusMenu` e2e retry loop). All three are ledgered deferred-work items assigned to this story; it must land before Story 4.2.

**Approach:** One invalidation helper in `useTrackingMutations` fans every settle-path invalidation out to both `['shelf']` and `['shelf-search']`; a module-level per-game write generation stamps each write, and both UNDO closures no-op (with a visible "expired" toast — failures surface) when a newer write has since begun; the popover's `open` boolean hoists to ShelfGrid (the 3.4 `openGameId` pattern) so a Card remount can't kill an open menu, and the e2e retry loop is deleted in the same change.

## Boundaries & Constraints

**Always:**
- AC1: every path that invalidates `['shelf']` in `useTrackingMutations` (all five mutations' success paths AND the 409-conflict error paths) also invalidates `['shelf-search']` (prefix match — the live key is `['shelf-search', term]`). One shared helper, not six copies.
- AC2: a toast UNDO whose game has since been written again (write settled or in flight) must NOT issue the stale write. The user gets feedback (an "Undo expired…" toast) — never a silent no-op (NFR-4 failures-surface bar). Both UNDO closures (status-drop restore, un-own restore) are covered. The existing IN_FLIGHT concurrent-write guard and its pinned tests stay intact.
- AC3: status-popover open-state lives in ShelfGrid (`openStatusGameId`, mirroring 3.4's `openGameId`); a refetch that re-chunks rows and remounts the Card leaves the menu open. Internal refs/focus/anchor logic stay in StatusPopover. The `openStatusMenu` retry loop in `epic2-tracking.spec.ts` is REMOVED in this change (plain click + visible assert), all 11 call sites still green.
- Hazard tests red→green per named hazard: (1) a write marks `['shelf-search']` invalidated; (2) stale UNDO after a settled newer write issues no PATCH and toasts expiry; (3) menu stays open across a games-array remount in jsdom.
- Every AC ships a Playwright test or COVERAGE.md row (standing rule). AC3's product fix is e2e-proven by the full suite running green WITHOUT the retry loop (that loop was the flake symptom).
- Close the three deferred-work ledger entries with resolution lines.
- Only one status menu can be open at a time (open-state is a single game id — same invariant the panel hoist established).

**Block If:**
- Removing the retry loop still flakes after the hoist (would mean the remount isn't the root cause — stop and report rather than re-papering).
- Playwright foundation broken.

**Never:**
- No server/API changes; no new dependencies; no Toast API redesign (the generation token makes toast-dismissal machinery unnecessary); no changes to `['genres']` invalidation.
- Don't gate UNDO by dismissing/hiding toasts — the toast may already be under the user's pointer; the guard belongs at activation time.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Write with open search | Search listbox open, any tracking write settles | `['shelf-search']` invalidated → results refetch | No error |
| 409 conflict path | Write refused (invariant) | Both keys invalidated (same refresh guarantee) | Existing conflict toast |
| Fresh UNDO | Drop → toast → Undo (no other write) | Previous status restored (unchanged behavior) | No error |
| Stale UNDO | Drop → toast → set Playing (settles) → Undo | No PATCH; "Undo expired" toast; Playing stands | No error |
| UNDO during in-flight write | Drop → toast → second write pending → Undo | Existing "Still saving…" toast, no write (unchanged) | No error |
| Un-own stale UNDO | Un-own → toast → re-own manually → Undo | No PATCH; expired toast | No error |
| Menu open + refetch | Status menu open, another card's write refetches/re-chunks | Menu still open on the remounted Card | No error |
| Second menu opened | Menu open on card A, pill clicked on card B | A closes, B opens (single-id invariant) | No error |

</intent-contract>

## Code Map

- `web/shelf/useTrackingMutations.ts` -- IN_FLIGHT set (:26), guardPending/beginWrite/settleWrite (:86-92), five `['shelf']` invalidations (:106, :120, :134, :223, :281, :287, :317), status-drop onUndo (:161-179, `previous` at :151), un-own onUndo (:241-253, :233)
- `web/components/Toast.tsx` -- enqueue-only API (`toast(spec)` → void); UNDO click calls onUndo then dismisses — no changes needed here
- `web/shelf/StatusPopover.tsx` -- local `open` state (:39), close() (:55-58), pill handlers (:158-162, :220), dismissal effects (:108-137); gains `open`/`onOpenChange` props
- `web/shelf/Card.tsx` -- renders `<StatusPopover game={game} />` (:173); threads the new props
- `web/shelf/Shelf.tsx` -- ShelfGrid `openGameId` precedent (:211-236); add `openStatusGameId`
- `web/shelf/SearchBox.tsx` -- `['shelf-search', debounced]` (:33); read-only consumer, no changes
- `web/shelf/StatusPopover.test.tsx` -- IN_FLIGHT guard pin (:220-254), UNDO pins (:175-218); harness gains controlled open-state; new stale-UNDO + invalidation hazard tests
- `web/shelf/Shelf.test.tsx` -- new menu-survives-remount hazard test (mirror the panel-survives test)
- `playwright/e2e/epic2-tracking.spec.ts` -- openStatusMenu helper retry loop (:30-44), 11 call sites
- `playwright/COVERAGE.md` + `_bmad-output/implementation-artifacts/deferred-work.md` -- 3.6 rows; close the spec-3-2 search-staleness, spec-3-4 stale-UNDO, spec-3-4 popover-remount entries

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/useTrackingMutations.ts` -- `invalidateShelfQueries()` helper replacing all six `['shelf']` invalidation sites (adds `['shelf-search']`); per-game `WRITE_GEN` stamped in `beginWrite`, captured in both onUndo closures, checked at activation (after the in-flight guard, so the existing "Still saving" pin holds) → expired toast
- [x] `web/shelf/StatusPopover.tsx` + `web/shelf/Card.tsx` + `web/shelf/Shelf.tsx` -- StatusPopover controlled (`open`, `onOpenChange`); ShelfGrid owns `openStatusGameId` (single-id invariant); Card threads required props
- [x] `web/shelf/StatusPopover.test.tsx` + `web/shelf/Shelf.test.tsx` + `Card.test.tsx`/`DetailPanel.test.tsx` harness updates -- hazard tests: shelf-search invalidated on write; stale UNDO expires after a settled newer write; in-flight pin green; menu survives a background-invalidation re-chunk
- [x] `playwright/e2e/epic2-tracking.spec.ts` -- retry loop deleted (plain click + assert); full parallel suite green twice without it
- [x] `playwright/COVERAGE.md` + `_bmad-output/implementation-artifacts/deferred-work.md` -- 3.6a/b/c rows; three ledger entries closed

**Acceptance Criteria:**
- Given any tracking write settling (success or 409), when queries refresh, then both `['shelf']` and `['shelf-search']` are invalidated.
- Given a toast UNDO activated after a newer write on the same game has begun or settled, when clicked, then no stale write is issued and an expiry toast surfaces.
- Given a toast UNDO with no intervening write, when clicked, then it restores exactly as before (no regression).
- Given an open status-popover menu, when a refetch re-chunks the grid and remounts its Card, then the menu remains open.
- Given the `openStatusMenu` e2e helper without its retry loop, when the full parallel suite runs, then all its call sites pass.

## Spec Change Log

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 0
- reject: 7: (high 0, medium 1, low 6)
- addressed_findings:
  - `[medium]` `[patch]` `openStatusGameId` skipped the stale-id cleanup half of the 3.4 pattern it copies — a game leaving the rendered set and reappearing would spontaneously re-open its menu and steal focus. Cleanup effect added; pinned by a new jsdom no-resurrection test
  - `[low]` `[patch]` menu-survival test asserted only that *a* menu was visible — now also asserts identity (`Play status for Bolt`)
  - `[low]` `[patch]` WRITE_GEN's deliberate breadth (any write type, even failed ones, expires undos) and the remount focus-reset trade-off were undocumented — comments state both, with the upgrade path
  - `[low]` `[patch]` `guardStaleUndo` accepted `number | undefined` where a mismatch against `undefined` reads as permanently stale — tightened to `number`, captures use `?? 0`
  - `[low]` `[patch]` COVERAGE 3.6a/3.6c overstated their evidence — reworded to what the tests actually pin
  - `[low]` `[patch]` `noMenu` fixture in DetailPanel.test.tsx was defined after its use site — moved above
- rejected (notable): undo-guard order keeps in-flight ("Still saving") ahead of stale ("Undo expired") — spec-mandated (the 3.4 pin stays intact) and both guards block the stale write either way; failed writes bumping WRITE_GEN is the documented safe-conservative direction; listener re-registration while a menu is open is micro-perf

### 2026-07-10 — Verification follow-up (post-review)
- Removing the retry loop initially flaked 2.2a under full-suite parallel load (2–3 of 5 runs). Trace analysis: NOT the hoisted-state bug (fixed, jsdom-pinned) but a second race the old loop had silently absorbed — the pill click dispatching while an overlapping refetch (back-to-back writes + parallel-worker DB churn) commits a full re-chunk. Fix: a `networkidle` quiescence gate in the helper (deterministic — the page only refetches on its own writes; after quiescence no commit can race the click), not a retry: a masked product regression would still fail, and the jsdom remount tests pin the product fix independently. Full parallel suite then green 3× consecutively.

## Design Notes

- Latest-write token over toast dismissal: the generation map lives next to IN_FLIGHT (same module, same keying, reset together in `resetInFlightWrites`). `beginWrite(id)` bumps `gen`; each undo closure captures the gen of ITS OWN write; at activation, a differing gen means newer intent exists → expired toast. This also covers "newer write currently in flight" (gen already bumped) — guardPending then never fires the stale write either way.
- The popover menu DOM still remounts with its Card (unlike the single hoisted panel) — the hoisted boolean makes it re-open on the remounted Card; the `open`-keyed focus/anchor effects re-run on remount, which is the desired behavior (menu reappears, first row focused).
- SearchBox selection is a no-op today (read-only listbox) — AC1 keeps an OPEN search listbox honest after a write; the search→detail flow doesn't exist yet.

## Auto Run Result

**Summary:** Story 3.6 implemented — the three pre-sync write-path seams are closed. Every tracking write (success and 409 paths) now invalidates `['shelf']` AND `['shelf-search']` through one shared helper; a module-level per-game write generation expires stale toast UNDOs (with an "Undo expired…" toast — NFR-4) while the in-flight "Still saving" contract stays intact; status-popover open-state is grid-owned (`openStatusGameId`, the 3.4 hoist pattern plus stale-id cleanup), so an open menu survives refetch re-chunks — and the `openStatusMenu` e2e retry loop is removed, replaced by a deterministic networkidle quiescence gate after trace analysis showed the loop had also been absorbing a click-vs-refetch-commit race.

**Files changed:**
- `web/shelf/useTrackingMutations.ts` — `invalidateShelfQueries()` (6 sites), `WRITE_GEN` + `guardStaleUndo` wired into both UNDO closures
- `web/shelf/StatusPopover.tsx` — controlled `open`/`onOpenChange`; remount trade-off documented
- `web/shelf/Card.tsx` — threads `statusMenuOpen`/`onStatusMenuOpenChange`
- `web/shelf/Shelf.tsx` — `openStatusGameId` + stale-id cleanup effect in ShelfGrid
- `web/shelf/StatusPopover.test.tsx` — controlled harness; stale-UNDO and shelf-search-invalidation hazard tests
- `web/shelf/Shelf.test.tsx` — menu-survives-re-chunk (identity-asserted) + no-resurrection hazard tests
- `web/shelf/Card.test.tsx` / `DetailPanel.test.tsx` — `noMenu` prop fixture
- `playwright/e2e/epic2-tracking.spec.ts` — retry loop removed (networkidle gate); loadAllPages added to 2.1b (the ledger's second named flake site, missed by 3.5)
- `playwright/COVERAGE.md` (3.6a–c rows), `deferred-work.md` (3 entries closed)

**Review findings:** 6 patches applied (1 medium — missing stale-id cleanup; 5 low), 0 deferred, 7 rejected (guard order is spec-mandated; failed-write gen bump is documented safe-conservative; listener churn is micro-perf).

**Verification:** lint + typecheck clean; Vitest 551/551; Playwright 49/49 three times consecutively with the retry loop removed.

**Residual risks:** a background refetch remounting an open menu resets the arrowed row to the checked row (documented trade-off, upgrade path noted); WRITE_GEN expiry is deliberately broad — any later write on a game, including failed ones, expires its undos.

## Verification

**Commands:**
- `bun run lint && bun run typecheck` -- expected: clean
- `bun run test` -- expected: green incl. new hazard tests and the untouched in-flight guard pin
- `bun run test:e2e` -- expected: full parallel suite green with the retry loop removed
