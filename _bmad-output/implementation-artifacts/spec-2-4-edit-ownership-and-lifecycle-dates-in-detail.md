---
title: 'Story 2.4: Edit ownership and lifecycle dates in detail'
type: 'feature'
created: '2026-07-09'
status: 'done'
baseline_revision: '0c547917ceabb9396c3d71195181ad7e62d1dea4'
final_revision: '7c61b2017003947597fb7aea23d16da8d0ab6a67'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/project-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Ownership the PS API can't see (physical discs) can't be recorded — `owned`/`ownership_type` have no write path — and a wrongly-stamped lifecycle date can never be corrected, though FR-45 promises manual editability in the detail view.

**Approach:** Two new user-scoped write paths through the existing layering: an ownership PATCH (own = default type `physical` + `bought_on` stamped once; un-own = reversible with toast UNDO) and a lifecycle-dates PATCH (partial, per-field, a deliberate override that may set or clear any date — refused only when it would clear the last milestone of a status-less game). Surfaces: a card owned toggle (top-right, no confirm) and editable ownership + native `<input type="date">` rows in the detail panel.

## Boundaries & Constraints

**Always:**
- One pure `core/` function per write owns the rules (AR-13): `applyOwnershipChange` — owning stamps `bought_on` **only when null** (write-once, FR-44) and defaults `ownership_type` to `physical` only when none is set; un-owning flips the flag and clears the type but **never touches any date**. `applyDateEdits` — validates each field is `YYYY-MM-DD` or null and returns the patch; **refuses (invariant signal) any edit that leaves `completed_on` and `platinum_on` both null while `play_status` is null** (FR-3/AR-12, same 409 as 2.3's clear).
- Manual date edits are deliberate overrides (FR-45): they may set or clear any of the five dates, including milestone dates. They never touch `play_status` — no milestone-logging reconciliation runs here.
- Automatic flows still never overwrite a recorded date — untouched by this story; the existing 2.1/2.2 write-once hazard tests must stay green.
- Write paths are `routes/ → services/ → repositories/` behind `requireAuth`, Zod in and out, user-scoped (AD-13); 404 unknown/foreign game, 400 invalid body, 409 invariant.
- Un-owning is a reversible risky action: toast with one-tap UNDO restoring `owned: true` + the previous ownership type (EXPERIENCE.md rules). Owning and type switches toast without UNDO. Date edits toast plainly.
- The card owned toggle sits top-right of the cover, reversible with no confirm, ≥44×44 hit area, accessible name + state (`aria-pressed`); it must not open the detail panel (stop propagation from the cover trigger).
- Detail-panel edits reuse the panel from 2.3; every write invalidates `['shelf']` (AD-7). Focus-trap boundaries must now include form controls — consolidate the trap's focusable selector into one shared constant/helper used by both dialogs (closes the deferred-work hole before inputs land).
- Native `<input type="date">` for date rows — no picker dependency.

**Block If:**
- The ownership or date rules cannot be expressed without a schema change (they can: all columns exist).

**Never:**
- No genre editing (2.5). No confirm modal on ownership (reversible). No sync logic. No `started_on` stamping changes. No editing from the card besides the owned toggle. No third-party call.
- Do not let a date edit run the milestone auto-clear reconciliation — `applyMilestone` is for logging, not correction.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mark owned (first time) | `owned: false`, `boughtOn: null`, `ownershipType: null` | `owned = true`, `ownership_type = 'physical'`, `bought_on = today` | No error expected |
| Re-own after un-own | `owned: false`, `boughtOn: '2024-01-01'`, type null | `owned = true`, type `physical`, `bought_on` **unchanged** (write-once) | No error expected |
| Own a game with a type already set | `ownershipType: 'digital'` (edge: from a partial state) | Type preserved, not reset to physical | No error expected |
| Un-own | `owned: true`, `ownershipType: 'digital'` | `owned = false`, `ownership_type = null`, dates untouched; toast UNDO restores owned + `digital` | No error expected |
| Switch type | `owned: true`, type `physical` → `digital` | Type updated, nothing else | No error expected |
| Set type while not owned | `owned: false`, body `{ownershipType:'digital'}` without owning | — | `400`, row unchanged (type belongs to an owned game) |
| Correct a date | `startedOn: '2024-03-10'` → `'2024-03-01'` | Date saved verbatim | No error expected |
| Clear a non-milestone date | `boughtOn` → null | Cleared | No error expected |
| Clear last milestone, status null | `playStatus: null`, only `completedOn` set → null | Row unchanged | `409 {"error":"completion invariant"}`, panel explains |
| Clear one of two milestones | both dates set, clear `platinumOn` | Cleared; `completedOn` stands | No error expected |
| Set a milestone date manually | `completedOn: null` → `'2024-06-01'`, `playStatus: 'Playing'` | Date saved; `play_status` untouched (no auto-clear on correction) | No error expected |
| Malformed date | `{"startedOn":"junk"}` or `"2024-13-99"` | — | `400`, row unchanged |
| Unauthenticated / foreign game | as previous stories | — | 401 / 404, row untouched |

</intent-contract>

## Code Map

- `src/core/ownership.ts` -- **new**: `applyOwnershipChange`.
- `src/core/date-edit.ts` -- **new**: `applyDateEdits` (ISO validation + invariant refusal).
- `src/core/completion-invariant.ts` -- reuse the predicate.
- `src/core/index.ts` -- barrel.
- `src/services/tracking.ts` -- add `changeOwnership`, `editDates` beside the existing two.
- `src/routes/tracking.ts` -- `PATCH /games/:gameId/ownership`, `PATCH /games/:gameId/dates`; reuse `trackingResponseSchema`.
- `src/repositories/tracking.ts` -- `upsertTracking` writes null, drops undefined. Reuse as-is.
- `web/shelf/api.ts` -- `changeOwnership`, `editDates` client fns.
- `web/shelf/useTrackingMutations.ts` -- extend the shared seam: ownership mutation (+UNDO on un-own), dates mutation (409 branch like clear).
- `web/shelf/Card.tsx` + `card.css` -- owned toggle top-right of the cover (replaces the static `OWNED` label as the interactive surface; keep a text state).
- `web/shelf/DetailPanel.tsx` + `detail-panel.css` -- ownership section becomes editable (owned toggle + digital/physical segmented pair); date rows become `<input type="date">` saving on change; trap selector shared.
- `web/components/focusable.ts` -- **new**: the one `FOCUSABLE_SELECTOR` both dialogs use (buttons, links, inputs, selects; excludes `tabindex="-1"`).
- `web/components/ConfirmDialog.tsx` -- consume the shared selector.
- `test/integration/tracking.test.ts` -- ownership + dates route/service coverage.
- `web/shelf/DetailPanel.test.tsx`, `Card.test.tsx` -- UI coverage.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ownership.ts` -- `applyOwnershipChange({ next: { owned, ownershipType? }, current, today })` → patch: owning stamps `boughtOn: today` only when `current.boughtOn` is null and defaults type to `physical` only when neither `next.ownershipType` nor `current.ownershipType` is set; un-owning returns `{ owned: false, ownershipType: null }`; a bare type switch requires `current.owned` (else invalid signal → 400). Pure. **Named hazard: `bought_on` stamped once — red-then-green.**
- [x] `src/core/ownership.test.ts` -- every ownership matrix row.
- [x] `src/core/date-edit.ts` -- `applyDateEdits({ edits, current })` → validates each provided field against strict `YYYY-MM-DD` (reject impossible dates) or null; merges onto current to evaluate `wouldViolateCompletionInvariant` (with current `playStatus`); returns `'invariant'` signal, `'invalid'` signal, or the patch. **Named hazard: refusing to clear the last milestone of a status-less game — red-then-green.**
- [x] `src/core/date-edit.test.ts` -- every date matrix row incl. both-milestones/one-milestone branches and impossible dates.
- [x] `src/core/index.ts` -- export both.
- [x] `src/services/tracking.ts` -- `changeOwnership` / `editDates`: `getTracking` → core → (`'invariant'`/`'invalid'` pass through, no write) → `upsertTracking` → `effectiveState`.
- [x] `src/routes/tracking.ts` -- `PATCH /games/:gameId/ownership` body `{ owned?: boolean, ownershipType?: 'physical'|'digital' }` (at least one key); `PATCH /games/:gameId/dates` body: any of the five date keys, `z.string().regex(ISO) | null` each, at least one key. Map signals → 400/409; 404; 200 `{ effectiveState }`.
- [x] `test/integration/tracking.test.ts` -- through the route with a real session: own-stamps-once (two own cycles), un-own leaves dates + UNDO restore path (PATCH owned:true+type), type switch, type-without-owned 400, date correction, clear-last-milestone 409 with row unchanged, clear-one-of-two 200, malformed date 400, 401/404.
- [x] `web/shelf/api.ts` -- `changeOwnership(gameId, body)`, `editDates(gameId, edits)` via `callApi`, Zod-parsed responses.
- [x] `web/components/focusable.ts` -- `FOCUSABLE_SELECTOR` shared constant; `ConfirmDialog` and `DetailPanel` traps consume it (inputs/selects included, `[tabindex="-1"]` excluded).
- [x] `web/shelf/useTrackingMutations.ts` -- add `setOwnership` (un-own toast carries UNDO restoring previous flag+type; own/type-switch toast plain) and `saveDates` (409 → invariant explanation + invalidate, mirroring clear); same in-flight guards.
- [x] `web/shelf/Card.tsx` + `card.css` -- top-right cover toggle: `aria-pressed={game.owned}`, name `Owned — <title>`, `tap-expander`, stops propagation so it never opens the panel; replaces nothing visually except making the state actionable (keep the `OWNED` text in the meta strip).
- [x] `web/shelf/DetailPanel.tsx` + `detail-panel.css` -- Ownership section: owned toggle + a digital/physical segmented pair (disabled/hidden when not owned); Dates section: five labelled `<input type="date">` rows (values from the DTO, save on `change` with the field name, clearing the input sends null); 409 surfaces the invariant explanation.
- [x] `web/shelf/DetailPanel.test.tsx` -- ownership editing (own defaults + un-own UNDO), type switch, date input save + clear, 409 explanation, trap includes the new inputs (Tab boundary test crossing an input).
- [x] `web/shelf/Card.test.tsx` -- toggle presence/name/state, toggling un-own shows UNDO toast, toggle does not open the panel.

**Acceptance Criteria:**
- Given a not-owned game, when the user marks it owned (card toggle or panel), then `owned` flips true, type defaults to physical, `bought_on` is stamped once, and un-owning it later carries a toast UNDO that restores flag and type.
- Given an owned game, when the user switches ownership type, then only the type changes.
- Given any lifecycle date in the panel, when the user edits or clears it, then the correction is saved verbatim as a deliberate override — except an edit that would leave a status-less game with no milestone, which the API refuses with 409 and the panel explains.
- Given automatic flows (status change, milestone log), when they run after manual corrections, then they still never overwrite a recorded date.
- Given the detail panel now contains inputs, when the user Tabs through it, then the focus trap includes every form control (shared selector, no per-dialog drift).

## Spec Change Log

## Review Triage Log

### 2026-07-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 1, medium 0, low 3)
- defer: 4 (high 0, medium 2, low 2)
- reject: 9
- addressed_findings:
  - `high` `patch` Date inputs PATCHed on every React `onChange` (per-keystroke segment edits emit complete-but-wrong intermediates like `0002-…`; the pending guard then silently dropped the real edit) — `DateRow` now accumulates a local draft and commits on blur; tests assert no PATCH before blur.
  - `low` `patch` Shared `FOCUSABLE_SELECTOR` matched `disabled` controls, which `focus()` can't land on — added `:not(:disabled)` to button/input/select.
  - `low` `patch` Third hard-coded `['physical', 'digital']` list in `DetailPanel.tsx` — now a single exported `OWNERSHIP_TYPES` const in `web/shelf/api.ts` (server/web duplication itself is the documented two-program boundary, kept).
  - `low` `patch` `bash.exe.stackdump` CRLF churn rode along in the story diff — churn reverted; delete+gitignore deferred (pre-existing tracked file).

## Design Notes

`applyDateEdits` evaluates the invariant on the *merged* result (edits over current), so multi-field bodies are judged as a whole — clearing `completedOn` while setting `platinumOn` in the same PATCH is legal. Signals stay string literals (`'invariant' | 'invalid'`) consistent with 2.3's service contract.

Un-own's UNDO restores `{ owned: true, ownershipType: previousType }` through the same ownership mutation — `bought_on` needs no restore because un-owning never touched it.

## Verification

**Commands:**
- `bun run lint` -- expected: Biome reports no errors.
- `bun run typecheck` -- expected: `tsc -b` exits 0.
- `bun run test` -- expected: all suites pass, incl. new `ownership`/`date-edit` units, extended tracking integration, panel/card UI tests; 2.1–2.3 hazard tests untouched and green; `src/core/purity.test.ts` passes.

## Auto Run Result

**Summary:** Story 2.4 implemented and reviewed. Two new user-scoped write paths — `PATCH /games/:gameId/ownership` (own stamps `bought_on` write-once, defaults type to physical; un-own reversible with toast UNDO) and `PATCH /games/:gameId/dates` (partial per-field lifecycle-date overrides, 409 on clearing the last milestone of a status-less game) — surfaced as a card owned toggle and editable ownership + native date rows in the detail panel, with the focus-trap selector consolidated into one shared constant.

**Files changed:**
- `src/core/ownership.ts` / `ownership.test.ts` — new pure `applyOwnershipChange` + full matrix coverage (write-once `bought_on` hazard test).
- `src/core/date-edit.ts` / `date-edit.test.ts` — new pure `applyDateEdits` (strict ISO validation, merged-result invariant check) + matrix coverage (last-milestone 409 hazard test).
- `src/core/types.ts`, `src/core/index.ts`, `src/core/seed-reconcile.ts`, `src/schema/catalog.ts` — `OWNERSHIP_TYPES` vocabulary single-sourced in core; barrel exports.
- `src/services/tracking.ts` — `changeOwnership`, `editDates` beside the existing writes.
- `src/routes/tracking.ts` — the two PATCH routes, Zod in/out, 400/404/409 mapping.
- `test/integration/tracking.test.ts` — 16 new route-level cases incl. both named hazards, malformed dates, 401/404, empty bodies.
- `web/shelf/api.ts`, `useTrackingMutations.ts` — client fns + `setOwnership` (UNDO on un-own) / `saveDates` (409 explanation) on the shared mutation seam.
- `web/shelf/Card.tsx` / `card.css` / `Card.test.tsx` — top-right owned toggle (`aria-pressed`, ≥44px hit area, never opens the panel).
- `web/shelf/DetailPanel.tsx` / `detail-panel.css` / `DetailPanel.test.tsx` — editable ownership section (toggle + segmented type pair) and five `<input type="date">` rows committing on blur.
- `web/components/focusable.ts` / `ConfirmDialog.tsx` — shared `FOCUSABLE_SELECTOR` (inputs/selects in, `tabindex="-1"` and `disabled` out) consumed by both dialogs.
- `web/shelf/Shelf.tsx` / `Shelf.test.tsx` — widget-mode Tab cycle generalized from two widgets to N to include the owned toggle.

**Review findings:** 4 patched (1 high: date inputs PATCHed per keystroke via React `onChange`, now draft-and-commit-on-blur; 3 low: `:not(:disabled)` in the trap selector, third ownership-vocabulary copy removed, stackdump CRLF churn reverted), 4 deferred (untransacted read-decide-write seam, UNDO pending-guard bypass, stackdump deletion; UTC-day stamping was already ledgered by 2.1/2.2), 9 rejected as noise/by-design.

**Verification:** `bun run lint` clean, `bun run typecheck` clean, `bun run test` 468/468 across 34 files — before and after review patches. Both named hazards covered at unit and route level.

**Residual risks:** concurrency holes in the write seam (deferred — single-user exposure only); lifecycle dates accept any calendar-valid value including future dates (per spec: deliberate override); UTC-day stamping still awaits an app-wide timezone policy.
