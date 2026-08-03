---
title: 'Story 13.1: Get three transparent suggestions'
type: 'feature'
created: '2026-08-02'
status: 'done'
baseline_revision: 'd51a979'
final_revision: 'b05ced8'
review_loop_iteration: 0
followup_review_recommended: true
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
- [x] `src/core/play-next.ts` -- define structural candidate/result types and pure rules. Return ordered additive factors plus primary reason; use stable string hashing for seeded ties and a diversity pass over genre and reason; never mutate input.
- [x] `src/core/play-next.test.ts` -- red/green tests for each matrix row, same-seed stability, different-seed tie variation, missing-data neutrality, unknown-release eligibility, terminal/future exclusion, Finish them cap, and three-near-identical avoidance.
- [x] `src/core/index.ts` -- export Play Next core API.
- [x] `web/play-next/PlayNextPage.tsx`, `web/play-next/SuggestionCard.tsx`, `web/play-next/play-next.css` -- after mock approval, own a visit seed in component state, reuse `['shelf']`, focus `WHAT NEXT?` only on destination mount, render transparent cards, and open details through `toDetail`.
- [x] `web/shell/Header.tsx`, `web/shell/AppShell.tsx`, `web/shelf/GameRoute.tsx` -- wire `/play-next`, four-link roving navigation, hidden search, stable background route, and close-focus handoff.
- [x] `web/play-next/PlayNextPage.test.tsx`, `web/shell/Header.test.tsx`, `web/shell/AppShell.test.tsx` -- cover web behavior and state preservation.
- [x] `playwright/support/factories/game-factory.ts`, `playwright/support/helpers/d1.ts` -- add optional genre seeding and cleanup so browser coverage can prove visible genre facts and varied cards from real D1 rows.
- [x] `playwright/e2e/epic13-play-next.spec.ts`, `playwright/COVERAGE.md` -- seed real D1 rows and pin every Story 13.1 UI AC with coverage-map evidence.

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

### 2026-08-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 1, medium 11, low 1)
- defer: 1: (high 0, medium 1, low 0)
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` froze the initial visit slate and pinned visit identity so cache changes or a hidden remount cannot replace the originating card behind detail.
  - `[medium]` `[patch]` made genre normalization and final ID ordering locale-invariant; added malformed TTB and past-departure fact guards.
  - `[medium]` `[patch]` kept the destination heading mounted/focused for loading failures and made Play Next route matching exact on Not Found paths.
  - `[medium]` `[patch]` disabled both card actions during status writes, clarified cap-limited result copy, and added 320px navigation containment.
  - `[medium]` `[patch]` canonicalized shared genre fixtures, removed wildcard cleanup, derived departure dates at runtime, and expanded browser exclusion/genre evidence.
  - `[medium]` `[patch]` added exact scoring thresholds, reason precedence, explanation, platinum-date, duplicate-ID, limit, and cap-limited core tests.
  - `[low]` `[patch]` sanitized fractional, negative, NaN, and infinite caller limits and duplicate candidate IDs.

## Design Notes

Core scores stay explainable: each non-missing signal contributes a named integer factor; totals never erase factor provenance. Use stable ID ordering before seeded tie-breaking so server order cannot change a visit. Diversity selects highest ranked candidate, then applies an explicit repeat penalty to shared primary genre/reason for remaining slots. Eligibility and Finish them cap remain hard constraints.

Exact default scoring contract (all qualifying factors add; absent facts add no factor record):

| Factor code | Qualification | Points | Primary reason / explanation |
|---|---|---:|---|
| `finish-them` | `Paused`, or completed without platinum | 40 | `FINISH THEM` / `You already made progress here. Returning now could turn it into a finish.` |
| `up-next` | raw status `Up next` | 32 | `UP NEXT` / `You marked this Up next, so it is ready to move from intention to play.` |
| `last-chance-14` | current PS+ and leaving in 0–14 days | 28 | `LAST CHANCE` / `It leaves PS+ on {date}, so waiting could remove your current access.` |
| `last-chance-30` | current PS+ and leaving in 15–30 days | 18 | same template |
| `forgotten-730` | backlog date age at least 730 days | 16 | `FORGOTTEN` / `It has waited on your Shelf since {date}.` |
| `forgotten-365` | age 365–729 days | 10 | same template |
| `forgotten-180` | age 180–364 days | 5 | same template |
| `quick-win-10` | known story TTB at most 10 hours | 12 | `QUICK WIN` / `Its known story estimate is about {hours} hours.` |
| `quick-win-20` | known story TTB over 10 and at most 20 hours | 6 | same template |
| `critic-confidence` | critic score at least 80 with at least 10 ratings | 8 | `SAFE BET` / `Its critic score is {score} from {count} ratings.` |
| `user-confidence` | user score at least 80 with at least 20 ratings | 8 | `SAFE BET` / `Its user score is {score} from {count} ratings.` |
| `familiar-genre` | genre overlaps a preference anchor | 4 | `FAMILIAR` / `Its {genre} genre matches games already active on your Shelf.` |
| `ps-plus-access` | current PS+ access | 6 | `AVAILABLE NOW` / `It is available through your current PS+ Extra access.` |
| `owned-access` | owned | 4 | factor only; access tag `OWNED`, never a primary reason while another reason exists |

Backlog date is `boughtOn` when known, otherwise `wishlistedOn`; `startedOn` is progress, not backlog age. Age uses whole UTC calendar days against the visit reference date. Preference anchors are eligible or ineligible Shelf rows whose raw status is `Up next`, `Playing`, or `Paused`; compare trimmed, case-insensitive genre names. If both score-confidence factors qualify, `SAFE BET` cites the higher score, breaking an equal score by larger count then critic before user. Past PS+ departure dates add no factor. Access tag is `OWNED` when owned, otherwise `PS+ EXTRA`.

Primary reason uses the first contributing category in this fixed precedence: `FINISH THEM`, `LAST CHANCE`, `UP NEXT`, `QUICK WIN`, `SAFE BET`, `FORGOTTEN`, `FAMILIAR`, `AVAILABLE NOW`; if only `owned-access` or no factor exists, use `WILDCARD` / `A varied eligible pick from your Shelf.` Known supporting facts render independently in this order: genre, story TTB, critic score, user score, PS+ leaving date. No missing fact creates a chip, factor, or clause.

Determinism and diversity are exact: sort candidates by `id`; compute a stable unsigned 32-bit FNV-1a hash of `${visitSeed}:${id}`; rank by total descending, then hash ascending, then `id` ascending. Greedy selection recomputes adjusted score for each remaining candidate: total minus 8 when its primary reason matches any selected card, minus 4 when any normalized genre overlaps any selected card. Finish them candidates become ineligible after one is selected. Before choosing card three, if first two share a primary reason and a known genre, reject a candidate sharing that reason and a genre with both when a cap-compliant alternative differs by reason or has no genre overlap with at least one; otherwise homogeneous output is allowed. “Eligible pool” at slate-count time means the remaining cap-compliant pool: an all-Finish pool yields one honest suggestion rather than violating the cap. Never duplicate or relax hard eligibility.

Visit construction is exact: `PlayNextPage` captures `referenceIso` once with `useState(() => new Date().toISOString().slice(0, 10))` and `visitSeed` once with `useState(() => crypto.randomUUID())`. A new `/play-next` destination mount creates a new visit; routed detail overlays preserve the mounted page and both values. `SURPRISE ME` is a non-interactive mode label (`<span>`), not a regeneration control; Story 13.2 adds Tune and Story 13.3 adds Shuffle.

`Play this` is live in 13.1: call existing `useTrackingMutations(game).selectStatus('Playing')`. On successful mutation callback, navigate to Shelf; existing mutation owns toast, invalidation, and in-flight guard. On failure, remain on Play Next with slate intact and existing error toast. Extend the hook with an optional status-success callback rather than duplicating its mutation. Story 13.4 owns combined-flow regression and accessibility hardening, not first wiring.

Suggestion roots carry `data-play-next-game-id={id}` and `tabIndex={-1}`. Detail close focus searches that selector after the Shelf gridcell and before grid/main fallbacks, then navigates back. The card IDs and visit values must remain unchanged across the overlay round-trip.

Oversize accepted: Story 13.1 is the cohesive cross-layer foundation for all later Epic 13 stories; splitting core selection from its only rendered consumer would create an unreviewable dead contract and duplicate the approved UI gate. Elevated posture is active from planning through `followup_review_recommended: true`; an independent follow-up review is mandatory before epic merge.

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

`Play this` must not become a dead control. Story 13.1 wires status success/failure and Shelf navigation through the existing mutation seam; Story 13.4 remains owner of combined-flow race-guard, responsive, accessibility, and Shelf-regression hardening.

## Verification

**Commands:**
- `bun x vitest run --project unit src/core/play-next.test.ts` -- pure rules and hazards pass.
- `bun x vitest run --project web web/play-next/PlayNextPage.test.tsx web/shell/Header.test.tsx web/shell/AppShell.test.tsx` -- destination behavior passes.
- `bun x playwright test playwright/e2e/epic13-play-next.spec.ts` -- all Story 13.1 visible flows pass.
- `bun run lint && bun run typecheck && bun run test && bun run build` -- repository gate passes.

## Auto Run Result

Status: done

Summary: shipped pure deterministic Play Next eligibility/scoring/diversity, approved `/play-next` Option A destination, transparent three-card slate, live `Play this`, routed detail preservation/focus, responsive layout, and real-D1 browser evidence.

Files changed:
- `src/core/play-next.ts`, `src/core/play-next.test.ts`, `src/core/index.ts` — pure selection contract and boundary coverage.
- `web/play-next/*` — visit owner, transparent cards, loading/error/empty states, actions, responsive approved layout, and web tests.
- `web/shell/*`, `web/shelf/GameRoute.tsx`, `web/shelf/useTrackingMutations.ts` — destination navigation/search, focus handoff, and reused status-success seam.
- `playwright/e2e/epic13-play-next.spec.ts`, `playwright/support/*`, `playwright/COVERAGE.md` — real-D1 genre fixtures, Story 13.1 flows, and AC ledger.
- `_bmad-output/implementation-artifacts/deferred-work.md` — one harness-level isolation risk recorded.

Review findings: 13 patches applied (high 1, medium 11, low 1); 1 medium pre-existing harness issue deferred; 0 rejected. Significant review-driven changes require independent follow-up (`followup_review_recommended: true`).

Verification: core 14/14; targeted web 27/27; Playwright 3/3; full Vitest 2141/2141; lint, typecheck, build, and `git diff --check` pass. One transient workerd startup error passed on clean retry; one unrelated Shelf debounce test passed targeted and on full-suite retry.

Residual risk: fully parallel Playwright files still share one authenticated Shelf/D1 pool; dominant run-unique Story 13.1 fixtures and serial burn-in pass, while per-worker isolation remains deferred.
