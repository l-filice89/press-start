---
title: 'Story 13.3: Shuffle without repetition'
type: 'feature'
created: '2026-08-02'
status: 'done'
baseline_revision: 'a43b585a55cd98bca55694bc60c0dd872944611e'
final_revision: '18302c4cc4b5b6ffcd7e16392ff612d1ed043fa4'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Rejecting a Play Next slate can immediately resurface games already shown during the same visit, making Shuffle feel repetitive and untrustworthy.

**Approach:** Add pure candidate exclusion to the recommendation engine and visit-scoped seen/exhaustion state to Play Next, with an explicit fresh-pool transition after unseen matches run out.

## Boundaries & Constraints

**Always:** Shuffle from the frozen visit Shelf snapshot using only the applied intent, union every displayed game ID into a visit-scoped seen set, exclude currently visible cards from every immediate replacement, preserve the full state through routed detail, retain focus on Shuffle, and announce every completed refresh even when the result count repeats. Build Familiar intent anchors from the full snapshot before exclusions.

**Block If:** Luca has not explicitly approved a Story 13.3 implementation-specific HTML mock showing normal Shuffle, smaller exhausted slate, and reset-ready placement immediately before UI implementation.

**Never:** Persist seen/history state, add backend/schema/provider work, use unapplied draft intent, mutate caller inputs or Shelf data, change manual Shelf filters, alter Tune behavior, auto-reset without the warned follow-up Shuffle, or reintroduce a currently visible card in the immediately resulting slate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Normal Shuffle | At least three unseen eligible matches | Replace slate using applied intent; exclude all visit-seen IDs; union new IDs into seen | Keep initiating control focused; announce honest count |
| Near exhaustion | One or two unseen matches | Show smaller slate and exact exhaustion warning; arm fresh-pool reset | Do not fill from seen pool early |
| Complete exhaustion | Zero unseen matches | Keep current slate visible, show the same warning, and arm reset | Avoid blank dead-end and preserve current-card exclusion |
| Armed reset | Warning visible and Shuffle runs | Clear old history for selection, exclude current visible IDs, generate fresh pool, and seed new seen set from result | Current cards never immediately return |
| Tune after Shuffle | Draft applied explicitly | Generate from new applied intent and union displayed IDs into the visit seen set | Draft edits alone change neither slate nor seen set |
| Routed detail / new visit | Detail overlay / destination remount | Detail preserves slate, seen, exhaustion, generation; remount resets all | No persisted history |

</intent-contract>

## Code Map

- `src/core/play-next.ts` -- accept immutable excluded game IDs while deriving intent anchors from the full candidate snapshot.
- `src/core/play-next.test.ts` -- pin exclusions, determinism, input immutability, Familiar-anchor ordering hazard, and Finish-cap interaction.
- `web/play-next/PlayNextPage.tsx` -- own visit seen IDs, exhaustion/reset state, generation counter, Shuffle transition, focus, and announcements.
- `web/play-next/play-next.css` -- approved Shuffle/warning placement, responsive target size, focus, and reduced-motion treatment.
- `web/play-next/PlayNextPage.test.tsx` -- cover normal, exhausted, zero-result, reset, draft/applied, detail, and remount transitions.
- `playwright/e2e/epic13-play-next.spec.ts`, `playwright/COVERAGE.md` -- visible Story 13.3 flows and per-AC evidence ledger.
- `_bmad-output/design-demos/epic-13-play-next/06-story-13-3-shuffle-states.html` -- implementation-specific approval artifact.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/play-next.ts`, `src/core/play-next.test.ts` -- add and hazard-test pure exclusion before UI work.
- [x] `_bmad-output/design-demos/epic-13-play-next/06-story-13-3-shuffle-states.html` -- present normal, exhausted, and reset-ready states and record Luca approval.
- [x] `web/play-next/PlayNextPage.tsx`, `web/play-next/play-next.css` -- implement approved visit state machine and responsive Shuffle surface.
- [x] `web/play-next/PlayNextPage.test.tsx` -- pin every state transition, repeated announcement, focus, preservation, and reset.
- [x] `playwright/e2e/epic13-play-next.spec.ts`, `playwright/COVERAGE.md` -- prove every visible criterion on real D1.

**Acceptance Criteria:**
- Given applied intent and a different unapplied draft, when Shuffle runs, then only applied intent is used and every game shown earlier in the visit is excluded.
- Given any current slate, when normal Shuffle or fresh-pool reset replaces it, then no currently visible game appears immediately afterward.
- Given one or two unseen matches, when Shuffle runs, then the honest smaller slate renders with `You’ve seen every other match. Next Shuffle starts a fresh pool.`
- Given no unseen match, when Shuffle runs, then current cards remain, the same warning appears, and the next Shuffle is armed to reset.
- Given the warning, when Shuffle runs again, then old seen history resets for selection while current cards stay excluded and the resulting IDs start the fresh seen set.
- Given routed detail navigation, when it closes, then slate, applied/draft intent, seen IDs, exhaustion state, and generation remain unchanged; leaving and re-entering Play Next resets them.
- Given a completed refresh, when results update, then Shuffle retains focus, the honest count is announced on every run, reduced-motion is respected, and the control target is at least 44px on desktop and 320px phone.
- Given this UI-changing story, when UI implementation begins, then Luca's approval of the implementation-specific mock is recorded and every visible AC has Playwright evidence.

## Spec Change Log

## Review Triage Log

### 2026-08-03 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 1, medium 3, low 2)
- defer: 0
- reject: 5: (medium 3, low 2)
- addressed_findings:
  - `[high]` `[patch]` Replaced result-count exhaustion inference with a one-result probe so Finish-capped unseen games are shown before history resets.
  - `[medium]` `[patch]` Strengthened exclusion hazard assertions so leaking either excluded ID fails independently.
  - `[medium]` `[patch]` Added Tune-after-Shuffle/reset-armed coverage proving Tune clears the warning and unions its displayed IDs into visit history.
  - `[medium]` `[patch]` Extended browser evidence to compare Shuffle against initial and Tune-applied visit IDs and to assert full zero-pool slate sizes.
  - `[low]` `[patch]` Corrected warning text-color specificity to preserve approved amber styling.
  - `[low]` `[patch]` Prevented disabled Shuffle hover from receiving active styling.

## Design Notes

`seenGameIds` contains every game actually displayed during the mounted destination visit, including initial, Tune-applied, shuffled, and fresh-pool slates. The exhausted/reset flag is armed after a one- or two-card replacement only when a one-result probe confirms no selectable unseen game remains, or after a zero-unseen attempt that deliberately preserves the current slate. Fresh-pool selection uses an empty historical exclusion plus current visible IDs; afterward, seen state starts from only the newly displayed slate.

Near-exhausted and reset-ready are one state, not two steps. Once the smaller slate and warning appear, the very next single Shuffle click immediately generates the fresh-pool slate while excluding the cards currently visible.

Exclusions are an optional core selection input and affect eligibility only after full-snapshot context such as Familiar genre anchors is derived. Seed suffixes use one monotonic visit generation counter across Tune and Shuffle so every explicit generation is deterministic and distinct.

Shuffle is a native button immediately left of `TUNE THE PICKS` in the top command row. Exhaustion warning is programmatic status text directly beneath that row and before the suggestion grid. On phone both commands share the full-width row with 44px targets. Motion changes use existing CSS transitions only and are disabled under `prefers-reduced-motion: reduce`.

Placement mock: `_bmad-output/design-demos/epic-13-play-next/06-story-13-3-shuffle-states.html`. Luca made final app-alignment edits and approved the resulting mock on 2026-08-03. Approval phrase `but not ... is approved` is recorded as a typo for `but now ... is approved`; the final edited file is binding for implementation.

## Verification

**Commands:**
- `bun x vitest run --project unit src/core/play-next.test.ts`
- `bun x vitest run --project web web/play-next/PlayNextPage.test.tsx`
- `bun x playwright test playwright/e2e/epic13-play-next.spec.ts --workers=1`
- `bun run lint && bun run typecheck && bun x vitest run --maxWorkers=2 && bun run build`

## Auto Run Result

Status: implementation and adversarial review complete.

Summary: Added pure candidate exclusion, visit-scoped seen/exhaustion state, one-click fresh-pool Shuffle, approved top command-row placement, exact warning, focus/live-region behavior, responsive layout, and reduced-motion handling.

Files changed: core selector and hazard tests; Play Next state/UI/CSS and web tests; Epic 13 Playwright scenarios and coverage ledger; this execution record.

Review: 6 patches applied, 0 new deferrals, 5 findings rejected. Existing shared-D1 cross-file isolation risk remains tracked from Story 13.1 and was not duplicated.

Follow-up review recommendation: true. Review changed exhaustion semantics and broadened state-transition evidence.

Verification: core 22/22; web 22/22; Epic 13 Playwright 9/9 on real local D1; full Vitest 79 files / 2169 tests; lint, typecheck, build, and `git diff --check` passed.

Residual risk: when the entire eligible pool is already visible, fresh-pool selection cannot produce a different card without violating current-card exclusion; Shuffle honestly retains the slate and announces zero new suggestions.
