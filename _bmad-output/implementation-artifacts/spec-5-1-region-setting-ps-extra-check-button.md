---
title: 'Story 5.1: Region setting & PS+ Extra check (button)'
type: 'feature'
created: '2026-07-11'
status: 'done'
baseline_revision: '27959c7f2562f66a9566016934d2d4a76a0c4192'
final_revision: '7cde05755832ab2206dfad5a2aada8a32cb46d5e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Nothing tells Luca a non-owned tracked game is already playable via his PS+ Extra subscription, so he can buy a game the subscription covers. `game.ps_plus_extra` exists but is only a one-shot seed-import proxy; no code updates it afterwards.

**Approach:** Store the account region in `SETTING` (seeded from a wrangler var on first read). Add a "Check PS+ Extra" FAB drawer item that fetches the region's PS+ Game Catalog through a new `PsnProvider` method (public store GraphQL, no cookie), sets/clears `ps_plus_extra` on tracked non-owned games by normalized-title match, and reports flag changes in a summary modal. Playable-now already derives from this column — no derived-state change.

## Boundaries & Constraints

**Always:**
- Region: `getPsnRegion(db,userId,env)` — `SETTING` key `psn_region` wins; else `env.PSN_REGION` is **persisted to `SETTING`** then returned (cron in 5.2 must read the same stored value). Sent as `x-psn-store-locale-override` header.
- Catalog fetch is a new `PsnProvider` method (provider seam, AR-5); it is a public endpoint — no `pdccws_p` cookie. Wire protocol (pinned by research 2026-07-11, playstation-store-api):
  GET `https://web.np.playstation.com/api/graphql/v1/op` with `operationName=categoryGridRetrieve`, `variables={"id":CATEGORY,"pageArgs":{"size":100,"offset":N},"sortBy":{"name":"productReleaseDate","isAscending":false},"filterBy":[],"facetOptions":[]}`, `extensions={"persistedQuery":{"version":1,"sha256Hash":"4ce7d410a4db2c8b635a48c1dcec375906ff63b19dadd87e073f8fd0c0481d35"}}`. PS+ Game Catalog category id: `3a7006fe-e26f-49fe-87e5-4473d7ed0fb2`. Response path `data.categoryGridRetrieve.{products,pageInfo.totalCount}`.
- Pagination hazard: advance `offset` by the number of items actually returned (server may cap page size below the requested 100); stop when a page is empty or `offset >= totalCount`; hard cap 30 pages.
- **Flag hazard (FR-38, AR-10):** the check updates `ps_plus_extra` ONLY on games tracked by the user where `owned = false` — set when the normalized title is in the catalog, clear when not (both directions). Owned games' rows and untracked games are never written. Catalog games absent from the library are NEVER inserted.
- Match by `title_normalized` (existing `normalizeTitle` on catalog product names). No fuzzy matching.
- Check completion opens a summary modal (house `useModalTrap` pattern) listing newly-flagged and newly-cleared titles + count checked; failure surfaces as a toast (existing FAB onError pattern). No attention-banner writes (that channel is 5.2's failed-cron notice).
- Playable-now stays `(owned || inPsPlusExtraCatalog) && released` — already implemented; card flag already renders only when `psPlusExtra && !owned`. Do not change `src/core/derived-state.ts`.

**Block If:** flag storage would require a schema migration beyond the existing `game.ps_plus_extra` column.

**Never:** no auto-adding catalog games; no cron trigger (5.2); no refreshed-at timestamp surface (5.3); no PS+ tier settings UI; no hand-written GraphQL (persisted query only); no fetch in query/render paths.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Tracked non-owned game's title in catalog | `ps_plus_extra` set; title in modal "now in catalog" list | No error |
| Left catalog | Flagged non-owned game no longer in catalog | Flag cleared; title in "left catalog" list | No error |
| Owned game | Owned game title in catalog | Row untouched (flag irrelevant/hidden) | No error |
| Untracked catalog game | Catalog title not in library | Nothing inserted, not reported | No error |
| No changes | Catalog matches current flags | Modal reports 0 changes + games checked | No error |
| Region unset | No `psn_region` setting, `env.PSN_REGION` present | Env value persisted to `SETTING`, used for the call | No error |
| Fetch fails | Sony 4xx/5xx or network error | No flag writes at all (all-or-nothing); toast with error | 502 from route |
| Server caps page size | Pages return 24 items despite size=100 | Offset advances by actual count; full catalog still read | No error |

</intent-contract>

## Code Map

- `src/providers/psn.ts` -- add `fetchPsPlusExtraCatalog(region): Promise<string[]>` (product names) + wire constants; existing `createPsnProvider` factory
- `src/services/settings.ts` -- add `PSN_REGION_SETTING_KEY` + `getPsnRegion(db,userId,env)` (mirror `getPsnCookie`, but persist env seed)
- `src/services/psplus.ts` -- NEW `runPsPlusCheck(db,userId,env)` service (fetch catalog → diff flags → write → result)
- `src/repositories/games.ts` -- add flag update helper (set/clear `ps_plus_extra` by game ids); `listLibraryForUser` for tracked rows
- `src/routes/psplus.ts` (NEW) + app composition (where `/sync` mounts) -- `POST /ps-plus-check` route mirroring `src/routes/sync.ts` (requireAuth, 502 on provider failure)
- `src/core/title.ts` (or wherever `normalizeTitle` lives) -- reuse, no change
- `web/settings/api.ts` -- `psPlusCheckResultSchema` + `runPsPlusCheck` fetcher
- `web/shell/Fab.tsx` -- second mutation + "Check PS+ Extra" `fab__item` (spinner, pending guard, same open-drawer semantics as Sync)
- `web/shell/AppShell.tsx` -- host the check-summary modal state (parallel to sync summary)
- `web/shell/PsPlusCheckModal.tsx` -- NEW small modal (counts + flagged/cleared title lists), `useModalTrap`
- `wrangler.jsonc` -- `vars.PSN_REGION` (default `it-it`); mirror in `env.e2e` block
- `test/integration/` -- new `psplus.test.ts` (stub global fetch, pass-through non-PSN — copy `sync.test.ts:49-70` pattern)
- `playwright/e2e/`, `playwright/COVERAGE.md` -- seeded-flag e2e + Epic 5 rows

## Tasks & Acceptance

**Execution:**
- [x] `src/providers/psn.ts` (+ `src/providers/psn.test.ts`) -- `fetchPsPlusExtraCatalog(region)`: persisted-query GET per the pinned wire protocol, region header, offset-by-actual-count pagination (unit-test the cap hazard), throws on non-OK -- AC1/AC2
- [x] `src/services/settings.ts` (+ integration test) -- `PSN_REGION_SETTING_KEY='psn_region'`, `getPsnRegion` persists the env seed on first read -- AC1
- [x] `src/repositories/games.ts` -- `setPsPlusExtraFlags(db, gameIds, value)` (batched `IN` update) -- AC3
- [x] `src/services/psplus.ts` -- `runPsPlusCheck`: region → catalog names → normalize → diff against tracked `owned=false` rows → set/clear → `{flagged:string[], cleared:string[], checked:number}`; `{ok:false,reason:'provider'}` outcome on fetch failure (no partial writes: fetch fully, then write) -- AC2/AC3
- [x] `src/routes/psplus.ts` + app composition -- `POST /ps-plus-check` behind `requireAuth`; 502 + generic message on provider failure -- AC2
- [x] `test/integration/psplus.test.ts` -- hazard tests: sets flag (non-owned, in catalog), clears flag (left catalog), owned row untouched, untracked catalog game not inserted (game count unchanged), region persisted from env on first run, fetch failure writes nothing -- AC1–AC4
- [x] `web/settings/api.ts` -- zod schema + `runPsPlusCheck` POST fetcher -- AC2
- [x] `web/shell/PsPlusCheckModal.tsx` (+ jsdom test) -- summary modal: checked count, "Now in PS+ Extra" / "Left PS+ Extra" lists, empty-state copy -- AC6
- [x] `web/shell/Fab.tsx` (+ test) -- "Check PS+ Extra" item: spinner while pending, drawer stays open, success → `onPsPlusCheckComplete(result)` + invalidate `['shelf','shelf-search']`, error → toast -- AC2
- [x] `web/shell/AppShell.tsx` -- wire modal state from the Fab callback -- AC6
- [x] `wrangler.jsonc` -- `PSN_REGION` var in root + `env.e2e` -- AC1
- [x] `playwright/e2e/epic5-psplus.spec.ts` + `playwright/COVERAGE.md` -- e2e: seeded non-owned game with `ps_plus_extra=1` shows card flag + lights "Playable now" pill; same game seeded owned hides the flag. COVERAGE rows for live-check flows (button run, flag set/clear, modal) citing the unstubbable-PSN constraint, pinned instead at integration/jsdom tiers -- AC4/AC5
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- mark 5.1 done -- bookkeeping

**Acceptance Criteria:**
- Given no stored region, when the check first runs, then the region is persisted in `SETTING` from config and used for the catalog call (AC1)
- Given the FAB drawer's "Check PS+ Extra" item, when tapped, then the check runs via `PsnProvider` with a spinner (AC2)
- Given the check result, when flags apply, then `ps_plus_extra` is set/cleared on tracked non-owned games only, both directions, and no catalog game is auto-added (AC3)
- Given a game that becomes owned, when the shelf renders, then its PS+ flag is hidden and ignored (AC4)
- Given a flagged, released, non-owned game, when derived state computes, then Playable now is true (card flag + filter pill) (AC5)
- Given a completed check, when it resolves, then a summary modal reports the flag changes (AC6)

## Spec Change Log

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 1, medium 1, low 3)
- defer: 2: (medium 1, low 1)
- reject: 5: (low 5)
- addressed_findings:
  - `[high]` `[patch]` Empty 200 catalog wiped every flag (both reviewers) — guard added: a 0-product 200 now returns `provider` failure (502) instead of running the clear pass; new integration hazard test asserts a flagged game survives an empty catalog.
  - `[medium]` `[patch]` Empty-normalized-title collision — catalog names now `.filter(Boolean)` after normalize so `''` can't match a tracked game that also normalizes to `''`.
  - `[low]` `[patch]` Non-string `product.name` could throw outside the fetch try — provider now pushes only `typeof name === 'string'`.
  - `[low]` `[patch]` Sync + PS+ check could run concurrently and stack two `aria-modal` traps — both FAB chore buttons now disable while either mutation is pending.
  - `[low]` `[patch]` Service docstring overclaimed atomicity — reworded to note the set/clear are two statements (self-heal on next run) and empty-catalog also leaves flags untouched.
- deferred (see deferred-work.md): `ps_plus_extra` is a global `game` column while flag decisions use one user's ownership (single-tenant latent); modal focus-restore captures the in-modal Close button rather than the opener (shared bug also in `SyncSummaryModal`).
- rejected: no-region 409 shown as generic toast (branch unreachable — `PSN_REGION` always seeded); `totalCount` undercount early-break (speculative server bug; empty-page + 30-page cap already terminate); region seeded with `setSetting` not `onlyIfUnset` (no concurrent writer exists); region header validation (env-config trusted, no user write path); `console.error` error-class observability gap (acceptable for a button).

## Design Notes

- Catalog endpoint is public (store browse) — deliberately outside the cookie path; `PsnAuthError` semantics don't apply. Failure posture = generic provider error, not re-auth instructions.
- `ps_plus_extra` column semantics change from "seed-time membership proxy" to "current catalog membership, maintained by the check". Seed still writes its proxy value (harmless: first check overwrites; owned games never render the flag anyway). Document via comment at the schema field.
- Catalog names carry ™/®/edition noise — the same `normalizeTitle` join used for PSN↔Notion matching handles it. Unmatched tracked titles simply stay/become unflagged; no needs-attention channel here (a miss is indistinguishable from "not in catalog").

## Verification

**Commands:**
- `bun run typecheck` / `bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. new provider unit + psplus integration + modal/Fab jsdom tests
- `bun run test:e2e` -- expected: green incl. epic5 seeded-flag spec

## Auto Run Result

Status: **done**

### Summary
Story 5.1 ships the PS+ Extra catalog check: a FAB "Check PS+ Extra" drawer item POSTs `/api/ps-plus-check`, which fetches the account region's public PS+ Game Catalog through a new cookie-less `PsnProvider.fetchPsPlusExtraCatalog(region)` (persisted GraphQL query, offset-by-actual-count pagination, 30-page cap), then sets/clears `game.ps_plus_extra` on tracked **non-owned** games only — both directions, matched by normalized title, never inserting catalog-only games. Region lives in `SETTING` (`psn_region`), seeded once from `env.PSN_REGION` and persisted so the 5.2 cron reads the same value. Completion opens a summary modal (flagged / cleared / checked); provider failure surfaces as a 502 → toast. Playable-now derivation was already `(owned || ps_plus_extra) && released`, so no derived-state change.

### Files changed
- `src/providers/psn.ts` — `fetchPsPlusExtraCatalog(region)` + catalog wire constants; pushes only string product names.
- `src/services/settings.ts` — `PSN_REGION_SETTING_KEY` + `getPsnRegion` (persists env seed on first read).
- `src/repositories/games.ts` — `setPsPlusExtraFlags(db, ids, value)` batched `IN` update (empty-array guarded).
- `src/services/psplus.ts` — `runPsPlusCheck` service: fetch → empty-catalog data-loss guard → normalize (drop empties) → diff tracked non-owned rows → set/clear → result.
- `src/routes/psplus.ts` — `POST /ps-plus-check` behind `requireAuth`; 409 no-region / 502 provider failure.
- `web/settings/api.ts` — `psPlusCheckResultSchema` + `runPsPlusCheck` fetcher.
- `web/shell/PsPlusCheckModal.tsx` — summary modal (counts + flagged/cleared lists, empty-state).
- `web/shell/Fab.tsx` — "Check PS+ Extra" item; both chore buttons disable while either mutation pends.
- `web/shell/AppShell.tsx` — hosts the check-summary modal state.
- `wrangler.jsonc` / `worker-configuration.d.ts` — `PSN_REGION` var (root + `env.e2e`).
- Tests: `src/providers/psn.test.ts` (pagination/cap/error hazards), `test/integration/psplus.test.ts` (flag both-directions, owned untouched, no auto-add, region-seed, fetch-fail + empty-catalog write-nothing), `web/shell/PsPlusCheckModal.test.tsx`, `web/shell/Fab.test.tsx`, `playwright/e2e/epic5-psplus.spec.ts` + `playwright/COVERAGE.md` (Epic 5 rows).

### Review findings
- Patches applied (5): empty-200-catalog flag-wipe guard (**high**, + new hazard test), empty-normalized-title collision filter, non-string `product.name` coercion, both-buttons-disable to prevent stacked modals, docstring atomicity accuracy.
- Deferred (2): global `ps_plus_extra` column vs per-user ownership (single-tenant latent); modal focus-restore captures Close button not opener (shared with `SyncSummaryModal`). Both in `deferred-work.md`.
- Rejected (5): unreachable no-region toast, speculative `totalCount` undercount, `onlyIfUnset` seed, region header validation, error-class observability.

### Verification
- `bun run typecheck` — clean. `bun run lint` — clean.
- `bun run test` — 1174 passed (48 files), incl. the new empty-catalog hazard test.
- `bun run test:e2e epic5-psplus` — 1 passed. (First run failed only on a worktree font `/@fs` 403 tripping the network-error monitor; resolved by installing deps locally in the worktree so vite serves fonts from within root — no code/config change.)

### Residual risks
- Multi-user flag bleed on the shared `game.ps_plus_extra` column (deferred; latent under single-tenant auth).
- The PS+ catalog persisted-query hash / category id are pinned from external research (2026-07-11); a Sony-side rotation would 502 the check until re-pinned — now fails safe (empty/error never wipes flags).
