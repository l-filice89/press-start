---
title: 'Story 3.3: Live filter summary, empty state & responsive filters'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: '9d3476f8ac531f6dd463b545a85cf0c0df0b518d'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** The filter model (3.1/3.2) has no plain-English readback, the no-match state has no recovery action, and the filter row doesn't work under the thumb on phones (FR-20, UX-DR9/18/23/26).

**Approach:** A pure summary-builder over `ShelfFilter` rendered as a live sentence with literal "or"/"and" connector words (OR = glow-cyan, AND = heat-magenta, color redundant to the words); a "Clear filters" action on the NO MATCH empty state; on phones the row collapses to one Filters button + active-count badge opening a grouped, logic-labeled bottom sheet with a "Show N games" action.

## Boundaries & Constraints

**Always:**
- Summary uses literal words "or"/"and"; color is redundant to the words, never the only signal (UX-DR23); it narrates only active groups and reads back the same OR-within/AND-across semantics the predicate applies.
- Reveals narrate as part of the state group (they extend it); each flag is its own AND group.
- NO MATCH empty state gains a "Clear filters" action that resets to `EMPTY_FILTER` (UX-DR18); the all-hidden-library INSERT GAMES branch keeps no such action.
- Phone (≤600px, existing breakpoint): single Filters button with active-count badge → bottom sheet, focus-trapped `role="dialog"` (reuse the ConfirmDialog trap pattern + `FOCUSABLE_SELECTOR`), groups labeled with their logic (any of / all of), "Show N games" applies-and-closes (filters apply live; the button is the exit). Desktop (>600px) shows the full row + summary inline, no Filters button.
- Accessibility floor: ≥44×44 targets, `aria-pressed`/`aria-checked` state, Escape closes the sheet and returns focus to the trigger, WCAG AA contrast for connector colors (use `--color-heat-magenta-ink` for AND on dark).
- Filter semantics themselves unchanged — this story adds narration and chrome only; `applyShelfFilter` is untouched.

**Block If:**
- Playwright foundation broken.

**Never:**
- No URL persistence, no server changes, no new dependencies, no changes to search.
- No focus-hardening work (3.4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No filter | EMPTY_FILTER | No summary sentence rendered | No error |
| State OR | states=[Playing, Paused] | "Showing Playing or Paused games." | No error |
| Reveal joins state group | states=[Playing], reveals=[Dropped] | "Showing Playing or Dropped games." | No error |
| Cross-group AND | states=[Playing], genres=[RPG, Racing], flags=[owned] | "Showing Playing and RPG or Racing and Owned games." | No error |
| Flags each own group | flags=[owned, playableNow] | "Showing Owned and Playable now games." | No error |
| Zero match | any filter matching nothing | NO MATCH + Clear filters → EMPTY_FILTER restores default set | No error |

</intent-contract>

## Code Map

- `web/shelf/filters.ts` -- add pure `summarizeFilter(filter): SummaryPart[]` (`{text, connector?: 'or'|'and'}`), reusing `FLAGS` labels
- `web/shelf/FilterRow.tsx` + `filter-row.css` -- render summary sentence (desktop); phone Filters button + count badge + `FilterSheet` (portal, trap per `web/components/ConfirmDialog.tsx`); needs new `visibleCount` prop
- `web/shelf/Shelf.tsx` -- pass `visibleCount`; EmptyState no-match gains Clear filters action
- `web/components/EmptyState.tsx` -- actions prop already exists, no change
- tokens: `--color-accent-glow` (OR), `--color-heat-magenta-ink` (AND), 600px breakpoint convention
- `playwright/e2e/epic3-summary.spec.ts` (new) + `playwright/COVERAGE.md`; viewport-switch pattern from `epic1-responsive.spec.ts`

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/filters.ts` + `filters.test.ts` -- `summarizeFilter` per I/O matrix (hazard: literal "or"/"and" words present; reveals join the state group)
- [x] `web/shelf/FilterRow.tsx` + `filter-row.css` -- summary sentence with connector spans (`filter-summary__or|and`); phone trigger + badge; `FilterSheet` grouped + logic-labeled + "Show N games"; Escape/backdrop close returns focus
- [x] `web/shelf/FilterRow.test.tsx` -- summary words + connector classes; sheet open/toggle/close; badge count
- [x] `web/shelf/Shelf.tsx` + `Shelf.test.tsx` -- Clear filters action on no-match (restores default set); visibleCount wiring
- [x] `playwright/e2e/epic3-summary.spec.ts` -- desktop summary sentence (words + both connector classes); NO MATCH → Clear filters restores; phone sheet flow (button+badge → sheet → toggle → Show N games → filtered shelf); desktop shows row inline (no Filters button)
- [x] `playwright/COVERAGE.md` -- 3.3 AC rows

**Acceptance Criteria:**
- Given active filters, when the shelf renders, then a live summary sentence narrates them with literal "or"/"and" (OR glow-cyan, AND heat-magenta, color redundant) (FR-20, UX-DR9/23).
- Given filters matching nothing, when the shelf renders, then NO MATCH with a "Clear filters" action shows (UX-DR18).
- Given the phone surface, when filters are shown, then a single Filters button + count badge opens a grouped bottom sheet with "Show N games"; desktop shows the full row inline with the summary (UX-DR26).

## Spec Change Log

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 2, low 9)
- defer: 1: (high 0, medium 1, low 0)
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` reveal-only summary misstated the visible set ("Showing Dropped games." while the default set + Dropped rendered) — sentence now spells out the live statuses; hazard test added
  - `[medium]` `[patch]` sheet focus trap had a hole: Shift+Tab straight off the just-focused container escaped the aria-modal dialog — container case handled; trap test added
  - `[low]` `[patch]` multi-group sentence disambiguated with commas before each "and"
  - `[low]` `[patch]` summary moved out of the desktop-only container — phone shows the sentence under the Filters button
  - `[low]` `[patch]` live-region announcement now carries the or/and sentence, not just counts
  - `[low]` `[patch]` sheet distinguishes genre-vocabulary error/pending from empty (desktop bar replicated)
  - `[low]` `[patch]` body scroll locked while the sheet is open; safe-area bottom padding added
  - `[low]` `[patch]` sheet closes when the viewport crosses the 600px breakpoint (stale chrome over the desktop row)
  - `[low]` `[patch]` sheet reveal toggles get "Show <state> games" accessible names (desktop rationale replicated; no milestone-name collision)
  - `[low]` `[patch]` in-sheet Clear filters appears at zero matches ("Show 0 games" no longer a dead end)
  - `[low]` `[patch]` COVERAGE.md Epic 3 rows reordered (3.2f restored before 3.3); openStatusMenu e2e helper hardened against refetch re-chunk remounts (3.4 owns the product fix)

## Design Notes

- Summary renders inside the filter row container; hidden when `EMPTY_FILTER` (no dead "Showing all games" chatter).
- Sheet reuses the same `toggleSelection` handlers — one filter state, two surfaces; "Show N games" only closes (filters already applied live).

## Auto Run Result

**Summary:** Story 3.3 implemented — pure `summarizeFilter` renders a live plain-English sentence (literal or/and words, glow-cyan/heat-magenta tinted spans, comma-scoped groups) on both surfaces and in the live-region announcement; NO MATCH gains a Clear filters action (plus an in-sheet one at zero matches); on phones the row collapses to a Filters button + count badge opening a focus-trapped, scroll-locked, logic-labeled bottom sheet with a "Show N games" exit that also closes on Escape, backdrop press, or crossing the breakpoint.

**Files changed:**
- `web/shelf/filters.ts` + tests — `summarizeFilter`/`summarizeFilterText` (reveal-only truthfulness hazard test)
- `web/shelf/FilterRow.tsx` + `filter-row.css` + tests — summary component, phone trigger + `FilterSheet` (trap incl. container hole, scroll lock, viewport-cross close, reveal aria-labels, genre error/pending states)
- `web/shelf/Shelf.tsx` + tests — Clear filters on no-match; sentence in announcements; `visibleCount`
- `playwright/e2e/epic3-summary.spec.ts` (new, 3 tests), `epic2-tracking.spec.ts` (openStatusMenu retry vs refetch re-chunk — product fix owned by 3.4), `playwright/COVERAGE.md`

**Review findings:** 11 patches applied (2 medium, 9 low), 1 deferred (extract the thrice-duplicated modal trap scaffold), 6 rejected.

**Verification:** lint + typecheck clean; Vitest 536/536; Playwright 43/43 twice consecutively (after hardening the epic2 helper against the ledgered refetch re-chunk flake).

**Residual risks:** modal trap scaffold duplicated in three components (deferred); transient UI vs grid re-chunk remains the product gap Story 3.4 closes.

## Verification

**Commands:**
- `bun run lint && bun run typecheck` -- expected: clean
- `bun run test` -- expected: green incl. new tests
- `bun run test:e2e` -- expected: green incl. epic3-summary.spec.ts
