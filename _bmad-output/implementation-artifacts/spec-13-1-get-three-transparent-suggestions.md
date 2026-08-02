---
title: 'Story 13.1: Get three transparent suggestions'
type: 'feature'
created: '2026-08-02'
status: 'draft'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Play Next has no shipped destination or recommendation engine, so Luca cannot receive an immediate, transparent three-game shortlist from the existing Shelf data.

**Approach:** Add a pure, deterministic core derivation and a `/play-next` destination consuming cached `['shelf']` data. Render three varied, explained default suggestions, preserve the slate through routed detail overlays, and cover every visible behavior in Playwright.

## Boundaries & Constraints

**Always:** Keep eligibility, scoring factors, explanations, seeded tie-breaking, Finish them classification, and diversity in `src/core/`; pass a reference ISO date and visit seed explicitly. Use only known facts. Treat missing enrichment as absence, never zero. Exclude raw `Playing`/`Dropped`, any platinumed game, and known future releases; retain unknown/TBA releases. Default access is owned or current `psPlusExtra`. Cap Finish them at one. Consume the existing `['shelf']` query and react-router background-location pattern. Keep every visible target at least 44x44 and preserve visible focus.

**Block If:** Luca has not explicitly approved the placement mock below immediately before UI implementation; Shelf payload lacks a fact needed for a visible explanation; deterministic rules cannot avoid three near-identical results without violating eligibility or the Finish them cap.

**Never:** Add schema, migration, API, provider, cron, external recommendation service, LLM/ML, persisted recommendations, `Math.random`, render-path I/O beyond the existing Shelf query, duplicate status mutation logic, or changes to manual Shelf filtering.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Default slate | At least three eligible accessible games | Exactly three deterministic, varied suggestions for visit seed; at most one Finish them | No error expected |
| Small pool | One or two eligible games | Render all eligible games without placeholders or duplication | Explain smaller pool without unsupported facts |
| No candidates | No eligible accessible games | Render honest empty state | Keep navigation usable |
| Future/terminal | Future date, Playing, Dropped, or platinumed | Candidate excluded | No silent fallback that re-admits it |
| Missing facts | Null scores, TTB, dates, cover, or empty genres | Candidate remains eligible; missing fact adds no factor or claim | Omit unknown fact from card |
| Detail round-trip | Open and close `/game/:id` from Play Next | Same mounted page, slate, seed, and focused originating card remain | Existing detail load error remains in overlay |
| Shelf read failure | Existing `['shelf']` query fails | No slate; existing error surface shown | Do not invent cached results |

</intent-contract>

## Code Map

- `src/core/play-next.ts` -- new pure eligibility, Finish them, factor, explanation, seeded selection, and diversity rules.
- `src/core/play-next.test.ts` -- deterministic boundary and named-hazard coverage.
- `src/core/index.ts` -- public core exports.
- `web/shelf/api.ts` -- existing `ShelfGame` and `fetchShelf`; no wire changes expected.
- `web/play-next/PlayNextPage.tsx` -- query-backed visit owner, initial slate, focus entry, loading/error/empty states.
- `web/play-next/SuggestionCard.tsx` -- transparent known-fact card and routed detail actions.
- `web/play-next/play-next.css` -- placement, equal desktop cards, compact mobile stack, focus, reduced motion.
- `web/shell/Header.tsx` -- add PLAY NEXT to link navigation and roving arrow order.
- `web/shell/AppShell.tsx` -- add route and hide Shelf search while Play Next is active, including behind detail.
- `web/shelf/GameRoute.tsx` -- extend close-focus target for a Play Next card without changing cold-detail fallback.
- `web/shell/Header.test.tsx`, `web/shell/AppShell.test.tsx` -- navigation, search, route, and background preservation.
- `web/play-next/PlayNextPage.test.tsx` -- render, focus, slate stability, known-fact, empty/error coverage.
- `playwright/e2e/epic13-play-next.spec.ts` -- every Story 13.1 visible AC.
- `playwright/COVERAGE.md` -- per-AC Story 13.1 evidence.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/play-next.ts` -- define structural candidate/result types and pure rules. Return ordered additive factors plus primary reason; use stable string hashing for seeded ties and a diversity pass over genre and reason; never mutate input.
- [ ] `src/core/play-next.test.ts` -- red/green tests for each matrix row, same-seed stability, different-seed tie variation, missing-data neutrality, unknown-release eligibility, terminal/future exclusion, Finish them cap, and three-near-identical avoidance.
- [ ] `src/core/index.ts` -- export Play Next core API.
- [ ] `web/play-next/PlayNextPage.tsx`, `web/play-next/SuggestionCard.tsx`, `web/play-next/play-next.css` -- after mock approval, own a visit seed in component state, reuse `['shelf']`, focus `WHAT NEXT?` only on destination mount, render transparent cards, and open details through `toDetail`.
- [ ] `web/shell/Header.tsx`, `web/shell/AppShell.tsx`, `web/shelf/GameRoute.tsx` -- wire `/play-next`, four-link roving navigation, hidden search, stable background route, and close-focus handoff.
- [ ] `web/play-next/PlayNextPage.test.tsx`, `web/shell/Header.test.tsx`, `web/shell/AppShell.test.tsx` -- cover web behavior and state preservation.
- [ ] `playwright/e2e/epic13-play-next.spec.ts`, `playwright/COVERAGE.md` -- seed real D1 rows and pin every Story 13.1 UI AC with coverage-map evidence.

**Acceptance Criteria:**
- Given authenticated navigation, when Play Next ships, then `SHELF | PLAY NEXT | CATALOG | STATS` links to `/play-next`, search is absent there, and focus enters `WHAT NEXT?`.
- Given a new visit with at least three eligible candidates, when Play Next mounts, then three default Surprise me suggestions appear without preliminary questions.
- Given known future dates, raw `Playing`/`Dropped`, or platinum completion, when eligibility runs, then those games are excluded while known released and unknown/TBA owned/current-PS+ games remain eligible.
- Given Paused or completed-without-platinum games, when default selection runs, then they may be tagged Finish them and occupy at most one card.
- Given missing enrichment, when ranking and explanation run, then absence neither excludes nor scores and produces no unsupported claim.
- Given eligible candidates, when selection runs, then inspectable additive factors, seeded ties, and cross-card diversity prevent a three-card near-duplicate slate.
- Given a suggestion, when rendered, then cover/title, one primary reason, optional access tag, known facts, one plain explanation, and `Play this`/`Open details` are present; unknown facts are absent.
- Given Open details, when the overlay closes, then the same slate and visit state remain and focus returns to the originating suggestion.
- Given Story 13.1 UI implementation, when code begins, then the approved mock below is recorded and every visible criterion has passing Playwright evidence.

## Spec Change Log

## Review Triage Log

## Design Notes

Core scores stay explainable: each non-missing signal contributes a named integer factor; totals never erase factor provenance. Use stable ID ordering before seeded tie-breaking so server order cannot change a visit. Diversity selects highest ranked candidate, then applies an explicit repeat penalty to shared primary genre/reason for remaining slots. Eligibility and Finish them cap remain hard constraints.

Placement mock requiring Luca approval:

```text
DESKTOP
┌─────────────────────────────────────────────────────────────────────┐
│ PRESS START   SHELF | PLAY NEXT | CATALOG | STATS       SETTINGS   │
├─────────────────────────────────────────────────────────────────────┤
│ WHAT NEXT?                         Three picks from your Shelf       │
│ SURPRISE ME                                                        │
│ ┌───────────────┐  ┌───────────────┐  ┌───────────────┐            │
│ │ cover         │  │ cover         │  │ cover         │            │
│ │ TITLE         │  │ TITLE         │  │ TITLE         │            │
│ │ PRIMARY REASON│  │ PRIMARY REASON│  │ PRIMARY REASON│            │
│ │ known facts   │  │ known facts   │  │ known facts   │            │
│ │ explanation   │  │ explanation   │  │ explanation   │            │
│ │ PLAY THIS     │  │ PLAY THIS     │  │ PLAY THIS     │            │
│ │ OPEN DETAILS  │  │ OPEN DETAILS  │  │ OPEN DETAILS  │            │
│ └───────────────┘  └───────────────┘  └───────────────┘            │
└─────────────────────────────────────────────────────────────────────┘

PHONE
┌────────────────────────────┐
│ PRESS START   SETTINGS     │
│ SHELF | PLAY NEXT | ...    │
├────────────────────────────┤
│ WHAT NEXT?                 │
│ SURPRISE ME                │
│ ┌────────────────────────┐ │
│ │ cover | TITLE          │ │
│ │       | reason + facts │ │
│ │ explanation            │ │
│ │ PLAY THIS | DETAILS    │ │
│ └────────────────────────┘ │
│ [card 2]                   │
│ [card 3]                   │
└────────────────────────────┘
```

Approval: **APPROVED by Luca on 2026-08-02 — "Approve revised option A placement mock". Production UI must follow revised Option A without `VARIED DEFAULT SLATE`.**

`Play this` must not become a dead control. Story 13.1 may wire the existing `useTrackingMutations` path early; Story 13.4 remains owner of success/failure navigation, race-guard, responsive, accessibility, and Shelf-regression hardening.

## Verification

**Commands:**
- `bunx vitest run --project unit src/core/play-next.test.ts` -- pure rules and hazards pass.
- `bunx vitest run --project web web/play-next/PlayNextPage.test.tsx web/shell/Header.test.tsx web/shell/AppShell.test.tsx` -- destination behavior passes.
- `bunx playwright test playwright/e2e/epic13-play-next.spec.ts` -- all Story 13.1 visible flows pass.
- `bun run lint && bun run typecheck && bun run test && bun run build` -- repository gate passes.

## Auto Run Result

Status: blocked
Blocking condition: UI-MOCK-GATE approval missing. Luca must explicitly approve the placement mock in this spec before UI implementation. Story 13.1 also gates Stories 13.2–13.4 through epic continuity.

Resumption: UI-MOCK-GATE cleared on 2026-08-02 by Luca: "Approve revised option A placement mock". Spec returned to `draft` for `/bmad-dev-auto` resumption.
