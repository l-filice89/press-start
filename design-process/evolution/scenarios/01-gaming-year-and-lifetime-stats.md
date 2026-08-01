# Gaming Year and Lifetime Stats

**Status:** Approved
**Date:** 2026-08-01
**Approved:** 2026-08-01 by product owner

## Target

Add one authenticated `STATS` destination that answers two connected questions:

1. What does my tracked gaming life look like overall?
2. What did I start and accomplish in a selected calendar year?

Primary job: let the user reflect on a gaming year without manually filtering or counting library entries.

## Current State

The app exposes `SHELF` and `CATALOG`. Individual cards and details show lifecycle state and dates, but no surface aggregates them. Answering “What did my gaming year look like?” requires manually searching, filtering, and counting games. Lifetime context is unavailable.

The data already exists in the authenticated shelf payload: tracking state, ownership, genres, and five optional lifecycle dates. Missing dates are honest unknowns and must not be inferred.

## Desired State

Header navigation adds a real `STATS` link beside `SHELF` and `CATALOG`. Opening it shows a responsive, read-only dashboard:

- A lifetime overview with exact totals for tracked games, owned games, story completions, and Platinums.
- A calendar-year selector, defaulting to the current year and offering all years present in lifecycle data.
- Selected-year totals for wishlisted, bought, started, story-completed, and Platinum milestones.
- A January–December activity chart showing starts, story completions, and Platinums by month.
- Top genres among games story-completed in the selected year, with ties handled deterministically.

Stats reuses the cached full-library query and derives aggregates locally. No new persisted data, analytics telemetry, or third-party calls. Search is absent on the Stats destination because it has no meaningful page-scoped search job.

## User Journey

1. User signs in and sees existing authenticated shell.
2. User follows the `STATS` navigation link.
3. URL becomes `/stats`; navigation visibly and semantically marks Stats current.
4. Dashboard loads the user-scoped full library through existing query/cache behavior.
5. User first sees lifetime totals, then current-year activity.
6. User changes year through a labelled native select.
7. Year totals, monthly chart, and genre ranking update immediately without another network request.
8. User can switch back to Shelf or Catalog through normal navigation.

### Empty and failure paths

- Empty library: explain that stats appear after games are added; no fabricated zero-history narrative.
- Year with no dated activity: retain selected year and show zero totals plus a clear “No dated activity” message.
- Library request failure: show a retryable error consistent with existing query behavior.
- Missing date on a game: omit that game from that date-based measure only; still count it in applicable lifetime state totals.

## Success Criteria

1. `/stats` is reachable through a real header link and survives direct load/reload.
2. Navigation exposes exactly three destinations and marks Stats with `aria-current="page"` while active.
3. Search/Add controls do not appear on `/stats`.
4. Lifetime totals equal facts in the full, non-discarded user library:
   - tracked = all returned games;
   - owned = `owned === true`;
   - story completed = `completedOn !== null`;
   - Platinum = `platinumOn !== null`.
5. Each selected-year total includes only dates whose `YYYY` equals selected year. A game may contribute to multiple lifecycle totals.
6. Monthly series uses the date’s stored calendar month without timezone conversion.
7. Genre ranking uses genres from games completed in selected year, counts every attached genre once per game, sorts count descending then name ascending, and shows up to five.
8. Visual activity chart has a programmatic text/table equivalent; meaning never depends on color alone.
9. Loading, request failure, empty library, and no-year-activity states are explicit.
10. Layout works at existing phone breakpoint without horizontal page overflow; controls meet existing 44px hit-target floor.
11. Existing Shelf, Catalog, detail overlay, keyboard navigation, and route-not-found behavior remain intact.
12. Unit/component tests cover aggregation boundaries and route/UI states; focused end-to-end coverage proves navigation and year switching.

## Scope

### Pages affected

- New authenticated `/stats` destination
- Shared authenticated header navigation

### Components touched or added

- `AppShell` route composition
- Header destination toggle and Stats-specific search-slot behavior
- New Stats page
- Lifetime metric cards
- Year selector
- Monthly activity visualization with accessible equivalent
- Completed-genre ranking
- Stats loading, empty, no-activity, and error states

### Data changes

- No schema or migration changes
- No write paths
- No new external API calls
- Reuse existing `/api/shelf?include=hidden` payload and React Query cache
- Add pure client-side aggregation helpers

### Risk

**Medium.** Aggregation is read-only and uses existing data, but adding a third destination changes shared navigation, responsive header layout, active-destination logic, search visibility, and routing tests.

## Deferred

- Backlog-health analysis, remaining-hours estimates, oldest backlog, or recommendations
- Comparison against other users or public sharing
- User ratings, playtime, trophy percentage, streaks, or inferred facts not present in current model
- Server-side materialized aggregates unless real performance evidence later requires them
