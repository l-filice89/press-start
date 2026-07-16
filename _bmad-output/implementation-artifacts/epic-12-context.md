# Epic 12 Context: Fit the Time I Have — the Time-to-beat Filter

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let the shelf answer "what can I actually finish?" — add a time-to-beat filter group that narrows the backlog to games fitting the hours available, riding the TTB data already persisted per game (`ttbStorySeconds`, `ttbCompleteSeconds`, `ttbCount`, on the shelf payload since v2.1.0). One story, pure client-side filter-system revision: no schema change, no API change, no cron. Born from a correct-course change (2026-07-16); closes the corresponding deferred-work ledger entry when shipped.

## Stories

- Story 12.1: Filter the shelf by time-to-beat bands (VR-9)

## Requirements & Constraints

- **Bands:** five band pills — ≤25h, 25–50h, 50–75h, 75–100h, >100h — plus an explicit `Unknown` pill. Half-open boundaries (e.g. 25 < h ≤ 50) so a game landing exactly on a boundary (50h) matches exactly one band: no overlap, no gap.
- **Filter semantics:** the Time group obeys the existing filter contract — OR among its own pills, AND against every other group (State, Reveals, Genre, Flags).
- **Metric toggle:** a story/100% toggle inside the group; default is story hours. Switching re-evaluates every selected band against the chosen metric. The toggle is part of the filter state, not a global setting.
- **Honest absence:** a game missing the selected metric (IGDB gap, unenriched, or carrying only the other value) matches only the `Unknown` band — never a numeric band, never a zero standing in for a value. This extends the existing absence contract (missing TTB values render as absent, never zero or estimate) into filtering.
- **Summary + sheet:** active Time selections must be narrated by the live filter summary sentence with the same literal "or"/"and" words, and the mobile filter sheet must carry the group with its count badge.
- **Standing rules:** the story spec needs a placement-level UI mock signed off by Luca before implementation (UI-MOCK-GATE) and Playwright e2e coverage for every UI AC (PLAYWRIGHT-COVERAGE). EXTERNAL-RISK-FLAG is N/A — no external call anywhere in this epic.
- **Success bar:** bands filter correctly on both metrics, `Unknown` stays honest, summary + sheet + e2e green.

## Technical Decisions

- **Server computes facts, client filters:** the TTB numbers are already computed and persisted server-side and shipped on the shelf payload; this epic adds only a client-side predicate over those fields. No new data, no new fetch — a fetch in a render/query path would be an architecture violation.
- **Stored values are seconds; bands are hours** — the predicate converts, it does not re-fetch or re-derive.
- **Where the work lives:** new filter group in the shelf filter logic (`web/shelf/filters.ts`) plus the filter row / filter sheet components, summary-sentence integration, and e2e. All under `web/`.
- **Effective-state and filter-pill behavior are computed in one place** — the new group must plug into the existing single filter predicate, not add a parallel filtering path.
- **Filter state:** the metric toggle and band selections live in filter state alongside the existing groups (URL-as-state navigation convention applies to the app generally; follow whatever the existing filter groups do).

## UX & Interaction Patterns

- **No color-alone signaling:** the summary sentence's OR/AND coloring is redundant to the literal words; any state the group conveys must survive without color.
- **Responsive deltas:** desktop shows the full filter row inline with the summary sentence; phone collapses to a single Filters button + count badge opening a grouped bottom sheet with "Show N games". The Time group joins both surfaces.
- **Known design risk:** filter-row crowding on desktop — resolved at the UI-MOCK-GATE, not in code first.
- **Active pills** show a visually highlighted toggle-on state, matching existing groups.
- When the mock is signed off, `EXPERIENCE.md`'s filter-row line gains the new group (design decisions live with the story).

## Cross-Story Dependencies

- **Consumes Epic 10 / Story 10.3 output:** the persisted TTB fields and their absence contract. Epic 10 is shipped and does not reopen — this epic only reads what it left behind.
- **Extends Epic 3's filter system** (also closed): amends FR-20 semantics with a new group rather than reopening that epic.
- No dependencies within the epic (single story); no impact on Epic 8.
