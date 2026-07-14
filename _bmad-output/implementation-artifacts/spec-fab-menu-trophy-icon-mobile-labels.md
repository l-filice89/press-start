---
title: 'FAB menu: reuse the platinum trophy icon for trophy sync, show item labels on mobile'
type: 'feature'
created: '2026-07-14'
status: 'done'
baseline_commit: '1f3e676344bf9b9f104dc00b8ce6679e2a33caf2'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The trophy-sync FAB item uses a generic `★` glyph instead of the app's own platinum trophy icon, and on phones the FAB drawer shows icons only — which the user finds unclear, so the item's meaning is guessable at best.

**Approach:** Reuse the existing `PlatinumTrophy` SVG (today a private function in `Card.tsx`) as the trophy-sync item's icon, and show the FAB item text labels on all viewports including mobile. This deliberately overrides the documented "icons-only on mobile" FAB decision; update the UX doc so it stops contradicting the code.

## Boundaries & Constraints

**Always:** One source of truth for the trophy icon — extract `PlatinumTrophy` to a shared component and import it in both `Card.tsx` and `Fab.tsx`, unchanged in appearance (stroke-only neon-outline, `currentColor`, `aria-hidden`). Preserve the card's existing `data-testid="platinum-trophy"` and every FAB `data-testid` and `aria-label`. Labels stay legible: the drawer must not overflow the viewport width on a small phone.

**Ask First:** —

**Never:** Do not restyle the icon or the card's platinum badge. Do not change any FAB behavior (mutations, spinners, disabled state, drawer open/close). Do not touch the other FAB icons or add a label to the round toggle. Do not duplicate the `platinum-trophy` testid — only the card carries it (a full-app render must not end up with two).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Trophy item, idle | Drawer open, not syncing | Renders the `PlatinumTrophy` SVG + the text label "Sync trophies" | N/A |
| Trophy item, running | `trophies.isPending` | Spinner replaces the icon (unchanged), label reads "Syncing trophies…" | N/A |
| Phone width | viewport ≤ 600px, drawer open | Every item shows icon **and** label; drawer stays within the viewport, clear of the bottom search bar | N/A |
| Card platinum badge | game with a platinum milestone | Card renders the same shared icon with `data-testid="platinum-trophy"`, visually identical to today | N/A |

</frozen-after-approval>

## Code Map

- `web/shelf/Card.tsx` -- holds `PlatinumTrophy()` (L14-41) used at L100 for the platinum flag glyph. Remove the local function; import the shared one and pass `data-testid="platinum-trophy"` so `Card.test.tsx:140` still resolves.
- `web/components/PlatinumTrophy.tsx` -- **NEW.** The extracted SVG, verbatim, accepting spread props (so the card can pass its testid, the FAB can pass nothing). Keep the explanatory comment about the outline style.
- `web/shell/Fab.tsx` -- the trophy-sync item (L209-233): swap the `'★'` glyph branch for `<PlatinumTrophy />`; the spinner branch and label are unchanged. Update the L20 component comment ("icons-only on phone") to match the new behavior.
- `web/shell/fab.css` -- delete the `@media (max-width: 600px) { .fab__item-label { display: none } }` rule (L92-95 region) so labels show on mobile; KEEP the `.fab { bottom: … + 64px }` phone rule that clears the search bar.
- `web/shelf/card.css` -- no change expected (the icon sizing lives on the SVG + `.card__flag`); confirm the shared icon still renders identically.
- `_bmad-output/planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md` -- the FAB line (L39) and the responsive table row (L125, "FAB drawer | Icons only | Icons + text") now read icons+text on both; note it was a deliberate change (date).
- `web/shell/Fab.test.tsx`, `web/shelf/Card.test.tsx` -- assert via testids/labels (not the glyph), so they should stay green; add/confirm a check that the FAB trophy item renders the shared icon.

## Tasks & Acceptance

- [x] `web/components/PlatinumTrophy.tsx` -- extract the SVG verbatim as a shared component that spreads props onto the `<svg>` -- one icon, two call sites.
- [x] `web/shelf/Card.tsx` -- import the shared icon, pass `data-testid="platinum-trophy"`, delete the local copy -- no visual or test change for the card.
- [x] `web/shell/Fab.tsx` -- render `<PlatinumTrophy />` for the idle trophy-sync icon; reword the stale component comment -- the item now carries the app's own trophy mark.
- [x] `web/shell/fab.css` -- drop the mobile label-hiding rule, keep the search-bar clearance -- labels legible on phones.
- [x] `EXPERIENCE.md` -- update the FAB rows to icons+text on all sizes -- docs stop contradicting the shipped UI.
- [x] `web/shell/Fab.test.tsx` -- add/confirm the trophy item renders the shared icon (e.g. the `platinum-trophy` SVG is absent-by-testid on the FAB but the item is present) and the label text shows -- pins the swap.

**Acceptance Criteria:**
- Given the FAB drawer is open and no sync is running, when the trophy-sync item renders, then it shows the `PlatinumTrophy` SVG (not `★`) and the label "Sync trophies".
- Given a phone-width viewport, when the drawer opens, then every item shows both its icon and its text label, and the drawer does not overflow horizontally.
- Given a card with a platinum milestone, when it renders, then the platinum badge is visually identical to today and `getByTestId('platinum-trophy')` still resolves to exactly one element.

## Verification

**Commands:**
- `bun run lint` + `bun run typecheck` -- clean.
- `bun run test` -- green, including `Fab.test.tsx` and `Card.test.tsx`.

**Manual checks:**
- Narrow the browser to ≤600px, open the FAB: each item shows icon + label, no horizontal overflow, drawer clears the bottom search bar. The trophy item shows the outline trophy, matching the card's platinum badge.

## Spec Change Log

### 2026-07-14 — Review pass (Blind Hunter + Edge Case Hunter)

No intent_gap or bad_spec — no loopback. Patches applied (all low): added a `max-width` + label-ellipsis overflow guard to `fab.css` so the spec's "must not overflow on a small phone" AC is literally satisfied (the Edge Case Hunter confirmed the vertical column of content-width pills does not overflow in practice; the guard is cheap insurance); strengthened the Fab test to assert the FAB trophy item has NO `platinum-trophy` testid (the real single-id invariant) instead of a tautological "no ★"; fixed stale "icons-only mobile" text in `DESIGN.md`, `epics.md` UX-DR10 and UX-DR26 (only `EXPERIENCE.md` was updated in the first pass). One deferred: the card's fixed `platinum-trophy` testid would collide under `getByTestId` with 2+ platinum cards — pre-existing, latent, logged. Rejected: the component's own `aria-hidden` default (correct for a decorative mark), and the FAB-vs-card glow difference (the card badge is unchanged; the FAB is a new placement).

## Suggested Review Order

**The icon swap (design intent)**

- Shared stroke-only trophy mark, spread props so callers add their own testid.
  [`PlatinumTrophy.tsx:11`](../../web/components/PlatinumTrophy.tsx#L11)

- FAB trophy-sync item now renders the shared SVG instead of the `★` glyph.
  [`Fab.tsx:228`](../../web/shell/Fab.tsx#L228)

- Card imports the shared icon and keeps its `platinum-trophy` testid (sole owner).
  [`Card.tsx:67`](../../web/shelf/Card.tsx#L67)

**Mobile labels**

- Dropped the label-hiding media rule; added a max-width + ellipsis overflow guard.
  [`fab.css:43`](../../web/shell/fab.css#L43)

**Test**

- Pins the swap and the single-testid invariant.
  [`Fab.test.tsx:89`](../../web/shell/Fab.test.tsx#L89)
