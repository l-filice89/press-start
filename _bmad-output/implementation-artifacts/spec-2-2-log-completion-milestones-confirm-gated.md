---
title: 'Story 2.2: Log completion milestones (confirm-gated)'
type: 'feature'
created: '2026-07-09'
status: 'done'
baseline_revision: 'ca189b82b1982e60360304a4a2f3f23b3e16bfcd'
final_revision: 'fd0ca9e4d8287520ca5b2864e631a9898a123452'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/project-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Milestones can't be logged. The status popover offers only the five play statuses; there is no write path to `completed_on`/`platinum_on`, no confirm gate, and no function owning the "milestone auto-clears play status to null" reconciliation.

**Approach:** Add one pure `core/` milestone-write reconciliation function (write-once, auto-clears `play_status`), one user-scoped `POST` route through `services/` + `upsertTracking`, and extend the existing status popover with two milestone rows that open a silver confirm modal before anything is written. The card's silver badge already renders from `hasCompleted`/`hasPlatinum` — no card change needed.

## Boundaries & Constraints

**Always:**
- One pure `core/` function owns the milestone write: sets `completed_on` or `platinum_on` to `today` **only when that date is null**, and auto-clears `play_status` to null in the same patch (FR-2, FR-5, AR-13/AR-21). Logging an already-dated milestone returns a no-op signal — the first achievement stands (FR-6). No caller re-derives this.
- Milestone dates are never overwritten on any path; `started_on` is never touched by a milestone write.
- Write path is `routes/ → services/ → repositories/`; `core/` stays I/O-free (`today` injected as ISO `YYYY-MM-DD`).
- Every read/write scoped to `c.get('userId')` via `requireAuth`; Zod validates body and response at the route, and again in `web/shelf/api.ts`.
- Nothing is written before the confirm modal's explicit confirm (FR-7). The modal is a focus-trapped `role="dialog"` (`aria-modal`, labelled), Escape/Cancel closes without writing, focus returns to the status pill, milestone-silver styling (UX-DR14). Confirmed milestone fires a toast, no UNDO (already confirm-gated).
- Milestone rows live in the existing popover menu as `role="menuitem"` rows (not `menuitemradio` — they are actions, not the exclusive status selection) and participate in the same arrow-key traversal.
- After a confirmed write the SPA invalidates `['shelf']`; effective state/ordering/badges come from the server re-bake (AD-7), never patched locally. The card leaves the default shelf (Completed/Platinum hidden) — expected, not a bug.

**Block If:**
- The reconciliation cannot be expressed without a schema change (it can: both date columns exist, nullable).

**Never:**
- No detail panel, no clearing milestones, no manual date editing, no completion-invariant refusal UI (Stories 2.3/2.4 — a milestone write always *satisfies* the invariant, so no guard is needed on this path).
- No DB migration. No UNDO on milestone toasts. No third-party call.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Log Story completed | `completedOn: null`, `playStatus: 'Playing'` | `completed_on = today`, `play_status = null` | No error expected |
| Log Platinum | `platinumOn: null`, any status | `platinum_on = today`, `play_status = null` | No error expected |
| Re-log same milestone | `completedOn: '2023-05-05'` | **Nothing changes** — no write, date stands; 200 with current state | No error expected |
| Platinum after Story completed | `completedOn` set, `platinumOn: null` | `platinum_on = today`, `play_status = null`, `completed_on` untouched | No error expected |
| Log on a replayed game | `playStatus: 'Playing'`, `completedOn` set, log Platinum | `platinum_on = today`, status cleared, `completed_on`/`started_on` untouched | No error expected |
| Cancel the confirm modal | modal open, user hits Escape/Cancel | No request sent, row unchanged, focus back on pill | No error expected |
| Unauthenticated POST | no session cookie | — | `401 {"error":"unauthorized"}` |
| Unknown game / other user's row | `gameId` absent or not this user's | — | `404 {"error":"not found"}`, other user's row unchanged |
| Invalid milestone value | body `{"milestone":"speedrun"}` | — | `400`, row unchanged |


## Code Map

- `src/core/types.ts` -- add `MILESTONES` tuple (`'completed' | 'platinum'`) + `Milestone` type; route enum keys off it.
- `src/core/milestone.ts` -- **new**: `applyMilestone` — the single milestone-write reconciliation function.
- `src/core/index.ts` -- barrel; add the new module.
- `src/core/status-transition.ts` -- write-side sibling; pattern to follow. Unchanged.
- `src/repositories/tracking.ts` -- `getTracking`/`upsertTracking`, user-scoped; `null` patch values ARE written (only `undefined` is dropped) — exactly what clearing `play_status` needs. Reuse as-is.
- `src/services/tracking.ts` -- add `logMilestone` beside `changePlayStatus`.
- `src/routes/tracking.ts` -- add `POST /api/games/:gameId/milestones` beside the PATCH.
- `web/shelf/api.ts` -- add `logMilestone` fetch beside `changePlayStatus`.
- `web/shelf/StatusPopover.tsx` -- the menu to extend: five `menuitemradio` rows + new milestone `menuitem` rows; owns `itemRefs` traversal and `close()` focus return.
- `web/components/ConfirmDialog.tsx` -- **new**: minimal focus-trapped confirm modal (none exists yet).
- `web/components/Toast.tsx` -- `useToast().toast({ message })`; milestone toast, no undo.
- `web/shelf/Card.tsx` -- already renders the silver milestone badge from `hasCompleted`/`hasPlatinum`. Unchanged.
- `test/integration/session.ts` -- real-session helpers for route tests.
- `test/integration/tracking.test.ts` -- existing suite shape to extend.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/types.ts` -- Add `export const MILESTONES = ['completed', 'platinum'] as const` + `Milestone` type -- core owns the vocabulary (AD-3).
- [x] `src/core/milestone.ts` -- Add `applyMilestone({ milestone, current: { completedOn, platinumOn }, today })` returning `{ completedOn?, platinumOn?, playStatus: null } | null`: `null` when the target date is already set (no-op — first achievement stands), else a patch stamping the one date and clearing `playStatus`. Pure, no `Date` -- FR-2/FR-5/FR-6 in exactly one place (AR-21).
- [x] `src/core/milestone.test.ts` -- Unit-test every matrix row that hits core: first log (each milestone), re-log no-op, platinum-after-completed leaving `completed_on` untouched, status auto-clear present in every non-null patch, `startedOn` never in the patch. **Named-hazard tests — assert directly, red-then-green.**
- [x] `src/core/index.ts` -- Export the new module.
- [x] `src/services/tracking.ts` -- Add `logMilestone(db, userId, gameId, milestone, today)`: `getTracking` → `null` when absent (404) → `applyMilestone` → if no-op, return current `effectiveState` without writing; else `upsertTracking` → new `effectiveState`.
- [x] `src/routes/tracking.ts` -- `POST /api/games/:gameId/milestones` behind `requireAuth`; Zod body `{ milestone: z.enum(MILESTONES) }` (400 on miss), 404 on `null` service result, 200 `{ effectiveState }` Zod-validated out.
- [x] `test/integration/tracking.test.ts` -- Route+service against real workerd/D1: happy path per milestone (dates stamped `today`, `play_status` NULL after), re-log leaves the original date, platinum-after-completed, 401 unauthenticated, 404 other user's game (row untouched), 400 invalid milestone.
- [x] `web/shelf/api.ts` -- Add `MILESTONES`/`Milestone` mirror + `logMilestone(gameId, milestone)` POSTing via `callApi`, Zod-parsing `{ effectiveState }`.
- [x] `web/components/ConfirmDialog.tsx` + `confirm-dialog.css` -- Minimal confirm modal: `role="dialog"` `aria-modal="true"` labelled by its title, focus moves in on open (Cancel button first — destructive-lite default), Tab cycles inside, Escape/Cancel → `onCancel`, Confirm → `onConfirm`; backdrop + milestone-silver accent using existing tokens. Caller owns focus return.
- [x] `web/shelf/StatusPopover.tsx` -- Append a separator + two milestone rows ("Story completed", "Platinum achieved") as `role="menuitem"` in the same menu; extend arrow-key traversal to 7 rows. Selecting a milestone row closes the menu (focus back to pill) and opens `ConfirmDialog` ("Log <milestone> for <title>? This is permanent."). Confirm → `useMutation(logMilestone)` → invalidate `['shelf']` + toast `"<title> — <milestone label>"` (no undo); reuse the existing `onError` toast + `isPending` guard pattern. Cancel/Escape → no request, focus returns to pill. Already-achieved milestone rows render `aria-disabled` with the date and do not open the modal (`hasCompleted`/`hasPlatinum` are on the card DTO).
- [x] `web/shelf/status-popover.css` -- Separator + milestone-row styling (milestone silver text/glyph) with existing tokens.
- [x] `web/shelf/StatusPopover.test.tsx` -- Extend: menu lists 7 rows with correct roles; milestone row opens the dialog and **no request fires before confirm**; confirm calls the mutation once and toasts without UNDO; Escape/Cancel writes nothing and returns focus to the pill; achieved row is `aria-disabled` and inert; arrow traversal reaches milestone rows.
- [x] `web/components/ConfirmDialog.test.tsx` -- Dialog ARIA contract, focus trap (Tab cycles), Escape → `onCancel`, buttons wired.

**Acceptance Criteria:**
- Given the status popover, when the user activates a milestone row, then a silver confirm modal gates the write — nothing is written until Confirm.
- Given the user confirms, when the milestone is logged, then the date is written, play status auto-clears to null via the single core function, a toast confirms, and the card leaves the default shelf showing a permanent silver badge wherever it renders.
- Given a milestone that already has a date, when the user attempts to log it again, then nothing changes — the row is disabled with its date shown.
- Given the modal is open, when the user presses Escape or Cancel, then no request fires and focus returns to the status pill.

## Spec Change Log

## Review Triage Log

### 2026-07-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 2, low 6)
- defer: 1: (high 0, medium 1, low 0)
- reject: 8: (high 0, medium 4, low 4)
- addressed_findings:
  - `[medium]` `[patch]` The confirm dialog's dismissal paths had holes: backdrop press did nothing (its test hook was unused), and Escape lived on the dialog div, going deaf whenever focus sat outside it. Backdrop mousedown now cancels; Escape moved to a document-level capture listener. Both asserted by new tests.
  - `[medium]` `[patch]` A confirmed milestone racing an in-flight write was silently discarded — dialog closed, intent gone, full menu+modal re-navigation required. The guard now keeps the dialog open and toasts, so retrying is one tap. New test.
  - `[low]` `[patch]` `applyMilestone` guarded write-once with truthiness, so an empty-string date would count as "unset" and be overwritten. Now `!= null`.
  - `[low]` `[patch]` `web/shelf/api.ts` exported a `MILESTONES` tuple nothing imported; replaced with a plain literal-union type.
  - `[low]` `[patch]` `confirm-dialog.css` hardcoded `z-index: 40`; now `var(--z-overlay)` like every other layer.
  - `[low]` `[patch]` The milestone route parsed its response against `playStatusResponseSchema` (worked, read wrong); renamed to the shared `trackingResponseSchema` and dropped the unused `PlayStatusResponse` export.
  - `[low]` `[patch]` Route-boundary test gaps: the FR-6 no-op, a malformed (non-JSON) body, and the `completed` enum member were never exercised through the HTTP route with a session. Three integration tests added.
  - `[low]` `[patch]` An achieved (disabled) milestone row was a silent dead-end on activation; it now toasts "already logged on <date>". Test updated.

Deferred (see `deferred-work.md`): milestone dates stamped from the Worker's UTC clock — the app-wide timezone policy already deferred from 2.1, with stakes raised because the date is now displayed and immutable.

Notable rejections:
- "Card unmounting mid-flight skips invalidation/toast" — disproved in 2.1's follow-up review: TanStack mutation callbacks fire regardless of observer unmount; the same code shape is already tested.
- "Concurrent POSTs break write-once (TOCTOU)" — both stamp the same `today` (idempotent); a cross-midnight double-tap by a single user is not a real failure mode, and 2.1's review already disproved the sibling clobber claim against `upsertTracking`'s defined-fields-only SET clause.
- "Stale cache lets a confirm through and the success toast lies" — requires a second tab plus a stale cache; FR-6 keeps the record correct, and the immediate shelf refetch corrects the UI. Toast wording in a contrived race is noise.
- "Upsert resurrects deleted rows, making the 404 guard unreachable" — nothing in the app deletes tracking rows; the guard is defensive, mirroring 2.1's reviewed pattern.
- Redundant `hasCompleted`+`completedOn` DTO pair, raw ISO date display (ISO is the app-wide date format), speculative exhaustive-switch for future milestones, non-JSON 500 on D1 failure (matches every existing route).

## Design Notes

`applyMilestone` returns `null` for the no-op rather than an empty patch, so the service can skip the write entirely (FR-6 "nothing changes" means no UPDATE at all):

```ts
export function applyMilestone({ milestone, current, today }: MilestoneInput): MilestonePatch | null {
	const field = milestone === 'platinum' ? 'platinumOn' : 'completedOn';
	if (current[field]) return null; // first achievement stands
	return { [field]: today, playStatus: null };
}
```

`upsertTracking` writes `null` values (only `undefined` is dropped), so `playStatus: null` clears the column with no repository change.

Milestone rows are `menuitem`, not `menuitemradio`: they trigger a gated action; the radio group stays the five statuses. `aria-checked` never applies to them.

## Verification

**Commands:**
- `bun run lint` -- expected: Biome reports no errors.
- `bun run typecheck` -- expected: `tsc -b` exits 0.
- `bun run test` -- expected: all suites pass, including new `milestone`, extended `tracking` integration, `StatusPopover`, and `ConfirmDialog` suites; `src/core/purity.test.ts` still passes.

## Auto Run Result

Status: done

**Implemented change.** The status popover gained two milestone rows ("Story completed", "Platinum achieved") behind a milestone-silver confirm modal. Confirming stamps the date, auto-clears play status to null through a single pure `core/` reconciliation function, toasts (no UNDO — already confirm-gated), and the card leaves the default shelf wearing its permanent silver badge. Re-logging an achieved milestone is a no-op: the row is disabled, shows the standing date, and explains itself when activated.

**Files changed.**
- `src/core/milestone.ts` (new) — `applyMilestone`: the single milestone-write function; write-once (`!= null` guard) + status auto-clear in one patch; returns `null` for the FR-6 no-op so the service skips the write entirely.
- `src/core/milestone.test.ts` (new), `src/core/types.ts` (`MILESTONES` tuple), `src/core/index.ts` (barrel).
- `src/services/tracking.ts` — `logMilestone`: user-scoped lookup → core → repository → new effective state.
- `src/routes/tracking.ts` — `POST /api/games/:gameId/milestones` behind `requireAuth`, Zod in/out; response schema renamed to the shared `trackingResponseSchema`.
- `src/services/shelf.ts`, `src/routes/shelf.ts` — `completedOn`/`platinumOn` ride on the card DTO (the disabled row must show its date; booleans can't).
- `web/components/ConfirmDialog.tsx` + `confirm-dialog.css` (new) — focus-trapped modal confirm gate; Escape works document-wide, backdrop press cancels.
- `web/shelf/StatusPopover.tsx` + `status-popover.css` — separator + milestone rows, 7-row traversal, confirm → mutation → invalidate + toast; in-flight confirm keeps the dialog open instead of discarding the confirmed intent.
- `web/shelf/api.ts` — `logMilestone`, DTO fields, `Milestone` type.
- Tests: `web/components/ConfirmDialog.test.tsx` (new), `web/shelf/StatusPopover.test.tsx` (+9), `test/integration/tracking.test.ts` (+11 route/service cases), fixture updates in three suites.

**Review findings.** Two blind reviewers (adversarial + edge-case). Triage: 8 patches applied (2 medium, 6 low), 1 deferred (UTC date policy — pre-existing, stakes raised), 8 rejected with evidence, 0 intent gaps, 0 spec defects. See the Review Triage Log.

**Verification.** `bun run lint` clean, `bun run typecheck` exit 0, `bun run test` 359/359 across 31 files. Both named hazards verified red-then-green by the implementer: removing the write-once guard turned 3 tests red; removing the status auto-clear turned 9 red. `src/core/purity.test.ts` passes — the new core module uses no `Date`/`fetch`/Drizzle.

**Residual risks.**
- Milestone dates stamp from the Worker's UTC clock; wrong-by-one for evening users west of Greenwich, permanent under FR-6. Deferred as the app-wide timezone policy (also binds 2.1's `started_on` and 2.4's `bought_on`).
- The confirm dialog is not portaled and does not `inert` the background; pointer and Tab are handled, but a screen reader's virtual cursor can wander behind `aria-modal`. Tolerable for the single-user v1; revisit if a portal/dialog primitive lands with Story 2.3's detail panel.
- Logging a milestone hides the card from the default shelf, so keyboard focus falls to `document.body` when it unmounts — the same deferred focus-restoration class as `Dropped` (DW ledger).
- jsdom-verified only; popover anchoring and dialog layering unexercised by a real layout engine.
