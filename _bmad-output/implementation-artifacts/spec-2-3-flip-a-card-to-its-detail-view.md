---
title: 'Story 2.3: Flip a card to its detail view'
type: 'feature'
created: '2026-07-09'
status: 'done'
baseline_revision: '1c4282279d52cf774553891c9c7106d68438055b'
final_revision: '9c485fca1b38cadf542348f8849fa5f1ed551ce9'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/project-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** A card's cover is inert — there is no way to see one game whole (dates, genres, ownership, store link) or to correct it in one place. Clearing a play status manually (allowed once a milestone exists) has no write path, and the completion invariant (FR-3) is enforced nowhere.

**Approach:** Make the cover open a focus-trapped detail dialog (flip-then-grow; full-screen mobile, ~760px desktop) fed entirely from the card DTO already in the query cache — no new read endpoint. The panel reuses the exact status/milestone mutation logic from 2.1/2.2 via a shared hook, adds a segmented play-status control including a milestone-gated "Clear status", and the PATCH route learns `playStatus: null` behind the completion-invariant guard at the API boundary.

## Boundaries & Constraints

**Always:**
- **The completion invariant is enforced at the API boundary** (AR-12/FR-3): `PATCH play-status` with `playStatus: null` is refused with `409 {"error":"completion invariant"}` unless a completion milestone exists. The service decides via the existing `wouldViolateCompletionInvariant` core predicate — the UI hiding the control is not the enforcement.
- Clearing to null goes through the same single core status-transition function and the same route as any status write; no second write path. Clearing never stamps or touches any date.
- The panel reuses 2.1/2.2 logic: the same mutations (changePlayStatus / logMilestone), the same `ConfirmDialog` gate for milestones, the same `['shelf']` invalidation. Extract the popover's mutation logic into one shared hook; neither surface hand-rolls its own transition (AR-13/AR-21).
- The panel is a focus-trapped `role="dialog"` (`aria-modal`, labelled by the game title): focus moves in on open, Tab cycles inside, Escape/close returns focus to the originating card's gridcell (UX-DR19).
- Flip-then-grow entry animation; `prefers-reduced-motion` replaces it with a fast cross-fade (no motion). Full-screen on mobile, centered ~760px on desktop.
- Wishlisted (= not owned) games show "View on PS Store": `storeUrl` when known, else `https://store.playstation.com/search/<encoded title>` (FR-16). Rendered from persisted data only — no third-party call on any read or edit path (NFR-3).
- The card DTO is the panel's data source: extend it with `startedOn`, `boughtOn`, `wishlistedOn`, `ownershipType` (server bake, both Zod schemas, fixtures). No detail endpoint.
- Every control keyboard-operable; the cover trigger has an accessible name; touch targets ≥44×44 via existing hit-area classes; toasts/announcements ride the existing live region.

**Block If:**
- Reusing the milestone/status logic requires changing the `<intent-contract>` of 2.1/2.2 behavior (it doesn't: extraction is a refactor, behavior identical).

**Never:**
- No editing of ownership flag/type, lifecycle dates, or genres — display only (Stories 2.4/2.5). No clearing of milestones (2.4 owns date edits under FR-45).
- No DB migration, no new repository query, no third-party fetch.
- Do not remove or bypass the shelf popover — both surfaces stay live and share the hook.
- Do not recompute effective state client-side; after any write the shelf query refetches (AD-7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open detail | tap/click non-control cover area | Panel opens as focus-trapped dialog showing status control, milestone rows + dates, lifecycle dates, genres, ownership, (store link if wishlisted) | No error expected |
| Keyboard open | gridcell focused → Enter → Tab to cover → Enter | Same panel; close returns focus to the gridcell | No error expected |
| Clear status, milestone exists | `playStatus: 'Playing'`, `completedOn` set; user clears | `play_status = null`, effective state becomes the milestone; toast | No error expected |
| Clear status, no milestone | `playStatus: 'Paused'`, no milestones; PATCH `{"playStatus":null}` | Row unchanged | `409 {"error":"completion invariant"}`; panel explains ("set a status or log a milestone first" — control hidden anyway) |
| Set status from panel | segmented control selection | Identical semantics to the shelf popover (incl. `started_on` write-once, Dropped UNDO toast) | Same as 2.1 |
| Log milestone from panel | milestone row → ConfirmDialog → confirm | Identical semantics to 2.2 (write-once, status auto-clear, no UNDO) | Same as 2.2 |
| Escape / close button | panel open | Panel closes, nothing written, focus returns to the originating card | No error expected |
| Reduced motion | `prefers-reduced-motion: reduce` | Cross-fade, no flip/grow transform | No error expected |
| Wishlisted, no storeUrl | `owned: false`, `storeUrl: null` | Store link points at the PS Store search URL for the title | No error expected |
| Owned game | `owned: true` | No store link section | No error expected |

</intent-contract>

## Code Map

- `src/core/status-transition.ts` -- extend `applyPlayStatusChange` to accept `next: PlayStatus | null` (clear = no stamp, ever).
- `src/core/completion-invariant.ts` -- `wouldViolateCompletionInvariant` predicate, already built for this boundary. Reuse.
- `src/services/tracking.ts` -- `changePlayStatus`: accept null + invariant refusal signal.
- `src/routes/tracking.ts` -- PATCH body schema gains `.nullable()`; 409 on refusal.
- `src/repositories/games.ts` -- `LibraryRow` + `listLibraryForUser` select: add the 4 tracking fields.
- `src/services/shelf.ts` / `src/routes/shelf.ts` -- `ShelfGame` DTO + Zod: add the 4 fields.
- `web/shelf/api.ts` -- client schema mirror + `changePlayStatus(gameId, status | null)`.
- `web/shelf/StatusPopover.tsx` -- source of the mutation/toast logic to extract; keeps identical behavior via the hook.
- `web/shelf/useTrackingMutations.ts` -- **new**: shared hook (status mutation incl. UNDO/in-flight guard, milestone confirm state + mutation).
- `web/shelf/DetailPanel.tsx` + `detail-panel.css` -- **new**: the dialog.
- `web/shelf/Card.tsx` -- cover becomes the open-detail trigger; hosts the panel + originating-focus return.
- `web/shelf/Shelf.tsx` -- widget-mode Tab cycle inside the cell (pill ↔ cover), Enter unchanged (pill first).
- `web/components/ConfirmDialog.tsx` -- reused as-is by the hook.
- `web/tokens.css` -- `--z-overlay`, milestone silver, spacing/radius tokens; `web/components/hit-area.css` -- `tap-target`/`tap-expander`.
- `test/integration/tracking.test.ts` -- clear-status + invariant-refusal route coverage.
- `web/shelf/StatusPopover.test.tsx`, `Card.test.tsx`, `Shelf.test.tsx`, `SearchBox.test.tsx` -- existing contracts to keep green (fixtures gain 4 fields).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/status-transition.ts` -- `next: PlayStatus | null`; `stampStart` only when `next === 'Playing'` (a null next never stamps). Patch type `playStatus: PlayStatus | null` -- one function still owns every status write (AR-13).
- [x] `src/core/status-transition.test.ts` -- add: clear leaves every date untouched and stamps nothing.
- [x] `src/services/tracking.ts` -- `changePlayStatus(db, userId, gameId, next: PlayStatus | null, today)`: when `next === null` and `wouldViolateCompletionInvariant({ playStatus: null, completedOn, platinumOn })`, return the refusal signal `'invariant'` without writing; keep `null` = not-found. **Named hazard: the API refuses the edit — assert red-then-green.**
- [x] `src/routes/tracking.ts` -- body `z.enum(PLAY_STATUSES).nullable()`; map `'invariant'` → `409 {"error":"completion invariant"}`.
- [x] `test/integration/tracking.test.ts` -- clear-with-milestone happy path (status null, effective state = milestone, dates untouched); clear-without-milestone → 409 and row unchanged (through the route, real session); existing 5-status behavior unchanged.
- [x] `src/repositories/games.ts` -- add `startedOn`, `boughtOn`, `wishlistedOn`, `ownershipType` to `LibraryRow` + select.
- [x] `src/services/shelf.ts`, `src/routes/shelf.ts`, `web/shelf/api.ts` -- carry the 4 fields through DTO + both Zod schemas; `changePlayStatus` accepts `PlayStatus | null`.
- [x] `web/shelf/useTrackingMutations.ts` -- Extract from `StatusPopover`: status mutation (onError toast, `['shelf']` invalidation, Dropped-UNDO toast, in-flight guard + "Still saving" toast) and milestone flow (confirming state, ConfirmDialog wiring, no-UNDO toast, achieved-row feedback). `StatusPopover` behavior byte-identical — its test suite must pass unmodified except fixtures.
- [x] `web/shelf/StatusPopover.tsx` -- consume the hook; no behavior change.
- [x] `web/shelf/DetailPanel.tsx` + `detail-panel.css` -- Focus-trapped labelled dialog over a backdrop (same trap/Escape/backdrop-cancel technique as `ConfirmDialog`, generalized to N focusables): cover + title header; play-status segmented control (`radiogroup`, 5 statuses via the hook) plus a "Clear status" action rendered **only when** `hasCompleted || hasPlatinum`; milestone rows + dates (confirm-gated via the hook, achieved rows disabled with date); read-only lifecycle dates (wishlisted/bought/started/completed/platinum, "—" when null); genres; ownership flag + type; "View on PS Store" when `!owned` (`storeUrl` ?? search URL, `target="_blank" rel="noopener"`); close button. Flip-then-grow entry (CSS transform), cross-fade under `prefers-reduced-motion`; full-screen `<760px`, centered otherwise.
- [x] `web/shelf/Card.tsx` -- wrap the cover in a button (`tabIndex={-1}`, accessible name `Open details — <title>`, class-based hook like the pill); mount `DetailPanel` on activation; on close, refocus the owning gridcell.
- [x] `web/shelf/Shelf.tsx` -- inside widget mode, Tab on the pill (menu closed) moves to the cover button and Tab/Shift+Tab cycle between them; Escape from either returns to the gridcell; Enter-on-cell → pill stays as-is (2.1 contract).
- [x] `web/shelf/DetailPanel.test.tsx` -- dialog ARIA contract + trap; opens from cover click and keyboard; Escape/close returns focus to gridcell; segmented control fires the same PATCH; Clear only rendered with a milestone and clears; milestone row confirm-gated; store link logic (url / search fallback / hidden when owned); reduced-motion class switch.
- [x] `web/shelf/Card.test.tsx`, `web/shelf/Shelf.test.tsx`, `web/shelf/SearchBox.test.tsx`, `web/shelf/StatusPopover.test.tsx` -- fixtures gain the 4 fields; add the cover-trigger + in-cell Tab-cycle assertions.

**Acceptance Criteria:**
- Given a card, when the user activates a non-control area of the cover (pointer or keyboard), then a focus-trapped detail dialog opens showing status control, milestone rows with dates, lifecycle dates, genres, and ownership.
- Given the panel is open, when the user closes it (Escape, close button, backdrop), then nothing extra is written and focus returns to the originating card.
- Given a game with a milestone, when the user clears its play status from the panel, then the effective state falls back to the milestone everywhere after refetch.
- Given a game with no milestone, when a `playStatus: null` PATCH reaches the API by any means, then it is refused with 409 and the row is unchanged.
- Given the panel and the shelf popover, when either writes a status or milestone, then both go through the same shared logic and the shelf reflects the result identically.
- Given `prefers-reduced-motion: reduce`, when the panel opens, then it cross-fades without flip/grow motion.

## Spec Change Log

## Review Triage Log

### 2026-07-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 1, medium 3, low 5)
- defer: 1: (high 0, medium 0, low 1)
- reject: 6: (high 0, medium 1, low 5)
- addressed_findings:
  - `[high]` `[patch]` The panel's own primary actions (Dropped, Clear status, a logged milestone) hide the card from the default shelf — the refetch unmounted the Card and the open dialog vanished mid-interaction with focus stranded on `<body>`. The hook now exposes `onHidden` (fired when a write's returned effective state is shelf-hidden) and the panel closes itself deliberately. New test.
  - `[medium]` `[patch]` The segmented control advertised `radiogroup`/`radio` roles with no roving tabindex and no arrow-key handling — SRs promise "use arrows" and nothing happens. Now one tab stop + arrow roving; arrows move focus without selecting (selection is a server write; select-on-arrow would PATCH per keystroke). New test.
  - `[medium]` `[patch]` The 409 completion-invariant refusal the server was taught to send was swallowed into the generic "Try again" toast — an error retrying can never fix. `onError` now branches on `status === 409`, explains, and refetches the stale shelf. New test.
  - `[medium]` `[patch]` The `aria-modal` dialogs rendered inline inside `role="gridcell"` — invalid grid content, and SRs that ignore `aria-modal` read the shelf behind them. `DetailPanel` and `ConfirmDialog` now portal to `document.body`.
  - `[low]` `[patch]` A milestone-only game (`playStatus: null`, reachable via search) rendered a "Clear status" button that silently no-opped. Render condition now also requires a non-null status. New test.
  - `[low]` `[patch]` Clearing hides the card exactly like Dropped but carried no UNDO — same reversible risky action, inconsistent feedback. Clear toasts now carry UNDO restoring the previous status. New test.
  - `[low]` `[patch]` Focus trap hole: a click on non-interactive dialog text dropped focus to `<body>`, from which Tab walked the page behind the modal. Both dialog roots are now `tabIndex={-1}` (click-focusable), and the trap selector excludes the roving `tabindex="-1"` radios.
  - `[low]` `[patch]` `reducedMotion` was sampled from `matchMedia` on every render; a mid-open preference flip would swap the class and replay the entry animation. Read once on mount via a lazy `useState`.
  - `[low]` `[patch]` `selectStatus` guarded only against an in-flight status PATCH, not an in-flight milestone POST whose server-side auto-clear it could race. The guard now covers both mutations.

Deferred (see `deferred-work.md`): three hand-rolled focus traps whose `querySelectorAll` selector will silently miss the `<input>`/`<select>` elements Stories 2.4/2.5 add to this very panel.

Notable rejections:
- "Dropped UNDO fires from a dead observer, invalidation never runs" — disproved in 2.1's follow-up review against TanStack query-core internals (mutation-level callbacks run regardless of observer unmount); re-raised here without new evidence.
- "Ownership enum duplicated client-side" — the client deliberately mirrors every wire schema (same as `PLAY_STATUSES`); drift surfacing as a parse error is the documented design.
- "Panel labels a not-owned catalog game 'Wishlisted'" — the epic defines wishlisted as *= not owned* (FR-16); the label matches the product definition.
- Store-search URL lacking a locale segment (PS Store redirects bare paths, locale-aware), the `'invariant'` string sentinel (typed literal union, no realistic collision), and the trap test mirroring the implementation selector (covered by explicit boundary assertions).

## Design Notes

Clear-status refusal is a *service* decision surfaced as 409 — the core predicate already exists:

```ts
if (next === null && wouldViolateCompletionInvariant({ playStatus: null, completedOn: current.completedOn, platinumOn: current.platinumOn })) {
	return 'invariant';
}
```

The panel needs no fetch: every field it renders now rides the card DTO, and every write invalidates `['shelf']`, so panel and shelf can never disagree (AD-7). True card-rect-to-panel FLIP animation is out of scope — a transform-origin flip/grow from the panel's own box reads as the same gesture at a fraction of the complexity.

## Verification

**Commands:**
- `bun run lint` -- expected: Biome reports no errors.
- `bun run typecheck` -- expected: `tsc -b` exits 0.
- `bun run test` -- expected: all suites pass, including new `DetailPanel` and extended `tracking`/`status-transition` suites; `StatusPopover.test.tsx` passes with only fixture edits; `src/core/purity.test.ts` still passes.

## Auto Run Result

Status: done

**Implemented change.** A card's cover now opens a focus-trapped detail dialog (flip-then-grow; cross-fade under reduced motion; full-screen mobile / ~760px desktop) showing the whole game: segmented play-status control, milestone rows + dates, lifecycle dates, genres, ownership, and a PS Store link for wishlisted games. Status and milestone writes reuse the exact 2.1/2.2 logic through a new shared hook. The play-status PATCH learned `playStatus: null` (manual clear) — refused with 409 at the API boundary when no completion milestone exists (FR-3/AR-12).

**Files changed.**
- `src/core/status-transition.ts` — `next: PlayStatus | null`; a clear never stamps a date.
- `src/services/tracking.ts` — `'invariant'` refusal via `wouldViolateCompletionInvariant`, decided before any write.
- `src/routes/tracking.ts` — nullable body enum; 409 mapping.
- `src/repositories/games.ts`, `src/services/shelf.ts`, `src/routes/shelf.ts`, `web/shelf/api.ts` — `startedOn`/`boughtOn`/`wishlistedOn`/`ownershipType` ride the card DTO (no detail endpoint; the panel reads the query cache).
- `web/shelf/useTrackingMutations.ts` (new) — the single mutation seam both surfaces share: toasts, `['shelf']` invalidation, Dropped/Clear UNDO, in-flight guards, milestone confirm flow, 409 explanation, and `onHidden` (panel closes itself when its own write hides the card).
- `web/shelf/DetailPanel.tsx` + `detail-panel.css` (new) — the portaled dialog with an ARIA-correct roving radiogroup.
- `web/shelf/StatusPopover.tsx` — consumes the hook; behavior unchanged (suite passes with only fixture edits).
- `web/shelf/Card.tsx`, `web/shelf/Shelf.tsx` — cover trigger (`Open details — <title>`), in-cell Tab cycle pill ↔ cover, close returns focus to the gridcell.
- `web/components/ConfirmDialog.tsx` — portaled to `<body>`, click-focusable root.
- Tests: `DetailPanel.test.tsx` (new, 23), extended `status-transition`/`tracking`/`Card`/`Shelf`/`StatusPopover` suites, fixtures +4 fields.

**Review findings.** Two blind reviewers. Triage: 9 patches (1 high, 3 medium, 5 low), 1 deferred (focus-trap consolidation before 2.4 adds inputs), 6 rejected with evidence, 0 intent gaps, 0 spec defects. See the Review Triage Log.

**Verification.** `bun run lint` clean, `bun run typecheck` exit 0, `bun run test` 391/391 across 32 files. Named hazard red-then-green: disabling the invariant guard turned the service-level and route-level refusal tests red; restoring turned them green. 2.1/2.2 hazard tests remain green; `src/core/purity.test.ts` passes.

**Residual risks.**
- Closing the panel after a hide-inducing write refocuses a gridcell that unmounts moments later — focus falls to `<body>` (the deferred focus-restoration class shared with 2.1's Dropped).
- The trap selector misses form controls; safe today (none exist in the panel), a real hole once 2.4 adds inputs — deferred with an explicit pre-2.4 fix note.
- UTC date stamping still binds every lifecycle date (deferred app-wide policy).
- jsdom-verified only; the flip animation, portal layering, and 760px breakpoint are unexercised by a real layout engine.
