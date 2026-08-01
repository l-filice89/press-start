---
title: 'Catalog responsive filter sheet'
type: 'bugfix'
created: '2026-08-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'fcfdd0d57360c0203170420fcd32ebf5a6c29f1a'
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Catalog exposes every genre pill above the grid on phones, consuming most of the initial viewport and contradicting Shelf behavior plus the responsive UX spine.

**Approach:** Give Catalog the same responsive disclosure model as Shelf: at 600px and below, show one `Filters` trigger and move the genre multiselect into a live bottom-sheet dialog; above 600px, use one inline Genre dropdown. Preserve Catalog's URL-backed filtering and server result count.

## Boundaries & Constraints

**Always:** Use PS-store facet keys and localized labels; preserve repeated `genre` URL parameters, `q`, replace-history behavior, OR semantics, active filter count, genre counts, selected keys absent from the vocabulary, and failed-vocabulary recovery. Phone sheet follows the WAI-ARIA modal dialog pattern: labeled `role="dialog"`, `aria-modal`, trapped focus, Escape/backdrop dismissal, body scroll lock, trigger-focus return, and automatic close when viewport crosses above 600px. Options expose pressed/checked state without color alone. Filters apply live; settled result count drives `Show N games`, while an in-flight request shows an honest updating state instead of stale N.

**Ask First:** Any extraction or redesign of Shelf filter primitives; any breakpoint change from the existing 600px contract.

**Never:** No API, repository, schema, query-contract, search, ordering, paging, or card changes. No IGDB genre vocabulary. No duplicated local filter state that can drift from the URL. No phone-visible inline genre wall. No stale result count presented as current.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Phone, no selection | width <=600px | One `Filters` button; inline genres hidden; genre-only sheet opens | N/A |
| Phone, live selection | Horror toggled in sheet | URL/query/grid update while sheet stays open; settled CTA says `Show N games`; trigger later says `Filters — 1 active` | CTA shows updating state during fetch |
| Desktop | width >600px | Sheet trigger hidden; one inline Genre menu exposes multiselect options | N/A |
| Deep-linked orphan | selected key absent from vocabulary | Active selection stays named, visible, and removable on both surfaces | Never strand hidden filter |
| Vocabulary failure | genre request fails | Existing alert and selected-filter escape hatch remain reachable in phone sheet and desktop menu | Refresh guidance remains visible |
| Breakpoint crossing | open phone sheet becomes >600px | Sheet closes and desktop control becomes authoritative | Restore scroll/focus safely |

</frozen-after-approval>

## Code Map

- `web/catalog/Catalog.tsx` -- URL-backed genre controller, responsive filter surfaces, remote total, and result announcement.
- `web/catalog/catalog.css` -- current all-width pill row; add desktop/menu and phone trigger/sheet breakpoint rules.
- `web/components/useModalTrap.ts` -- shared modal focus/Escape machinery already used by Shelf.
- `web/shelf/FilterRow.tsx` -- behavioral reference for portal, scroll lock, breakpoint close, active badge, and focus return; do not broaden it.
- `web/catalog/Catalog.test.tsx` -- existing hazards for focus-preserving fetches, orphan keys, vocabulary failure, and announcements.
- `playwright/e2e/epic7-catalog.spec.ts` -- existing desktop Catalog genre flow; add real phone viewport coverage.
- `playwright/COVERAGE.md` -- Story 7.2c evidence ledger.

## Tasks & Acceptance

**Execution:**
- [x] `web/catalog/Catalog.tsx` -- replace all-width genre fieldset with a Catalog-local responsive controller: desktop ARIA menu-button multiselect and phone modal sheet, both operating directly on URL state; pass settled/fetching totals without stale-count claims.
- [x] `web/catalog/catalog.css` -- implement the existing <=600px disclosure contract and Shelf-equivalent bottom-sheet placement using Catalog-owned selectors.
- [x] `web/catalog/Catalog.test.tsx` -- pin modal semantics, live shared state, updating/settled count, focus trap/Escape/return, orphan selection, failure recovery, and breakpoint close.
- [x] `playwright/e2e/epic7-catalog.spec.ts` -- preserve desktop genre filtering and add 375x667 flow proving hidden inline controls, live sheet filtering, URL key, count, badge, close, and resulting cards.
- [x] `playwright/COVERAGE.md` -- amend 7.2c with desktop and phone evidence.

**Acceptance Criteria:**
- Given Catalog at phone width, when it renders, then only one `Filters` trigger occupies the filter row and genre options live in a bottom-sheet dialog above the grid.
- Given the phone sheet, when a genre changes, then URL and results update live, active count remains accessible, and `Show N games` closes only with a settled current count.
- Given Catalog above 600px, when filters render, then the sheet trigger is hidden and one keyboard-operable Genre multiselect is inline.
- Given the dialog is open, when focus moves, Escape/backdrop is used, or the breakpoint changes, then modal focus, dismissal, scroll restoration, and trigger return follow the Shelf pattern.

## Spec Change Log

## Design Notes

User-supplied Shelf/Catalog phone photos are the signed-off placement mock. Keep implementation Catalog-local: Shelf's sheet and dropdown are private and coupled to `ShelfFilter`; reuse `useModalTrap` and behavior, not feature-private state or CSS.

## Verification

**Commands:**
- `bun run lint && bun run typecheck` -- expected: clean.
- `bunx vitest run web/catalog/Catalog.test.tsx` -- expected: responsive controller and existing Catalog hazards green.
- `bunx playwright test playwright/e2e/epic7-catalog.spec.ts` -- expected: desktop and phone Catalog flows green.
- `bun run test` -- expected: full Vitest suite green.

## Review Triage Log

### 2026-08-01 — Blind Hunter + Edge Case Hunter

- intent_gap: 0
- bad_spec: 0
- patch: 8 (medium 6, low 2)
- defer: 0
- rejected: inert-background redesign outside the approved Shelf-equivalent modal pattern; findings whose cited snippets did not exist in the diff
- addressed: stale inline count, hidden-trigger breakpoint focus, pending-vocabulary labeling/focus, menu focus on resize/scroll and disappearing controls, pending-sheet dismissal, duplicate URL values, and real-browser breakpoint coverage

## Auto Run Result

- `bun run lint` -- clean.
- `bun run typecheck` -- clean.
- `bunx vitest run web/catalog/Catalog.test.tsx` -- 16/16 passed.
- `bunx playwright test playwright/e2e/epic7-catalog.spec.ts` -- 14/14 passed.
- `bun run test` -- 77 files, 2073 tests passed.

## Suggested Review Order

**Responsive controller**

- Start here: URL-backed state feeds both responsive surfaces and honest remote counts.
  [`Catalog.tsx:39`](../../web/catalog/Catalog.tsx#L39)

- Phone and desktop controls share options without duplicating filter state.
  [`Catalog.tsx:269`](../../web/catalog/Catalog.tsx#L269)

**Interaction patterns**

- Desktop menu provides checkbox semantics, roving focus, and resilient async vocabulary handling.
  [`Catalog.tsx:370`](../../web/catalog/Catalog.tsx#L370)

- Phone dialog owns live filtering, dismissal, scroll lock, and breakpoint focus handoff.
  [`Catalog.tsx:564`](../../web/catalog/Catalog.tsx#L564)

- Catalog-owned CSS switches surfaces at the existing 600px contract.
  [`catalog.css:36`](../../web/catalog/catalog.css#L36)

- Bottom-sheet geometry mirrors Shelf without coupling feature-private selectors.
  [`catalog.css:162`](../../web/catalog/catalog.css#L162)

**Verification**

- Unit hazards cover stale counts, modal focus, failures, duplicates, and late vocabulary.
  [`Catalog.test.tsx:339`](../../web/catalog/Catalog.test.tsx#L339)

- Browser test pins real phone placement and desktop breakpoint focus transfer.
  [`epic7-catalog.spec.ts:200`](../../playwright/e2e/epic7-catalog.spec.ts#L200)

- Coverage ledger maps responsive behavior to its executable evidence.
  [`COVERAGE.md:308`](../../playwright/COVERAGE.md#L308)
