---
title: 'Story 2.1: Change play status from the shelf'
type: 'feature'
created: '2026-07-09'
status: 'done'
baseline_revision: '56b1a5f42da1f022a7c4314763ef8abb23bf764c'
final_revision: '4bfb1bb3613468fb40ed8b3c58d66e7c692c9d7a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/project-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The shelf is read-only — a card's status pill is an inert `<span>`, there is no write path to `game_tracking.play_status`, and nothing stamps `started_on`. Logging a status change still means opening Notion.

**Approach:** Add one pure `core/` status-transition function that owns the `started_on` write-once rule, one user-scoped `PATCH` route through `services/` + the existing `upsertTracking` repository, and turn the status pill into an ARIA menu button whose popover applies a status instantly, toasts, and offers UNDO on `Dropped`.

## Boundaries & Constraints

**Always:**
- `started_on` is stamped **only** on a transition to `Playing`, **only** when `started_on` is null, and **only** while `completed_on` and `platinum_on` are both null (a replay never stamps it). One pure `core/` function owns this rule; no caller re-derives it (FR-44/45, AD-11).
- Effective state, ordering, and pill label are re-read from the existing single `computeEffectiveState`/`orderShelf` core functions after every change — the SPA invalidates and refetches, never patches state locally (FR-8, AD-7).
- The write path is `routes/ → services/ → repositories/`. `core/` stays I/O-free (no `Date`, no `fetch`, no Drizzle) — `today` is injected as an ISO `YYYY-MM-DD` string (AD-3/AD-4).
- Every read and write is scoped to `c.get('userId')` via `requireAuth`; a user may never mutate another user's tracking row (AD-13).
- Zod validates the request body and the response at the route boundary, and the response again in `web/shelf/api.ts`.
- The status popover has menu semantics: `aria-haspopup="menu"` + `aria-expanded` on the pill, `role="menu"` with `role="menuitemradio"` rows, arrow-key/Home/End traversal, and Escape closes and returns focus to the pill (UX a11y floor).
- Controls keep a ≥44×44 hit area via the existing `tap-target` class.
- The card grid's own arrow-key handler must not fire for keys handled inside the pill/popover.

**Block If:**
- The `started_on` write-once rule cannot be satisfied without changing the `game_tracking` schema (it can: the column exists, nullable).

**Never:**
- Do not implement milestone logging, the confirm modal, clearing `play_status` to null, the detail-panel flip, ownership editing, or genre editing — those are Stories 2.2–2.5. The route accepts only the five play statuses.
- Do not add a DB migration; `game_tracking.play_status` and `started_on` already exist.
- Do not add `ORDER BY play_status` in SQL, and do not recompute effective state in the SPA.
- Do not overwrite `started_on`, `completed_on`, or `platinum_on` on any path in this story.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First transition to Playing | `playStatus: 'Not started'`, `startedOn: null`, no milestones | `play_status = 'Playing'`, `started_on = today` | No error expected |
| Re-transition to Playing | `startedOn: '2024-01-01'`, no milestones | `play_status = 'Playing'`, `started_on` unchanged | No error expected |
| Replay after completion | `playStatus: null`, `completedOn: '2023-05-05'`, `startedOn: null` | `play_status = 'Playing'`, `started_on` **stays null** | No error expected |
| Replay after platinum | `platinumOn` set, `startedOn: null` | `play_status = 'Playing'`, `started_on` **stays null** | No error expected |
| Non-Playing status | any state, next = `Paused`/`Up next`/`Not started`/`Dropped` | `play_status` updated, `started_on` untouched | No error expected |
| Mark Dropped | game on default shelf | Row updated; game absent from the next `GET /api/shelf` | No error expected |
| Unauthenticated PATCH | no session cookie | — | `401 {"error":"unauthorized"}` |
| Unknown game / no tracking row for this user | `gameId` absent, or owned by another user | — | `404 {"error":"not found"}`; the other user's row is unchanged |
| Invalid status value | body `{"playStatus":"Finished"}` | — | `400`, row unchanged |
| Mutation returns 401 (session expired mid-session) | expired cookie | Session refetched → app renders `<Login/>` | No retry, no generic toast |

</intent-contract>

## Code Map

- `src/core/types.ts` -- `PLAY_STATUSES` tuple + `PlayStatus`; the vocabulary the route enum keys off.
- `src/core/effective-state.ts` -- `computeEffectiveState` (AD-7); the single read function. Unchanged.
- `src/core/status-transition.ts` -- **new**: the single pure write function for a play-status change (`started_on` rule).
- `src/core/index.ts` -- barrel; add the new module.
- `src/repositories/tracking.ts` -- `getTracking` / `upsertTracking` already exist and are user-scoped. Reuse as-is.
- `src/services/shelf.ts` -- `bakeCard` builds the `ShelfGame` DTO; add `playStatus` to it.
- `src/services/tracking.ts` -- **new**: `changePlayStatus` orchestration (row lookup → core → repository).
- `src/services/index.ts` -- barrel; add the new module.
- `src/routes/tracking.ts` -- **new**: `PATCH /api/games/:gameId/play-status`, `requireAuth` + Zod.
- `src/routes/index.ts` -- mounts route modules under `/api/*`; add the new one.
- `src/routes/shelf.ts` -- `shelfGameSchema`; add `playStatus`.
- `web/shelf/api.ts` -- client Zod mirror of `ShelfGame` + `fetchGames`; add `playStatus` and a `changePlayStatus` mutation fn.
- `web/shelf/StatePill.tsx` -- presentational effective-state pill (`<span>`). Keep as the label; the popover wraps it in a button.
- `web/shelf/StatusPopover.tsx` -- **new**: the pill button + ARIA menu popover + mutation + toast/UNDO.
- `web/shelf/Card.tsx` -- renders `StatePill` inside `card__meta`; swap for `StatusPopover`, and stop grid keys leaking from its children.
- `web/shelf/Shelf.tsx` -- `ShelfGrid` roving-tabindex/arrow-key handler on each `role="gridcell"`.
- `web/components/Toast.tsx` -- `useToast().toast({ message, undo })`; already announces via the live region.
- `web/query-client.ts` -- `QueryCache.onError` does the central 401 re-auth; no `MutationCache` hook yet.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/status-transition.ts` -- Add `applyPlayStatusChange({ next, current: { startedOn, completedOn, platinumOn }, today })` returning the tracking patch `{ playStatus, startedOn? }`; `startedOn: today` is included **only** when `next === 'Playing' && !startedOn && !completedOn && !platinumOn`. Pure, no `Date` -- AD-3/AD-11 put the write-once rule in exactly one place.
- [x] `src/core/status-transition.test.ts` -- Unit-test every Playing row of the I/O matrix (first stamp, re-transition no-overwrite, replay-after-completion, replay-after-platinum) plus each non-Playing status leaving `startedOn` untouched -- this is the named hazard for this story and must be asserted directly.
- [x] `src/core/index.ts` -- Export the new module.
- [x] `src/services/tracking.ts` -- Add `changePlayStatus(db, userId, gameId, next, today)`: `getTracking` → return `null` when absent (404 signal) → `applyPlayStatusChange` → `upsertTracking` → return the new `effectiveState` via `computeEffectiveState`. Rationale: the service is the only place that knows `today` and the persistence seam.
- [x] `src/services/shelf.ts` -- Add `playStatus: row.playStatus` to `ShelfGame` + `bakeCard`, so the popover can check the correct radio row (`effectiveState` alone can't distinguish a replay from a milestone).
- [x] `src/services/index.ts` -- Export the new module.
- [x] `src/routes/tracking.ts` -- `PATCH /api/games/:gameId/play-status` behind `requireAuth`; Zod-parse `{ playStatus: z.enum(PLAY_STATUSES) }` (400 on miss), 404 when the service returns `null`, else 200 `{ effectiveState }` Zod-validated on the way out.
- [x] `src/routes/index.ts` -- Mount `trackingRoute`.
- [x] `src/routes/shelf.ts` -- Add `playStatus: z.enum(PLAY_STATUSES).nullable()` to `shelfGameSchema`.
- [x] `test/integration/tracking.test.ts` -- Cover the route + service against real workerd/D1 following `test/integration/shelf.test.ts`'s shape: happy path, `started_on` write-once across two Playing transitions, no stamp when a milestone exists, `Dropped` disappearing from `getShelf`, 401 unauthenticated, 404 for another user's game (and assert that user's row is untouched), 400 on an invalid status.
- [x] `web/shelf/api.ts` -- Add `playStatus` to `shelfGameSchema` (nullable enum) and a `changePlayStatus(gameId, playStatus)` fetch that PATCHes with `credentials: 'same-origin'`, attaches `status` to its error like `fetchGames`, and Zod-parses `{ effectiveState }`.
- [x] `web/shelf/StatusPopover.tsx` -- The pill button (`aria-haspopup="menu"`, `aria-expanded`, `tabIndex={-1}`, `tap-target`, accessible name `"<state> — change status"`) + a `role="menu"` popover of five `role="menuitemradio"` rows (`aria-checked` on the raw `playStatus`). Opens on click/Enter/Space/ArrowDown, focuses the checked row; ArrowUp/ArrowDown/Home/End traverse; Escape and outside-click close and return focus to the pill. Selecting fires a `useMutation`, invalidates `['shelf']`, and toasts (`Dropped` passes an `undo` that PATCHes the previous status back).
- [x] `web/shelf/status-popover.css` -- `surface-raised` + glow-ring popover anchored to the pill, using existing tokens.
- [x] `web/shelf/Card.tsx` -- Replace `<StatePill state={...}/>` in `card__meta` with `<StatusPopover game={game}/>`; keep the pill label rendering inside it.
- [x] `web/shelf/Shelf.tsx` -- In `onCardKeyDown`, return early when `e.target !== e.currentTarget`, and add `Enter` on the focused gridcell to move focus into its pill button (the ARIA-grid "enter widget" step). Rationale: without the guard, arrow keys inside the popover would also move grid focus.
- [x] `web/query-client.ts` -- Add a `MutationCache` with the same 401 → `authClient.$store.notify('$sessionSignal')` hook as `QueryCache`, and the same 4xx no-retry policy for mutations. Rationale: this story adds the app's first mutation; the existing comment already flags the gap.
- [x] `web/shelf/StatusPopover.test.tsx` -- Assert the menu ARIA contract (haspopup/expanded, `role=menu`, `menuitemradio` + `aria-checked`), arrow-key traversal, Escape returning focus to the pill, that selecting a status calls the mutation once, and that only `Dropped` renders an UNDO in the toast.
- [x] `web/query-client.test.tsx` -- Add the mutation case: a 401 from a write refetches the session (routing to sign-in) and is attempted exactly once.
- [x] `test/integration/session.ts` -- Extract the magic-link session helpers out of `test/integration/auth.test.ts` (unchanged behaviour) so the tracking suite can drive the route with a real session cookie for the 200/400/404 cases.
- [x] `test/integration/auth.test.ts` -- Import those helpers instead of redefining them.
- [x] `web/shelf/Card.test.tsx`, `web/shelf/Shelf.test.tsx`, `web/shelf/SearchBox.test.tsx` -- Add `playStatus` to the `ShelfGame` fixtures; wrap `Card` renders in a `QueryClientProvider` (its pill now carries a mutation).

**Acceptance Criteria:**
- Given a card on the shelf, when the user activates its status pill, then a popover opens listing exactly the five play statuses with the game's current one checked.
- Given the popover, when the user selects a status, then it is applied without a confirmation step, a toast confirms it, and the shelf reflects the new pill label and ordering after the refetch.
- Given the user selects `Dropped`, when the change is applied, then the toast carries a one-tap UNDO that restores the previous status, and the card is gone from the default shelf until it is restored.
- Given the popover is open, when the user presses Escape, then it closes and focus returns to the status pill.
- Given a status change is in flight, when the server answers 401, then the app routes to sign-in rather than showing a generic error.

## Spec Change Log

## Review Triage Log

### 2026-07-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 4, low 5)
- defer: 3: (high 0, medium 3, low 0)
- reject: 8: (high 0, medium 1, low 7)
- addressed_findings:
  - `[medium]` `[patch]` Mutations inherited the query retry policy, so a network error re-sent a write up to 3× (TanStack Query's default is no retry). Set `mutations: { retry: false }`; the asymmetry between safe reads and unsafe writes is now documented.
  - `[medium]` `[patch]` A failed status change was silent — no toast, shelf unchanged, user believes it stuck. Added an `onError` toast on the mutation, which covers the UNDO write too.
  - `[medium]` `[patch]` The pill used `.tap-target`, inflating its own box to 44×44 and stretching the card's info strip; `web/components/hit-area.css` reserves `.tap-expander` for controls that must stay visually compact. Swapped, and the pill span is raised above the invisible hit overlay.
  - `[medium]` `[patch]` `Shelf.tsx` located the pill via `[data-testid="status-pill-button"]`, making a test hook load-bearing for keyboard navigation. Matched on `.status-popover__pill` instead.
  - `[low]` `[patch]` A second selection while the first write was in flight raced two PATCHes. Guarded `select()` on `isPending`.
  - `[low]` `[patch]` The focus effect keyed on `[open, checkedIndex]`, so a refetch that changed the checked row yanked focus off the row the user had arrowed to. Keyed on `open` alone, reading the initial index from a ref.
  - `[low]` `[patch]` Tab out of an open menu left `aria-expanded="true"`. Tab now closes the menu behind the moving focus.
  - `[low]` `[patch]` `changePlayStatus` dereferenced `upsertTracking`'s result without checking it. Returns `null` (→ 404) if the row vanished underneath.
  - `[low]` `[patch]` The route integration test asserted `startedOn` was merely non-null — the one place the real clock runs. It now asserts the exact stamped date.

Deferred (see `deferred-work.md`): focus lost when a `Dropped` card unmounts; no UNDO when the previous play status was null; lifecycle dates stamped in UTC.

### 2026-07-09 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 2, low 0)
- defer: 0
- reject: 11: (high 0, medium 3, low 8)
- addressed_findings:
  - `[medium]` `[patch]` A status picked while an earlier write was still in flight was dropped in silence — the `isPending` guard added last pass returned with no feedback, recreating the exact "silently did nothing" failure its sibling `onError` toast exists to prevent. The guard now toasts `Still saving <title>…`, asserted by a new test (red-then-green: restoring the bare `return` fails it).
  - `[medium]` `[patch]` Opening the menu near the viewport edge could close it instantly: focusing the checked row scrolled it into view, and the popover's own capture-phase `scroll` listener reads any scroll as outside activity. Initial focus now passes `{ preventScroll: true }` — the menu is anchored to an already-visible pill, so nothing needs scrolling.

Notable rejections, each disproved against the code rather than waved off:
- "UNDO after a `Dropped` card unmounts never invalidates the shelf" (raised independently by both reviewers). `Mutation.execute` awaits `this.options.onSuccess` directly (`@tanstack/query-core/build/modern/mutation.js:123`), and `MutationObserver.mutate` rebuilds the mutation from the observer's last-set options regardless of subscription state. The `invalidateQueries(['shelf'])` still fires after unmount, so UNDO restores the card. The existing UNDO test passes.
- "The read-modify-write in `changePlayStatus` can clobber a concurrent milestone write." `upsertTracking` builds its `onConflictDoUpdate` `SET` clause from the *defined* patch fields only, so `completed_on`/`platinum_on` are never part of the statement. Two concurrent first-`Playing` writes stamp the same `today`, which is idempotent.
- `aria-label` announcing the effective state while the checked row reflects the raw play status is correct, not contradictory: the accessible name must match the pill's visible label (WCAG 2.5.3), while the menu checks what the write path actually sets.
- Arrow keys not moving grid focus while focus rests on the pill is the ARIA grid widget-mode contract, not a keyboard trap; Escape exits back to the gridcell, which the pill wires.

## Design Notes

The write-side twin of `computeEffectiveState`. Core stays pure by taking `today`:

```ts
export function applyPlayStatusChange({ next, current, today }: PlayStatusChange): TrackingPatch {
	const stampStart =
		next === 'Playing' && !current.startedOn && !current.completedOn && !current.platinumOn;
	return stampStart ? { playStatus: next, startedOn: today } : { playStatus: next };
}
```

`upsertTracking` drops `undefined`, so omitting `startedOn` from the patch is exactly "don't touch it" — no explicit no-overwrite branch is needed at the repository.

`playStatus` must ride on the card DTO alongside `effectiveState`: a replayed game shows `Playing` with `completed_on` set, so the popover's checked row cannot be derived from `effectiveState`.

## Verification

**Commands:**
- `bun run lint` -- expected: Biome reports no errors.
- `bun run typecheck` -- expected: `tsc -b` exits 0.
- `bun run test` -- expected: all suites pass, including the new `status-transition`, `tracking` integration, and `StatusPopover` suites. `src/core/purity.test.ts` must still pass (the new core module uses no `Date`/`fetch`/Drizzle).

## Auto Run Result

Status: done

**Implemented change.** The shelf's status pill became an ARIA menu button. Tapping it opens a popover of the five play statuses; selecting one applies instantly (no confirm), toasts, and — for `Dropped`, which hides the card — offers a one-tap UNDO. The write goes `routes/ → services/ → repositories/`, with a new pure `core/` function owning the `started_on` write-once rule.

**Files changed.**
- `src/core/status-transition.ts` (new) — `applyPlayStatusChange`: the single write-side function; stamps `started_on` only on a first transition to `Playing` with no completion milestone.
- `src/core/status-transition.test.ts` (new) — asserts that rule directly, every branch.
- `src/services/tracking.ts` (new) — `changePlayStatus`: user-scoped row lookup → core → repository → new effective state; `null` when the row isn't this user's.
- `src/routes/tracking.ts` (new) — `PATCH /api/games/:gameId/play-status` behind `requireAuth`, Zod in and out.
- `src/services/shelf.ts`, `src/routes/shelf.ts` — carry raw `playStatus` on the card DTO (a replay reads `Playing` while holding `completed_on`, so the checked menu row can't come from `effectiveState`).
- `web/shelf/StatusPopover.tsx` + `status-popover.css` (new) — the menu button, its popover, the mutation, the toast/UNDO.
- `web/shelf/Card.tsx`, `web/shelf/Shelf.tsx` — mount the popover; stop grid keys leaking from cell widgets; Enter enters widget mode.
- `web/shelf/api.ts` — `callApi` helper + `changePlayStatus`.
- `web/query-client.ts` — 401 re-auth now covers mutations; writes never retry.
- `test/integration/tracking.test.ts` (new), `test/integration/session.ts` (new, extracted from `auth.test.ts`) — route + service coverage with a real session.
- `web/shelf/StatusPopover.test.tsx` (new), `web/query-client.test.tsx`, and three fixture updates.

**Review findings.** First pass: 9 patches applied, 3 deferred, 8 rejected. Follow-up pass: 2 patches applied (both in `StatusPopover.tsx`), 0 deferred, 11 rejected. 0 intent gaps, 0 spec defects across both. See the Review Triage Log.

**Verification.** `bun run typecheck` exits 0. `bun run lint` (Biome) reports no errors. `bun run test` passes 315/315 across 29 files (314 + the follow-up pass's in-flight-selection test). Both named hazards were checked red-then-green, not merely observed passing: removing the `started_on` guard turns 6 tests red (3 unit, 3 integration); removing the `MutationCache` 401 hook turns the new mutation test red. `src/core/purity.test.ts` still passes — the new core module touches no `Date`, `fetch`, or Drizzle.

**Residual risks.**
- Lifecycle dates are stamped from the Worker's UTC clock; an evening change west of Greenwich records tomorrow, permanently. Deferred as an app-wide policy decision that also binds Stories 2.2 and 2.4.
- A `Dropped` card unmounts on refetch and keyboard focus falls to `document.body`, which also makes the toast's UNDO hard to reach by keyboard. Deferred.
- `Dropped` on a milestone-completed game offers no UNDO (restoring a null status is out of this story's scope). Unreachable until Epic 3's reveal pills or Story 2.3's detail panel render those cards.
- The popover was verified through jsdom tests, not a real browser; the pill's `tap-expander` hit area and popover anchoring are unexercised by an actual layout engine.

**Process note.** Step-03 implementation ran in the main session: the `Agent` tool launches subagents detached, which the run's ORCHESTRATION CONSTRAINT forbids for long-running work. Both review layers, however, did run as real blind subagents — launched together and then awaited **synchronously in the same turn** via `TaskOutput(block: true)`, so the session never idled and the reviewers had no prior conversation context. The follow-up pass recorded above used that arrangement.
