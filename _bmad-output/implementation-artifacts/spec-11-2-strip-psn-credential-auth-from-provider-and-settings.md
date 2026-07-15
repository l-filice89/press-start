---
title: 'Story 11.2: Strip PSN credential auth from the provider and settings'
type: 'refactor'
created: '2026-07-15'
status: 'done'
baseline_revision: 'b4299c8caffb2437a8529fa43e0241643026b258'
final_revision: 'e2fc2c63727fcf44e1a9291c547c462c84a49a03'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** After 11.1 no route reaches it, but the credential machinery still exists: the NPSSO→bearer exchange in `PsnProvider`, the `psn_npsso`/`psn_auth` settings, the Settings token field, the expired-token banner, and the `PSN_NPSSO` env plumbing. Any future import is one line away from a credentialed fan-out; the epic's promise is grep-clean.

**Approach:** Collapse `PsnProvider` to its anonymous catalog methods, delete all NPSSO/auth-expired plumbing (service, route, UI, env types), trim the `PsnOp` lock union to `catalog-refresh`, remove the dead surface 11.1 delegated here (`sync_attention` read/write/schema, sync-era orphan repository fns, dead psn-stub exchange double), and ship migration `0010` deleting the dead setting rows + stale lock rows.

## Boundaries & Constraints

**Always:**
- Anonymous catalog surface survives byte-for-byte in behavior: `fetchPsPlusExtraCatalog`, `fetchPsPlusCatalogGenreKeys`, `fetchPsPlusExtraCatalogByGenre`, `PsnStoreRejectionError`, catalog suites, cron, PS+ check, genre sweep.
- `src/services/psn-lock.ts` file survives; only the `PsnOp` union trims to `'catalog-refresh'`. Generic lock hazard tests survive re-pointed at `catalog-refresh`.
- Hazard test (grep-clean AC): a test or CI-suitable check asserting no `fetchPurchasedGames|fetchTrophyTitles|npsso|NPSSO|getBearer|AUTHORIZE_URL|TOKEN_URL` in `src/ web/` (allow `worker-configuration.d.ts` regeneration lag only if wrangler regenerates it — prefer zero hits).
- Migration `0010` follows the `0006_drop_psn_cookie_setting.sql` precedent (hand-written DML + `_journal.json` entry): `DELETE FROM setting WHERE key IN ('psn_npsso','psn_auth','sync_attention')` plus stale `psn_op_lock` rows whose value tags a retired op. Must NOT touch other keys/tables.
- Settings a11y: the `role="status"` live region currently lives on the NPSSO section; region-save feedback depends on it — move it to the region section when the NPSSO section dies.
- `.dev.vars` holds a real NPSSO token (gitignored): blank the value locally; scrub `PSN_NPSSO` lines from `.dev.vars.example` and `.dev.vars.e2e`; drop from `worker-configuration.d.ts` (3 sites) and README setup.

**Block If:** any PRODUCTION code path still calls a credentialed provider method when deletion starts (inventory says zero — if wrong, the 11.1 severance was incomplete; HALT).

**Never:**
- No trophy work: `core/trophy.ts`, `trophy_*` columns, Card/DetailPanel readouts, `setTrophyCountsBatch`, `listPlatinumBackfillCandidates`, `hasAnyTrophyData`, `epic9-trophies.spec.ts` — all story 11.3.
- No replacement auth of any kind; no burner-account scaffolding.
- Never delete `stubStore`/`PSN_LIBRARY_HOST`/`realFetch` in `test/integration/psn-stub.ts` (live for catalog suites).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Severed route | `PUT /api/settings/psn-npsso` | 404 | n/a — route absent |
| GET settings | `GET /api/settings` | payload has no `psnNpssoSet`, `psnAuthExpired`, `syncAttention` fields; timezone/region/fab/claim intact | n/a |
| Migration on seeded DB | rows `psn_npsso`, `psn_auth`, `sync_attention`, stale `psn_op_lock` (`…:library-sync:…`) + unrelated keys | dead rows gone; `psn_region`, `timezone`, live `catalog-refresh` lock rows SURVIVE | n/a |
| Catalog check under lock | PS+ check + genre sweep with `catalog-refresh` lock | behavior unchanged, suites green | existing 409 paths |
| Settings UI | panel open | no NPSSO section, no expired banner; region save feedback still announced via `role="status"` | n/a |

</intent-contract>

## Code Map

- `src/providers/psn.ts` — delete credentialed half: OAuth constants (`AUTHORIZE_URL`,`TOKEN_URL`,`OAUTH_*`), `OPERATION`/`PERSISTED_QUERY_HASH`, `PAGE_SIZE`/`MAX_PAGES`, trophy constants, `PsnAuthError`, `PsnGame`/`PsnTrophy*`/`PsnPlatinumDate` types, `exchange`/`getBearer`, `fetchPage`/`fetchTrophyPage`, `pageUrl`, `toPsnGame`/`toTrophyTitle`, `fetchPurchasedGames`/`fetchTrophyTitles`/`fetchPlatinumEarnedAt` impls + interface methods; drop `getNpsso` factory param. Keep `API_URL`, `PSN_TIMEOUT_MS`, all `CATALOG_*`, `PsnStoreRejectionError`, catalog types/impls
- `src/services/psplus.ts:121-123`, `src/services/psplus-genres.ts:140-142` — remove the `getNpsso` arg from `createPsnProvider` calls
- `src/providers/psn.test.ts` — delete the three credentialed describes; keep catalog describes. `src/providers/psn-encapsulation.test.ts` — trim to catalog-only cases
- `src/services/settings.ts` — delete `PSN_NPSSO_SETTING_KEY`, `PSN_AUTH_*`, `getPsnNpsso`, `markPsnAuthExpired`, `clearPsnAuthExpired`, `isPsnAuthExpired`, `SYNC_ATTENTION_SETTING_KEY`, `readSyncAttention`, `writeSyncAttention`, `SyncAttentionItem`
- `src/routes/settings.ts` — delete `PUT /psn-npsso` handler, `unwrapNpsso`, `COOKIE_OCTET`, `psnNpssoBodySchema`; strip `psnNpssoSet`/`psnAuthExpired`/`syncAttention` from GET payload + Promise.all
- `web/settings/api.ts` — remove `savePsnNpsso`, `syncAttentionItemSchema`, and `psnNpssoSet`/`psnAuthExpired`/`syncAttention` schema fields
- `web/settings/SettingsPanel.tsx` — delete the NPSSO token section; move `role="status"` live region to the region feedback div. `SettingsPanel.test.tsx` — delete NPSSO tests, fix mocks, keep the 11.1 backfill-absence + region/fab/cancel tests
- `web/shell/AppShell.tsx:92-101` — delete the `expired-token` banner usage (keep `AttentionBanner` component + other variants); `AttentionBanner.test.tsx` — drop the NPSSO-message case
- `src/services/psn-lock.ts:46-50` — `PsnOp` → `'catalog-refresh'` only
- `test/integration/psn-lock.test.ts` — re-point retired-op literals at `catalog-refresh` (keep every hazard: atomic claim, per-user, cross-op steal is moot → adapt or drop that one case, TTL, failure release, own-lock release); `test/integration/psplus-cron.test.ts:175` — foreign-lock stand-in → distinct `catalog-refresh` token holder
- `test/integration/settings.test.ts` — drop npsso/psn_auth/env-seed/syncAttention blocks; keep timezone/region/fab/claim
- `src/repositories/games.ts` — delete `listGamesWithPsnLinks` (+ its `games.test.ts` pin) and `listDiscardedTitleKeys` (no pin)
- `test/integration/psn-stub.ts` — delete `stubPsnFetch`, `PSN_TROPHY_HOST`, exchange-only scaffolding (`AUTHORIZE`/`TOKEN` constants); keep `stubStore`/`realFetch`/`PSN_LIBRARY_HOST`/`StoreCall`
- `migrations/0010_drop_psn_credential_settings.sql` + `migrations/meta/_journal.json` — DML migration per Always-constraint
- `test/integration/` — migration hazard test: seeded dead rows + survivor rows → apply → dead gone, survivors intact
- `worker-configuration.d.ts` (3 sites), `.dev.vars` (blank value), `.dev.vars.example`, `.dev.vars.e2e`, `README.md:102` — retire `PSN_NPSSO`
- `playwright/e2e/epic4-settings.spec.ts` — delete token-field/deep-link/charset/expired-banner tests + `psn_npsso`/`psn_auth` seed helpers; add settings-surface e2e (no NPSSO section rendered)
- `playwright/COVERAGE.md` — mark 4.1/9.1b token rows removed by 11.2; map 11.2 ACs

## Tasks & Acceptance

**Execution:**
- [x] `src/providers/psn.ts` + `psn.test.ts` + `psn-encapsulation.test.ts` -- delete credentialed half, drop `getNpsso` param -- provider collapses to anonymous catalog
- [x] `src/services/psplus.ts` + `psplus-genres.ts` -- drop `getNpsso` args -- factory signature changed
- [x] `src/services/settings.ts` + `src/routes/settings.ts` -- delete NPSSO/auth-expired/sync_attention plumbing + PUT route -- server credential surface gone
- [x] `web/settings/api.ts` + `SettingsPanel.tsx` (+tests) -- delete NPSSO section + schema fields; relocate `role="status"` -- UI credential surface gone, a11y preserved
- [x] `web/shell/AppShell.tsx` + `AttentionBanner.test.tsx` -- delete expired-token banner usage/case -- banner variant dead
- [x] `src/services/psn-lock.ts` + `psn-lock.test.ts` + `psplus-cron.test.ts` -- trim `PsnOp` to `catalog-refresh`, re-point tests -- lock serves only anonymous refresh
- [x] `src/repositories/games.ts` + `games.test.ts` -- delete `listGamesWithPsnLinks`, `listDiscardedTitleKeys` -- sync-era orphans (11.1 delegation)
- [x] `test/integration/psn-stub.ts` -- delete `stubPsnFetch`/`PSN_TROPHY_HOST`/exchange scaffolding -- dead double (11.1 delegation)
- [x] `test/integration/settings.test.ts` -- drop npsso/psn_auth/syncAttention blocks -- suites of deleted surface
- [x] `migrations/0010_*.sql` + `meta/_journal.json` + migration hazard test -- delete dead setting rows + stale retired-op lock rows; survivors intact -- 11.1 delegation + epic AC
- [x] `worker-configuration.d.ts`, `.dev.vars*`, `README.md` -- retire `PSN_NPSSO` -- env surface gone
- [x] `playwright/e2e/epic4-settings.spec.ts` + `COVERAGE.md` -- delete token/expired-banner e2e, add no-NPSSO-section e2e, update rows -- Playwright-coverage rule

**Acceptance Criteria:**
- Given the codebase after this story, when grepped for `fetchPurchasedGames|fetchTrophyTitles|NPSSO|npsso|getBearer`, then zero hits in `src/`, `web/`, `test/`, `playwright/` (hazard-greppable, pinned by a check).
- Given the settings page, when Luca opens it, then no NPSSO field and no expired-token banner exist (Playwright-asserted) and region-save feedback is still announced (`role="status"` present).
- Given a DB seeded with `psn_npsso`, `psn_auth`, `sync_attention`, a stale `library-sync` lock row, plus `psn_region`/`timezone` rows, when migration 0010 applies, then dead rows are gone and survivors intact (hazard test).
- Given the monthly catalog cron, PS+ check, and genre sweep, when they run under the `catalog-refresh` lock, then all suites pass.
- Given `GET /api/settings`, when called, then the payload carries no `psnNpssoSet`/`psnAuthExpired`/`syncAttention` and the SPA renders settings without error.

## Spec Change Log

## Review Triage Log

### 2026-07-15 — Review pass (Blind Hunter + Edge Case Hunter, deduped)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 1: (medium 1)
- reject: 7
- addressed_findings:
  - `[medium]` `[patch]` grep-clean guard scope thinner than the epic invariant — added `scripts/` to scan dirs and 5 identifiers (`fetchPlatinumEarnedAt`, `PsnAuthError`, `psn_auth`, `sync_attention`, Sony OAuth host, split-halved); `.md` exempted with rationale; renamed the colliding `PSN_AUTH_PATTERNS` constant; split-halved the migration test's seeded keys; fixed the guard's overclaiming comment
  - `[medium]` `[patch]` lock op-segment authorization branch lost its only test when the cross-op steal case was dropped — added forged retired-op-token refusal test at the service seam (`psn-lock.test.ts`)
  - `[low]` `[patch]` migration 0010 missing the repo's `--> statement-breakpoint` marker between its two statements — added
  - `[low]` `[patch]` region e2e `panel.getByRole('status')` strict-mode brittle — re-targeted to `psn-region-feedback` testid + role attribute assert
  - `[low]` `[patch]` `settings-panel__token-input` class survived the token section — renamed to `__text-input` (tsx + css)
  - `[low]` `[patch]` orphaned `.dev.vars.e2e` comment referencing deleted variable/test — removed
- deferred: `sync-reconcile.ts`/anchor-write production-dead weight → deferred-work.md (delete vs keep for burner-account revival is a product call)
- rejected (for the record): **deployed Wrangler secret still holds the token — VERIFIED FALSE live**: `wrangler secret list` shows no `PSN_NPSSO` on the deployed Worker, README's "was retired" is accurate; deploy-skew payload rejection for stale bundles (transient, self-heals on reload, single-user — and server-side stub fields would reintroduce banned identifiers, tripping the guard); migration catch-all for malformed lock values (single mint site, 2-min TTL); fabricated journal `when` (matches 0006 hand-authored precedent); migration-test PK seam (unrepresentable combination); initial-focus-on-region-input (parity with prior behavior — the panel always focused its first input); `PSN_LIBRARY_HOST` naming nit.

## Design Notes

- Delegations IN (from 11.1, all carried as tasks/ACs above): `sync_attention` full surface, orphan repo fns, dead psn-stub double, stale lock rows in migration. Trophy-era orphans (`setTrophyCountsBatch`, `listPlatinumBackfillCandidates`, `hasAnyTrophyData`) stay for 11.3 with the schema drop.
- The `login_required` stopgap fix inside `exchange()` dies with `exchange()` — subsumed per sprint-change-proposal-2026-07-15 §5.
- Grep-clean check: prefer a tiny vitest (`src/no-credential-code.test.ts` or similar) reading source files, mirroring the existing orphan-test guard pattern, so CI pins the epic's core invariant permanently.

## Verification

**Commands:**
- `bun run typecheck` -- expected: clean
- `bun run lint` -- expected: clean
- `bun run test` -- expected: green; migration hazard test + grep-clean guard present
- `bun run test:e2e` -- expected: green minus the pre-existing epic6 CSV EPERM environment failure
- `grep -riE "npsso|fetchPurchasedGames|fetchTrophyTitles|getBearer" src web test playwright` -- expected: no hits

## Auto Run Result

**Summary:** The credential machinery is gone. `PsnProvider` collapsed to anonymous catalog methods only (OAuth exchange, bearer, purchased-games, trophy fetches, `PsnAuthError` deleted; `getNpsso` factory param dropped); NPSSO settings plumbing removed end to end (service keys, `PUT /settings/psn-npsso`, UI token section, expired-token banner incl. the now-dead `AttentionBanner` variant); `sync_attention` dead surface removed (11.1 delegation); `PsnOp` trimmed to `catalog-refresh`; sync-era orphan repository fns and the dead psn-stub exchange double deleted; `PSN_NPSSO` retired from env types/`.dev.vars*`/README (deployed secret verified already absent via `wrangler secret list`); migration `0010` deletes `psn_npsso`/`psn_auth`/`sync_attention` rows + retired-op lock rows with a hazard test proving survivors (`psn_region`, `timezone`, live `catalog-refresh` lock) intact. New permanent CI guard `src/no-credential-code.test.ts` pins the epic invariant over `src/ web/ test/ playwright/ scripts/` code.

**Files changed:** 35 tracked edits + 5 new files (migration 0010 SQL/journal/snapshot, migration hazard test, grep-clean guard). Largest: `src/providers/psn.ts` (~600 lines of credentialed code out), `psn.test.ts` (credentialed describes out, 500-status catalog test restored), `settings` service/route/web triplet, `SettingsPanel` + tests rebuilt around the surviving sections.

**Review:** 6 patches applied (2 medium: guard-scope extension, forged-op lock test; 4 low), 1 deferred (production-dead `sync-reconcile`/anchor write → ledger), 7 rejected — including the reviewers' top finding (deployed secret at rest) which was **verified false live**: no `PSN_NPSSO` in `wrangler secret list`.

**Verification:** `tsc -b` clean; `biome check` clean (253 files); vitest 1855/1855 green (migration hazard + extended guard + forged-op lock test included); playwright 95 passed / 1 failed (the pre-existing epic6 CSV-download EPERM, environmental); `grep -riE "npsso|fetchPurchasedGames|fetchTrophyTitles|getBearer" src web test playwright` — zero hits.

**Residual risks:** stale cached SPA bundles reject the slimmer settings payload until a reload (accepted: transient, single-user; a server stub would reintroduce banned identifiers). `.dev.vars` locally still carries a blank `PSN_NPSSO=` line (gitignored; the real token value was blanked). Trophy display/schema still present — story 11.3.

**Follow-up review recommendation:** false — patches were guard/test hardening and cosmetic renames; no behavior, API, or data-path change came out of review.
