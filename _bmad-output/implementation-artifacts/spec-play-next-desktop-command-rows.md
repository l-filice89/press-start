---
title: 'Play Next desktop command rows'
type: 'feature'
created: '2026-08-03'
status: 'done'
baseline_revision: '621bd41a4afedc8f69b50eb4e4c05786680864e5'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The desktop Play Next portrait-card grid underuses the wide reading surface and pushes the three-pick briefing below the fold. Phone layout is already approved and must not move.

**Approach:** At 1024px and wider, implement the approved `08a-desktop-command-rows.html`: three ranked, full-width landscape rows with cover, verdict/evidence, score factors, and actions arranged horizontally. Below 1024px preserve the shipped card structure, ordering, spacing, controls, and behavior.

## Boundaries & Constraints

**Always:** Treat `08a-desktop-command-rows.html` as binding desktop placement; activate rows at exactly `min-width: 1024px`; show decorative `01`–`03` ranks from current slate order; preserve every card fact, reason, closest-match label, ownership control, access/leaving state, action, pending state, focus path, and 44×44 target; keep phone and 601–1023 layouts unchanged; keep title text untruncated in desktop rows.

**Ask First:** Any change to recommendation content, rank semantics, action behavior, Tune/Shuffle placement, or the approved mobile card presentation.

**Never:** Change scoring, selection, slate order/count, visit state, lifecycle writes, Shelf/Catalog behavior, backend data, or render a desktop row below 1024px.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Desktop briefing | Width ≥1024px; three suggestions | Three vertically stacked full-width rows ordered `01`–`03`; fixed cover rail, readable evidence, factors, right action rail | No horizontal overflow; long content may grow its row |
| Narrow layout | Width <1024px | Existing responsive card grid remains structurally and visually unchanged | No desktop rank/factor heading visible |
| Slate changes | Tune or Shuffle produces a new ordered slate | Visible ranks recompute from current render order | No stale rank stored in suggestion data |
| Card states | PS+, leaving, closest match, owned, pending, or failed action | Desktop redistributes presentation only; existing semantics and mutation/focus behavior survive | Failure preserves visit and restores action focus |

</frozen-after-approval>

## Code Map

- `_bmad-output/design-demos/epic-13-play-next/08a-desktop-command-rows.html` -- approved desktop layout reference.
- `web/play-next/PlayNextPage.tsx` -- current slate order and rank source.
- `web/play-next/SuggestionCard.tsx` -- card hierarchy, facts, factors, controls, mutation/focus behavior.
- `web/play-next/play-next.css` -- shipped card grid plus exact desktop-only row transformation.
- `web/play-next/PlayNextPage.test.tsx` -- semantic rank/wrapper contract and existing behavior regression.
- `playwright/e2e/epic13-play-next.spec.ts` -- real CSS geometry, breakpoint, phone non-regression, and interaction proof.
- `playwright/COVERAGE.md` -- visible acceptance evidence ledger.

## Tasks & Acceptance

**Execution:**
- [x] `web/play-next/PlayNextPage.tsx`, `web/play-next/SuggestionCard.tsx` -- derive render-order ranks and introduce grouping hooks that are layout-neutral below 1024px.
- [x] `web/play-next/play-next.css` -- reproduce approved five-column command rows at ≥1024px and keep all narrower rules unchanged.
- [x] `web/play-next/PlayNextPage.test.tsx` -- pin decorative current-order ranks, factor heading, and unchanged card/action semantics.
- [x] `playwright/e2e/epic13-play-next.spec.ts` -- replace obsolete desktop card-width evidence with command-row geometry at 1440×900, exact 1023/1024 boundary, long-content/no-overflow, and unchanged phone evidence.
- [x] `playwright/COVERAGE.md` -- map every visible desktop-row and narrow-layout criterion.

**Acceptance Criteria:**
- Given a 1440×900 viewport, when three picks render, then all three ranked command rows are visible in order, use the approved horizontal regions, show full titles, and fit without horizontal overflow.
- Given 1023px and 1024px viewports, when the same slate renders, then only 1024px uses command rows; 1023px retains the shipped card grid.
- Given a 320px viewport, when Play Next renders and actions/Tune/Shuffle are exercised, then the shipped two-up layout, spacing, ordering, targets, and overflow behavior remain unchanged; desktop-only rank and factor headings are absent.
- Given Tune or Shuffle changes the slate, when results render, then ranks remain decorative and read `01`–`03` in the new visual order.
- Given existing details, ownership, Playing mutation success/failure, PS+/leaving/closest-match states, when used from a desktop row, then existing behavior and accessibility semantics remain unchanged.

## Spec Change Log

- 2026-08-03: Implemented approved desktop command rows; preserved narrower layouts.

## Review Triage Log

- Patched: unbroken-token containment, single semantic Leaving announcement, full-width row proof, exact-breakpoint stress, 44px targets, and post-Tune ranks.
- Rejected: full-height cover conflicts with approved mock; wrapper DOM is layout-neutral below 1024px; legacy `display: contents` fallback is outside supported Chromium target; existing desktop interaction suites already cover duplicated behavior requests.
- Deferred: none.

## Design Notes

Desktop row columns follow the approved mock: `44px | 120px | main evidence | score factors | 180px actions`. Production ownership diamond and cover flags remain live. At desktop, Leaving moves into the title line while its existing cover placement remains unchanged below 1024px. New grouping wrappers use layout-neutral `display: contents` below the breakpoint.

UI-MOCK-GATE: Luca approved `08a-desktop-command-rows.html` on 2026-08-03 and explicitly froze mobile layout.

## Verification

**Commands:**
- `bun x vitest run web/play-next/PlayNextPage.test.tsx --maxWorkers=1` -- semantic and interaction regressions pass.
- `bun x playwright test playwright/e2e/epic13-play-next.spec.ts --workers=1` -- desktop, breakpoint, and phone flows pass.
- `bun run lint && bun run typecheck && bun x vitest run --maxWorkers=2 && bun run build` -- full quality gate passes.

## Suggested Review Order

**Desktop row transformation**

- Start with exact breakpoint and approved five-column command-row geometry.
  [`play-next.css:510`](../../web/play-next/play-next.css#L510)

- Render current-order decorative ranks without changing suggestion data.
  [`PlayNextPage.tsx:222`](../../web/play-next/PlayNextPage.tsx#L222)

- Group evidence, factors, Leaving state, and actions for responsive redistribution.
  [`SuggestionCard.tsx:12`](../../web/play-next/SuggestionCard.tsx#L12)

**Boundary and regression evidence**

- Prove full-width rows, untruncated titles, regions, and no overflow at desktop.
  [`epic13-play-next.spec.ts:491`](../../playwright/e2e/epic13-play-next.spec.ts#L491)

- Stress exact 1023/1024 switch with pathological content and target sizing.
  [`epic13-play-next.spec.ts:578`](../../playwright/e2e/epic13-play-next.spec.ts#L578)

- Pin semantic ranks and existing card-state behavior in component tests.
  [`PlayNextPage.test.tsx:116`](../../web/play-next/PlayNextPage.test.tsx#L116)

- Map visible acceptance criteria to executable evidence.
  [`COVERAGE.md:544`](../../playwright/COVERAGE.md#L544)
