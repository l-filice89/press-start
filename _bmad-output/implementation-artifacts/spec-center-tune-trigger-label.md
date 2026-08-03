---
title: 'Center the active Tune trigger label'
type: 'bugfix'
created: '2026-08-03'
status: 'done'
route: 'one-shot'
---

# Center the active Tune trigger label

## Intent

**Problem:** The inline active-count badge shifted `TUNE THE PICKS` away from the button’s geometric center on phone layouts.

**Approach:** Remove the badge from label flow, keep the label centered within the trigger, and pin active/inactive geometry, visible and accessible count, non-overlap, and overflow safety at 320px.

## Suggested Review Order

**Layout fix**

- Center button contents while anchoring count independently at the corner.
  [`play-next.css:60`](../../web/play-next/play-next.css#L60)

- Give browser tests a stable label geometry target without changing accessible naming.
  [`PlayNextPage.tsx:173`](../../web/play-next/PlayNextPage.tsx#L173)

**Regression evidence**

- Compare active/inactive centers, stable button bounds, badge visibility, and phone overflow.
  [`epic13-play-next.spec.ts:844`](../../playwright/e2e/epic13-play-next.spec.ts#L844)

- Map centered active-count behavior to real-browser coverage.
  [`COVERAGE.md:542`](../../playwright/COVERAGE.md#L542)
