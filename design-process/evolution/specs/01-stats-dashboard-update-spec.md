# Stats Dashboard — Update Specification

**Status:** Approved for implementation
**Scenario:** [Gaming Year and Lifetime Stats](../scenarios/01-gaming-year-and-lifetime-stats.md)
**Approved visual direction:** [A — Cabinet Scoreboard](../design-demos/stats-dashboard-huashu/direction-a-cabinet-scoreboard.html)
**Date:** 2026-08-01
**Approved:** 2026-08-01 by product owner (“Go ahead”)

## Change Summary

Add `/stats` as third authenticated destination. Page reuses full non-discarded library payload and locally derives lifetime and selected-year facts. Approved Cabinet Scoreboard design presents four tactile all-time score windows, compact annual lifecycle readouts, a monthly activity chart, and completed-genre ranking. Cyan remains shell/infrastructure color; magenta is deliberately extended to active-play history (`Started`) and selected-year energy. No database, API, or external dependency changes.

## Before

Authenticated shell exposes `SHELF` and `CATALOG`. Header search always mounts and assumes every non-Catalog destination is Shelf. Lifecycle dates are visible per game but never aggregated. No `/stats` route exists.

## After

### Information architecture

- Destination navigation becomes `SHELF | CATALOG | STATS`.
- `/stats` is a real route and supports cold load/reload.
- Stats is current when visible, including shell semantics through `aria-current="page"`.
- Search slot is removed—not disabled—while Stats is active.
- Existing PS+ freshness, Settings, Sign out, banners, FAB, toast layer, background, and not-found behavior remain.

### Page structure

1. Page header:
   - Eyebrow: `PLAYER RECORD / ALL TIME`
   - H1: `CABINET SCORE`
   - Year control on right: label `CURRENT ROUND`, native select
2. All-time scoreboard:
   - `TRACKED`
   - `OWNED`
   - `STORY COMPLETE`
   - `PLATINUM`
3. Annual activity panel:
   - Five compact lifecycle totals: Wishlisted, Bought, Started, Complete, Platinum
   - Legend: Started, Complete, Platinum
   - January–December activity chart on desktop
   - Exact active-month rows on phone
   - Expandable semantic data table on desktop
4. Completed-genres panel:
   - Up to five genres from games story-completed in selected year
   - Exact counts and proportional bars

### Visual system

- Use existing tokens and self-hosted fonts only.
- Background: existing void/grid/ambient wash; no page-specific image.
- All-time score windows: `--color-surface`, hairline/cyan borders, `--radius-md`, inset tone plus low raised edge. They must feel like score windows, not generic metric cards.
- Selected-year panel: restrained `--color-heat-magenta` border/bloom.
- Started value/bars: heat magenta; story-complete bars: milestone silver; Platinum: silver hatch/border plus text label.
- Genre bars: approved cyan-to-magenta interpolation. Counts remain readable without bars.
- H1 and section titles: Orbitron. UI labels: Rajdhani. Counts/dates: JetBrains Mono with tabular numerals. Body/error text: Inter.
- No animation required. Reduced motion loses nothing.

## Data Contract and Calculations

### Source

Reuse existing React Query request:

```ts
useQuery({
  queryKey: ['shelf'],
  queryFn: ({ signal }) => fetchShelf(signal),
})
```

This fetches `/api/shelf?include=hidden`, containing all non-discarded user-library games, including completed, Platinum, and Dropped states. Same query key permits cache reuse with Shelf. No new endpoint.

### Date handling

- Read stored ISO strings as strings.
- Extract year/month from `YYYY-MM-DD`; never construct `Date` for bucketing.
- Missing/malformed date contributes to no date-based measure.
- Current calendar year is always available and initially selected.
- Add every valid year found in `wishlistedOn`, `boughtOn`, `startedOn`, `completedOn`, and `platinumOn`.
- Sort selectable years descending.

### Lifetime totals

- Tracked: `games.length`
- Owned: `game.owned === true`
- Story complete: `game.completedOn !== null`
- Platinum: `game.platinumOn !== null`

### Selected-year totals

Each game independently contributes once to every matching lifecycle date:

- Wishlisted: `wishlistedOn`
- Bought: `boughtOn`
- Started: `startedOn`
- Complete: `completedOn`
- Platinum: `platinumOn`

### Monthly activity

- Twelve stable entries, January through December.
- Bucket only `startedOn`, `completedOn`, and `platinumOn` for selected year.
- Chart maximum is highest displayed count, with minimum scale of 1.
- Bar height uses normalized ratio; large counts cannot overflow chart.
- Exact numbers remain in semantic table/phone rows.

### Completed genres

- Candidate games: `completedOn` belongs to selected year.
- Deduplicate genres within each game before counting.
- A genre attached to different completed games increments once per game.
- Sort count descending, then `localeCompare` by name with base sensitivity.
- Display first five.
- Completed game without genres remains in completion total and contributes no genre.

### Empty definitions

- Empty library: no dashboard; Stats-specific `INSERT GAMES` message explains that stats appear after library activity exists.
- No dated activity: all five selected-year lifecycle totals equal zero. Keep lifetime scoreboard and year control; replace annual panels with `NO DATED ACTIVITY` explanation.
- Wishlist/purchase-only year: not globally empty. Show annual totals; chart states `No starts or milestones recorded` and genre panel states `No completed genres recorded`.

## Components

### `StatsPage`

- Owns query state and selected year.
- Renders loading, retryable error, empty library, or dashboard.
- Reuses `['shelf']` query and `fetchShelf`.

### Pure aggregation module

Suggested file: `web/stats/aggregate.ts`.

Exports typed, deterministic helpers for available years and summary generation. No React, browser APIs, mutation, or network access.

### `AllTimeScoreboard`

- Semantic section with four articles.
- Counts use localized numeric display only at render; internal values remain numbers.

### `GamingYearPanel`

- Labelled native select with 44px minimum target.
- Five score readouts.
- Controls monthly visualization and genre ranking.

### `MonthlyActivity`

- Desktop chart is `aria-hidden` because semantic table carries exact information.
- Legend uses shape/pattern and labels, not color alone.
- Phone renders exact non-zero month rows instead of squeezed twelve-column chart.

### `CompletedGenres`

- Ordered ranking with name and count.
- Bar is decorative and hidden from accessibility tree.

### Shared shell changes

- Add Stats entry to `DESTINATIONS`.
- Determine active index by matching Stats, Catalog, otherwise Shelf.
- Update Header search contract so `null` suppresses whole slot; `undefined` retains existing disabled fallback behavior for tests/placeholders.
- AppShell passes `null` on Stats and `<SearchBox />` elsewhere.
- Add `/stats` route.
- On phone, Stats removes bottom padding reserved for pinned search.

## Responsive Behavior

### Desktop (`>600px`)

- Max content width follows existing app shell.
- Four equal all-time score windows in one row.
- Annual activity and genres use approximately 3:1 content split.
- Twelve-month chart visible.

### Phone (`≤600px`)

- Destination toggle remains one full-width row with three equal segments.
- Header search absent; no empty pinned-search gap.
- Page header stacks; year control becomes full-width or justified row.
- All-time scoreboard becomes 2×2.
- Five year totals become 2×2 plus final full-width Platinum row.
- Chart becomes exact active-month rows.
- Genre panel stacks below activity.
- No page-level horizontal overflow.

## Loading and Failure

- Loading: scoreboard-shaped skeletons with `role="status"`, `aria-busy="true"`, and label `Loading your stats`.
- Error: `role="alert"`, concise failure message, `Retry` button calling query `refetch()`.
- Query errors never render stale fabricated zeros unless React Query already provides valid cached data.

## Acceptance Criteria

1. `/stats` route works by navigation and direct load.
2. Header has three real destination links; keyboard arrow traversal includes Stats.
3. Stats receives `aria-current="page"` while active.
4. Search/Add UI and phone search reservation are absent on Stats only.
5. Lifetime totals exactly follow defined library facts.
6. Current year is initial selection; year options contain current plus every valid lifecycle year, descending.
7. Year and month bucketing uses stored string components without timezone conversion.
8. A game may count in multiple lifecycle totals; missing date affects only its own measure.
9. Monthly scale normalizes safely and exact values remain programmatically available.
10. Completed genres count once per game, sort deterministically, and cap at five.
11. Empty library, no dated activity, wishlist/purchase-only year, loading, and request failure have explicit honest states.
12. Meaning never depends on cyan/magenta/silver alone.
13. Phone layout has no page overflow and interactive targets meet 44px floor.
14. Shelf, Catalog, detail overlay, Settings, FAB, banners, and not-found routes remain functional.
15. No database migration, new endpoint, external request, chart package, or analytics telemetry is added.

## Test Plan

### Unit

- Aggregation totals and independent lifecycle counting
- Current-year inclusion and descending year options
- ISO string month boundaries
- Missing/malformed dates
- High monthly counts and normalization
- Per-game genre deduplication, tie sort, top-five cap
- Empty and wishlist/purchase-only years

### Component

- Loading/error/retry/empty/dashboard states
- Year change updates totals without another fetch
- Desktop semantic activity table
- Phone exact month rows
- Genre empty state

### Shell and routing

- Three-link roving destination navigation
- Stats active-state calculation
- Search absent on Stats, present on Shelf/Catalog
- `/stats` route and not-found regression

### End-to-end

- Authenticated user follows Stats link
- Selected year changes visible annual values
- Direct `/stats` load succeeds
- Phone viewport has no horizontal page overflow

## Deferred

- Backlog health and Play Next
- Server-side aggregates/materialized views
- Shareable recap cards
- URL-persisted year selection
- Ratings, playtime, trophy percentage, streaks, or inferred facts
