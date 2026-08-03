---
title: 'Play Next compact command rows'
type: 'feature'
created: '2026-08-03'
status: 'done'
baseline_revision: '9f38fb093d1e865a1dfafcffc6ac7cd4ab2b0225'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Play Next falls back to portrait cards throughout the 695–1023px range even though these screens have enough horizontal space for a faster, briefing-style scan.

**Approach:** Use the approved `09-tablet-command-rows-965-1023.html` placement from 695px through 1023px: compact ranked horizontal rows with an 88px cover, combined evidence/factors column, and 150px action rail. Keep the full `08a` five-column rows at 1024px and wider and preserve the shipped layout below 695px.

## Boundaries & Constraints

**Always:** Activate compact rows at exactly 695px and end them at 1023px; retain all three current suggestions, render-order ranks, production cover flags/ownership control, facts, closest-match state, explanation, factors, Leaving state, and both actions; preserve 44×44 targets and untruncated titles; contain pathological long tokens without page overflow; treat the approved `09` mock as binding placement while production semantics remain authoritative.

**Ask First:** Any change to recommendation content, card behavior, action order, Tune/Shuffle placement, the below-695 presentation, or the full `08a` layout at 1024px and wider.

**Never:** Change scoring, eligibility, slate order/count, visit state, action/focus behavior, lifecycle writes, backend data, Shelf/Catalog presentation, or hide production information merely to fit the compact row.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Existing narrow layout | Width ≤694px | Current portrait-card grid remains unchanged; compact rank/factor heading stays hidden | No compact-row rules leak below breakpoint |
| Compact briefing | Width 695–1023px | Three full-width rows use compact rank, 88px cover, evidence/factors, and 150px action regions | Long content wraps and grows its row without horizontal overflow |
| Full desktop | Width ≥1024px | Existing approved `08a` five-column layout remains unchanged with its dedicated factor rail | Compact rules do not override desktop geometry |
| Card states | PS+, Leaving, owned, closest match, pending, or failed action | Presentation redistributes only; existing semantics, controls, focus, and mutations survive | Failure preserves visit and restores action focus |

</frozen-after-approval>

## Code Map

- `_bmad-output/design-demos/epic-13-play-next/09-tablet-command-rows-965-1023.html` -- approved compact-row placement reference.
- `web/play-next/SuggestionCard.tsx` -- existing rank, evidence, factors, Leaving, ownership, and action hierarchy; no markup change expected.
- `web/play-next/play-next.css` -- compact 695–1023 layout and existing ≥1024 desktop layout.
- `playwright/e2e/epic13-play-next.spec.ts` -- exact breakpoint, compact geometry, long-content, target, and desktop non-regression evidence.
- `playwright/COVERAGE.md` -- acceptance evidence ledger.

## Tasks & Acceptance

**Execution:**
- [x] `web/play-next/play-next.css` -- add bounded 695–1023 compact-row rules; fold factors beneath evidence, keep cover flags/ownership usable, and leave other ranges unchanged.
- [x] `playwright/e2e/epic13-play-next.spec.ts` -- replace obsolete 1023 portrait expectation with exact 694/695/965/1023/1024 geometry, overflow, title, state, and ≥44px target evidence.
- [x] `playwright/COVERAGE.md` -- map compact-range and adjacent-breakpoint criteria to browser evidence.

**Acceptance Criteria:**
- Given a 694px viewport, when Play Next renders, then it retains the pre-change card layout and hides compact-only rank/factor headings.
- Given 695px, 965px, or 1023px, when the same slate renders, then three horizontal rows show 36px rank, 88px cover, combined evidence/factors, and 150px actions without horizontal overflow or truncated titles.
- Given production ownership, PS+, Leaving, facts, closest-match, and long-token states in a compact row, when rendered or activated, then all information and ≥44px controls remain usable without overlap.
- Given a 1024px viewport, when Play Next renders, then the existing 44px/120px/evidence/factor/180px `08a` geometry remains unchanged.
- Given details, ownership, or Playing actions from a compact row, when they succeed or fail, then existing semantics, focus restoration, visit preservation, and mutation behavior remain unchanged.

## Spec Change Log

## Review Triage Log

- Patched: fractional-width breakpoint coverage, production ownership/PS+ placement in the mock, non-null and in-cover geometry assertions, all-row action-rail containment, compact closest-match flow, exact-1024 safeguards, and dedicated coverage traceability.
- Rejected: remote mock image portability, duplicated state-geometry assertions, arbitrary controlled factor-code fixtures, and pre-approval change-log claims.
- Deferred: none.

## Design Notes

The compact range uses four visual rails: `36px | 88px | evidence + factors | 150px actions`. Factors remain separate semantic content but sit as a bordered line below evidence. Full desktop keeps its dedicated factors column. Production ownership and PS+ flags stay on the smaller cover; their placement must avoid overlap.

UI-MOCK-GATE: Luca approved `09-tablet-command-rows-965-1023.html` on 2026-08-03, then requested implementation for the previously agreed horizontal range beginning at 695px.

## Verification

**Commands:**
- `bun x playwright test playwright/e2e/epic13-play-next.spec.ts --workers=1` -- compact boundaries, geometry, actions, and adjacent layouts pass.
- `bun x vitest run web/play-next/PlayNextPage.test.tsx --maxWorkers=1` -- shared semantics and behavior remain green.
- `bun run lint && bun run typecheck && bun x vitest run --maxWorkers=2 && bun run build` -- full quality gate passes.

## Suggested Review Order

**Responsive placement**

- Start with bounded compact geometry and adjacent full-desktop cascade.
  [`play-next.css:510`](../../web/play-next/play-next.css#L510)

- Compare approved compact hierarchy, production ownership, and PS+ placement.
  [`09-tablet-command-rows-965-1023.html:8`](../design-demos/epic-13-play-next/09-tablet-command-rows-965-1023.html#L8)

**Boundary and behavior proof**

- Verify exact breakpoints, every-row containment, overlays, targets, and full-desktop restoration.
  [`epic13-play-next.spec.ts:580`](../../playwright/e2e/epic13-play-next.spec.ts#L580)

- Trace compact acceptance criteria to browser flows.
  [`COVERAGE.md:554`](../../playwright/COVERAGE.md#L554)
