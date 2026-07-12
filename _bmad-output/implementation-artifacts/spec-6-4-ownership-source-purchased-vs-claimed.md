---
title: 'Story 6.4: Ownership source — purchased vs claimed, and un-claim on cancel'
type: 'feature'
created: '2026-07-12'
status: 'done'
baseline_revision: '1997c89'
final_revision: '6dbadf9'
review_loop_iteration: 0
followup_review_recommended: false # independent follow-up pass ran 2026-07-12; see Follow-up Review
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Sync records whether a game was bought or PS+-claimed (`owned_via`), but a *manual* owned-toggle can't: it always writes `purchase`, the detail panel doesn't state the source in AC wording, and the escape hatch `owned_via` was built for — drop claims when the sub ends — was never surfaced. So "owned" can silently lie and a lapsed subscription leaves phantom-owned games.

**Approach:** Thread a `via` choice through the already-wired ownership path; when a user marks a PS+-catalog game owned, prompt "Purchased / Claimed with PS+" (non-PS+ games stay silent `purchase`). State the source plainly in detail. Add a Settings "I cancelled PS+" action that un-owns every `membership` row after a count-confirm, purchases untouched, and re-flags those still-catalog games so the PS+ pill re-shows.

## Boundaries & Constraints

**Always:** Only a game carrying the PS+ Extra pill (`game.psPlusExtra === true`) prompts on manual-own; every other game defaults silently to `owned_via='purchase'`. Un-owning reverses ownership ONLY (`owned=false, ownershipType=null, ownedVia=null`) — never touches `playStatus`, `completedOn`, `platinumOn`, `startedOn`, `boughtOn`, `wishlistedOn`, `discarded`. The cancel-PS+ confirm names the exact claim count before acting. `owned_via` writes stay within the existing enum `'purchase'|'membership'`.

**Block If:** none — schema, core policy, repo write, and route already exist; this is wiring + one bulk path.

**Never:** No new migration (the `owned_via` column already exists, Epic 4). Do not touch purchase (`owned_via='purchase'`) rows in the cancel flow. Do not delete tracking/milestones/dates on un-own. Do not make cancel-PS+ hit the network (no IGDB/PSN call) — it is a local D1 mutation; catalog truth is reconciled by the existing PS+ check.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Own a PS+ game | manual own toggle, `game.psPlusExtra=true` | source dialog opens; no write yet | dialog Cancel → no write |
| Choose "Purchased" | dialog on PS+ game | write `owned=true, via='purchase'`, stamps `boughtOn` | onError toast |
| Choose "Claimed with PS+" | dialog on PS+ game | write `owned=true, via='membership'`, no `boughtOn` | onError toast |
| Own a non-PS+ game | manual own toggle, `game.psPlusExtra=false` | silent write `owned=true, via='purchase'`, no dialog | onError toast |
| Cancel PS+ with claims | ≥1 `owned_via='membership'` owned row | confirm names count N; on confirm un-own all N, re-flag `psPlusExtra=true`, invalidate shelf | onError toast, no partial-silent |
| Cancel PS+ with 0 claims | no membership rows | button inert/disabled ("No PS+ claims") | n/a |

</intent-contract>

## Code Map

- `src/routes/tracking.ts` -- `PATCH /games/:id/ownership`; ADD `via: z.enum(['purchase','membership']).optional()` to `ownershipBodySchema` (~L43), pass `body.data.via` to `changeOwnership` (~L140)
- `src/services/tracking.ts` -- `changeOwnership(...,via='purchase')` already threads `via`; ADD `cancelMembership(db,userId): Promise<{ unowned: number }>` — list owned membership rows, per-row `updateTrackingOwnership({owned:false,ownershipType:null,ownedVia:null})`, then `setPsPlusExtraFlags(db, ids, true)`; ADD `countMembershipClaims(db,userId): Promise<number>`
- `src/repositories/tracking.ts` -- reuse `listTrackingForUser` (filter `owned && ownedVia==='membership'` in JS) or ADD a filtered `listMembershipTracking`; write via existing `updateTrackingOwnership`
- `src/repositories/games.ts` -- reuse `setPsPlusExtraFlags` for the pill re-flag
- `src/routes/settings.ts` -- GET payload: ADD `psPlusClaimCount` (from `countMembershipClaims`); ADD `POST /settings/cancel-ps-plus` (`requireAuth`) → `cancelMembership` → `c.json({ unowned })`
- `src/services/settings.ts` -- no key needed (this is a tracking mutation, not a setting); import point only
- `web/shelf/api.ts` -- `changeOwnership` payload: ADD `via?: 'purchase'|'membership'`
- `web/shelf/useTrackingMutations.ts` -- `setOwnership` change type ADD `via?`; gate: `change.owned===true && game.psPlusExtra` → open `sourcePrompt` instead of writing; expose `sourcePrompt`, `confirmSource(via)`, `cancelSource`
- `web/shelf/OwnershipSourceDialog.tsx` (new) -- two-choice modal reusing `confirm-dialog.css` + `useModalTrap`; buttons Cancel / "Claimed with PS+" / "Purchased"
- `web/shelf/Card.tsx` + `web/shelf/DetailPanel.tsx` -- render `<OwnershipSourceDialog>` off `sourcePrompt`; DetailPanel provenance line (~L382) copy → "Owned · via PS+" / "Owned · purchased"
- `web/settings/api.ts` -- `settingsSchema` ADD `psPlusClaimCount: number`; ADD `cancelPsPlus()` POST helper
- `web/settings/SettingsPanel.tsx` -- new section: "I cancelled PS+" button (disabled when `psPlusClaimCount===0`) → `ConfirmDialog` titled with count → `cancelPsPlus` mutation, invalidate `['settings']` + `['shelf']`
- Tests: `src/services/tracking.test.ts` or `test/integration/tracking.test.ts`, `test/integration/settings.test.ts`, `web/shelf/OwnershipSourceDialog.test.tsx`, `playwright/e2e/epic6.spec.ts` + `playwright/COVERAGE.md`

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/tracking.ts` -- add optional `via` to `ownershipBodySchema`, pass to `changeOwnership` -- close manual-set gap
- [x] `src/services/tracking.ts` -- add `countMembershipClaims` + `cancelMembership` (un-own membership rows → clear owned/type/via, re-flag `psPlusExtra=true`, return count) -- AC4 bulk path + pill re-show hazard
- [x] `src/routes/settings.ts` -- add `psPlusClaimCount` to GET, add `POST /settings/cancel-ps-plus` -- AC4 endpoint + confirm count
- [x] `web/shelf/api.ts` + `web/shelf/useTrackingMutations.ts` -- thread `via`; gate source prompt on PS+-catalog manual-own; expose `sourcePrompt`/`confirmSource`/`cancelSource` -- AC1/AC2
- [x] `web/shelf/OwnershipSourceDialog.tsx` (new) -- two-choice buy/claim modal (Cancel dismisses = no write) -- AC1
- [x] `web/shelf/Card.tsx` + `web/shelf/DetailPanel.tsx` -- render source dialog; detail provenance copy → AC3 wording -- AC1/AC3
- [x] `web/settings/api.ts` + `web/settings/SettingsPanel.tsx` -- `psPlusClaimCount` field, `cancelPsPlus` helper, "I cancelled PS+" section with count-ConfirmDialog -- AC4
- [x] `test/integration/tracking.test.ts` + `test/integration/settings.test.ts` -- via-write cases; **hazard test**: cancel un-owns membership only, purchases (owned/ownedVia/boughtOn) + milestones/dates/status untouched, `psPlusExtra` re-set true, count returned; 0-claim no-op -- HAZARD-TEST rule (AC4 named invariants)
- [x] `web/shelf/OwnershipSourceDialog.test.tsx` -- renders three actions, choosing each fires the right `via`, Cancel writes nothing -- component behavior
- [x] `playwright/e2e/epic6.spec.ts` + `playwright/COVERAGE.md` -- e2e per AC below; COVERAGE rows for all four 6.4 ACs -- PLAYWRIGHT-COVERAGE rule
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- story 6-4 status per convention

**Acceptance Criteria:**
- Given an un-owned game carrying the PS+ Extra pill, when I mark it owned (card or detail), then a dialog asks "Did you buy this, or claim it with PS+?" and my choice writes `owned_via='purchase'` or `'membership'`
- Given an un-owned game NOT in the PS+ catalog, when I mark it owned, then no prompt appears and it writes `owned_via='purchase'`
- Given an owned game's detail panel, when it opens, then the source reads "Owned · via PS+" for a claim and "Owned · purchased" otherwise
- Given the Settings surface with ≥1 `owned_via='membership'` row, when I tap "I cancelled PS+" and confirm the named count, then every claimed row is un-owned (purchases untouched, tracking/milestones/dates intact) and those still-catalog games re-show the PS+ pill

## Design Notes

- `via` is already a `changeOwnership` parameter — the whole server chain (service→core→repo) honors it; only the route Zod schema and the client payload were missing it. Small diff.
- Source prompt gates *inside* `setOwnership` (mirrors the existing milestone `confirming` pattern) so both Card and DetailPanel get it from their own hook instance — each renders `<OwnershipSourceDialog>`. Non-PS+ games skip the gate entirely (silent purchase).
- ponytail: dedicated `OwnershipSourceDialog` (two affirmative choices, not confirm/cancel) reusing `confirm-dialog.css` + `useModalTrap` — clearer than bending the shared 2-button `ConfirmDialog`; the cancel-PS+ count-confirm reuses `ConfirmDialog` as-is (title interpolates the count).
- **Pill re-show hazard:** `runPsPlusCheck` only flags NON-owned rows, so a **sync-ingested** claim (owned from ingest) never gets `psPlusExtra` set — un-owning alone leaves it pill-less. A **pill-claimed** game already carries the flag. `cancelMembership` re-sets `psPlusExtra=true` on the un-owned rows (no-op for the second case, restorative for the first) so the pill re-shows either way. `// ponytail: re-flag from last-known catalog membership; next runPsPlusCheck clears any that have since left the catalog.` Flags are set BEFORE the un-own loop so a mid-loop D1 throw can't strand a row un-owned-without-pill (still-owned rows hide the pill via `!owned`; retry finishes).
- ponytail: count + un-own derive from one `listTrackingForUser` filter (excluding `discarded` so the named count matches the visible shelf); per-row `updateTrackingOwnership` matches the existing per-game write pattern (D1 has no app-side multi-row txn).
- Un-own UNDO re-sends the previous `via` (not just `ownershipType`) — otherwise a re-owned claim silently revives as a purchase and stamps `bought_on`.
- No external provider→write path here (cancel-PS+ is local D1), so PROBE-BEFORE-YOU-MAP and DEGENERATE-RESPONSE rules don't bind; the 0-claim no-op is covered by the matrix + hazard test.

## Verification

**Commands:**
- `bun run typecheck` -- expected: clean
- `bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. via-write + cancel-membership hazard + 0-claim + OwnershipSourceDialog cases
- `bun run test:e2e` -- expected: epic6 spec green (prompt on PS+ own, silent non-PS+ own, detail source copy, cancel-PS+ un-owns + pill re-shows), no regressions

## Review Triage Log

### 2026-07-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 1
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` Un-own UNDO restored `owned`/`ownershipType` but not `via` — a re-owned membership claim silently revived as a `purchase` (and would stamp `bought_on`). Fixed: UNDO now re-sends `previousVia`; added Card test asserting UNDO of a claim re-sends `via='membership'`.
  - `[medium]` `[patch]` `cancelMembership` un-owned rows in a loop then re-flagged `psPlusExtra` once at the end — a mid-loop D1 throw stranded rows un-owned-without-pill, unrecoverable on retry. Fixed: set flags BEFORE the un-own loop (still-owned rows hide the pill via `!owned`; retry finishes).
  - `[low]` `[patch]` `countMembershipClaims`/`cancelMembership` counted discarded (tombstoned) claims, so the named count could exceed the visible shelf. Fixed: both filters now exclude `discarded`; added integration test.
  - `[low]` `[patch]` Source-prompt gate keyed off `change.owned === true` only — a future non-toggle caller sending `{owned:true}` on an already-owned PS+ game would pop a spurious prompt. Fixed: gate now also requires `!game.owned`.
  - `[low]` `[patch]` `confirmSource` dismissed the prompt before the in-flight guard, discarding the buy/claim choice on a race. Fixed: guard before dismiss (keeps the prompt open to retry).
  - `[low]` `[patch]` Design Note + two test comments encoded a false premise (`runPsPlusCheck` "clears the flag on owned games"); it only flags NON-owned rows. Corrected the rationale to the real reason (sync-ingested claims never got the flag) in code, spec, and tests — seed values were already correct.
  - Deferred: cancel-PS+ writes the shared global `game.psPlusExtra` from a per-user action (multi-user catalog bleed) — pre-existing single-tenant assumption shared with `runPsPlusCheck`; logged to `deferred-work.md`.
  - Rejected (noise/by-design): re-flag can transiently show a stale pill for a game that left the catalog (accepted ponytail tradeoff, self-heals next check); two full tracking scans + N per-row writes (single-tenant, ~175 games); Zod accepts a `via` that `core` ignores on un-own (client never sends it); count TOCTOU between GET and POST (server acts on live state; single-user, no toast plumbing in the panel).

## Auto Run Result

Status: done

**Change:** Wires ownership provenance end-to-end. Manual-owning a not-yet-owned PS+-catalog game now prompts Purchased/Claimed and threads `via` through route→service→core→repo; non-PS+ games write `purchase` silently. Detail panel states "Owned · via PS+" / "Owned · purchased". A new Settings "I cancelled PS+" action un-owns every live `membership` claim after a count-confirm (purchases + tracking/milestones/dates untouched) and re-flags those games so the PS+ pill re-shows.

**Files changed:**
- `src/routes/tracking.ts` — optional `via` on `ownershipBodySchema`, threaded to `changeOwnership`.
- `src/services/tracking.ts` — `countMembershipClaims` + `cancelMembership` (discarded-excluded; flags-set-before-un-own; per-row reversal of `owned`/`ownershipType`/`ownedVia` only).
- `src/routes/settings.ts` — `psPlusClaimCount` in GET; `POST /settings/cancel-ps-plus`.
- `web/shelf/api.ts` — `via?` on the ownership change payload.
- `web/shelf/useTrackingMutations.ts` — source-prompt gate (`!game.owned && psPlusExtra`); `confirmSource`/`cancelSource`; UNDO restores `via`; guard-before-dismiss.
- `web/shelf/OwnershipSourceDialog.tsx` (new) — buy/claim modal.
- `web/shelf/Card.tsx` / `web/shelf/DetailPanel.tsx` — render the dialog; AC3 provenance copy.
- `web/settings/api.ts` / `web/settings/SettingsPanel.tsx` — `cancelPsPlus` + count-confirm section.
- Tests: `test/integration/{tracking,settings}.test.ts` (via-writes, AC4 hazard, 0-claim no-op, discarded-exclusion), `web/shelf/{Card,DetailPanel,OwnershipSourceDialog}.test.tsx`, `playwright/e2e/epic6.spec.ts` + `playwright/COVERAGE.md`.

**Review:** 6 patches applied (2 medium: UNDO provenance loss, cancel partial-failure ordering; 4 low), 1 deferred (multi-user global pill flag), 4 rejected. See Review Triage Log.

**Verification:** `typecheck` clean · `lint` clean (216 files) · `test` 1321 passed (57 files) · `test:e2e` all five Story 6.4 flows green (isolated `epic6.spec.ts --workers=1`: 13 passed). Sole e2e failure is the pre-existing 6.3 Export-CSV test hitting a Windows `EPERM` reading the download artifact — unrelated to this diff.

**Residual risk:** cancel-PS+ re-flag shows a transient stale pill if a claimed game already left the catalog (self-heals next PS+ check — accepted). Multi-user global-flag bleed deferred.

**Follow-up review:** recommended — two medium data-integrity fixes on write/undo paths landed during review; an independent pass before the epic merge gate is prudent (FOLLOW-UP-REVIEW CONTRACT).

## Follow-up Review — 2026-07-12 (independent pass, FOLLOW-UP-REVIEW CONTRACT satisfied)

Two independent Opus reviewers over the combined 6.4+6.5 diff (baseline 1997c89). The primary risk — the claim→purchase "I bought this" upgrade — was verified CORRECT (writes owned_via + bought_on write-once only; status/milestones/dates untouched; gate's `!game.owned` skips the prompt). Earlier patches (discarded-exclusion, UNDO via-restore, flags-first ordering) confirmed sound.

Fixed this pass (commit 1abbaba): upgrade toast says "marked as purchased"; typeless-claim upgrade seeds `ownershipType=digital`; detail always states owned-ness ("Owned" for legacy null-source rows); `OwnershipSourceDialog` restores focus on dismiss (a11y).

Deferred (low/med, logged to deferred-work.md): server doesn't enforce `via=membership` needs a PS+ game (self-scoped integrity); `cancelMembership` writes the shared global `psPlusExtra` (multi-user bleed — pre-existing pattern). Rejected: dialog button hierarchy, per-keystroke fold perf, precomposed-diacritic folding, count TOCTOU, doc drift — all low, single-tenant.

`followup_review_recommended` consumed → set false.
