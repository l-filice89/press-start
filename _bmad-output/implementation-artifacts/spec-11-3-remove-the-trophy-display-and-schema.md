---
title: 'Story 11.3: Remove the trophy display and schema'
type: 'refactor'
created: '2026-07-15'
status: 'done'
baseline_revision: 'adfd9ab9f2bd7a99b6fe38eac154fb1c5d7cdae0'
final_revision: '4e9bdcf6df51ac2e050e45f652f587b556173809'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The trophy %/grade display and its 11 `trophy_*` columns are the last remnant of the credentialed surface — nothing can ever repopulate them (11.1/11.2 deleted the sync), so they render stale data and carry dead schema.

**Approach:** Delete the trophy readout (Card + DetailPanel), the `core/trophy.ts` domain module, the trophy fields in the shelf DTO/zod chain, the orphaned trophy repository fns, and migrate out the `trophy_*` columns. The manual milestone flow (`platinum_on`/`completed_on`, Epic 2) and ownership model (`owned_via`/`bought_on`, Epic 6.4) are byte-for-byte untouched.

## Boundaries & Constraints

**Always:**
- `platinum_on` ≠ `trophy_earned_platinum`: the PlatinumTrophy badge, `hasPlatinum`/`hasCompleted`, the DetailPanel Milestones section and Dates rows, and both milestone columns survive with their tests green.
- Migration hazard test (DEGENERATE-RESPONSE/HAZARD rules): seed a row with milestone + ownership + trophy values, apply `0011`, assert `platinum_on`, `completed_on`, `owned_via`, `bought_on` values SURVIVE byte-identical while no `trophy_*` column remains (inspect `PRAGMA table_info`).
- Migration `0011` uses `ALTER TABLE game_tracking DROP COLUMN` (11 columns incl. `trophy_synced_at`; no index touches them — verified). Snapshot 0011 must reflect the dropped columns (regenerate via drizzle-kit, or copy-and-trim 0010's) so drizzle-kit doesn't drift.
- Playwright: delete `epic9-trophies.spec.ts`; strip trophy columns from `playwright/support/helpers/d1.ts` seedSql + `game-factory.ts`; add an absence assertion (no `card-trophy`, no `detail-trophies`) to an existing surviving spec; flip COVERAGE 9.2 "display survives until 11.3" rows to REMOVED and map 11.3 ACs.
- The epic ends here: after this story the epic success criteria hold (grep-clean, anonymous surfaces green, manual flows unchanged, schema clean).

**Block If:** any production caller of `setTrophyCountsBatch`, `listPlatinumBackfillCandidates`, or `hasAnyTrophyData` exists (inventory says zero), or a shelf consumer reads `game.trophy` beyond Card/DetailPanel.

**Never:**
- Never touch `platinum_on`/`completed_on`/`owned_via`/`bought_on` columns or their flows.
- Never delete `PlatinumTrophy.tsx`, the `card__flag--platinum` cluster, or the `platinum-trophy` testid.
- No changes to `no-credential-code.test.ts` or `psn-encapsulation.test.ts` (verified no collision; they guard the credentialed wire, not the display).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card render | game with (stale) trophy data pre-migration UI | no `card-trophy` element; platinum badge still renders when `platinum_on` set | n/a |
| Detail render | same | no `detail-trophies` section; Milestones + Dates rows unchanged | n/a |
| Migration | row with milestones+ownership+trophy values | trophy columns gone; milestone/ownership values byte-identical | n/a |
| Shelf payload | GET /shelf, /game/:id | no `trophy` field; zod (server + web) has no trophy schema | n/a |
| Manual platinum | set platinum date in detail | records + displays exactly as before | existing paths |

</intent-contract>

## Code Map

- `web/shelf/Card.tsx:198-210` — `card__trophy` block; DELETE (keep `:65-73,169-178` platinum badge). `Card.test.tsx` — delete 3 trophy tests + `trophy: null` factory field; keep `platinum-trophy` test
- `web/shelf/DetailPanel.tsx:19-25,326-349` — `TROPHY_TIERS` + Trophies section; DELETE (keep Milestones `:308-324`, Dates `:372-383`). `DetailPanel.test.tsx` — delete trophy tests
- `web/shelf/card.css` `.card__trophy`, `web/shelf/detail-panel.css` `.detail-panel__trophy-*` — delete rules
- `web/shelf/api.ts:44-61,91` — web zod trophy schemas/types + field; DELETE
- `src/routes/shelf.ts:3,17-22,52-59` — server zod trophy schema + `TROPHY_GRADES` import; DELETE
- `src/services/shelf.ts:8-19,71-84,94-114,152` — trophy imports, `ShelfGame.trophy`, `TrophyTiers`, `bakeTrophy`, bake call; DELETE
- `src/core/trophy.ts` + `trophy.test.ts` — DELETE; `src/core/index.ts:17` — remove export line
- `src/repositories/tracking.ts:14,245-262,263,276-…,342-368,375-388` — `TrophyTierCounts` import, `TrophyCountsWrite`, `TROPHY_BATCH_SIZE`, `setTrophyCountsBatch`, `listPlatinumBackfillCandidates`, `hasAnyTrophyData`; DELETE. `src/repositories/tracking.test.ts` — DELETE (whole file tests only the batch write)
- `src/repositories/games.ts:260-272,314-322` — `LibraryRow` trophy fields + SELECT columns; remove surgically
- `src/schema/catalog.ts:119-146` — 11 trophy column defs + JSDoc; DELETE
- `migrations/0011_drop_trophy_columns.sql` + `meta/0011_snapshot.json` + `_journal.json` — 11 × `DROP COLUMN` with statement-breakpoints; snapshot without trophy columns
- `test/integration/` — migration hazard test (survivor columns byte-identical)
- `playwright/e2e/epic9-trophies.spec.ts` — DELETE; `playwright/support/helpers/d1.ts:127-146` + `game-factory.ts:31-40,68-69` — strip trophy seeding; absence assertion in a surviving spec
- `playwright/COVERAGE.md` — flip 9.2 display rows to REMOVED by 11.3; map 11.3 ACs
- `_bmad-output/implementation-artifacts/deferred-work.md:368-392` — mark the three trophy entries resolved-by-deletion (append resolution notes, don't rewrite history)

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/Card.tsx` + test + css -- delete trophy readout, keep platinum badge -- display AC
- [x] `web/shelf/DetailPanel.tsx` + test + css -- delete Trophies section, keep Milestones/Dates -- display AC
- [x] `web/shelf/api.ts`, `src/routes/shelf.ts`, `src/services/shelf.ts` -- remove trophy from the DTO/zod chain -- payload AC
- [x] `src/core/trophy.ts` + test + `core/index.ts` -- delete domain module -- dead after display removal
- [x] `src/repositories/tracking.ts` + `tracking.test.ts`, `src/repositories/games.ts` -- delete orphan fns + LibraryRow trophy fields -- 11.1/11.2 delegation
- [x] `src/schema/catalog.ts` -- remove 11 trophy columns -- schema AC
- [x] `migrations/0011_*` + journal + snapshot -- DROP COLUMN migration -- schema AC
- [x] `test/integration/` migration hazard test -- survivors byte-identical, trophy columns absent via PRAGMA -- named hazard
- [x] playwright: delete `epic9-trophies.spec.ts`, strip seed helpers, absence assertion, COVERAGE rows -- Playwright-coverage rule
- [x] `deferred-work.md` -- close the three trophy entries as resolved-by-deletion -- ledger hygiene

**Acceptance Criteria:**
- Given a game card and its detail view, when they render, then no trophy %/grade/tier readout appears anywhere (jsdom + Playwright absence assertions), while the platinum badge and Milestones section render exactly as before.
- Given the D1 schema after migration 0011, when inspected (PRAGMA), then no `trophy_*` column remains and `platinum_on`, `completed_on`, `owned_via`, `bought_on` are intact with values preserved (hazard test).
- Given a platinum or story-completion milestone, when set manually in the detail view, then it records and displays exactly as before — Epic 2 suites pass unmodified.
- Given the full suite (`tsc`, biome, vitest, playwright), when run, then green with zero references to `trophyGrade`, `completionPercent`, `setTrophyCountsBatch`, `card-trophy`, `detail-trophies` outside git history.

## Spec Change Log

## Review Triage Log

### 2026-07-15 — Review pass (Blind Hunter + Edge Case Hunter, deduped)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 3, low 3)
- defer: 0
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` migration tests applied ALL migrations after the target (a future 0012 could mask or cause a failure) — both 0010 and 0011 tests now apply `slice(0, target + 1)`; 0010's stale "last migration" assert also made position-independent (it was failing after 0011 landed)
  - `[medium]` `[patch]` 0011 hazard test's "ONLY those" was a 4-column subset check and survivors seeded mostly NULL — now asserts the EXACT post-0011 column list and every survivor column carries a non-NULL value asserted byte-identical
  - `[medium]` `[patch]` deploy-window hazard unrecorded (old Worker SELECTs trophy_* against the migrated DB until the deploy lands) — recorded in the migration header with the acceptance rationale; recovery path for a mid-file death also documented
  - `[low]` `[patch]` e2e absence assertion spelled `card-trophy`/`detail-trophies` as literals while the jsdom pins use split halves — e2e now uses the same halves convention
  - `[low]` `[patch]` `PlatinumTrophy.tsx` comment still named the deleted FAB trophy-sync call site — fixed
  - `[low]` `[patch]` `db.ts` batch-typing comment cited the deleted trophy sync as precedent — re-pointed at the surviving PS+ catalog persistence
- rejected (for the record): pre-flight sqlite_master drift check (schema fully migration-managed, single-user); absence pins "trivially green" (accepted — they guard testid reuse; the real pin is the deleted code + migration test); duplicated findIndex boilerplate (two copies acceptable); absence assert desktop-only (the readout is viewport-independent); journal trailing newline; seed-import comment epistemics; migration idempotency rebuild-style rewrite (recovery comment suffices for a single-user D1); position of the absence assert inside the geometry test (it rides the only test that opens both card and panel).

## Design Notes

- Snapshot 0011: prefer `drizzle-kit generate` after editing the schema (it emits the DROP COLUMN statements + correct snapshot in one step); fall back to hand-authoring per 0010 precedent only if generate output is wrong.
- Epic completion: this is the last story — the Auto Run Result should record the epic-level success-criteria check (grep-clean guard green, anonymous suites green, manual flows unchanged, schema clean).

## Verification

**Commands:**
- `bun run typecheck` -- expected: clean
- `bun run lint` -- expected: clean
- `bun run test` -- expected: green; migration 0011 hazard test present
- `bun run test:e2e` -- expected: green minus the pre-existing epic6 CSV EPERM
- `grep -rn "trophyGrade\|completionPercent\|setTrophyCountsBatch\|card-trophy\|detail-trophies" src web test playwright` -- expected: no hits

## Auto Run Result

**Summary:** The trophy display and schema are gone — the epic is complete. Card/detail trophy %/grade readout deleted (PlatinumTrophy badge and Milestones section untouched), `core/trophy.ts` + tests deleted, trophy stripped from the shelf DTO/zod chain (server + web, symmetric so deploy skew is safe both directions), the three orphaned repository fns deleted, the 11 `trophy_*` columns dropped by migration 0011 (`ALTER TABLE DROP COLUMN`, snapshot verified drift-free by running `drizzle-kit generate`), Playwright seed helpers and `epic9-trophies.spec.ts` deleted with an absence pin added to `epic2-detail.spec.ts`.

**Epic 11 success criteria (this closes the epic):** grep-clean guard green (`src/no-credential-code.test.ts`, 11 identifiers over 5 dirs); the three credentialed routes 404 (hazard test); anonymous PS+ catalog check/cron/browse + CSV export suites green; manual milestone and ownership flows byte-for-byte unchanged (Epic 2/6.4 suites unmodified, migration hazard test proves survivor values byte-identical); schema clean (PRAGMA exact-column-list assert); deployed Worker secrets verified free of `PSN_NPSSO`.

**Files changed:** ~28 (4 web display files + tests + css, 3 DTO/zod files, core module + barrel, 2 repository files + deleted test, schema, migration 0011 SQL/journal/snapshot, migration hazard test, 2 playwright support files, 1 deleted + 1 edited e2e spec, COVERAGE.md, deferred-work ledger, 3 comment fixes).

**Review:** 6 patches (3 medium: migration-test isolation + exact-column/full-value hazard assert + deploy-window documentation; 3 low), 0 deferred, 8 rejected. Note: the implementation agent died mid-run (session limit) after ~90% of the work; the orchestrator completed the COVERAGE mapping, ledger notes, e2e absence pin, and the 0010-test regression its 0011 migration exposed.

**Verification:** `tsc -b` clean; `biome check` clean (250 files); vitest 1806/1806 green; playwright 94/94 green (including the epic6 CSV test that failed with a pre-existing environmental EPERM in earlier runs) + the edited detail spec re-run green in isolation; reference grep zero hits (absence pins use split-halves).

**Residual risks:** the deploy window (documented in the migration header — old Worker 500s on shelf reads between migration apply and deploy completion, one CI step, human-gated); a mid-file migration death needs the documented manual recovery (SQLite lacks DROP COLUMN IF EXISTS).

**Follow-up review recommendation:** false — review patches hardened tests and docs; no behavior or data-path change came out of review.
