---
title: 'Story 3.1: Filter the shelf by State and Genre'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: 'bfdeb5c49ee80a1807edc1fbc5d7f2e6985a693a'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** The shelf always shows the full default visible set; Luca cannot narrow it to the statuses and genres he cares about (Epic 3, FR-20/21/22).

**Approach:** Client-side filtering over the existing `/api/shelf` payload: a filter row above the grid with a State multiselect (the four live statuses) and a Genre multiselect (vocabulary from `GET /api/genres`), OR within a group, AND across groups, applied through a pure predicate before the grid renders. No API changes.

## Boundaries & Constraints

**Always:**
- OR within a group, AND across groups (FR-20).
- State group empty → default visible set (the `/api/shelf` payload as-is); any state selected → exactly the selected states (FR-21).
- FR-18 amendment: filtered views keep state-priority → owned-before-wishlisted → alphabetical ordering. The payload is already server-ordered; the filter predicate MUST preserve input order (subset of a sorted list stays sorted) — never re-sort client-side.
- Filters never touch the whole-library search path (`SearchBox`, `['shelf-search']`, `/api/shelf/search`) — separate query path by design.
- Client filter consumes the server-computed `effectiveState`/`genres` fields on each `ShelfGame` — never recompute state client-side (AD-7).
- Active filter entries visually highlighted (FR-22) with accessible state (`aria-checked`), never color alone; ≥44×44 hit areas; WCAG AA contrast; filter changes announce via the polite live region.
- Zero-match filter result renders `EmptyState variant="no-match"`, never a blank shelf.
- Web program never imports from `src/core` (AR-26 two-program boundary).

**Block If:**
- Filtering turns out to require games absent from the `/api/shelf` payload (would force an API change this story doesn't own — reveal pills are Story 3.2).
- Playwright foundation broken (cannot run `bun run test:e2e`).

**Never:**
- No reveal pills, flag pills (3.2), summary sentence, mobile bottom sheet, or "Clear filters" action (3.3).
- No URL/router filter persistence — local React state only.
- No server-side filter params on `/api/shelf`.
- No new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No selection | states=[], genres=[] | Full payload unchanged, same order | No error |
| State OR | states=[Playing, Paused] | Exactly games whose effectiveState is Playing or Paused | No error |
| Genre OR | genres=[RPG, Racing] | Games having RPG or Racing among their genres | No error |
| AND across groups | states=[Playing], genres=[RPG] | Games that are Playing AND tagged RPG | No error |
| Zero match | states=[Paused], genres=[some genre no Paused game has] | Empty list → `EmptyState variant="no-match"` | No error |
| Order preservation | Any selection | Output preserves payload order (FR-18) | No error |
| Game with no genres | genres=[RPG] selected | Game excluded (no genre matches) | No error |

</intent-contract>

## Code Map

- `web/shelf/Shelf.tsx` -- shelf query (`['shelf']`), `ShelfGrid` (progressive render, ARIA row chunking via `chunkIntoRows`); filter state lives in `Shelf`, filtered array passed to `ShelfGrid` (upstream of `useProgressiveList`)
- `web/shelf/api.ts` -- `ShelfGame` (has `effectiveState`, `genres: string[]`), `PLAY_STATUSES`, `fetchGenreVocabulary` (reuse under query key `['genres']`)
- `web/shelf/StatusPopover.tsx` -- ARIA menu-button pattern to copy for multiselect dropdowns (switch `menuitemradio` → `menuitemcheckbox`, keep arrow/Home/End/Escape, outside-close, viewport flip)
- `web/components/EmptyState.tsx` -- `variant="no-match"` already exists ("No games match the current filters.")
- `web/components/LiveRegion.tsx` -- `useAnnounce()` for filter-change announcements
- `web/shelf/SearchBox.tsx` -- isolation boundary: do not touch
- `playwright/e2e/epic1-shelf.spec.ts` -- ordering-assertion pattern to mirror
- `playwright/support/factories/game-factory.ts`, `playwright/support/helpers/d1.ts` -- e2e seeding (seed own games, clean up try/finally; never mutate the 3 baseline fixtures)
- `playwright/COVERAGE.md` -- per-AC coverage map (epic-AC keyed)

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/filters.ts` -- new: `ShelfFilter` type (`states: PlayStatus[]` live-only, `genres: string[]`) + pure `applyShelfFilter(games, filter)` implementing the I/O matrix; order-preserving
- [x] `web/shelf/filters.test.ts` -- unit tests (web vitest project) covering every I/O-matrix row, incl. order-preservation hazard test
- [x] `web/shelf/FilterRow.tsx` + `web/shelf/filter-row.css` -- filter row: State + Genre multiselect dropdown buttons (StatusPopover-derived, `menuitemcheckbox`); trigger shows active highlight + selected count; genre list from `['genres']` query; announces changes via `useAnnounce`; ≥44px hit targets; testids `filter-row`, `filter-state`, `filter-genre`
- [x] `web/shelf/Shelf.tsx` -- hold `ShelfFilter` state, mount `FilterRow` above the grid, apply `applyShelfFilter`, branch to `EmptyState variant="no-match"` on zero matches (only when a filter is active)
- [x] `web/shelf/FilterRow.test.tsx` -- jsdom tests: checkbox semantics, highlight state, keyboard interaction
- [x] `playwright/e2e/epic3-filter.spec.ts` -- e2e: state filter shows exactly selected states; genre filter; AND across groups; deselect-all restores default set; active highlight visible; FR-18 ordering held in a filtered view (seed owned+wishlisted games sharing a state)
- [x] `playwright/COVERAGE.md` -- add Story 3.1 AC rows (all ACs have UI flows → all map to the e2e spec)

**Acceptance Criteria:**
- Given the filter row, when I open the State group, then it is a multiselect of the four live statuses, and Genre is a multiselect of the full vocabulary (FR-20).
- Given selections across groups, when the shelf filters, then it is OR within a group and AND across groups (FR-20).
- Given nothing selected in the State group, when the shelf renders, then it shows the default visible set; the moment anything in the state group is selected it shows exactly the selected states (FR-21).
- Given an active filter, when it is applied, then its pill/entry is visually highlighted with accessible checked state (FR-22).
- Given any active filter, when the shelf renders, then visible games keep state-priority → owned → alphabetical order (FR-18 amendment).
- Given active filters, when the whole-library search is used, then results are unaffected by filters (search isolation).

## Spec Change Log

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 2, low 6)
- defer: 1: (high 0, medium 1, low 0)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` Escape on the trigger now closes an open menu — previously a keyboard dead-end when the menu had no focusable rows (empty/pending vocabulary)
  - `[medium]` `[patch]` genre vocabulary fetch error/pending now surface as distinct menu placeholders ("Genres couldn't load" / "Loading genres…") instead of a silent "No options"
  - `[low]` `[patch]` empty-menu placeholder is an inert `role="menuitem"` button — a `role="menu"` no longer renders without owned menuitems
  - `[low]` `[patch]` a selected genre missing from the refetched vocabulary stays listed as a checked row so it can always be untoggled
  - `[low]` `[patch]` filter-change announcement now derives from the single rendered filter result via effect — removed the duplicate `applyShelfFilter` call
  - `[low]` `[patch]` `.filter-row` gets `flex-wrap: wrap` for narrow viewports
  - `[low]` `[patch]` e2e `seedGenres` throws on an unknown genre name instead of silently inserting an empty-string id
  - `[low]` `[patch]` COVERAGE.md 3.1a row corrected (jsdom pins the full listings, e2e pins seeded rows); jsdom tests added for accessible-name flip-back, orphaned-genre row, and empty-menu Escape

## Design Notes

- Payload is pre-ordered and pre-restricted to the default visible set; the state multiselect only offers the four live statuses, so pure client-side subset filtering suffices — Dropped/milestone reveals arrive in 3.2 with their own data path.
- Model `ShelfFilter` as a standalone type so 3.2 can extend it (reveal states, flags) without reshaping 3.1 code.
- Hazard tests (named invariants → dedicated red/green tests): exactly-selected-states semantics, empty-group default semantics, order preservation, search isolation (e2e: apply filter, search still returns hidden-by-filter titles).

## Verification

**Commands:**
- `bun run lint && bun run typecheck` -- expected: Biome + tsc clean
- `bun run test` -- expected: all Vitest projects green incl. new filters/FilterRow tests
- `bun run test:e2e` -- expected: Playwright green incl. epic3-filter.spec.ts

## Auto Run Result

**Summary:** Story 3.1 implemented — State/Genre multiselect filter row over the client-side shelf payload. Pure order-preserving predicate (`applyShelfFilter`), OR within group / AND across groups, empty state group = default visible set, active triggers highlighted with accessible state, zero-match renders NO MATCH, search path untouched. No API changes.

**Files changed:**
- `web/shelf/filters.ts` — new: filter model + pure predicate + toggle helper
- `web/shelf/filters.test.ts` — new: unit tests incl. FR-18 order-preservation hazard test
- `web/shelf/FilterRow.tsx` + `web/shelf/filter-row.css` — new: State/Genre multiselect dropdowns (menuitemcheckbox), error/pending vocabulary states, orphaned-genre handling
- `web/shelf/FilterRow.test.tsx` — new: jsdom tests (semantics, highlight, keyboard, edge cases)
- `web/shelf/Shelf.tsx` — FilteredShelf layer: filter state, live-region announcements, no-match branch
- `web/shelf/Shelf.test.tsx` — integration tests: exact-states filtering, default-set restore, NO MATCH
- `playwright/e2e/epic3-filter.spec.ts` — new: 4 e2e tests (FR-20/21/22, FR-18 ordering, search isolation)
- `playwright/COVERAGE.md` — Epic 3 section, one row per 3.1 AC

**Review findings:** 8 patches applied (2 medium: empty-menu Escape dead-end, silent genre-fetch failure; 6 low), 1 deferred (pre-existing epic2 e2e parallel flake), 9 rejected as noise.

**Verification:** `bun run lint` clean, `bun run typecheck` clean, `bun run test` 522/522, `bun run test:e2e` 36/36 (one flaky run traced to environment load + two pre-existing epic2 flakes, green on re-run).

**Residual risks:** epic2 e2e fold-position flake under parallel load (deferred-work ledger); Story 3.2 will extend `ShelfFilter` and needs a data path for hidden states (out of 3.1 scope by design).
