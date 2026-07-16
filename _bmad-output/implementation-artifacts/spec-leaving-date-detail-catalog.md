---
title: 'Leaving date in detail + catalog cards, and a shelf Leaving soon filter (10.4 follow-on)'
type: 'feature'
created: '2026-07-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
route: 'quick-dev'
baseline_commit: '1e7e77e'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
warnings: []
---

<frozen-after-approval>

## Intent

**Problem:** the leaving date renders only as the shelf card's pill — the detail panel says nothing, and the catalog grid (where "should I claim/play this?" is decided) doesn't warn either.

**Approach:** pure render, no new data. Detail panel: an amber "Leaving PS+ Extra on {date}" line. Catalog cards: a "LEAVING {short date}" flag via the browse service's EXISTING library join (the tracked map already reads `listLibraryForUser`, whose rows carry `psPlusLeavingOn`). Shelf: a "Leaving soon" FLAG pill (checkpoint decision — the shelf is where the data is complete), predicate = un-owned + future date, visibility gated like the PS+ pill. Catalog coverage is honestly partial: only tracked games have dates — the sweep never fans out to all 491 products.

## Boundaries & Constraints

**Always:**
- No new external calls, columns, or sweep scope — render what `game.ps_plus_leaving_on` already holds (NFR-3).
- Same display rules everywhere as the shelf pill: hidden when owned (FR-38), hidden when the date is past (blind-window suppression), amber warn family, date always beside the words (never color-only).
- Catalog: the date rides the tracked-match join (all three keys); an untracked product renders NO leaving signal — absence of data, never a fabricated one (NFR-4).
- Detail line lives with the other read-only facts; sr-only/visible copy carries the full ISO date.
- Shared date formatting with the shelf pill (one `formatLeavingDate` home — extract, don't copy).

**Block If:** (none)

**Never:** a CATALOG "leaving soon" filter (checkpoint decision: catalog data covers tracked games only — a filter implies catalog-wide truth and would silently hide untracked leaving games; the SHELF pill is the honest home); sweeping untracked products; touching sweep/cron/provider code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tracked, un-owned, future date | detail open / catalog grid | detail shows "Leaving PS+ Extra on {ISO}"; catalog card shows LEAVING {short} flag | none |
| Owned game with date | either surface | nothing renders (FR-38); fact persists | none |
| Past date | either surface | suppressed, same as shelf pill | none |
| Untracked catalog product | catalog grid | no leaving signal — no date exists | none |
| No date | any surface | absent | none |
| Shelf "Leaving soon" pill on | ≥1 un-owned future-dated game in library | only those games show; summary reads "Showing Leaving soon games." | none |
| No leaving games in library | shelf filters render | pill hidden (unless active) — PS+-pill gating pattern | none |

</frozen-after-approval>

## Code Map

- `web/shelf/leaving.ts` (new, tiny) -- `formatLeavingDate` + `showLeaving(date, owned)` extracted from Card.tsx; Card imports
- `web/shelf/DetailPanel.tsx` + `detail-panel.css` -- amber leaving line near the PS+/status facts
- `src/services/psplus-browse.ts` -- `leavingOn` on the tracked-match value (3-key join, owned-wins unchanged) → `CatalogGame`
- `src/routes/` catalog route schema + `web/catalog/api.ts` -- `leavingOn: string|null` (client default null for deploy skew)
- `web/catalog/CatalogCard.tsx` + `catalog.css` -- LEAVING flag beside the ◈ PS+ flag, gated un-owned + future
- `web/shelf/filters.ts` -- `leavingSoon` in FLAGS + special-case predicate (like `psPlusExtra`); `web/shelf/FilterRow.tsx` -- visibility gate; `web/shelf/Shelf.tsx` (or wherever `showPsPlus` derives) -- the has-leaving-game proxy
- tests: DetailPanel jsdom (shows/owned-hides/past-hides), CatalogCard jsdom, filters.test.ts predicate + summary rows, FilterRow gating, browse integration (tracked match carries date; untracked null), Playwright epic10-leaving-soon additions (detail line + catalog flag + shelf pill flow), COVERAGE.md 10.4 row updates

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/leaving.ts` -- extract shared helpers; Card.tsx consumes
- [x] `web/shelf/DetailPanel.tsx` + css -- leaving line
- [x] `src/services/psplus-browse.ts` + route schema + `web/catalog/api.ts` -- `leavingOn` through the DTO
- [x] `web/catalog/CatalogCard.tsx` + css -- LEAVING flag
- [x] `web/shelf/filters.ts` + `FilterRow.tsx` + shelf wiring -- Leaving soon pill (predicate, gate, summary)
- [ ] tests -- jsdom both surfaces, browse integration, Playwright, COVERAGE.md

**Acceptance Criteria:**
- Given a tracked, un-owned game with a future leaving date, when its detail opens, then an amber "Leaving PS+ Extra on {date}" line shows; when the catalog renders its product, then the card carries a LEAVING {date} flag.
- Given an owned game or a past date, when either surface renders, then no leaving signal appears.
- Given an untracked catalog product, when the grid renders, then no leaving signal appears (no fabricated data).
- Given the shelf holds an un-owned game with a future leaving date, when filters render, then a "Leaving soon" pill is available; toggling it shows exactly those games and the summary narrates it; with no such game the pill hides unless active.

## Review Triage Log

### 2026-07-16 — Review pass (quick-dev, dual hunters)
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 3, low 7)
- defer: 0
- reject: 5
- addressed_findings:
  - `[medium]` `[patch]` The "Leaving soon" pill could promise games the filter cannot show (both hunters): the visibility proxy counted hidden-state games while the predicate ANDs with LIVE states — toggling yielded an empty shelf. Gate now counts live-state games only
  - `[medium]` `[patch]` The spec's catalog-flag e2e was silently substituted with jsdom — added (`epic10-leaving-soon.spec.ts` › catalog card carries the LEAVING flag, via seedCatalog + tracked game join)
  - `[medium]` `[patch]` UTC-"today" semantics undocumented — leaving.ts now records the choice and its user-facing consequence (warning drops early for users west of UTC, never late)
  - `[low]` `[patch]` Un-owned duplicate merge dropped the date (first-inserted-wins) — both match maps now prefer the dated row among un-owned entries
  - `[low]` `[patch]` FilterRow gating for the new pill unpinned — hidden/shown/stranding-guard test added
  - `[low]` `[patch]` Owned-wins interplay unpinned below the DTO — integration pin: owned match returns date WITH owned:true (the FR-38 gate's inputs)
  - `[low]` `[patch]` Title-collision false-positive amplification acknowledged in a comment (pre-existing L6 pattern; exact-link keys checked first)
  - `[low]` `[patch]` Magic 26px flag offset tied to its source in a comment
  - `[low]` `[patch]` DetailPanel test title overclaimed ("or a past date") — renamed; tautological catalog assert removed (server-side guarantee lives in integration)
  - `[low]` `[patch]` Spec Change Log entry recording the detail-line placement (below header, above Play status — the decision surface, in the spirit of "with the read-only facts")

## Spec Change Log

- **2026-07-16 — placement note (review).** The frozen intent says the detail line "lives with the other read-only facts"; it ships directly under the header, above Play status — the most prominent read-only slot, since "play it before {date}" is the decision the panel opens for. Recorded rather than re-derived; no behavior change.


## Verification

**Commands:**
- `bun run typecheck && bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. new browse/jsdom pins
- `bunx playwright test epic10 epic7` -- expected: green


## Suggested Review Order

**The one gate every surface shares**

- Entry point: `showLeaving` + UTC-today semantics and `formatLeavingDate`, extracted from Card
  [`leaving.ts:1`](../../web/shelf/leaving.ts#L1)

**New render surfaces**

- Detail line above Play status (placement rationale in the comment)
  [`DetailPanel.tsx:262`](../../web/shelf/DetailPanel.tsx#L262)
- Catalog LEAVING flag stacked under the PS+ badge
  [`CatalogCard.tsx:66`](../../web/catalog/CatalogCard.tsx#L66)

**The browse join**

- Match maps carry `leavingOn`; owned wins, dated row beats date-less among un-owned
  [`psplus-browse.ts:186`](../../src/services/psplus-browse.ts#L186)
- DTO + collision-amplification note
  [`psplus-browse.ts:264`](../../src/services/psplus-browse.ts#L264)

**The filter pill**

- `leavingSoon` flag + predicate
  [`filters.ts:33`](../../web/shelf/filters.ts#L33)
- Live-states-only visibility proxy (the review's top finding)
  [`Shelf.tsx:169`](../../web/shelf/Shelf.tsx#L169)
- FilterRow gating
  [`FilterRow.tsx:50`](../../web/shelf/FilterRow.tsx#L50)

**Peripherals**

- Integration pins (tracked date / untracked null / owned-with-date)
  [`psplus-browse.test.ts:391`](../../test/integration/psplus-browse.test.ts#L391)
- e2e: detail line, shelf pill flow, catalog flag
  [`epic10-leaving-soon.spec.ts:72`](../../playwright/e2e/epic10-leaving-soon.spec.ts#L72)
- COVERAGE.md 10.4b row widened
  [`COVERAGE.md:404`](../../playwright/COVERAGE.md#L404)
