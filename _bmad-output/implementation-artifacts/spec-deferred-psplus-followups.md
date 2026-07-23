---
title: 'Deferred follow-ups: add-as-claimed + factory bought_on knob'
type: 'feature'
created: '2026-07-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: '80e9eb3c69a974400930b75c67618936c520ec38'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two deferred items from spec-claimed-via-psplus-option. (A) AddGameDialog's "Add as owned" is the one manual-own entry point that never asks buy-vs-claim — it silently writes `owned_via = purchase` and stamps a made-up `bought_on`, wrong twice for a claimed Essential title added by name. (B) E2E tests hand-write `UPDATE game_tracking SET bought_on = …` because the game factory has no `bought_on` knob.

**Approach:** (A) Thread an acquisition source through the add flow: when "I own this game" is checked, the dialog shows an inline Purchased / Claimed-with-PS+ radio pair (default Purchased); the add payload carries `via`, and the server's new-tracking default branches on it — membership writes `owned_via = 'membership'` and NEVER stamps `bought_on`. (B) Add `boughtOn` to the e2e game factory's tracking block, wire it into the seed INSERT, replace the raw UPDATE.

## Boundaries & Constraints

**Always:**
- Membership never stamps `bought_on`; purchase keeps stamping today (FR-43 / FR-9 amended).
- Catalog adds stay refused as owned adds (`owned` + `psnProductId` refine, review H1) — the source radio, like the checkbox, is hidden for `fromProduct`; `via` alongside `psnProductId` must not open a bypass (TEST-THE-BYPASS: the refine must still refuse with `via` present).
- Native `<input type="radio">` pair, one `name`, wrapped in a labelled group — WCAG radio-group pattern via native semantics, no custom widget.
- No external service touched — local UI/API/test-infra change.

**Ask First:** any schema/migration change (none expected — `owned_via` column exists).

**Never:**
- No source prompt dialog stacked on the add modal (inline radio only).
- No `via` on wishlist adds (`owned: false` sends no `via`; server ignores/refuses it).
- No factory changes beyond the `boughtOn` knob (discarded flag etc. stay raw SQL).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add as owned, Purchased (default) | checkbox on, radio untouched, Save | POST carries `via: 'purchase'` (or omits it); tracking row: `owned_via = purchase`, `bought_on` = today | existing onError toast |
| Add as owned, Claimed with PS+ | checkbox on, claim radio, Save | POST carries `via: 'membership'`; row: `owned_via = membership`, `bought_on` NULL | existing onError toast |
| Uncheck owned after picking claim | checkbox off, Save | Wishlist add, no `via` sent; row: not owned, `wishlisted_on` today | N/A |
| Catalog add (`fromProduct`) | `psnProductId` present | Checkbox AND radios hidden; `owned`/`via` never sent; server refine still refuses `owned`+`psnProductId` even with `via` | 400 at boundary |
| Duplicate title (409 path) | owned+claim on an existing game | Unchanged duplicate flow (opens existing detail); no tracking overwrite | existing |
| E2E seeds `boughtOn` | `createGame({ tracking: { boughtOn: '2023-12-25' } })` | Seed INSERT writes the date; no raw UPDATE needed | N/A |

</frozen-after-approval>

## Code Map

- `web/shelf/AddGameDialog.tsx` -- owned checkbox (~321), `save()` payload (~153), CTA label (~350); radio pair goes under the checkbox.
- `web/shelf/api.ts` -- `AddGamePayload` type gains optional `via`.
- `src/routes/games.ts` -- add schema (~107): optional `via: z.enum(['purchase','membership'])`; refine (~123) must also cover `via`-carrying bodies.
- `src/services/games.ts` -- `AddGameInput` + `newTracking(owned, today)` (~199): branch on `via`, membership omits `boughtOn`; three call sites (~384, ~427, ~448) thread it.
- `playwright/support/factories/game-factory.ts` -- tracking block gains `boughtOn: string | null` (default null).
- `playwright/support/helpers/d1.ts` -- seed INSERT gains the `bought_on` column.
- `playwright/e2e/epic6.spec.ts:660` -- raw UPDATE replaced by the factory knob.
- `test/integration/games.test.ts:183` -- existing FR-43 owned-add test; sibling for the membership branch.
- `web/shelf/AddGameDialog.test.tsx` (if exists) / dialog tests -- radio rendering + payload assertions.
- `playwright/COVERAGE.md` -- rows for the new ACs.

## Placement Mock (UI-MOCK-GATE)

Add-game dialog, fields column — only when the owned checkbox is ticked (and never for catalog adds):

```
[x] I own this game
    ( •) Purchased            ← NEW inline radio pair, indented under
    ( ) Claimed with PS+         the checkbox; default Purchased
[Cancel]  [Add as owned]      ← CTA unchanged
```

Unchecked box / catalog add: dialog looks exactly as today.

## Tasks & Acceptance

**Execution:**
- [x] `src/services/games.ts` -- `AddGameInput.via?: OwnedVia`; `newTracking(owned, today, via)`: membership → `{ owned, playStatus, ownedVia: 'membership' }` with NO `boughtOn`; thread through the three call sites -- server truth first.
- [x] `src/routes/games.ts` -- add optional `via` to the add schema; extend the H1 refine so `psnProductId` + `owned` stays refused regardless of `via` -- boundary mirrors the service.
- [x] `web/shelf/api.ts` + `web/shelf/AddGameDialog.tsx` -- `via` state (default `'purchase'`), radio pair rendered only when `owned && !fromProduct`, payload sends `via` only when owned -- smallest UI diff.
- [x] `test/integration/games.test.ts` -- membership sibling of the FR-43 test: add-as-claimed writes `owned_via = membership`, `bought_on` NULL (hazard test); refine still 400s `owned`+`psnProductId`+`via`.
- [x] `playwright/support/factories/game-factory.ts` + `playwright/support/helpers/d1.ts` -- `boughtOn` knob wired into the seed INSERT.
- [x] `playwright/e2e/epic6.spec.ts` -- replace the raw UPDATE with the knob; e2e: add-by-name as claimed → D1 `owned_via='membership'`, `bought_on IS NULL`.
- [x] `playwright/COVERAGE.md` -- rows for the new ACs.
- [x] Dialog unit tests -- radios appear only when owned (and not fromProduct); claim selection changes the payload; unchecking owned drops `via`.

**Acceptance Criteria:**
- Given the add dialog with "I own this game" checked, when the user picks "Claimed with PS+" and saves, then the new row has `owned_via = 'membership'` and `bought_on` NULL.
- Given the same dialog with the radio untouched, when the user saves, then the row has `owned_via = 'purchase'` and `bought_on` = today (unchanged FR-43).
- Given a catalog add (`psnProductId` present), when the dialog renders, then neither checkbox nor radios appear, and the server still refuses any `owned` add for it (with or without `via`).
- Given a test seeding `tracking.boughtOn`, when `seedGames` runs, then the row carries that date with no raw SQL in the spec file.

## Spec Change Log

## Verification

**Commands:**
- `bun run lint && bun run typecheck` -- expected: clean
- `bun run test` -- expected: Vitest green including new integration cases
- `bunx playwright test epic6` -- expected: green including the new add-as-claimed case

## Suggested Review Order

**Server: `via` through the add flow**

- `newTracking` branches on the source — membership never emits `boughtOn`
  [`games.ts:207`](../../src/services/games.ts#L207)

- Boundary: optional `via` in the add schema; new refine refuses `via` without `owned: true` (H1 doctrine)
  [`games.ts:133`](../../src/routes/games.ts#L133)

**Dialog: inline source radios**

- Radio pair with visible legend, only when `owned && !fromProduct`; uncheck resets to purchase
  [`AddGameDialog.tsx:346`](../../web/shelf/AddGameDialog.tsx#L346)

**Hazard tests**

- Server: claimed add → `owned_via = membership`, `bought_on` NULL; explicit-purchase twin; stray-`via` 400
  [`games.test.ts:204`](../../test/integration/games.test.ts#L204)

- E2E: add-by-name as claimed → D1 membership row, no `bought_on`
  [`epic6.spec.ts:139`](../../playwright/e2e/epic6.spec.ts#L139)

**Factory knob**

- `boughtOn` in the tracking seed shape; raw UPDATE in the downgrade test replaced
  [`game-factory.ts:32`](../../playwright/support/factories/game-factory.ts#L32)

**Peripherals**

- jsdom: radios render/absence, claim payload, uncheck drops `via`
  [`AddGameDialog.test.tsx:304`](../../web/shelf/AddGameDialog.test.tsx#L304)

- Coverage row for the new ACs
  [`COVERAGE.md:165`](../../playwright/COVERAGE.md#L165)
