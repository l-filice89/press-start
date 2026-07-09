---
title: 'Platinum-only auto-hide: completion milestone keeps play status'
type: 'feature'
created: '2026-07-09'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'ec74b1780cc0421105d765cf2e2953767766eeac'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Logging the `completed` milestone auto-clears `play_status`, so the game's effective state becomes `Story completed` and it vanishes from the default shelf. Luca almost always keeps playing toward the platinum after finishing the story — the current flow forces him to re-set `Playing` after every completion.

**Approach:** Only the `platinum` milestone auto-clears `play_status` (game hides). The `completed` milestone stamps `completed_on` and leaves `play_status` untouched — the game stays on the shelf at its current status. This amends PRD FR-2 (completed no longer clears status); FR-5 (platinum) unchanged.

## Boundaries & Constraints

**Always:**
- Single write-side function rule (AR-21): the behavior change lives in `applyMilestone` in `src/core/milestone.ts` only — services/routes/UI keep consuming its patch.
- Milestone dates stay write-once (FR-6): `null` no-op when the target date is already set.
- Effective-state read side (`computeEffectiveState`) and shelf visibility (`isDefaultShelfVisible`) unchanged — a status-less completed game still reads `Story completed` and stays hidden.
- Completion invariant (FR-3) unchanged.

**Ask First:** Nothing anticipated.

**Never:**
- No new hidden/visible state vocabulary; `HIDDEN_STATES` in the client mirror stays as-is.
- No migration/backfill of existing rows — historical status-less completed games stay hidden.
- No UI redesign; comment/copy touch-ups only where the old "milestone hides the card" claim is now wrong.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Complete while playing | `completed`, status `Playing`, no dates | patch `{completedOn: today}` — status untouched; effective state stays `Playing`, card stays on shelf, detail panel stays open | N/A |
| Platinum while playing | `platinum`, status `Playing` | patch `{platinumOn: today, playStatus: null}` — effective state `Platinum achieved`, card hides, panel closes | N/A |
| Complete with no status | `completed`, status `null` (platinum-first game) | patch `{completedOn: today}` — status stays `null`, effective state remains `Platinum achieved` | N/A |
| Already dated | either milestone, target date set | `null` patch, no write (FR-6 unchanged) | N/A |

</frozen-after-approval>

## Code Map

- `src/core/milestone.ts` -- `applyMilestone` + `MilestonePatch` type: the only behavior change (`playStatus` becomes optional, set only for `platinum`)
- `src/core/milestone.test.ts` -- unit tests asserting the old clear-always rule; rewrite per matrix
- `src/services/tracking.ts` -- `logMilestone` consumes the patch; `upsertTracking` already drops `undefined` keys — no code change, docstring only
- `test/integration/tracking.test.ts` -- "stamps completed_on today and auto-clears play_status" (~line 315) asserts old behavior; route-level completed test asserts returned effective state
- `web/shelf/useTrackingMutations.ts` -- no logic change (`onHidden` keys off server-returned effective state, which now stays live for completed); stale comments referencing "a logged milestone hides the card"
- `web/shelf/DetailPanel.tsx` -- comment at ~line 112 lists "a logged milestone" among hiding writes; now platinum only

## Tasks & Acceptance

**Execution:**
- [x] `src/core/milestone.ts` -- make `MilestonePatch.playStatus` optional (`playStatus?: null`); include it only when `milestone === 'platinum'`; update docstrings (FR-2 amended 2026-07-09) -- the single write-side change
- [x] `src/core/milestone.test.ts` -- update: completed patch has NO `playStatus` key (`'playStatus' in patch` false); platinum patch still `playStatus: null`; keep write-once and no-`startedOn` cases -- unit coverage of the matrix
- [x] `test/integration/tracking.test.ts` -- update completed-milestone service/route tests: `play_status` survives, returned effective state is the live status when one is set; platinum tests unchanged -- end-to-end proof through real workerd + D1
- [x] `src/services/tracking.ts` + `web/shelf/useTrackingMutations.ts` + `web/shelf/DetailPanel.tsx` -- fix stale comments claiming every milestone clears status / hides the card -- comments must not lie (`services/tracking.ts` docstring was already accurate — unchanged)

**Acceptance Criteria:**
- Given a game with status `Playing`, when `completed` is logged, then the shelf still shows the card as `Playing` with the completed glyph and the detail panel does not auto-close.
- Given a game with status `Playing`, when `platinum` is logged, then `play_status` is cleared, the card leaves the default shelf, and an open detail panel closes.
- Given a game whose `completed_on` is already set, when `completed` is logged again, then nothing is written (FR-6).

## Spec Change Log

## Verification

**Commands:**
- `bun run test` -- expected: all suites pass, including updated milestone unit + integration tests
- `bun run lint` -- expected: clean

## Suggested Review Order

**The behavior change (write side)**

- The whole change: only the platinum branch clears `play_status`; per-branch literals pin each write-once date
  [`milestone.ts:46`](../../src/core/milestone.ts#L46)

- `playStatus` now optional in the patch — omitted means "don't touch it" (upsert drops `undefined`)
  [`milestone.ts:21`](../../src/core/milestone.ts#L21)

**Unchanged seams the change leans on**

- Hidden-state vocabulary untouched — a status-less completed game still reads hidden
  [`shelf.ts:29`](../../src/core/shelf.ts#L29)

- Client mirror unchanged; panel-close keys off server-returned effective state, which now stays live after a completion
  [`useTrackingMutations.ts:22`](../../web/shelf/useTrackingMutations.ts#L22)

**Comment truth (review patches)**

- Hiding-writes comment now covers the one completed-log path that still hides (status-less game)
  [`DetailPanel.tsx:112`](../../web/shelf/DetailPanel.tsx#L112)

- Race guard marked deliberately broad — completed POST no longer touches status
  [`useTrackingMutations.ts:111`](../../web/shelf/useTrackingMutations.ts#L111)

**Spec-doc propagation (FR-2 amendment)**

- FR-2 amended in the PRD, mirrored in epics, epic-2 context, and AD-21
  [`prd.md:36`](../planning-artifacts/prds/prd-ps-game-catalog-2026-07-05/prd.md#L36)
  [`epics.md:24`](../planning-artifacts/epics.md#L24)
  [`epic-2-context.md:19`](epic-2-context.md#L19)
  [`ARCHITECTURE-SPINE.md:200`](../planning-artifacts/architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md#L200)

**Tests**

- Unit: completed patch carries no `playStatus` key; platinum still clears; completion-after-platinum case added
  [`milestone.test.ts:14`](../../src/core/milestone.test.ts#L14)

- Integration: completed keeps the game on the shelf; platinum removes it; status-less completion stays hidden (review patch)
  [`tracking.test.ts:315`](../../test/integration/tracking.test.ts#L315)

- Client: panel stays open after completed, closes after platinum (review patch — the user-visible ACs)
  [`DetailPanel.test.tsx:357`](../../web/shelf/DetailPanel.test.tsx#L357)
