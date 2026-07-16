---
title: 'Filter the shelf by time-to-beat bands (VR-9)'
type: 'feature'
created: '2026-07-16'
status: 'done'
baseline_revision: '87980360ddbefaa7eae4e2f7326ec8fa96834265'
final_revision: '39b317437fc179dcd1dade779f528a4222c24683'
review_loop_iteration: 0
followup_review_recommended: true # P1 reworked shared FilterDropdown roving-focus machinery (State/Genre regression surface) mid-review
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The shelf can't answer "what can I actually finish?" — Story 10.3's TTB data (`ttbStorySeconds`/`ttbCompleteSeconds`, on the shelf payload since v2.1.0) is a label, not a lens; the filter system (Epic 3) has no time dimension.

**Approach:** Add a "Time" filter group to the existing client-side filter system: five hour bands (≤25, 25–50, 50–75, 75–100, >100) plus an explicit `Unknown` pill, with a story/100% metric toggle (default story) inside the group. Pure client predicate over already-shipped payload fields — no schema, no API, no cron.

## Boundaries & Constraints

**Always:**
- Bands are half-open (`25 < h ≤ 50` shape): a game landing exactly on a boundary matches exactly ONE band — no overlap, no gap. Hours = selected-metric seconds / 3600.
- OR within the Time group, AND against every other group (FR-20 semantics) — implemented as one more clause in the SINGLE existing predicate `applyShelfFilter`, never a parallel filtering path.
- Absence contract (NFR-4, extends 10.3): selected-metric field `null` ⇒ matches ONLY the `Unknown` band — never a numeric band, never zero-as-value. `0` seconds is a real value (matches ≤25h). PRESERVE-VS-CLEAR: read-only path, no writes — absence handling is exactly this ruling.
- The metric toggle lives in filter state (`ShelfFilter`), not a global setting; switching re-evaluates every selected band.
- Metric toggle survives without color; band pills show `aria-pressed`/checked state like existing groups.
- UI mock signed off by Luca 2026-07-16 (recorded below in Design Notes) — desktop placement is a THIRD DROPDOWN after State and Genre; follow it at placement level.
- EXTERNAL-RISK-FLAG: N/A — anonymous client-side filtering, no external call, no account identity.

**Block If:**
- The shelf payload turns out not to carry `ttbStorySeconds`/`ttbCompleteSeconds` as `number | null` (contract drift from 10.3).
- The e2e game factory cannot be made to seed TTB columns without schema changes.

**Never:**
- No new fetch in any render/query path (AD-7: server computes facts, client filters).
- No re-deriving or estimating hours (no `ttbCount`-based heuristics); no persisting the toggle anywhere.
- No zero-count hiding of band pills — bands are static, always shown.
- Don't touch server code, schema, or cron.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Band match | `≤25h` selected, story metric, game `ttbStorySeconds = 90000` (25h) | Game shown (≤25h is `h ≤ 25`) | No error expected |
| Boundary exactness | Game at exactly 50h (180000s), bands `25–50h` and `50–75h` both selected | Matches `25–50h` only; counted once | No error expected |
| OR within group | `≤25h` + `>100h` selected | Games matching either band shown | No error expected |
| AND across groups | `≤25h` + genre `RPG` | Only games matching both | No error expected |
| Metric toggle | `25–50h` selected, toggle story→100% | Same band re-evaluated against `ttbCompleteSeconds`; result set updates | No error expected |
| Absence honest | Story metric, game has `ttbStorySeconds = null`, `ttbCompleteSeconds = 200000` | Matches only `Unknown`; never a numeric band | No error expected |
| Unknown band | `Unknown` selected, story metric | Only games with `ttbStorySeconds == null` shown | No error expected |
| Zero seconds | `ttbStorySeconds = 0`, `≤25h` selected | Matches ≤25h (0 is a value, not absence) | No error expected |
| No Time selection | `ttb.bands` empty | Time group imposes no constraint regardless of toggle position | No error expected |

</intent-contract>

## Code Map

- `web/shelf/filters.ts` -- filter state (`ShelfFilter`, `EMPTY_FILTER` :52-64), single predicate `applyShelfFilter` (:80-110), `isFilterActive` (:66), `summarizeFilter`/`joinWithOr` (:148-192), `toggleSelection` (:199)
- `web/shelf/FilterRow.tsx` -- `FilterRow` desktop row (:131-208), `FilterDropdown` ARIA menu pattern to mirror (:418-592), `FilterSheet` mobile groups (:246-415), `FilterSummary` (:219-238), count badges (:543-547, sheet trigger :81-111)
- `web/shelf/filter-row.css` -- pill/dropdown/sheet styles
- `web/shelf/Shelf.tsx` -- `useState<ShelfFilter>` (:62), summary live region (:140), `resetKey` already serializes filter (:249)
- `web/shelf/api.ts` -- `shelfGameSchema` TTB fields `number | null` (:80-82)
- `web/shelf/filters.test.ts` -- co-located Vitest; `game()` factory already has TTB fields
- `web/shelf/FilterRow.test.tsx` -- component tests
- `playwright/e2e/epic3-filter.spec.ts` -- seeding/assertion conventions to copy
- `playwright/support/factories/game-factory.ts` -- `createGame`; must accept/write TTB columns
- `playwright/COVERAGE.md` -- add `## Epic 12` section
- `EXPERIENCE.md` -- filter-row line gains the Time group (mock signed off)

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/filters.ts` -- add `TTB_BANDS` const (key, label, `(hours) => boolean` half-open predicates), `TtbMetric = 'story' | 'complete'`, extend `ShelfFilter` with `ttb: { metric: TtbMetric; bands: TtbBandKey[] }` (EMPTY_FILTER default `{ metric: 'story', bands: [] }`); add Time clause to `applyShelfFilter` (null metric ⇒ only `unknown` band matches); include bands in `isFilterActive`; add Time group to `summarizeFilter` via `joinWithOr` -- core predicate + narration
- [x] `web/shelf/filters.test.ts` -- unit-test every I/O matrix row (HAZARD-TESTS: boundary exactness at 50h, null-metric-never-numeric, 0-seconds-is-a-value, cross-metric absence) + summary narration with Time group -- named hazards need red/green tests
- [x] `web/shelf/FilterRow.tsx` -- desktop: third `FilterDropdown` "Time" after Genre with metric toggle pinned at menu top (two-option segmented control, `aria-pressed`) and six checkbox rows, count badge = selected bands; sheet: "Time to beat — any of (or)" group between Genre and Flags with metric toggle above six option rows via `toggleRow`; include band count in sheet trigger `activeCount`; test-ids `filter-ttb`, `filter-ttb-menu`, `filter-ttb-<band>`, `filter-ttb-metric` -- signed-off mock placement
- [x] `web/shelf/filter-row.css` -- styles for metric toggle inside dropdown menu + sheet group; reuse existing pill/menu classes wherever possible -- minimal new CSS
- [x] `web/shelf/FilterRow.test.tsx` -- component tests: dropdown renders 6 bands + toggle, toggle flips metric in state, count badge, sheet group present -- UI state coverage
- [x] `playwright/support/factories/game-factory.ts` -- let `createGame` accept `ttbStorySeconds`/`ttbCompleteSeconds` (and write the columns) if it doesn't already -- e2e seeding
- [x] `playwright/e2e/epic12-ttb.spec.ts` -- e2e per conventions (run-unique seeds, cleanup in `finally`, assert on seeded titles): band filters shelf; boundary game (exactly 50h) appears under 25–50h not 50–75h; metric toggle re-evaluates; missing-metric game only under Unknown; summary sentence narrates with or/and; mobile sheet carries group + count badge -- PLAYWRIGHT-COVERAGE
- [x] `playwright/COVERAGE.md` -- `## Epic 12` section, one row per Story 12.1 AC -- coverage ledger
- [x] `EXPERIENCE.md` -- filter-row line gains the Time group -- design decision recorded with story
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the homed TTB-filter ledger entry closed (ships with 12.1) -- ledger hygiene

**Acceptance Criteria:**
- Given the filter row, when it renders, then a Time group offers ≤25h, 25–50h, 50–75h, 75–100h, >100h and `Unknown` — OR within the group, AND across groups [VR-9, FR-20]
- Given the story/100% toggle, when it switches, then every selected band re-evaluates against the chosen metric (default story); the toggle is filter state, not a global setting [VR-9]
- Given active Time selections, when the shelf renders, then the live summary sentence narrates them with literal or/and words and the mobile filter sheet carries the group with its count badge [FR-20, UX-DR23, UX-DR26]
- Given any Time-group state, when conveyed, then it survives without color (words/pressed-state, not color alone) [UX-DR23]

## Design Notes

- **UI-MOCK-GATE sign-off (Luca, 2026-07-16, recorded in-session):** desktop = third dropdown `[State ▾] [Genre ▾] [Time ▾]` with metric toggle at menu top + six checkbox rows; mobile = "Time to beat — any of (or)" sheet group, toggle above six options, between Genre and Flags. Chosen over inline pills to avoid the named desktop crowding risk.
- Metric toggle is NOT a band pill: with no bands selected the toggle imposes no filter — `isFilterActive` and counts key off `bands.length`, never the metric.
- `ttb` object in `ShelfFilter` automatically feeds `Shelf.tsx` `resetKey` (`JSON.stringify(filter)`) — progressive-list snap-to-top needs no extra wiring.
- SAMPLE-OF-ONE: N/A — band boundaries are product decisions (Luca 2026-07-16), not observed constants; TTB field shapes come from the 10.3 contract, not a single sample.

## Verification

**Commands:**
- `bun run typecheck` -- expected: clean
- `bun run lint` -- expected: clean (Biome)
- `bun test web/shelf` (or `bunx vitest run web/shelf`) -- expected: all green incl. new hazard tests
- `bunx playwright test e2e/epic12-ttb.spec.ts` (from `playwright/`, per playwright/README.md) -- expected: all green

## Spec Change Log

## Review Triage Log

### 2026-07-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 1: (high 0, medium 0, low 1)
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` Desktop Time-menu metric toggle was mouse-only and ARIA-invalid (plain buttons inside `role="menu"`, outside the roving focus) — reworked as `menuitemradio` items with `aria-checked` in the same roving focus list as band rows; Enter/Space selects without closing; sheet buttons gained `aria-label="Story hours"/"100% hours"`; new jsdom roving-list test + e2e updated.
  - `[medium]` `[patch]` `matchesTtb` absence guard was `=== null` only — `undefined`/`NaN` made a game vanish from all six bands and negatives matched ≤25h; guard now routes non-finite or negative to `Unknown` (0 still a value); hazard tests added.
  - `[low]` `[patch]` Band-label lookup duplicated in FilterRow and summarizeFilter — single exported `ttbBandLabel` helper.
  - `[low]` `[patch]` e2e flake/honesty: `loadAllPages` now precedes every initial-visibility precondition; AND-across test re-asserts the visible card set (owned vs un-owned seeds), COVERAGE.md rows corrected to match real evidence.
  - `[low]` `[patch]` Clear-filters silently resetting metric to story was unpinned — unit test + DECISION comment pin toggle-is-filter-state.
- deferred: summary sentence does not name the active metric ("≤25h" reads identically under story or 100%) — product copy decision, logged in deferred-work.md.
- rejected: ledger-closed-before-merge timing (spec-mandated wording), sheet rows addressed by label (existing sheet convention), jsdom controlled-state test readability (correct as written), sprint-status.yaml update (handled at finalize).

## Auto Run Result

**Summary:** Story 12.1 shipped — Time-to-beat filter group on the shelf: five half-open hour bands (≤25, 25–50, 50–75, 75–100, >100) + explicit `Unknown`, story/100% metric toggle in filter state (default story), OR-within/AND-across via one new clause in the single `applyShelfFilter` predicate, summary-sentence narration, desktop dropdown (mock signed off by Luca 2026-07-16) + mobile sheet group, full hazard/unit/component/e2e coverage.

**Files changed:**
- `web/shelf/filters.ts` — `TTB_BANDS`, `ttbBandLabel`, `ShelfFilter.ttb`, `matchesTtb` clause (non-finite/negative → Unknown), summary group
- `web/shelf/FilterRow.tsx` — Time `FilterDropdown` with `menuitemradio` metric toggle in the roving focus list; sheet "Time to beat — any of (or)" group; badges/activeCount
- `web/shelf/filter-row.css` — metric-toggle + sheet-group styles
- `web/shelf/filters.test.ts` / `web/shelf/FilterRow.test.tsx` — I/O-matrix + hazard tests (boundary 50h, null/undefined/NaN/negative, 0-is-a-value, cross-metric absence), roving-focus test, EMPTY_FILTER metric pin
- `playwright/e2e/epic12-ttb.spec.ts` — 4 e2e (bands+boundary, metric toggle, Unknown+summary, phone sheet), loadAllPages preconditions, AND-across card-set assert
- `playwright/COVERAGE.md` — Epic 12 section (rows 12.1a–d)
- `_bmad-output/planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md` — filter-row line gains Time group
- `_bmad-output/implementation-artifacts/deferred-work.md` — TTB entry resolved; one new deferred item (summary metric naming)

**Review findings:** 5 patches applied (2 medium: keyboard/ARIA metric toggle, absence-guard hardening; 3 low), 1 deferred (summary doesn't name active metric — copy decision), 4 rejected as noise/convention.

**Follow-up review:** recommended (`true`) — the mid-review P1 rework touched shared `FilterDropdown` focus machinery used by State/Genre; an independent pass over the final diff is warranted per the FOLLOW-UP-REVIEW CONTRACT.

**Verification:** `bun run typecheck` clean; `bun run lint` (Biome) clean; Vitest 74 files / 1991 tests green; Playwright `epic12-ttb.spec.ts` 4/4 + `epic3-filter.spec.ts` regression 4/4 green (post-patch run also re-ran epic3-summary earlier: green).

**Residual risks:** shared-dropdown focus rework regression surface on State/Genre menus (covered by existing epic3 e2e, still the reason for the follow-up flag); summary sentence metric ambiguity deferred; band keys load-bearing in test-ids.
