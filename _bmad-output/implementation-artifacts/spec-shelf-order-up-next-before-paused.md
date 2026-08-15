---
title: 'Shelf ordering: Up next before Paused'
type: 'feature'
created: '2026-08-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: '1b1f58e7f04823afff40a0d011b708d416dec647'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad/custom/standing-rules-core.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Shelf currently orders live games Playing → Paused → Up next → Not started. Up Next games should be the next decision surface after currently playing games, before paused games.

**Approach:** Change the single core state-priority list to Playing → Up next → Paused → Not started while preserving the existing owned-before-wishlisted and alphabetical tiers, hidden-state ranks, visibility rules, grid, and filters.

## Boundaries & Constraints

**Always:** Keep `SHELF_STATE_ORDER` as the only source of shelf state priority; preserve effective-state derivation, default visibility, hidden-state order, ownership tier, title tiebreaker, and input immutability. Update canonical FR-18/UX wording and exact automated expectations. Every UI-facing AC retains passing Playwright coverage and a current `playwright/COVERAGE.md` row.

**Ask First:** Any change to state vocabulary, default-visible states, ownership/title ordering, filtered/reveal semantics, pagination, card/grid layout, or responsive breakpoints.

**Never:** Add client-side re-sorting, SQL `ORDER BY play_status`, a new dependency, group headings, separators, animation, persistence, schema/API changes, or edits to historical briefs, completed spec intent, context snapshots, readiness reports, or retrospectives.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Default shelf | Playing, Up next, Paused, Not started, and hidden games | Only live games render in Playing → Up next → Paused → Not started order | Existing load/error behavior unchanged |
| Within one state | Owned and wishlisted games with non-alphabetical titles | Owned first, then wishlisted; alphabetical inside each ownership tier | N/A |
| Revealed states | Live plus Story completed, Platinum achieved, and Dropped | New live order first; hidden ranks remain Story completed → Platinum achieved → Dropped | N/A |
| Filter/search/mutation | Multi-state filters, whole-library search, or status update/refetch | Remaining cards preserve core payload order; moved cards enter the new tier | Existing focus/menu restoration unchanged |

### Placement mock and responsive contract

Same flat, row-major shelf grid with no group headings or separators; arrows show DOM/reading order, not new UI:

```text
[Playing cards] → [Up next cards] → [Paused cards] → [Not started cards]
```

| Screen class | Placement/behavior | Regression statement |
|--------------|--------------------|----------------------|
| Phone, ≤600px | Existing two-column grid wraps the ordered card sequence naturally | Card sizing, controls, focus order, filters, genres visibility, scrolling, and overflow remain unchanged |
| Desktop, ≥601px | Existing auto-fill grid wraps the same ordered card sequence naturally | Track sizing, spacing, card content, controls, filters, scrolling, and overflow remain unchanged |

No breakpoint is introduced or changed. Approval of this spec records product-owner sign-off for this placement and matrix immediately before implementation.

</frozen-after-approval>

## Code Map

- `src/core/shelf.ts` -- `SHELF_STATE_ORDER` feeds `shelfRank` → `compareShelf` → `orderShelf`; root priority seam. `DEFAULT_VISIBLE_STATES` is deliberately independent and read-only for this change.
- `src/core/shelf.test.ts` -- pure ordering, ownership, hidden-rank, comparator, and immutability coverage; update exact live-state order.
- `src/services/shelf.ts` -- `getShelf` is the only production `orderShelf` caller; update stale contract comment only. Both default and `includeHidden` flows share the comparator.
- `test/integration/shelf.test.ts` -- real D1 expectations pin default and `includeHidden` ordering (`Nova` Up next must precede `Mist` Paused).
- `web/shelf/Shelf.tsx`, `web/shelf/filters.ts` -- read-only evidence: filtering and `chunkIntoRows` preserve server order; the ARIA grid follows that row-major order. Do not add a second sort.
- `playwright/e2e/epic1-shelf.spec.ts` -- UI flow for AC 1.7b; seed and assert Up next before Paused in rendered card order.
- `playwright/e2e/epic3-filter.spec.ts` -- filtered-view UI flow; add an Up next seed/selection so the state-priority assertion distinguishes it from Paused.
- `playwright/COVERAGE.md` -- keep AC 1.7b and filtered-view FR-18 rows mapped to updated browser assertions.
- `_bmad-output/specs/spec-ps-game-catalog/SPEC.md` -- update current CAP-2 success order; leave its `.memlog.md` untouched.
- `_bmad-output/planning-artifacts/prds/prd-ps-game-catalog-2026-07-05/prd.md` -- update canonical FR-18 order.
- `_bmad-output/planning-artifacts/epics.md` -- update canonical FR-18 mapping and shelf acceptance wording.
- `_bmad-output/planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md` -- update current default-order UX contract.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/shelf.ts`, `src/core/shelf.test.ts` -- move Up next before Paused at the shared seam and pin full live/hidden ordering.
- [x] `src/services/shelf.ts`, `test/integration/shelf.test.ts` -- align contract wording and verify both shelf modes through real D1.
- [x] `playwright/e2e/epic1-shelf.spec.ts`, `playwright/e2e/epic3-filter.spec.ts`, `playwright/COVERAGE.md` -- assert default and filtered rendered order and retain UI-AC traceability.
- [x] Canonical SPEC, PRD, epics, and UX files in Code Map -- replace current FR-18 order without rewriting historical artifacts.

**Acceptance Criteria:**
- Given Playing, Up next, Paused, and Not started games on the shelf, when default or filtered/revealed shelf cards render, then every retained card follows Playing → Up next → Paused → Not started state priority, followed by unchanged hidden-state ranks when revealed.
- Given multiple games in any state, when ordered, then owned games remain before wishlisted games and titles remain alphabetical within each ownership tier.
- Given phone or desktop supported layout, when the new order renders, then the existing continuous grid and responsive behavior remain unchanged and the Up next card group is immediately after Playing in DOM/reading order.

## Spec Change Log

## Verification

**Commands:**
- `bun run test -- src/core/shelf.test.ts test/integration/shelf.test.ts` -- focused unit and real-D1 ordering checks pass through registered Vitest projects.
- `bun run test:e2e playwright/e2e/epic1-shelf.spec.ts playwright/e2e/epic3-filter.spec.ts --grep "default shelf hides|a filtered view keeps" --workers=1` -- default and filtered rendered ordering pass without shared-fixture parallel interference.
- `bun run lint && bun run typecheck` -- edited code and documentation references introduce no lint/type errors.

## Suggested Review Order

**Ordering seam**

- Single priority list swaps Up next before Paused for every shelf consumer.
  [`shelf.ts:16`](../../src/core/shelf.ts#L16)

- Service remains a thin caller of shared core ordering.
  [`shelf.ts:181`](../../src/services/shelf.ts#L181)

**Product contract**

- Capability success now states new order and preserved ownership tier.
  [`SPEC.md:27`](../specs/spec-ps-game-catalog/SPEC.md#L27)

- Canonical FR-18 records complete state, ownership, and title priority.
  [`prd.md:83`](../planning-artifacts/prds/prd-ps-game-catalog-2026-07-05/prd.md#L83)

- Epic requirement, traceability, and acceptance wording remain aligned.
  [`epics.md:58`](../planning-artifacts/epics.md#L58)

- UX behavior reflects identical ordering across responsive surfaces.
  [`EXPERIENCE.md:87`](../planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md#L87)

**Verification**

- Pure test pins complete live and hidden priority sequence.
  [`shelf.test.ts:42`](../../src/core/shelf.test.ts#L42)

- Real-D1 test proves default and include-hidden service results.
  [`shelf.test.ts:110`](../../test/integration/shelf.test.ts#L110)

- Default rendered shelf asserts Up next before Paused.
  [`epic1-shelf.spec.ts:68`](../../playwright/e2e/epic1-shelf.spec.ts#L68)

- Filtered rendered shelf asserts same shared priority.
  [`epic3-filter.spec.ts:159`](../../playwright/e2e/epic3-filter.spec.ts#L159)

- Coverage ledger maps both UI-facing ordering contracts.
  [`COVERAGE.md:30`](../../playwright/COVERAGE.md#L30)

**Deferred infrastructure**

- Parallel shared-baseline interference recorded outside feature scope.
  [`deferred-work.md:587`](deferred-work.md#L587)
