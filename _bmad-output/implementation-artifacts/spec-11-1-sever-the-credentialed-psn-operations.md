---
title: 'Story 11.1: Sever the credentialed PSN operations'
type: 'refactor'
created: '2026-07-15'
status: 'done'
baseline_revision: '3f9e9b7737e73c2402fdedb833fa0a1e9b35e056'
final_revision: '6ee28f41fa1d027910d1259c718acebc243f20c4'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Three routes (`POST /sync`, `POST /sync/trophies`, `POST /backfill/platinum-dates`) put Luca's PSN credential on the wire; his real account was locked on 2026-07-15 right after credentialed calls. Every UI path into them must go too.

**Approach:** Delete the three credentialed routes, their services, and every UI entry point (FAB sync buttons, both readout modals, Settings backfill panel). Pure removal — no new behavior. The anonymous PS+ catalog check, monthly cron, and CSV export are untouched and must stay green.

## Boundaries & Constraints

**Always:**
- FAB drawer keeps exactly "Check PS+ Extra" and "Export CSV" (plus its existing genre-sweep follow-on).
- A hazard test asserts each of the three routes answers 404 after removal (HAZARD-TEST rule: red-then-green, the named hazard is "credentialed routes no longer exist").
- Surviving suites (PS+ catalog check/cron/browse, CSV export, manual tracking) stay green.
- Keep `src/services/psn-lock.ts` whole — `catalog-refresh` still uses it. Do NOT trim the `PsnOp` union here (story 11.2 owns that).
- Keep `src/core/trophy.ts` (shelf card display still imports it — story 11.3 owns its removal) and `src/core/sync-reconcile.ts` (+ its test; exercised by surviving catalog test, COVERAGE row 7.3j).
- Keep `web/components/PlatinumTrophy.tsx` (shared with the card platinum badge).
- In `web/settings/api.ts` remove only the sync/trophy/backfill exports; keep `settingsSchema`, `syncAttentionItemSchema`, `fetchSettings`, `saveFabHandedness`, `cancelPsPlus`, `savePsnRegion`, `savePsnNpsso`, `psPlusCheckResultSchema`, `runPsPlusCheck`.

**Block If:** deleting any file reveals a production importer not in the Code Map (beyond tests slated for deletion/edit) — the inventory missed an entanglement; HALT rather than improvise.

**Never:**
- No provider changes (`src/providers/psn.ts`), no NPSSO/settings-field removal, no `psn_auth` banner work, no schema migration — stories 11.2/11.3.
- No replacement sync of any kind.
- Never touch manual milestone or ownership flows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Severed route | `POST /api/sync` (authed) | 404 | n/a — route absent |
| Severed route | `POST /api/sync/trophies` (authed) | 404 | n/a |
| Severed route | `POST /api/backfill/platinum-dates` (authed) | 404 | n/a |
| Survivor | FAB "Check PS+ Extra" flow | works exactly as before | existing paths |
| Survivor | FAB "Export CSV" (`/api/export.csv`) | works exactly as before | existing paths |
| Orphaned banner | `settings.syncAttention` non-empty (stale data) | no banner rendered (its Review action opened the deleted modal; the field never repopulates once sync is gone) | n/a |

</intent-contract>

## Code Map

- `src/routes/sync.ts` — all three credentialed routes; DELETE file
- `src/routes/index.ts:12,32` — imports + mounts `syncRoute`; remove both lines
- `src/services/sync.ts`, `src/services/trophies.ts`, `src/services/backfill.ts` — sole importer is the deleted route; DELETE
- `src/services/trophies.test.ts`, `test/integration/sync.test.ts`, `test/integration/trophies.test.ts`, `test/integration/backfill.test.ts` — suites of deleted code; DELETE
- `web/shell/SyncSummaryModal.tsx` (+`.test.tsx`), `web/shell/TrophySyncModal.tsx` (+`.test.tsx`) — readout modals; DELETE. `sync-summary-modal.css` STAYS — surviving `PsPlusCheckModal.tsx` imports it (Code Map corrected during implementation; rename to a shared name is a later cleanup)
- `web/shell/Fab.tsx` — remove `fab-sync` + `fab-trophy-sync` buttons, their mutations, and now-unused imports; keep check/export/genre-sweep. Edit `Fab.test.tsx` accordingly
- `web/shell/AppShell.tsx` — drop modal imports/renders, `summary`/`trophyResult` state, `onSyncComplete`/`onTrophySyncComplete` props, and the `syncAttention` amber banner (L123-133, orphaned by the modal deletion). Edit `AppShell.test.tsx`
- `web/settings/SettingsPanel.tsx` — remove the backfill panel (imports, `BackfillState` helpers, `runBackfill` loop, `backfill-*` UI); keep timezone/token/region/cancel-PS+. Edit `SettingsPanel.test.tsx`
- `web/settings/api.ts` — surgical export removal per Always-constraint
- `test/integration/` (new or existing suitable file) — hazard test: three routes 404
- `playwright/e2e/epic4-settings.spec.ts` — remove the 4 tests driving deleted UI (`:141`, `:166`, `:180`, `:247`); add FAB-surface e2e (drawer shows only surviving controls)
- `playwright/COVERAGE.md` — update rows 4.1c (edit), 4.2a-f, 4.3a-c, 9.2a-e+FAB, 9.3a-i, 9.5d (mark removed by Epic 11); map this story's ACs

## Tasks & Acceptance

**Execution:**
- [x] `web/shell/SyncSummaryModal.tsx` + test + css, `web/shell/TrophySyncModal.tsx` + test -- delete -- leaf components first
- [x] `web/shell/Fab.tsx` + `Fab.test.tsx` -- remove sync/trophy buttons, mutations, imports; edit tests -- FAB keeps check + export
- [x] `web/shell/AppShell.tsx` -- drop modal wiring, related state/props, `syncAttention` banner -- orphaned by modal deletion (`AppShell.test.tsx` needed no edit — verified it never touched the removed wiring)
- [x] `web/settings/SettingsPanel.tsx` + test -- remove backfill panel only -- rest of panel survives
- [x] `web/settings/api.ts` -- remove sync/trophy/backfill exports only -- shared module, surgical edit
- [x] `src/routes/sync.ts` -- delete; `src/routes/index.ts` -- unmount -- severs the routes
- [x] `src/services/{sync,trophies,backfill}.ts` + their 4 test files -- delete -- dead after route removal
- [x] `test/integration/` -- add hazard test: the three routes answer 404 -- named hazard, red-then-green
- [x] `playwright/e2e/epic4-settings.spec.ts` -- remove 4 dead-UI tests; add FAB-surface test -- AC-1 has a UI flow
- [x] `playwright/COVERAGE.md` -- update rows listed in Code Map; add story 11.1 mapping -- Playwright-coverage rule

**Acceptance Criteria:**
- Given the app is running, when Luca opens the FAB drawer, then only "Check PS+ Extra" and "Export CSV" can trigger anything — no sync/trophy control exists (Playwright-asserted).
- Given a client posts to `/api/sync`, `/api/sync/trophies`, or `/api/backfill/platinum-dates`, when the route resolves, then it 404s (hazard test).
- Given the anonymous PS+ catalog check, monthly cron, and CSV export, when their suites run, then all pass unmodified.
- Given `tsc`/build/lint/full vitest + playwright, when run, then green with zero references to `runSync`, `runTrophySync`, `runPlatinumBackfill` outside git history.

## Spec Change Log

## Review Triage Log

### 2026-07-15 — Review pass (Blind Hunter + Edge Case Hunter, deduped)
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 0 (delegations recorded in Design Notes instead — receiving specs 11.2/11.3 are authored in this same run and will carry the ACs)
- reject: 5
- addressed_findings:
  - `[medium]` `[patch]` failure-path lock-release test died with the sync routes while COVERAGE 9.5b still claimed "released on every exit (success or failure)" — re-vehicled onto `/api/ps-plus-check` (store 500 → lock row gone); COVERAGE row updated
  - `[medium]` `[patch]` Settings backfill panel's absence was unpinned (only FAB surface asserted) — added jsdom absence test in `SettingsPanel.test.tsx`
  - `[low]` `[patch]` `Fab.tsx` stale `syncPendingRef` name + "while sync is pending" comment — renamed to `checkPendingRef`, comment fixed
  - `[low]` `[patch]` COVERAGE 7.3j premise counterfactual after sync removal — row annotated (domain-seam pin only)
  - `[low]` `[patch]` spec task ledger claimed an `AppShell.test.tsx` edit that wasn't needed — corrected
- rejected (for the record): untracked hazard test (committed this pass), residual credentialed provider code (11.2's explicit scope), stale comments in `epic9-trophies.spec.ts` (11.3 deletes the file), count-2 drawer assertion brittleness (deliberate pin), banner-orphan speculation (banner removed).

## Design Notes

- Delegation OUT (DELEGATED-WORK rule) — story 11.2's spec must carry ACs covering this dead surface left behind by 11.1 (recorded here; 11.2 spec is authored in this same run):
  - `sync_attention` setting row (migration), `syncAttentionItemSchema` + the `GET /api/settings` read (`readSyncAttention`, `src/routes/settings.ts`), `writeSyncAttention` (`src/services/settings.ts`) and its `test/integration/settings.test.ts` pins — zero production writers remain.
  - Orphaned repository functions with no production caller: `listGamesWithPsnLinks`, `listDiscardedTitleKeys` (sync-era → 11.2); `setTrophyCountsBatch`, `listPlatinumBackfillCandidates`, `hasAnyTrophyData` (trophy-era → 11.3 with the schema drop).
  - `test/integration/psn-stub.ts`: `stubPsnFetch` + `PSN_TROPHY_HOST` exchange double now has zero consumers — dies with the provider auth code in 11.2.
  - 11.2's migration should also clear any stale `psn-lock` rows holding retired ops (`library-sync`/`trophy-sync`/`platinum-backfill`) so a pre-deploy in-flight lock can't refuse catalog ops until TTL.
- `src/core/sync-reconcile.ts` goes production-dead but stays (surviving test dependency); candidate for the deferred-work ledger, not this diff.

## Verification

**Commands:**
- `bun run typecheck` (or the repo's tsc script) -- expected: clean
- `bun run lint` -- expected: clean
- `bun run test` (vitest, all projects) -- expected: green, deleted suites gone, hazard test present
- `bun run test:e2e` (playwright) -- expected: green including new FAB-surface test
- `grep -r "runSync\|runTrophySync\|runPlatinumBackfill" src web test playwright` -- expected: no hits

## Auto Run Result

**Summary:** Severed the entire credentialed PSN operation surface: three routes (`POST /api/sync`, `/api/sync/trophies`, `/api/backfill/platinum-dates`), their services (`sync`/`trophies`/`backfill`), and every UI entry point (FAB sync + trophy-sync buttons, `SyncSummaryModal`, `TrophySyncModal`, the `syncAttention` banner, the Settings backfill panel). Anonymous PS+ catalog check/cron/browse and CSV export untouched. Net −4200 lines.

**Files changed:** 24 tracked (7 src deletions, 4 test deletions, 4 web deletions, 9 edits) + new `test/integration/severed-routes.test.ts` (hazard: three routes 404). Key edits: `routes/index.ts` (unmount), `Fab.tsx`/`AppShell.tsx`/`SettingsPanel.tsx` (UI trims), `web/settings/api.ts` (surgical export removal), `psn-lock.test.ts`/`discard.test.ts` (re-vehicled/trimmed), `epic4-settings.spec.ts` (4 dead-UI e2e removed, FAB-surface e2e added), `COVERAGE.md` (Epic 4/9 rows marked removed, Epic 11 mapping added).

**Review:** 2 medium + 3 low patches applied (see Review Triage Log); 0 deferred to ledger — 4 delegations recorded in Design Notes for 11.2/11.3 specs (dead `sync_attention` surface, orphaned repository fns, dead psn-stub double, stale lock rows); 5 rejected.

**Verification:** `tsc -b` clean; `biome check` clean (251 files); vitest 2158/2158 green (incl. 3 severed-route hazard tests + failure-release lock test + backfill-absence test); playwright 98 passed / 1 failed (`epic6` CSV-download EPERM — reproduced identically on clean baseline, pre-existing Windows environment issue, not this change); grep for `runSync|runTrophySync|runPlatinumBackfill` — zero hits.

**Residual risks:** credential-bearing provider code (`fetchPurchasedGames`, NPSSO plumbing) still exists but is unreachable — no route or UI path calls it; story 11.2 deletes it. `sync_attention` reads survive serving stale data until 11.2's cleanup. `core/sync-reconcile.ts` is production-dead but pinned by a surviving domain test (annotated in COVERAGE 7.3j).

**Follow-up review recommendation:** false — review-driven changes were test restorations and doc/bookkeeping fixes, no behavior or API impact.
