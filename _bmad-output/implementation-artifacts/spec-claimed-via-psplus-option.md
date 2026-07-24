---
title: 'Claimed-via-PS+ option for manual ownership'
type: 'feature'
created: '2026-07-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'e7e3b915d741271725302669020a43df6c8cb2fe'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** PSN sync is removed, so PS+ claims are never auto-recorded. The buy-vs-claim prompt (Story 6.4) only fires for `psPlusExtra` catalog games — free Essential monthly games aren't in that catalog, so a manual own always writes `owned_via = purchase`, and an already-owned game has no purchase→membership correction path.

**Approach:** UI-only; API and core already accept `via: 'membership'`. (1) Drop the `psPlusExtra` gate: every manual own of a not-yet-owned game opens the existing buy-vs-claim dialog (card toggle and detail CTA both already render it). (2) In the detail panel's Ownership section, add a "Claimed with PS+" correction button for owned games whose `ownedVia` is not `membership`, mirroring the existing "I bought this" upgrade button.

## Boundaries & Constraints

**Always:**
- All writes go through the existing `setOwnership` seam in `useTrackingMutations` (AR-13) — no new mutation path.
- Downgrade to membership PRESERVES `bought_on` (write-once stands; server already never clears it). Claims never stamp `bought_on` (FR-9 amended).
- Un-own UNDO keeps restoring the previous `via` (existing behavior — don't regress).
- Dialog keeps its ARIA pattern (modal dialog via `useModalTrap`, focus restore) — WCAG nudge satisfied by reuse.
- No external service touched — anonymous local UI change, no risk flag needed.

**Ask First:** any server/core/schema change that turns out to be needed — the spec assumes zero.

**Never:**
- No new `owned_via` enum values; `purchase | membership` only.
- No changes to seed/backfill, settings, or the PS+ leaving-soon cron surfaces.
- No membership option on the un-own path or on type switches.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Own a non-PS+-catalog game | un-owned, `psPlusExtra: false`, activate own toggle/CTA | Buy-vs-claim dialog opens; no write until a choice | Cancel/Escape dismisses, no write |
| Choose "Claimed with PS+" | dialog open on un-owned game | `PATCH { owned: true, via: 'membership' }`; `owned_via = membership`, `bought_on` NOT stamped; toast "— owned" | existing onError toast |
| Correct owned purchase → claim | owned, `ownedVia: 'purchase'` or `null`, press new detail button | `PATCH { owned: true, via: 'membership' }`; `owned_via = membership`; `bought_on` untouched; toast "— claimed with PS+"; label flips to "Owned · via PS+" | existing onError toast |
| Already a claim | owned, `ownedVia: 'membership'` | Correction button not rendered ("I bought this" renders instead, unchanged) | N/A |
| Redundant re-own while owned | owned game, `{ owned: true, via }` | Writes straight through (no dialog — gate only applies to not-yet-owned) | N/A |

</frozen-after-approval>

## Code Map

- `web/shelf/useTrackingMutations.ts` -- `setOwnership` gate at line ~304 (`game.psPlusExtra` condition to drop); toast copy branch at ~338.
- `web/shelf/DetailPanel.tsx` -- Ownership section ~518–608: owned-via label, "I bought this" upgrade button (~558) the new button mirrors, un-owned CTA.
- `web/shelf/Card.tsx` -- own toggle (line 144) + already renders `OwnershipSourceDialog`; no code change expected.
- `web/shelf/OwnershipSourceDialog.tsx` -- reused as-is.
- `src/routes/tracking.ts`, `src/core/ownership.ts` -- already accept/handle `via: 'membership'`; read-only reference.
- `web/shelf/Card.test.tsx`, `web/shelf/DetailPanel.test.tsx`, `web/shelf/useTrackingMutations` coverage in `Shelf.test.tsx` -- existing tests assuming prompt-free own on non-PS+ games need updating.
- `playwright/e2e/epic6.spec.ts` -- existing buy-vs-claim e2e (PS+ game); pattern for new e2e.
- `playwright/COVERAGE.md` -- e2e coverage map.

## Placement Mock (UI-MOCK-GATE)

Detail panel, Ownership section — owned game, `ownedVia ≠ membership`:

```
Ownership
Owned · purchased            ← existing label
[physical] [digital]         ← existing type fieldset
[Claimed with PS+ — mark as PS+ claim]   ← NEW, sits where "I bought this" sits for claims
[Mark as not owned]          ← existing
```

Un-owned games and the shelf card: zero visual change — only the dialog now opens for every game.

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/useTrackingMutations.ts` -- drop `game.psPlusExtra` from the source-prompt gate (`change.owned === true && !game.owned`); add toast branch for `game.owned && change.via === 'membership'` → "claimed with PS+" -- the one shared seam fixes card + detail together.
- [x] `web/shelf/DetailPanel.tsx` -- render "Claimed with PS+" correction button when `game.owned && game.ownedVia !== 'membership'`, calling `setOwnership({ owned: true, via: 'membership' })`; keep type untouched -- mirror of the existing claim→purchase upgrade.
- [x] `web/shelf/Card.test.tsx` / `web/shelf/DetailPanel.test.tsx` / `web/shelf/Shelf.test.tsx` -- update tests assuming prompt-free own on non-PS+ games; add: dialog opens for `psPlusExtra: false`; correction button renders for purchase/null and not for membership; membership write sends `via: 'membership'`.
- [x] `playwright/e2e/epic6.spec.ts` -- e2e: (a) own a non-PS+ game → dialog → "Claimed with PS+" → D1 shows `owned_via = 'membership'`, `bought_on IS NULL`; (b) owned purchase with stamped `bought_on` → correction button → D1 shows `owned_via = 'membership'` AND `bought_on` unchanged (hazard test: downgrade preserves the date).
- [x] `playwright/COVERAGE.md` -- add/adjust rows for the new ACs.

**Acceptance Criteria:**
- Given any un-owned game (PS+ catalog or not), when the user activates "Mark as owned" (card toggle or detail CTA), then the buy-vs-claim dialog opens and no write happens until a choice; "Claimed with PS+" records `owned_via = membership` without stamping `bought_on`.
- Given an owned game with `ownedVia` of `purchase` or `null`, when the user opens the detail panel, then a "Claimed with PS+" button is shown; activating it sets `owned_via = membership`, preserves `bought_on`, shows a "claimed with PS+" toast, and the label reads "Owned · via PS+".
- Given an owned game with `ownedVia = membership`, when the detail panel renders, then only the existing "I bought this" upgrade button is shown (no membership button).
- Given the dialog is cancelled (button, Escape, or backdrop), when it closes, then no write occurred and focus is restored.

## Spec Change Log

## Verification

**Commands:**
- `bun run lint && bun run typecheck` -- expected: Biome + tsc clean
- `bun run test` -- expected: Vitest suite green including updated shelf tests
- `bun run test:e2e` -- expected: Playwright green including new epic6 cases

## Suggested Review Order

**Gate drop — every manual own now asks buy-vs-claim**

- The one-line gate change: `psPlusExtra` removed, prompt fires for any un-owned game
  [`useTrackingMutations.ts:307`](../../web/shelf/useTrackingMutations.ts#L307)

- New toast branch: a via-membership write on an owned game says "claimed with PS+"
  [`useTrackingMutations.ts:350`](../../web/shelf/useTrackingMutations.ts#L350)

**Purchase→claim correction button (detail panel)**

- The new button: `via: 'membership'`, digital seed for NULL-type rows (mirror of "I bought this")
  [`DetailPanel.tsx:584`](../../web/shelf/DetailPanel.tsx#L584)

- Pill style, electric tint variant of the upgrade button
  [`detail-panel.css:413`](../../web/shelf/detail-panel.css#L413)

**Hazard tests**

- Core: downgrade preserves stamped `bought_on` (write-once in both directions)
  [`ownership.test.ts:51`](../../src/core/ownership.test.ts#L51)

- E2E: non-PS+ own → prompt → claim → D1 `owned_via='membership'`, no `bought_on`
  [`epic6.spec.ts:605`](../../playwright/e2e/epic6.spec.ts#L605)

- E2E: correction preserves a seeded historic `bought_on`
  [`epic6.spec.ts:645`](../../playwright/e2e/epic6.spec.ts#L645)

**Peripherals**

- jsdom: NULL-type correction sends `ownershipType: 'digital'`; membership row hides the button
  [`DetailPanel.test.tsx:839`](../../web/shelf/DetailPanel.test.tsx#L839)

- Card/Shelf tests rerouted through the now-ungated prompt
  [`Card.test.tsx:479`](../../web/shelf/Card.test.tsx#L479)

- Coverage map rows for the new ACs
  [`COVERAGE.md:163`](../../playwright/COVERAGE.md#L163)
