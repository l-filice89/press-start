---
title: 'Story 3.5: Reveal-pill exclusive mode'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: 'f89db51757fc8782958cf8cf2fb4b980d61a214c'
final_revision: 'c78e6cedbec047d82f512c4a4ae8832110c113af'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Reveal pills are additive today (`filters.ts:74-77` unions reveals into the state group), so revealed Completed/Platinum/Dropped games land behind the default order + infinite scroll — the retro's Significant Discovery. PRD FR-4/FR-20/FR-21 were amended 2026-07-10 to an exclusive view; code, summary sentence, and e2e suites still implement the superseded semantics. The story also bundles three assigned deferred-work items on the same surfaces (shared focus trap, empty-state focus handoff, loadAllPages flake fix).

**Approach:** Make reveals their own exclusive group in the pure filter layer (`reveals.length > 0` → visible set is reveal states only), enforce State↔Reveal mutual exclusion in the toggle handlers (activating one clears the other), narrate reveal views literally in the summary, extract one shared modal focus-trap for ConfirmDialog/DetailPanel/FilterSheet, hand focus to a deliberate target when ShelfGrid unmounts to the empty state, and rewrite the pinning tests/e2e to the amended contract.

## Boundaries & Constraints

**Always:**
- AC1 (FR-4/FR-20/FR-21 as amended): any reveal pill selected → visible set contains **only** games whose effective state is in the selected reveal set; the State group is replaced entirely and state selections **clear** (filter object holds `states: []` while reveals are active, not just ignored).
- AC2: multiple reveal pills OR among themselves (Completed + Platinum = either).
- AC3: Genre and Flag selections still AND with an active reveal view (Completed + RPG + Owned → only completed owned RPGs). Ordering unchanged — `applyShelfFilter` stays an order-preserving subset.
- AC4 (FR-21): mutual exclusion is bidirectional — selecting a State-dropdown entry while a reveal is active clears the reveals, in every entry point (desktop row AND FilterSheet).
- AC5 (FR-21 wording): a reveal-only view narrates literally — "Showing Story completed games." / "Showing Story completed or Dropped games." (existing reveal-term vocabulary, OR connectors) — the live-status enumeration branch (`filters.ts:110-116`) is removed. Shelf announcement (`Shelf.tsx:72-81`) keeps working off `summarizeFilterText`.
- AC6 (deferred-work: spec-3-4 last-visible-card entry): when `ShelfGrid` unmounts to `EmptyState` while the grid held focus, focus lands on a deliberate target — the Clear-filters action, else the empty-state heading — never `<body>`. Handoff must live above ShelfGrid (its restore effect unmounts with it).
- AC7 (deferred-work: spec-3-3 trap-triplication entry): one shared focus-trap implementation (hook or component) consumed by ConfirmDialog, DetailPanel, and FilterSheet — preserving FilterSheet's container-self Shift+Tab branch (`FilterRow.tsx:283-287`), DetailPanel's `confirming` stand-down (as an `enabled` guard), focus-on-open, Escape-capture dismiss, and the shared `FOCUSABLE_SELECTOR`. All existing trap tests stay green.
- AC8 (deferred-work: spec-3-1 parallel-flake entry): `loadAllPages` inserted before the fold-sensitive asserts in `epic2-detail.spec.ts` (~:118-121 aria-label check) and `epic2-tracking.spec.ts` (~:155-166 disappearance/reappearance checks).
- Hazard tests red→green per named hazard: exclusive replacement (states cleared), bidirectional mutual exclusion, OR-among-reveals, AND-with-genre/flags, literal summary, empty-state focus handoff.
- Every AC ships a Playwright test or COVERAGE.md row (standing rule); the epic3 reveal/summary/filter suites are **rewritten** to the amended contract, not patched around.
- Close the three bundled deferred-work ledger entries with resolution lines.

**Block If:**
- The amended PRD/epics semantics contradict each other on any reveal behavior.
- Playwright foundation broken (never write a false skip reason).

**Never:**
- No URL/persisted filter state; no server/API changes; no new dependencies; no reordering logic changes.
- Don't keep a dead additive code path behind a flag — superseded semantics are deleted.
- Don't recompute effective state client-side (AD-7 — consume `game.effectiveState`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reveal from default view | No states, toggle `Dropped` pill | Only Dropped games visible | No error |
| Reveal while states active | `states:[Playing]`, toggle `Story completed` | `states` cleared; only Story-completed games | No error |
| State while reveal active | `reveals:[Dropped]`, select `Paused` in dropdown | `reveals` cleared; only Paused games | No error |
| Two reveals | Toggle `Story completed` + `Platinum achieved` | Games in either state | No error |
| Reveal + genre + flag | `Dropped` + RPG + Owned | Only dropped, owned RPGs | No error |
| Reveal with zero matches | `Dropped` pill, no dropped games seeded | NO MATCH empty state; focus on Clear filters if grid had focus | No error |
| Untoggle last reveal | `reveals:[Dropped]` → toggle off | Default visible set returns | No error |
| Summary, reveal-only | `reveals:[Story completed]` | "Showing Story completed games." — no live-status enumeration | No error |
| Active-count badge | `reveals:[Dropped]`, phone | Badge counts 1 (states guaranteed empty) | No error |

</intent-contract>

## Code Map

- `web/shelf/filters.ts` -- `ShelfFilter` type (:40-52), `applyShelfFilter` additive branch (:74-77), `summarizeFilter` enumeration branch (:108-134), `toggleSelection` (:144)
- `web/shelf/FilterRow.tsx` -- desktop reveal pills (:156-177), state dropdown (:108-119), FilterSheet modal scaffold + trap (:216-414), active-count badge (:58-62), `FilterSummary` (:189-208)
- `web/shelf/Shelf.tsx` -- `FilteredShelf` owns filter state (:56), EmptyState swap (:90-110), announce effect (:72-81), ShelfGrid focus-restore + `gridHadFocus` (:195-203, :357-376)
- `web/components/EmptyState.tsx` -- no focus target today; gets heading/action focus support
- `web/components/ConfirmDialog.tsx` (:28-64), `web/shelf/DetailPanel.tsx` (:132-173) -- duplicated traps; `web/components/focusable.ts` `FOCUSABLE_SELECTOR`
- `web/shelf/filters.test.ts` (:91, :96, :139, :162, :209, :217-219), `FilterRow.test.tsx` (:165, :197, :212-222), `Shelf.test.tsx` -- pinning tests to rewrite/extend
- `playwright/e2e/epic3-reveal.spec.ts`, `epic3-summary.spec.ts`, `epic3-filter.spec.ts`, `epic3-focus.spec.ts` -- suites rewritten to exclusive contract
- `playwright/e2e/epic2-detail.spec.ts` (~:118-121), `epic2-tracking.spec.ts` (~:155-166), `playwright/support/helpers/shelf.ts` (`loadAllPages`) -- flake fix
- `playwright/COVERAGE.md`, `_bmad-output/implementation-artifacts/deferred-work.md` -- rows + 3 ledger closures

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/filters.ts` + `filters.test.ts` -- exclusive `applyShelfFilter` (reveals replace state group), literal reveal summary in `summarizeFilter`; rewrite additive pins, add hazard tests for the full edge matrix -- pure layer first, everything else consumes it
- [x] `web/shelf/FilterRow.tsx` + `FilterRow.test.tsx` -- bidirectional clear in reveal-pill and state-dropdown handlers (desktop row + FilterSheet); verify badge; hazard tests for both clear directions
- [x] `web/components/` (new trap hook/component) + `ConfirmDialog.tsx` + `web/shelf/DetailPanel.tsx` + `FilterRow.tsx` FilterSheet -- extract shared focus trap (Escape capture, Tab cycle incl. container-self branch, focus-on-open, `enabled` guard); all three adopt it; existing trap tests green (`web/components/useModalTrap.ts`)
- [x] `web/shelf/Shelf.tsx` + `web/components/EmptyState.tsx` + `Shelf.test.tsx` -- grid→empty-state focus handoff (deliberate target, never body); hazard test: focused card, filter to zero matches, focus lands on Clear filters
- [x] `playwright/e2e/epic3-reveal.spec.ts` + `epic3-summary.spec.ts` + `epic3-focus.spec.ts` -- rewritten to exclusive contract: replacement + state-clear, OR among reveals, AND with flags, mutual exclusion both directions, literal summary wording, empty-view focus handoff (epic3-filter.spec.ts needed no changes — it never pinned reveal semantics)
- [x] `playwright/e2e/epic2-detail.spec.ts` + `epic2-tracking.spec.ts` -- `loadAllPages` before the fold-sensitive asserts (2.3c scrollIntoViewIfNeeded, 2.3e post-backdrop label, 2.1c post-Undo reappearance)
- [x] `playwright/COVERAGE.md` + `_bmad-output/implementation-artifacts/deferred-work.md` -- 3.5a–3.5g rows added, 3.2b marked superseded; the spec-3-1 flake, spec-3-3 trap, spec-3-4 empty-focus entries closed

**Acceptance Criteria:**
- Given any dotted reveal pill selected, when the shelf renders, then only games in the selected hidden state(s) are visible and state selections are cleared.
- Given two reveal pills selected, then matching games of either state show (OR).
- Given an active reveal view with Genre/Flag selections, then those still narrow it (AND).
- Given a state-dropdown selection while a reveal is active, then the reveal clears (mutual exclusion, both directions).
- Given a reveal-only view, then the summary reads "Showing {reveal terms} games." with no live-status enumeration.
- Given a focused card and a filter change emptying the shelf, when ShelfGrid unmounts, then focus lands on Clear filters or the empty-state heading, never `<body>`.
- Given ConfirmDialog, DetailPanel, and FilterSheet, then all three consume one shared trap implementation with no behavior regression.
- Given the full parallel Playwright suite, then the two previously-flaky epic2 asserts run green with `loadAllPages` in place.

## Spec Change Log

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 4, low 3)
- defer: 1: (high 0, medium 0, low 1)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[medium]` `[patch]` headline-fallback handoff path was untested while COVERAGE.md implied jsdom covered it — added a jsdom test (all-hidden library → INSERT GAMES → headline focused) and corrected the 3.5e row
  - `[medium]` `[patch]` reveal-pill accessible names understated the exclusive semantics ("Show X games" while replacing the whole view) — renamed to "Show only X games" in the desktop row and the sheet, tests updated
  - `[medium]` `[patch]` the `activeElement === body` handoff guard was a proxy (fired for focus parked on dead page background too) — replaced with a capture-armed `shelfHadFocus` flag on a display:contents wrapper (same technique as ShelfGrid's 3.4 restore), so only focus that died with the swap triggers a handoff
  - `[medium]` `[patch]` reverse transition hole: activating Clear filters unmounted the empty state under the focused button, dropping focus to `<body>` — the handoff effect now tracks grid/empty view transitions and lands focus back on the grid; pinned in the extended jsdom test
  - `[low]` `[patch]` the headline focus target had no visible focus style (programmatic focus doesn't reliably match `:focus-visible`) — explicit `:focus` outline added, matching the UX-DR19/20 floor
  - `[low]` `[patch]` toggle-off of the last reveal pill (return to the default set) lost its regression coverage in the e2e rewrite — re-pinned in jsdom
  - `[low]` `[patch]` reveal-view announcement said "N of defaultCount" where the denominator excluded the revealed games — denominator switches to the whole library for reveal views
- deferred: the Escape-greedy document-capture dismiss now centralized in useModalTrap (pre-existing behavior, real only when a modal gains an Escape-owning inner popup without wiring `enabled`)

## Design Notes

- Summary vocabulary: FR examples say "Showing Completed games."; existing pills/terms use `Story completed` / `Platinum achieved` / `Dropped`. Keep the existing term vocabulary (pill label = summary term) — the amendment fixes *structure* (literal, no enumeration), not term spelling.
- Mutual exclusion is enforced in the handlers (filter object always consistent: `states` and `reveals` never both non-empty), and `applyShelfFilter` still treats `reveals.length > 0` as authoritative — defense in depth, no state where both apply.
- Empty-state handoff: the arm/disarm signal must outlive ShelfGrid — hoist a "shelf had focus" ref to `FilteredShelf` (or pass a callback ref into EmptyState with autofocus-on-swap). Reuse the 3.4 pattern: deliberate target, no focus theft when the user was elsewhere (e.g. in the filter row when results empty — focus must NOT jump).

## Auto Run Result

**Summary:** Story 3.5 implemented — reveal pills are now an exclusive view per the amended FR-4/FR-20/FR-21: `applyShelfFilter` treats any reveal selection as authoritative (only the revealed hidden states show), the toggle handlers keep State and reveals mutually exclusive in both directions (desktop row + phone sheet), and the summary narrates a reveal view literally ("Showing Story completed games.") with no live-status enumeration. Bundled deferred work closed: one shared `useModalTrap` scaffold for ConfirmDialog/DetailPanel/FilterSheet; a bidirectional grid↔empty-state focus handoff (capture-armed, never steals focus, reverse path returns focus to the grid on Clear filters); loadAllPages de-flaking in the three fold-sensitive epic2 asserts.

**Files changed:**
- `web/shelf/filters.ts` — exclusive `applyShelfFilter` branch; literal reveal narration in `summarizeFilter`
- `web/shelf/FilterRow.tsx` — mutual-exclusion clears in all four toggle sites; "Show only X games" labels; sheet label "show only (or)"; FilterSheet adopts `useModalTrap`
- `web/components/useModalTrap.ts` (new) — shared focus-on-open / capture-Escape (`enabled` stand-down) / Tab-cycle trap
- `web/components/ConfirmDialog.tsx`, `web/shelf/DetailPanel.tsx` — hand-rolled traps replaced by the hook
- `web/shelf/Shelf.tsx` — grid↔empty focus handoff (shelfHadFocus capture wrapper + view-transition effect); reveal-aware announcement denominator
- `web/components/EmptyState.tsx` + `empty-state.css` — focusable headline with explicit focus outline
- `web/shelf/filters.test.ts`, `FilterRow.test.tsx`, `Shelf.test.tsx` — additive pins rewritten to the exclusive contract; hazard tests for replacement/OR/AND/mutual-exclusion/literal-summary/handoff (forward, reverse, headline fallback, toggle-off)
- `playwright/e2e/epic3-reveal.spec.ts` (exclusive-contract rewrite + reveal×flag AND test), `epic3-summary.spec.ts` (literal summary test), `epic3-focus.spec.ts` (last-visible-card handoff via run-unique genre), `epic2-detail.spec.ts` + `epic2-tracking.spec.ts` (loadAllPages ×3)
- `playwright/COVERAGE.md` (3.5a–g rows, 3.2b superseded), `deferred-work.md` (3 entries closed, DW-9 + 1 defer added)

**Review findings:** 7 patches applied (4 medium — untested headline fallback, understated reveal labels, handoff arming proxy, reverse-transition focus hole; 3 low), 1 deferred (Escape-greedy trap primitive, pre-existing), 10 rejected.

**Verification:** lint + typecheck clean; Vitest 547/547; Playwright 49/49 twice consecutively (one earlier run flaked on pre-existing epic1 1.7c under machine load — ledgered as DW-9, green in isolation and both final runs).

**Residual risks:** DW-9 (1.7c sentinel timing under heavy parallel load); the Escape-greedy trap convention (deferred); UX-DR9's "dashed reveals" shape language now encodes "reveals exclusively" — planning docs already amended, no code impact.

## Verification

**Commands:**
- `bun run lint && bun run typecheck` -- expected: clean
- `bun run test` -- expected: green incl. new hazard tests, rewritten filter pins
- `bun run test:e2e` -- expected: full parallel suite green incl. rewritten epic3 suites and the two de-flaked epic2 asserts
