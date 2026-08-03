---
title: 'Story 13.4: Act on a recommendation and harden the flow'
type: 'feature'
created: '2026-08-03'
status: 'in-review'
baseline_revision: 'd6694f1b869dc83a5c491e5cc11805e28aecf946'
review_loop_iteration: 2
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Play Next already exposes `Play this`, but Epic 13 is incomplete until the action is proven to use the established lifecycle write safely, settle on Shelf, preserve the entire visit on failure, and remain trustworthy across responsive and accessible interaction paths.

**Approach:** Harden the existing recommendation card action around the shared status mutation, add an explicit pending state and successful Shelf focus handoff, and close Epic 13 with combined-flow, accessibility, responsive, and Shelf-regression evidence.

## Boundaries & Constraints

**Always:** Reuse `useTrackingMutations` and its per-game race guard, lifecycle reconciliation, cache invalidation, and toast behavior; navigate only after a successful `Playing` write; preserve the complete mounted visit on failure; retain the approved Story 13.2 Tune modal/bottom-sheet and Story 13.3 Shuffle/Tune command row; keep every action at least 44×44 with visible focus and semantic state.

**Block If:** Luca has not explicitly approved the Story 13.4 implementation-specific HTML mock immediately before UI implementation.

**Never:** Add a recommendation-specific write path, optimistic lifecycle state, backend/schema/provider work, a carousel, inline phone Tune disclosure, persisted visit history, ranking/Tune/Shuffle redesign, or changes to manual Shelf search/filter/status behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Start suggestion | Eligible card; idle mutation | One PATCH sets `Playing`; activated card shows `STARTING…`; its `Play this` and text `Open details` actions are disabled; duplicate activation produces one write | Existing per-game guard remains authoritative |
| Success | PATCH and invalidation succeed | Navigate to Shelf; selected game settles in Playing tier; route-arrival focus lands on its Shelf gridcell/card; success toast remains existing copy | Do not navigate before success |
| Failure | PATCH rejects | Stay on `/play-next`; restore activated actions and focus; preserve ordered slate, visit seed/date, draft/applied intent, seen IDs, exhaustion, and generation; show existing error toast | No blank/reset/re-derivation |
| Routed detail | Open/close any suggestion | Preserve full visit; close returns focus to originating suggestion | Existing fallback to grid/main remains |
| Phone | 320px viewport | Preserve approved two-up compact covers, stacked per-card actions, one-row Shuffle/Tune commands, Tune bottom sheet, and no carousel | No horizontal overflow |
| Regression | Existing Shelf Flow 3 | Search, filters, status mutations, ordering, and focus behavior remain unchanged | Existing regression suites stay green |

</intent-contract>

## Code Map

- `web/play-next/SuggestionCard.tsx` -- shared lifecycle-hook consumer; pending label, disabled state, and same-game race surface.
- `web/play-next/PlayNextPage.tsx` -- success navigation and full visit-state owner.
- `web/shelf/useTrackingMutations.ts` -- existing per-game in-flight/write-generation guards, lifecycle toast, and query invalidation; reuse unchanged unless a proven shared defect requires repair.
- `web/shelf/Shelf.tsx`, `web/shelf/Card.tsx` -- Playing-tier settled result and route-arrival focus target.
- `web/shelf/GameRoute.tsx`, `web/shelf/detail-navigation.ts` -- existing detail preservation/focus chain.
- `web/play-next/PlayNextPage.test.tsx` -- success, failure, pending, rapid activation, state-preservation, and focus tests.
- `playwright/e2e/epic13-play-next.spec.ts` -- real-D1 combined action/responsive/accessibility evidence.
- `playwright/e2e/epic2-tracking.spec.ts`, `playwright/e2e/epic3-filter.spec.ts` -- existing lifecycle and manual Shelf regression flows.
- `playwright/COVERAGE.md` -- Story 13.4 AC-to-browser evidence ledger.
- `_bmad-output/design-demos/epic-13-play-next/07-story-13-4-action-hardening.html` -- implementation-specific approval artifact.

## Tasks & Acceptance

**Execution:**
- [x] `_bmad-output/design-demos/epic-13-play-next/07-story-13-4-action-hardening.html` -- present ready, pending, failure-preserved, success-Shelf, desktop, and 320px states; record Luca approval.
- [x] `web/play-next/SuggestionCard.tsx`, `web/play-next/play-next.css` -- implement approved pending/action treatment without changing card hierarchy.
- [x] `web/play-next/PlayNextPage.tsx`, `web/shelf/Shelf.tsx` -- pass successful selection context through navigation and focus the settled Playing Shelf card without stealing focus on ordinary Shelf visits.
- [x] `web/play-next/PlayNextPage.test.tsx` -- pin single-write pending behavior, success navigation/focus intent, failure restoration, and full visit preservation.
- [x] `playwright/e2e/epic13-play-next.spec.ts`, `playwright/COVERAGE.md` -- prove success settlement, failure preservation, desktop/phone interaction, and every visible Story 13.4 criterion on real D1.
- [x] `playwright/e2e/epic2-tracking.spec.ts`, `playwright/e2e/epic3-filter.spec.ts` -- run unchanged Shelf lifecycle/filter flows as regression evidence; modify only if a real regression is found.

**Acceptance Criteria:**
- Given an eligible suggestion, when `Play this` is activated rapidly, then exactly one existing lifecycle write runs, the activated action reads `STARTING…`, its paired text action is unavailable, and semantic pending/disabled state is exposed.
- Given successful mutation and refetch, when Shelf renders, then the selected game is visibly `Playing`, appears in the Playing tier/order, retains existing success feedback, and receives route-arrival focus once.
- Given mutation failure after Tune/Shuffle/exhaustion state exists, when error returns, then URL, ordered slate, intent readback/draft, visit identity, warning, and next deterministic transition remain unchanged; existing error feedback appears and focus remains usable.
- Given desktop and 320px layouts, when all controls and dialogs are exercised, then approved placement remains, targets are at least 44×44, state is not color-only, Tune remains a modal/bottom sheet, and no carousel or horizontal overflow appears.
- Given routed detail, when it closes, then focus returns to its originating recommendation and no visit state changes.
- Given existing Shelf Flow 3, when lifecycle/filter/search regression runs, then behavior and ordering remain unchanged.
- Given this UI-changing story, when production UI work begins, then Luca's approval of the implementation-specific mock is recorded and every visible AC has Playwright evidence.

## Spec Change Log

## Review Triage Log

### 2026-08-03 — Adversarial and edge-case pass
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 1, medium 6, low 1)
- defer: 0
- reject: 6 (medium 5, low 1)
- addressed_findings:
  - Disabled cover-detail, ownership, Shuffle, and Tune escape paths while any recommendation write remains pending.
  - Restored failed action focus and prevented delayed Shelf settlement from stealing user-moved focus.
  - Consumed invalid or unsettled arrival intent after refetch settlement.
  - Added invalid-arrival, pending-control, concurrent-card-write, non-empty transition, and full 44×44 assertions.
  - Replaced the page's single pending ID with a set after independent follow-up found cross-card writes could settle out of order.
- rejected_findings: native disabled behavior plus the existing module guard already enforce the one-write contract; refetch-failure navigation is outside the stated successful-refetch branch; deep progressive reveal uses the shared tested list primitive; run-unique real-D1 fixtures and serial epic gate cover current scope; Playing-tier assertion plus unchanged Shelf ordering regressions cover settlement order.

### 2026-08-03 — Mandatory independent follow-up
- patch: 1 (medium)
- defer: 0
- reject: 0
- result: pending command lock now tracks every concurrent per-game write; focused regression added and passed.
- follow-up recommendation cleared.

## Design Notes

Oversized-story acceptance: keep Story 13.4 cohesive because its action, failure-preservation, route-focus, responsive, and Shelf-regression checks form one final end-to-end Epic 13 contract and splitting would separate implementation from its merge evidence. Elevated adversarial plus independent follow-up review is mandatory.

The approved Story 13.2/13.3 artifacts supersede stale planning prose: on phone, `TUNE THE PICKS` remains a collapsed trigger opening the shared bottom-sheet modal, while the compact card grid remains two-up with actions stacked inside each card. Story 13.4 introduces no new layout direction.

Pending is local to the activated suggestion and uses existing visual language: button text becomes `STARTING…`, both text actions on that card disable, and `aria-busy` exposes state. Module-level per-game guards still prevent duplicate writes; unrelated suggestion controls are not globally frozen.

Successful navigation carries only the selected game ID as ephemeral route state. Shelf consumes it once after the invalidated query settles, focuses the matching Playing card/gridcell, and clears the intent. Normal Shelf navigation must never auto-focus a card.

Placement mock: `_bmad-output/design-demos/epic-13-play-next/07-story-13-4-action-hardening.html`. Luca applied final shipped-app alignment edits and approved the resulting UI on 2026-08-03; those edits are binding.

## Verification

**Commands:**
- `bun x vitest run --project web web/play-next/PlayNextPage.test.tsx web/shelf/Shelf.test.tsx web/shelf/StatusPopover.test.tsx`
- `bun x vitest run --project unit src/core/status-transition.test.ts src/core/shelf.test.ts`
- `bun x vitest run --project integration test/integration/tracking.test.ts`
- `bun x playwright test playwright/e2e/epic13-play-next.spec.ts playwright/e2e/epic2-tracking.spec.ts playwright/e2e/epic3-filter.spec.ts --workers=1`
- `bun run lint && bun run typecheck && bun x vitest run --maxWorkers=2 && bun run build`

## Auto Run Result

Status: implementation, adversarial review, independent follow-up, and verification complete.

Summary: Reused the shared Playing mutation; added approved local pending treatment; blocked slate-changing escapes until all writes settle; preserved the mounted visit and focus on failure; carried one-shot route focus to the settled Playing Shelf card without ordinary-visit or delayed focus theft; expanded real-D1 success/failure/responsive evidence.

Review: parallel adversarial/edge pass applied 8 patches with no new deferrals. Mandatory independent follow-up found and fixed one cross-card pending-set race. Remaining findings were rejected with evidence in the triage log.

Verification: focused web 59/59; Epic 13 browser 10/10; combined Epic 13 + unchanged Shelf lifecycle/filter browser gate 22/22; full Vitest 79 files / 2173 tests; lint, typecheck, build, and `git diff --check` passed.

Post-epic temporal/resource sweep: visit seed, reference date, Tune/Shuffle history, and arrival focus remain mount/route scoped; no scheduler, provider, schema, persistence, or backend budget was added. One existing PATCH plus normal Shelf invalidation/refetch remains the action budget. Shared-D1 parallel-fixture harness risk was explicitly accepted and closed in the deferred ledger after serial combined-flow evidence.

UI-MOCK-GATE: approved by Luca on 2026-08-03 after Luca's final shipped-app alignment edits. Production implementation may proceed.
