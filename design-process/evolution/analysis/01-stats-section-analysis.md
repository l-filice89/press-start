# Stats Section — Product Analysis

**Date:** 2026-08-01
**Selected target:** Lifetime overview + gaming-year activity

## Product snapshot

PRESS START is an installable personal PlayStation-library tracker built with React 19, TypeScript, Vite, Hono, Cloudflare Workers, D1, and Drizzle. Its authenticated shell currently has two destinations: `SHELF` for the tracked library and `CATALOG` for PS+ discovery. The custom dark neon design system is token-based and responsive.

The product records enough lifecycle history for a useful stats surface without schema changes: `wishlisted_on`, `bought_on`, `started_on`, `completed_on`, and `platinum_on`. Existing game data also provides play status, effective state, ownership, genres, IGDB scores, and time-to-beat estimates. All data is user-scoped through authenticated routes.

The founding product brief explicitly banked lifecycle dates for future stats and asks, “What did my gaming year look like?” A stats destination therefore develops an intended capability instead of introducing a disconnected feature.

## Improvement targets

1. **Gaming year** — yearly starts, story completions, Platinums, monthly activity, and genre patterns. High user value; medium effort.
2. **Lifetime overview** — library totals, completion progress, status distribution, ownership, and milestones. Medium-high user value; low-medium effort.
3. **Backlog health** — owned backlog, wishlist, oldest untouched games, and estimated remaining hours. High decision value; medium-high effort.

## Selected improvement

Create one `STATS` destination combining lifetime overview with a selected gaming year. Lifetime figures establish context; the yearly section answers the primary question: **“What did my gaming year look like?”**

This pairing remains one focused scenario because both sections summarize the same user-scoped library dataset and support one reflection task. Backlog recommendations remain deferred.

## Constraints and opportunities

- Preserve the existing three-beat lifecycle vocabulary: want it, own it, beat it.
- Treat story completion and Platinum as distinct milestones.
- Derive statistics from persisted library facts; do not fabricate missing dates or scores.
- Fit the existing authenticated shell and responsive destination navigation.
- Search is destination-scoped today; Stats likely needs a year control instead of library search.
- First version should reuse the existing shelf payload if practical, unless a dedicated aggregate API materially improves correctness or payload cost.
- Accessibility requires semantic headings, text equivalents for visual charts, keyboard access, and information not conveyed by color alone.

## Deferred

- Backlog-health recommendations and “play next” suggestions
- Cross-user comparisons or social features
- New telemetry or inferred playtime
- Deploy/PR work until explicitly requested
