---
title: 'Filter summary names the active TTB metric'
type: 'feature'
created: '2026-07-17'
status: 'done'
route: 'one-shot'
---

# Filter summary names the active TTB metric

## Intent

**Problem:** The live filter summary read "Showing ≤25h … games." identically whether the Time bands evaluated story or 100% hours — the sentence couldn't be decoded without opening the Time menu (Story 12.1 review deferral, resolved at the epic-12 retro).

**Approach:** The Time group's summary tokens gain a metric label after the band terms — "story completion" / "100% completion" (wording Luca's, 2026-07-17) — via an exhaustive `Record<TtbMetric, string>` lookup in `summarizeFilter`. Live-region announcements inherit it through `summarizeFilterText`.

## Suggested Review Order

1. [web/shelf/filters.ts](../../web/shelf/filters.ts) — `TTB_METRIC_LABEL` + the one-line group change in `summarizeFilter`.
2. [web/shelf/filters.test.ts](../../web/shelf/filters.test.ts) — updated narration asserts + new 100%-metric and comma-placement cases.
3. [playwright/e2e/epic12-ttb.spec.ts](../../playwright/e2e/epic12-ttb.spec.ts) — story-metric wording assert updated; metric-toggle test now asserts the 100% sentence end-to-end.
4. [_bmad-output/implementation-artifacts/deferred-work.md](deferred-work.md) — ledger entry resolved.

## Review Findings (Blind Hunter, one-shot)

- 4 patched: exhaustive metric→label `Record` (was a ternary), e2e assert of the 100% sentence after the toggle, unit assert pinning comma placement under the complete metric, ledger resolution date corrected to 2026-07-17.
- 3 rejected: copy-ambiguity concern (exact wording is Luca's, approved in-session), metric-token styling marker (summary has never styled non-connector tokens), comment cross-ref pedantry.

**Verification:** typecheck clean, Biome clean, Vitest web/shelf 261 green, Playwright epic12-ttb + epic3-summary 8/8 green.
