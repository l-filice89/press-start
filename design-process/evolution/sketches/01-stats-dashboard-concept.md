# Stats Dashboard — Design Concept

**Scenario:** Gaming Year and Lifetime Stats
**Approach:** Sketch first
**Status:** Superseded by approved Huashu direction A
**Date:** 2026-08-01

> Final visual direction: [Cabinet Scoreboard](../design-demos/stats-dashboard-huashu/direction-a-cabinet-scoreboard.html). Approved 2026-08-01.

## Before snapshot

Authenticated shell has two destinations (`SHELF`, `CATALOG`), a destination-scoped search field, catalog freshness metadata, Settings, and Sign out. Main content is always a cover grid. No aggregate or historical view exists.

## After concept — desktop

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ PRESS START   [ SHELF | CATALOG | STATS ]        PS+ …   ⚙   SIGN OUT       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ YOUR STATS                                         A lifetime, year by year. │
│                                                                              │
│ ALL TIME                                                                     │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│ │     344      │ │     212      │ │      73      │ │      18      │         │
│ │   TRACKED    │ │    OWNED     │ │ STORY COMPLETE│ │   PLATINUM   │         │
│ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘         │
│                                                                              │
│ GAMING YEAR                                               [ 2026        ▾ ] │
│ ┌──────────┬──────────┬──────────┬──────────────┬──────────┐                 │
│ │ WANTED 9 │ BOUGHT 7 │ STARTED 8│ COMPLETED 6  │ PLATINUM 2│                │
│ └──────────┴──────────┴──────────┴──────────────┴──────────┘                 │
│                                                                              │
│ ┌───────────────────────────────────────────────┐ ┌────────────────────────┐ │
│ │ ACTIVITY                                      │ │ COMPLETED GENRES       │ │
│ │                                               │ │                        │ │
│ │  3 ┤        ▣                                │ │ Action          4 ━━━ │ │
│ │  2 ┤  ▮     ▮     □              ▣           │ │ RPG             3 ━━  │ │
│ │  1 ┤  ▮ □   ▮ □   □  ▮     ▣     ▮           │ │ Adventure       3 ━━  │ │
│ │  0 └ JAN FEB MAR APR MAY JUN JUL AUG SEP …    │ │ Horror          2 ━   │ │
│ │     ■ Started  □ Story complete  ▣ Platinum   │ │ Platformer      1 ━   │ │
│ └───────────────────────────────────────────────┘ └────────────────────────┘ │
│                                                                              │
│ ACTIVITY DATA (expandable semantic table)                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## After concept — phone

```text
┌──────────────────────────────┐
│ PRESS START        ⚙  EXIT   │
│ [ SHELF | CATALOG | STATS ]  │
├──────────────────────────────┤
│ YOUR STATS                   │
│ A lifetime, year by year.    │
│                              │
│ ALL TIME                     │
│ ┌───────────┐ ┌───────────┐  │
│ │    344    │ │    212    │  │
│ │  TRACKED  │ │   OWNED   │  │
│ └───────────┘ └───────────┘  │
│ ┌───────────┐ ┌───────────┐  │
│ │     73    │ │     18    │  │
│ │ COMPLETED │ │ PLATINUM  │  │
│ └───────────┘ └───────────┘  │
│                              │
│ GAMING YEAR     [ 2026   ▾ ] │
│ WANTED 9 · BOUGHT 7          │
│ STARTED 8 · COMPLETED 6      │
│ PLATINUM 2                   │
│                              │
│ ACTIVITY                     │
│ JAN  Started 1 · Complete 0  │
│ FEB  Started 0 · Complete 1  │
│ MAR  Started 2 · Platinum 1  │
│ … only active months …       │
│                              │
│ COMPLETED GENRES             │
│ Action         4 ━━━━━━━━━   │
│ RPG            3 ━━━━━━━     │
└──────────────────────────────┘
```

## Visual language

- Existing void background and faint grid remain; dashboard does not introduce a second background system.
- Page heading uses Orbitron. Labels use Rajdhani. Large figures and dates use JetBrains Mono.
- Metric cards use `--color-surface`, hairline borders, and minimal glow. High density stays calm beside cover-heavy destinations.
- Started activity uses electric cyan; story completion uses milestone silver; Platinum adds the existing trophy symbol/pattern. Labels and values provide non-color identification.
- Heat magenta remains reserved for the `Playing` state and does not appear in generic stats.
- No decorative illustrations or external assets.

## Behavior

- Stats link is a real route link and third segment in the existing roving destination control.
- Search slot collapses completely on Stats. No disabled or misleading library search remains.
- Current calendar year is initial selection. Available years are current year plus every year found in the five lifecycle date fields, descending.
- Changing year recomputes local aggregates instantly and does not change URL or refetch.
- Desktop activity chart always shows January–December for comparable rhythm.
- Phone replaces chart with compact rows for active months. If none are active, one explicit no-activity message replaces the list.
- Accessible activity data remains present as a semantic table/disclosure on desktop; phone rows already expose exact text.

## Diff from current shell

- Add `STATS` to destination navigation.
- Add `/stats` route and Stats page.
- Hide the persistent search field only while Stats is active.
- Remove phone search-reservation bottom padding while Stats is active.
- Preserve freshness metadata, Settings, Sign out, banners, FAB, background, toast layer, and not-found behavior.

## Edge cases

- Long counts: metric cards allow wrapping labels but keep numerals unbroken.
- Three nav segments: equal-width segments on phone; compact horizontal padding if needed.
- Empty library: one centered Stats empty state, not sixteen zero components.
- No dated activity for selected year: lifetime cards remain; yearly area states that no dated activity was recorded.
- Completed games without genres: included in completion totals, omitted only from genre ranking.
- Tied genre counts: alphabetical order makes output stable.
- Very large monthly counts: chart scale derives from maximum value; exact values remain available in text/table.
- Reduced motion: no chart animation required.

## Design decisions needing confirmation

1. Keep `YOUR STATS` as page title rather than arcade-flavored copy.
2. Use visual chart on desktop and exact activity rows on phone.
3. Show only active months on phone to avoid twelve mostly empty rows.
4. Keep year selection local, not encoded in URL.
