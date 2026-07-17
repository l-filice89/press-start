---
title: 'Story 8.4: The scheduled refresh serves every region (B4; B5 retired)'
type: 'feature'
created: '2026-07-17'
status: 'done'
baseline_revision: '0ff7a56'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-17-epic8-capacity.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The cron still serves ONE user (`findOldestUser` — the 8.2 interim bridge): one region refreshed, one user's settings carrying sweep state and failure flags, a capturable identity, and failure banners users can't act on.

**Approach:** AD-31/AD-32 (signed off): the cron fans out over the **distinct regions of registered users** under a **region-state ledger** (`last_success`, `last_attempt`, `failure_count`, `cycle_complete`, `last_user_activity`) — one rotation slot per fire, failed/stale regions first, 3-failure quarantine, skip idle-60d or cycle-complete regions. Sweep/leaving state moves from per-user SETTING rows onto the region ledger (a userless cron cannot key state by user). A shelf request against a stale (>35d) or absent snapshot triggers a `waitUntil` **membership-pass-only** refresh under a region-keyed single-flight lock, with a "PS+ catalog updating…" notice beside the as-of timestamp (placement signed off in AD-31). Failures are passive: the `psplus_refresh_failed` banner machinery and the manual check button are REMOVED.

## Boundaries & Constraints

**Always:**
- **New table `ps_plus_region_state`** (PK `region`; `tier` default 'extra'): `last_success`, `last_attempt`, `failure_count`, `cycle_complete` (int bool), `last_user_activity`, plus `sweep_state` and `leaving_state` JSON columns (the per-region homes of today's per-user setting JSONs — same shapes, same semantics, cursors and all). Migration 0017 creates it and drops nothing (the old setting keys just go unread; a cleanup DELETE for the four dead keys is included).
- **Cron entry** (`runScheduledPsPlusCheck` reworked): resolve distinct regions of registered users (`SELECT DISTINCT value FROM setting WHERE key='psn_region'` ∩ valid regions) — `findOldestUser` DIES. Pick ONE region per invocation: quarantined regions (`failure_count >= 3`) last and at most once per rotation window; otherwise failed/stale first (oldest `last_success`), skipping regions idle >60d (`last_user_activity`) or already `cycle_complete` this window. Window = the `15-28` cron window of the calendar month; a new window resets `cycle_complete` and `failure_count` (re-admits quarantined regions). The chosen region runs the SAME rotation as today (genre sweep pending → leaving pending → membership pass) against per-region state; `cycle_complete` sets when membership + genre + leaving are all done since the window opened. Outcomes update the ledger (attempt always; success/failure counts).
- **User-facing writes die in the cron:** no `markPsPlusRefreshFailed`, no per-user freshness stamp from the cron path — freshness becomes a per-region fact: the as-of timestamp reads the region ledger's `last_success` (route `/settings` swaps source; same response field). Timezone for `today`: UTC date (`new Date().toISOString().slice(0,10)`) — per-region facts stop carrying one user's timezone (review 8.3 residual).
- **Stale-snapshot guard**: on an authenticated shelf GET (the natural "first request of the day" — it also touches `last_user_activity`, max one ledger write per region per day), if the user's region has no snapshot or `last_success` > 35 days old, `c.executionCtx.waitUntil()` a **membership pass only** for that region under a **region-keyed lock** (`withPsnLock` re-keyed: lock key = `psn_region_lock:<region>` on a well-known row — same atomic upsert mechanics, user-independent), so concurrent same-region sign-ins coalesce. Genre/leaving follow via the cron (the guard arms them by resetting per-region sweep state, exactly as a membership pass does today).
- **UI**: the shelf/settings "PS+ CATALOG AS OF {date}" readout gains an "updating…" suffix while the guard's refresh is in flight — signalled by a `catalogRefreshing: boolean` on the settings response (lock-held = in flight). Placement: beside the as-of timestamp (AD-31, signed off — the UI-MOCK-GATE placement decision). No new palette, no banner.
- **REMOVALS** (8.4 owns them per AD-31): the manual "Check PS+ Extra" button (route `POST /ps-plus-check`, `web/settings` button + api fn), `psplus_refresh_failed` + `markPsPlusRefreshFailed`/`isPsPlusRefreshFailed`/`clearPsPlusRefreshFailed` + the failed-refresh attention banner surface and its tests. The catalog destination's EMPTY state (which offered "run the check here") now explains the automatic refresh instead ("the catalog updates automatically — check back soon", same empty-state frame). The failed-SCORE-refresh banner is UNTOUCHED (different feature, user-actionable).
- The per-user PSN single-flight lock stays for any remaining per-user PSN ops; the catalog refresh path migrates to the region lock.
- **Budget (AD-32)**: the cron's per-invocation shape is unchanged (one rotation slot) plus ≤3 ledger reads/writes — restate the ledgers. The guard's `waitUntil` membership pass ≈ 34 subrequests in a REQUEST context (50 cap: fits; the request itself spent ~5) — state it. `last_user_activity` writes are date-gated (one per region per day).
- Multi-user correctness: with users in regions X/Y, consecutive cron fires refresh X and Y in rotation; each user's shelf answers from their own snapshot (8.3) — integration-proven.
- External surface: unchanged (anonymous catalog endpoint; EXTERNAL-RISK one-liner stands).

**Block If:**
- The rotation cannot fit per-region state without changing the sweep algorithms themselves (only their state HOME may move).

**Never:**
- No per-user snapshot writes; no failure banners for refreshes; no DLQ/queue infrastructure; no admission/auth changes; no per-region prune of idle regions' DATA beyond the skip rule (a later chore may vacuum; the ledger rows are tiny). No UI beyond the "updating…" suffix and the empty-state copy swap.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two regions, alternating fires | Users in it-it + en-us, both active | Fire 1 refreshes the stalest region, fire 2 the other; both `cycle_complete` within the window | No error |
| Region fails repeatedly | Fetch fails 3 consecutive attempts | Quarantined: at most one retry per window, others never starved | Logged; no banner |
| New window opens | Calendar month rolls into day 15 | `cycle_complete`/`failure_count` reset; rotation restarts | No error |
| Idle region | No authenticated request 60d | Skipped by the cron; data retained | No error |
| Stale snapshot on shelf GET | Region's `last_success` > 35d (or no snapshot) | `waitUntil` membership pass under the region lock; response not delayed | Failure logged, retried by cron |
| Concurrent same-region sign-ins | Two shelf GETs race the guard | One refresh runs (region lock); the loser no-ops | No error |
| Zero users / zero regions | Fresh deploy | Cron no-ops cleanly | No error |
| Refresh fails | Provider down during cron slot | Ledger `failure_count`+1, `last_attempt` set; NO user-visible flag | Logged only |
| Manual button gone | Old client POSTs /ps-plus-check | 404 (route removed) | N/A |


</intent-contract>

## Code Map

- `src/schema/catalog.ts` + `migrations/0017` -- `ps_plus_region_state` (PK region; tier, last_success, last_attempt, failure_count, cycle_complete, last_user_activity, sweep_state TEXT, leaving_state TEXT) + DELETE of the four dead setting keys (`psplus_refresh_failed`, `psplus_refreshed_at`, `psplus_sweep_state`, `psplus_leaving_state`).
- `src/repositories/psplus-region.ts` (new) -- ledger CRUD: `getRegionState`, `listRegionStates`, `touchRegionActivity(region, today)` (date-gated), `recordAttempt/Success/Failure`, `setRegionSweepState`, `setRegionLeavingState`, `listDistinctUserRegions`.
- `src/services/psplus.ts` -- `runScheduledPsPlusCheck` reworked: region picker (window/quarantine/skip rules) + per-region rotation; `runPsPlusCheck(db, {region})` loses its userId (summary/readout move to the button's grave — the fn keeps returning counts for tests/logs); freshness = ledger `last_success`; UTC today; `findOldestUser` deleted here (scores.ts keeps it until 10.x revisits — scores are user-independent shared facts but its stale-gate is per-user setting; out of scope).
- `src/services/psplus-genres.ts` + `psplus-leaving.ts` -- state reads/writes → region ledger columns (same JSON shapes; signatures gain region, lose userId).
- `src/services/psn-lock.ts` -- `withRegionLock(db, region, op, fn)` (well-known lock row, same upsert mechanics).
- `src/routes/shelf.ts` -- after the 200 path resolves region: `touchRegionActivity` + the 35d stale-guard `waitUntil` (membership pass only, region lock).
- `src/routes/psplus.ts` -- `POST /ps-plus-check` route DELETED; `src/routes/settings.ts` -- `psPlusRefreshFailed` field dies, `psPlusRefreshedAt` reads the ledger, + `catalogRefreshing` (region lock held).
- `web/settings/SettingsPanel.tsx` + `api.ts` -- button + `runPsPlusCheck` fn removed; as-of readout gains the "updating…" suffix; `web/catalog/Catalog.tsx` -- empty-state copy swap; `web/shell/AppShell*` -- failed-refresh banner branch removed (score banner stays).
- Tests: `psplus-cron.test.ts` (rotation → region picker suites), `psplus.test.ts`/`psplus-genres.test.ts`/`psplus-leaving.test.ts` (state home moves), `settings.test.ts`, new `region-rotation.test.ts` (two-region fires, quarantine, window reset, idle skip, stale guard + lock coalescing, zero-region no-op), web tests for the removed button/banner + updating suffix; playwright `epic5-psplus.spec.ts` reworked (button gone → seeded-ledger readout; the FAILED-refresh spec dies), COVERAGE.md.

## Tasks & Acceptance

**Execution:**
- [x] Schema + migration 0017 + `psplus-region.ts` repo.
- [x] Region picker + per-region rotation in `runScheduledPsPlusCheck`; per-region sweep/leaving state threading; UTC today; ledger outcome writes.
- [x] `withRegionLock`; stale-snapshot guard + `touchRegionActivity` on the shelf route.
- [x] Removals: button route/UI/api, banner machinery + surface, dead setting keys; settings response rework (+`catalogRefreshing`); catalog empty-state copy.
- [x] Tests per Code Map; ledgers/budget comments restated.
- [x] Playwright + COVERAGE.md; all suites green.

**Acceptance Criteria:**
- Given users in two regions, when the cron fires repeatedly, then both regions reach `cycle_complete` within a window and each user's shelf answers from their own snapshot.
- Given a region failing 3 attempts, when further fires happen, then healthy regions are never starved and the quarantined region retries at most once per window (and fully re-admits next window).
- Given a shelf GET against a >35d/absent snapshot, when it completes, then a membership refresh runs via `waitUntil` under the region lock (concurrent GETs coalesce) and the UI shows "updating…" beside the as-of date until it lands.
- Given any refresh failure, when it happens, then NO user-visible banner/flag exists anywhere — logs only — and the manual check button is gone from route and UI.
- Given zero registered users, when the cron fires, then it no-ops cleanly.

## Spec Change Log

## Review Triage Log

### 2026-07-17 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 3, medium 5, low 4)
- defer: 0
- reject: 5
- addressed_findings:
  - `[high]` `[patch]` **The 304 fast path skipped BOTH the activity touch and the stale guard** — a 304-heavy daily user's region aged into the idle-skip with no self-heal. The whole 8.4 block now runs before the conditional return.
  - `[high]` `[patch]` **The guard had no backoff**: a poison/bad-locale region fired a REAL 5-page store fetch on every shelf GET. Now one combined ledger read, day-gated (one attempt per region per day), quarantine-aware (failureCount ≥3 → cron-only), config-gaps (`bad-region`/`no-region`) and lock races (`conflict`) never counted as failures.
  - `[high]` `[patch]` **`recordRegionOutcome` stamped the window without resetting window-scoped counters**, defeating the picker's lazy reset (June's cycle-complete/quarantine surviving into July after a day-3 guard write). Window-crossing now resets `cycle_complete`/`failure_count` in the same statement.
  - `[medium]` `[patch]` `maybeMarkCycleComplete` forged `last_success` via a success outcome on sweep-only invocations (skewing stalest-first, the 35d guard, and the as-of readout) — now a dedicated `markRegionCycleComplete`.
  - `[medium]` `[patch]` All-quarantined picker bailed instead of trying siblings holding an unburned retry — now skips past. Guard attempts no longer burn the cron's quarantine retry (guard skips quarantined regions entirely).
  - `[medium]` `[patch]` Migration 0017 backfill: `MAX()` + `GROUP BY` per region (deterministic, freshest-stamp winner); mis-homed sweep-state JSONs contained by the sweeps' own `state.region` guards (documented in the SQL).
  - `[medium]` `[patch]` Cron `conflict` outcomes no longer recorded as failures (three lock races would have quarantined a healthy region).
  - `[low]` `[patch]` `withRegionLock` release wrapped in `.catch` (a throwing release must not flip a successful refresh to failed); `listDistinctUserRegions` re-validates the locale shape; e2e `seedRegionFreshness` targeted-upserts instead of REPLACE (was wiping lock/sweep columns) and the dead `deleteRegionState` helper is gone; the as-of readout gains `aria-live="polite"` for the updating suffix; guard-path budget restated honestly (~46 of 50 inside the waitUntil, margin ~4 — the next rider re-budgets).
  - Rejected (5): `isRegionRefreshing` treating any unexpired lock as refreshing (only catalog-refresh mints it today; noted); the updating suffix rarely visible for guard refreshes (settings isn't refetched mid-flight — cosmetic, the cron overlap case works); genre chips empty for days on a NEW region (the signed-off AD-31 convergence model); bad-region silent non-refresh (AD-31 passive posture + the settings PUT already validates the format; a store-refused locale is the residual, documented); scores.ts on `findOldestUser` (spec-scoped out, ponytail marker moved there).

## Design Notes

Sweep/leaving state JSON shapes are MOVED, not redesigned — the cursors, generation stamps, attempt counters and their reviewed hazard semantics survive verbatim; only the storage key changes (user → region). The guard arms sweeps by resetting per-region state exactly as a membership pass does, so "a reviving region's first user" gets genre/departure data via the normal cron convergence (AD-31's ruling). `runScheduledScoreRefresh` keeps its per-user stale-gate under `findOldestUser` for now — scores are region-independent and its rework is not in B4's scope; the `ponytail:` marker moves there.

## Verification

**Commands:**
- `bunx vitest run test/integration` / `bunx vitest run web` -- green.
- `bunx tsc -b` / `bunx biome check src web test worker` -- clean.
- `bunx playwright test playwright/e2e/epic5-psplus.spec.ts playwright/e2e/epic7-catalog.spec.ts playwright/e2e/epic1-shelf.spec.ts` -- green.

## Auto Run Result

Status: done

**Implemented:** AD-31/AD-32 in full. The cron fans out over the distinct regions of registered users via the new `ps_plus_region_state` ledger — one rotation slot per fire (genre → leaving → membership, per-region state homed on the ledger), healthy-stalest-first with a 3-failure quarantine (one retry per window, siblings never starved), 60-day idle skip by `last_user_activity`, and `YYYY-MM` window resets that survive out-of-band stamps. `runPsPlusCheck` is de-usered (region + region-keyed CAS lock on the ledger row; UTC dates). The shelf route touches activity and runs the >35-day stale-snapshot guard BEFORE its 304 return — day-gated, quarantine-aware, config-gaps never counted — as a `waitUntil` membership pass under the region lock. REMOVED: the manual check button (route + FAB item + catalog empty-state action), the failed-refresh banner machinery, and the client genre-sweep loop; the FAB hides entirely on the catalog; the as-of readout reads the ledger and suffixes "updating…" (`catalogRefreshing`) with `aria-live`. Migration 0017 creates the ledger, backfills per region via `MAX()`, and deletes the four dead setting keys.

**Files changed:** schema + migration 0017; `src/repositories/psplus-region.ts` (new) + `games.ts` (`listRegionTrackedGames`); `src/services/psplus.ts` (picker + rotation), `psplus-genres.ts`/`psplus-leaving.ts` (region-first), `psn-lock.ts` (region lock), `settings.ts` (region-homed state + ledger freshness; banner fns deleted); `src/routes/psplus.ts` (button + sweep POST deleted), `settings.ts` (`catalogRefreshing`), `shelf.ts` (guard); `worker/index.ts` untouched this story; web: `Fab.tsx`/`AppShell.tsx`/`Header.tsx`/`Catalog.tsx`/`EmptyState.tsx`/`settings/api.ts`/`catalog/api.ts` (+`PsPlusCheckModal` deleted); 11 integration files migrated + `psn-lock`/`read-budget`/`auth` guard-dormancy seeds; playwright: epic5/epic7 reworked, d1 helpers (freshness seed, derived-row cleanup).

**Review:** 2 lenses, 29 raw findings → 12 patched (3 high — all in the guard/ledger interaction cluster: 304-path skip, no backoff, window poisoning), 5 rejected (rulings recorded), 0 deferred, 0 intent gaps/bad-spec. `followup_review_recommended: true` (3 highs + a migration + product-wide removals).

**Verification:** integration 289 ×2 (region rotation, quarantine, window reset, lock preemption/coalescing, ledger freshness, guard dormancy), web 336 (FAB/banner/empty-state/updating-suffix reworks), Playwright epic1/5/7/10/auth 31 → 23+ re-runs green after patches; `tsc -b` + `biome` clean. Migration applies in every suite run.

**Budget (AD-32):** cron invocation shape unchanged (one slot) + ~4 ledger statements; the guard's waitUntil path ≈ 46 of 50 in a request context (margin ~4 — the next rider re-budgets); steady-state shelf GETs add ONE ledger read (day-gated writes).

**Residual risks:** a store-refused (well-formed but wrong) locale never refreshes and never surfaces — AD-31's passive posture; the settings PUT validates format, and the empty-catalog copy promises an auto-update that can't come for that misconfig (accepted, logged server-side). The "updating…" suffix is rarely visible for guard refreshes (settings isn't refetched mid-flight). `scores.ts` still resolves `findOldestUser` (out of scope; marked). 8.3's residual — old-region snapshot/ledger data pruning — remains open: the idle-skip stops the SPEND, a vacuum chore can reclaim the rows later.
