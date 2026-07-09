---
title: 'Shelf grid ARIA row regrouping to match 2-D nav (DW-4)'
type: 'bugfix'
created: '2026-07-08'
status: 'done'
baseline_revision: 'e043a500beca912e6e64e0efc40493364f031cb3'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: '10f3e376aef3faf8b0d6028f2f5ba8db5ea5438a'
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** `web/shelf/Shelf.tsx` renders every card inside a single `role="row"` (`shelf__row`) while arrow-key nav moves in 2-D by a measured column count. Assistive tech therefore announces a flat 1×N grid that contradicts the visual/navigational N×M structure. Left/Right reading-order traversal — the stated a11y-floor invariant — already works, so this is a faithful refinement, not a floor break.

**Approach:** Make `.shelf__grid` the single auto-fill grid container (moving the grid CSS off `.shelf__row`) and give each `.shelf__row` `display: contents` so it groups cards semantically without altering the one-grid visual layout. Measure the true resolved column count from the container (`getComputedStyle().gridTemplateColumns`, re-measured on resize via `ResizeObserver`) into React state, chunk the visible cards into `role="row"` groups of that width in reading order, and drive Up/Down nav from the same state. Flat per-card focus index and reading-order traversal are preserved unchanged.

## Boundaries & Constraints

**Always:** Keep one visual grid (auto-fill on desktop, fixed 2-up ≤600px) — regrouping is semantic only via `display: contents`. Preserve reading-order (Left/Right/Home/End) traversal and the flat roving-tabindex focus index across rows. Chunk cards in DOM order so each `role="row"` holds a contiguous reading-order run equal to the measured column count. Fall back to a column count of 1 when layout is unmeasurable (jsdom / no `ResizeObserver` / unresolved template), collapsing Up/Down to prev/next as today. `role="grid"` → `role="row"` → `role="gridcell"` nesting must be intact.

**Block If:** A faithful multi-row ARIA grouping cannot be achieved without breaking the single responsive auto-fill visual layout or the existing reading-order/focus invariants.

**Never:** Change the server DTO, ordering, visibility, progressive-render, or search behavior. Do not add a design primitive or dependency. Do not alter card content/markup in `Card.tsx`. Do not edit the deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chunk into rows | 5 items, columnCount 2 | Rows `[[0,1],[2,3],[4]]` — contiguous reading order, last row partial | n/a |
| Chunk fallback | any items, columnCount 0 or <1 | Treated as 1 col → one item per row | n/a |
| Empty visible | 0 items | Zero `role="row"` groups rendered, no throw | n/a |
| jsdom render | N cards, no layout engine | columnCount stays 1 → N `role="row"` groups each with one `role="gridcell"`; grid/row/gridcell roles present | No error |
| Reading-order nav | Focus card 0, ArrowRight / End / Home | Roving focus moves next / last / first across row groups, unchanged | No error |

</intent-contract>

## Code Map

- `web/shelf/Shelf.tsx` -- system under test: `ShelfGrid` renders the single `role="row"` (line ~159) and measures `columnCount()` per keypress via `getBoundingClientRect`. Replace with measured-into-state column count + chunked `role="row"` groups; export a pure `chunkIntoRows` helper for test.
- `web/shelf/shelf.css` -- move grid layout from `.shelf__row` onto `.shelf__grid`; set `.shelf__row { display: contents; }`. Keep tokens, gap, responsive 2-up.
- `web/shelf/Card.tsx` -- unchanged; renders `role="gridcell"`. Read-only reference.
- `web/shelf/Shelf.test.tsx` -- extend: assert `role="row"` grouping + gridcell nesting + reading-order traversal; import and unit-test `chunkIntoRows`.
- `vitest.config.ts` -- `web` jsdom project globs `web/**/*.test.tsx`; no config change.

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/Shelf.tsx` -- Add `gridRef` + `columnCount` state measured from resolved `gridTemplateColumns` (guarded: unresolved/`(`-containing/absent → 1) in a `ResizeObserver` effect (early-return when `ResizeObserver` undefined). Export pure `chunkIntoRows(items, columnCount)`. Render `.shelf__grid` (role grid) → one `.shelf__row` (role row) per chunk → `Card`s, computing flat index `rowIdx * columnCount + colIdx`. Drive Up/Down from the `columnCount` state; drop the per-keypress `getBoundingClientRect` measurement.
- [x] `web/shelf/shelf.css` -- Move the grid declarations (`display: grid`, `grid-template-columns`, `gap`, `align-items`) onto `.shelf__grid`; set `.shelf__row { display: contents; }`; keep the ≤600px 2-up override on `.shelf__grid`.
- [x] `web/shelf/Shelf.test.tsx` -- Unit-test `chunkIntoRows` (I/O matrix rows 1–3) + `countColumns`. Add a component test: N cards render N `role="row"` groups (jsdom fallback = 1 col), each containing one `role="gridcell"`, under the single `role="grid"`. Reading-order traversal test still passes.

**Acceptance Criteria:**
- Given the rendered shelf, when inspected, then gridcells are nested in `role="row"` groups under one `role="grid"` (never all cells in a single row) and the visual auto-fill layout is unchanged (rows use `display: contents`).
- Given a column count of N, when `chunkIntoRows` runs, then cards are partitioned into contiguous reading-order rows of N (final row may be partial) and a count <1 is treated as 1.
- Given the shelf grid, when navigating by keyboard, then Left/Right/Home/End traverse in reading order across row groups and the focused card remains the sole tab stop (a11y floor preserved).
- Given a browser with layout, when the viewport resizes changing the auto-fill column count, then the `role="row"` grouping re-chunks to the new measured count.

## Spec Change Log

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 2
- addressed_findings:
  - `[low]` `[patch]` Flat card index used raw `columnCount` while `chunkIntoRows` clamped to `Math.max(1, …)`; derived one shared `cols` for both so the DOM index can never diverge from the row grouping (`web/shelf/Shelf.tsx`).
  - rejected (2): `aria-rowcount`/`aria-rowindex` for progressive rendering (out of scope — DW is 1×N→N×M row grouping, now fixed; pre-existing announce-total concern); `display:contents` dropping `role` from the a11y tree (modern browsers preserve it — documented tradeoff, not a code defect).

### 2026-07-08 — Review pass (2)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 1
- reject: 21
- addressed_findings:
  - `[low]` `[patch]` Inserting the new `describe('countColumns')`/`describe('chunkIntoRows')` blocks reparented the pre-existing `shows an alert if the shelf fails to load` test into `describe('chunkIntoRows')` (still ran, but mislabelled `chunkIntoRows > shows an alert…`). Moved it back into `describe('Shelf')` (`web/shelf/Shelf.test.tsx`).
  - deferred (1): resize-triggered re-chunk remounts the focused card (rows keyed by index, card moves to a different parent `div` when column count changes) — drops browser focus on viewport resize crossing a column boundary. Real but inherent to the mandated `display:contents` row-grouping; roving-tabindex and reading order preserved.
  - rejected (21): brittleness/edge findings against `countColumns`/`chunkIntoRows` (line-name brackets, `fit-content`/`calc`/retained `minmax`, `auto-fit` collapsed tracks, non-integer/negative `columnCount`, `display:none` measuring `none`) — none reachable with this project's fixed `repeat(auto-fill, minmax(150px,1fr))` template and integer-only internal usage; N>1 / ArrowUp-Down not e2e-tested and first-paint 1-col flicker (jsdom has no layout engine — logic covered by pure `chunkIntoRows`/`countColumns` unit tests, documented residual risk); `getComputedStyle`-per-tick perf, empty-dep observer, no-`ResizeObserver` silent fallback, End-beyond-visible (guarded by `supportsObserver`) — pre-existing, guarded, or negligible.

## Design Notes

`display: contents` on `.shelf__row` erases the row box from layout, so its `Card` children become direct grid items of `.shelf__grid` — the visual layout is byte-for-byte the prior single auto-fill grid while the DOM now carries faithful row semantics. Column count is read from the resolved template, not the old top-coordinate scan:

```ts
function countColumns(template: string): number {
  // Resolved value is space-separated track sizes ("150px 150px …").
  // "none" / unresolved repeat()/minmax() (jsdom) → fall back to 1.
  if (!template || template.includes('(')) return 1;
  return Math.max(1, template.split(' ').filter(Boolean).length);
}
```

jsdom has no `ResizeObserver` and no layout engine, so `columnCount` stays 1 there → one gridcell per row, Up/Down collapse to prev/next, and reading-order tests stay deterministic (matches the pre-existing fallback contract).

## Verification

**Commands:**
- `bun run test -- web/shelf/Shelf.test.tsx` -- expected: all shelf tests pass incl. new `chunkIntoRows` + row-grouping + reading-order cases.
- `bun run lint` -- expected: Biome clean (a11y `role` ignores preserved with justification).
- `bun run typecheck` -- expected: no type errors.

**Manual checks:**
- `bun run dev`, sign in: shelf still renders as one responsive auto-fill grid (desktop dense, phone 2-up); DOM shows multiple `role="row"` groups matching visible columns; arrow keys traverse reading order and Up/Down move by a visual row.

## Auto Run Result

Status: done

**Summary:** Fixed the shelf card grid ARIA structure (DW-4). Gridcells were all in a single `role="row"` while arrow-key nav moved in 2-D — AT announced a flat 1×N grid. Now `.shelf__grid` is the single auto-fill grid, `.shelf__row` groups use `display: contents` (visual layout unchanged), and the visible cards are chunked into `role="row"` groups whose width tracks the measured column count. Column count is read from the resolved `grid-template-columns` via a `ResizeObserver` (falls back to 1 in jsdom / no observer), replacing the per-keypress `getBoundingClientRect` scan. Reading-order (Left/Right/Home/End) traversal and the flat roving-tabindex focus index are preserved.

**Files changed:**
- `web/shelf/Shelf.tsx` -- exported pure `countColumns` + `chunkIntoRows`; `columnCount` state measured via `ResizeObserver`; render chunks cards into `role="row"` groups with a shared clamped `cols` for chunking + flat index.
- `web/shelf/shelf.css` -- moved grid layout onto `.shelf__grid`; `.shelf__row { display: contents; }`; responsive 2-up override moved to `.shelf__grid`.
- `web/shelf/Shelf.test.tsx` -- unit tests for `countColumns` + `chunkIntoRows`; component test asserting `role="row"` grouping + gridcell nesting under one `role="grid"`; reading-order traversal test retained.

**Review findings:** 1 patch applied (low — shared clamped `cols` for chunk + index consistency); 0 deferred; 2 rejected (`aria-rowcount`/`rowindex` out of scope; `display:contents` a11y-tree tradeoff). No intent_gap, no bad_spec — `review_loop_iteration` stays 0.

**Verification:**
- `bun run test` -- 273/273 pass (25 files), incl. 11 shelf tests.
- `bun run lint` -- Biome clean (108 files).
- `bun run typecheck` -- no errors.

**Residual risks:** The multi-column measurement path (`ResizeObserver` + resolved `getComputedStyle`) can't run in jsdom, so N×M grouping and resize re-chunking are covered by the pure `chunkIntoRows`/`countColumns` unit tests plus the row-nesting assertion, not end-to-end; worth a manual keyboard + screen-reader pass in a real browser. `display:contents` on `role="row"` relies on modern browsers keeping the role in the a11y tree.

### Review pass 2 (2026-07-08)

Independent Blind Hunter + Edge Case Hunter pass. 1 patch, 1 defer, 21 reject; no intent_gap, no bad_spec (`review_loop_iteration` stays 0).

- **Patch (low):** the new `describe` blocks had reparented the pre-existing `shows an alert…` test into `describe('chunkIntoRows')`; moved it back into `describe('Shelf')` (`web/shelf/Shelf.test.tsx`).
- **Defer (low):** resize re-chunk remounts the focused card → focus lost mid-resize (index-keyed rows; inherent to `display:contents` grouping). Logged to `deferred-work.md`.
- **Verification:** `bun run test -- web/shelf/Shelf.test.tsx` 11/11 pass; `bun run lint` Biome clean (108 files); `bun run typecheck` no errors.
- **Follow-up review:** not recommended — single localized low-severity test-grouping fix.
