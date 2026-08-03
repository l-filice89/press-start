---
title: 'Play Next card size parity and Tune cleanup'
type: 'bugfix'
created: '2026-08-03'
status: 'done'
baseline_revision: '14552f43c47c46ba420f09f94b7a62283fada785'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Play Next forces three cards to fill the desktop grid width, making each cover roughly twice the established Shelf/Catalog card size. Tune also offers Safe bet/Wildcard after games are already on Shelf, exposing a purchase-confidence choice at the wrong phase.

**Approach:** Give Play Next the exact Shelf/Catalog responsive grid geometry: auto-filled tracks with a 150px minimum on desktop and the same two-up layout on phone. Remove Confidence from Tune and from the public Tune intent/matching machinery while preserving default score-based ranking and card reasons.

## Boundaries & Constraints

**Always:** Match Shelf/Catalog card track sizing and spacing; retain three suggestions; retain 3:4 covers, readable content, 44×44 actions, and current 320px two-up layout; remove Safe bet/Wildcard from Tune and applied-intent state; preserve default confidence score factors and existing card reasons; add real-browser evidence.

**Ask First:** Any further change to recommendation card content/hierarchy or default scoring.

**Never:** Stretch three cards across the full desktop width; retain hidden/dead Tune-confidence state; change default recommendation scoring, slate count, Shelf/Catalog CSS, lifecycle behavior, or responsive navigation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Desktop | Three suggestions at normal app width | Cards use the same auto-fill track width and gap as Shelf/Catalog; unused columns remain empty | No horizontal overflow |
| Phone | Three suggestions at 320px | Existing two-up compact grid and stacked actions remain usable | Every action remains at least 44×44 |
| Tune | Open Tune on desktop or phone | No Confidence group, Safe bet option, or Wildcard option appears | Remaining groups preserve one-or-none behavior |

</frozen-after-approval>

## Code Map

- `web/play-next/play-next.css` -- fixed three-column desktop grid causing oversized covers; phone override already matches Shelf/Catalog.
- `web/play-next/TunePanel.tsx` -- Confidence group to remove from rendered Tune controls.
- `web/play-next/PlayNextPage.tsx` -- applied-label enumeration must stop reading Confidence.
- `web/shelf/shelf.css` -- canonical responsive grid geometry.
- `web/catalog/catalog.css` -- same canonical geometry, confirming shared product language.
- `src/core/play-next.ts` -- remove Confidence from `PlayNextIntent` and intent-distance matching; retain base critic/user confidence factors and reasons.
- `src/core/play-next.test.ts`, `web/play-next/PlayNextPage.test.tsx` -- remove obsolete Tune-confidence cases and pin remaining semantics.
- `playwright/e2e/epic13-play-next.spec.ts` -- real-layout assertions for Play Next desktop and phone.
- `playwright/COVERAGE.md` -- visible acceptance evidence ledger.

## Tasks & Acceptance

**Execution:**
- [x] `web/play-next/play-next.css` -- replace stretched desktop tracks with Shelf/Catalog auto-fill geometry while preserving phone override.
- [x] `web/play-next/TunePanel.tsx`, `web/play-next/PlayNextPage.tsx` -- remove Confidence control/readback from Tune UI.
- [x] `src/core/play-next.ts` -- remove Confidence intent state, match factor, and distance contribution without changing base score confidence factors.
- [x] `src/core/play-next.test.ts`, `web/play-next/PlayNextPage.test.tsx` -- replace obsolete Confidence intent coverage while retaining explicit default confidence-factor/reason boundaries and asserting UI absence.
- [x] `playwright/e2e/epic13-play-next.spec.ts` -- assert desktop cover/card width parity and unchanged phone geometry/targets.
- [x] `playwright/COVERAGE.md` -- record browser evidence for this correction.

**Acceptance Criteria:**
- Given three Play Next suggestions on desktop, when the grid renders, then each card width matches the Shelf/Catalog grid track convention instead of dividing the whole row into thirds.
- Given a 320px viewport, when Play Next renders, then cards remain two-up, actions remain usable, and no horizontal overflow appears.
- Given Tune on desktop or phone, when it opens, then Confidence, Safe bet, and Wildcard are absent while all remaining intent groups still apply normally.
- Given empty/default intent, when suggestions derive, then qualified critic/user confidence factors and `SAFE BET` card reasons remain unchanged.

## Design Notes

Approved reference requested directly by Luca: “same size as the catalog and shelf.” Placement mock:

```text
Desktop: [card][card][card][empty track…]  — same auto-fill tracks as Shelf/Catalog
Phone:   [card][card]
         [card]                         — existing two-up behavior
```

Safe bet/Wildcard disappears only as a user-selected Tune dimension. Existing default ranking may still award qualified critic/user confidence factors and show `SAFE BET` as a transparent card reason; changing that scorer is outside this correction.

## Verification

**Commands:**
- `bun x playwright test playwright/e2e/epic13-play-next.spec.ts --workers=1` -- desktop parity and phone regression pass.
- `bun run lint && bun run typecheck && bun x vitest run --maxWorkers=2 && bun run build` -- repository quality gate passes.

## Review Triage Log

### 2026-08-03 — Parallel adversarial and edge-case review

- patch: 9
- defer: 0
- reject: 1
- result: Edge review clean. Strengthened browser evidence across all three cards, unused desktop tracks, Catalog and Shelf parity, desktop overflow, third phone-card geometry, and canonical phone gap. Removed a tautological malformed-confidence assertion and corrected task wording. Breakpoint-matrix expansion rejected because approved acceptance targets normal desktop plus 320px, both covered directly.

## Auto Run Result

Status: implementation and review complete.

Verification: focused core/web 45/45; Epic 13 Chromium 11/11; full Vitest 79 files / 2173 tests; lint, typecheck, build, and `git diff --check` passed.

## Suggested Review Order

**Responsive card geometry**

- Entry point: reuse exact Shelf/Catalog tracks and phone spacing.
  [`play-next.css:135`](../../web/play-next/play-next.css#L135)

- Real browser proves three-card, empty-track, Shelf, Catalog, and overflow parity.
  [`epic13-play-next.spec.ts:491`](../../playwright/e2e/epic13-play-next.spec.ts#L491)

- Phone proof preserves two-up geometry, canonical gap, targets, and overflow safety.
  [`epic13-play-next.spec.ts:561`](../../playwright/e2e/epic13-play-next.spec.ts#L561)

**Tune cleanup**

- Removed Confidence from rendered one-or-none groups.
  [`TunePanel.tsx:8`](../../web/play-next/TunePanel.tsx#L8)

- Removed dead Confidence field and intent-distance branch; base scoring remains.
  [`play-next.ts:24`](../../src/core/play-next.ts#L24)

- Applied-intent readback now enumerates only remaining controls.
  [`PlayNextPage.tsx:286`](../../web/play-next/PlayNextPage.tsx#L286)

**Evidence ledger**

- Maps every visible correction criterion to browser or core coverage.
  [`COVERAGE.md:534`](../../playwright/COVERAGE.md#L534)
