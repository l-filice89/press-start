---
title: 'Story 5.2: Scheduled monthly refresh (Cron Trigger)'
type: 'feature'
created: '2026-07-11'
status: 'done'
baseline_revision: '6db38204967ed39521fdaeed933f020e2d4708de'
final_revision: '5f438b8f98ae008e8df963de188f15ebc328194a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-1-region-setting-ps-extra-check-button.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Story 5.1's PS+ Extra check only runs when Luca taps the button, so the catalog drifts stale between manual runs and the Playable-now signal silently rots.

**Approach:** A monthly Cloudflare Cron Trigger fires a `scheduled` Worker handler that runs the SAME `runPsPlusCheck` service (5.1) for the single account user, reading the same stored region. A failed scheduled run persists a `failed-refresh` flag in `SETTING` that surfaces as the (already-provisioned) steel attention banner; any successful refresh — cron OR button — self-resolves it.

## Boundaries & Constraints

**Always:**
- Cron is a monthly trigger aligned AFTER Sony's ~3rd-Tuesday catalog refresh: `wrangler.jsonc` `triggers.crons` = `["0 12 22 * *"]` (12:00 UTC, 22nd — past the latest possible 3rd Tuesday, the 21st). One fire/month, stateless, free-tier safe (AR-1, NFR-2).
- The Worker default export becomes `{ fetch, scheduled }` (`worker/index.ts`); `fetch` still delegates to the existing Hono app unchanged. `scheduled` awaits the cron service (no fire-and-forget) so failures are observable.
- Cron resolves the single user via `findUserByEmail(db, env.AUTH_ALLOWED_EMAIL)` (single-tenant; AD-13). No user row → no-op (nothing to check yet). It then calls `runPsPlusCheck(db, userId, env)` — identical path to the button, so both read the same persisted `psn_region` (AR-18/23; no divergence).
- Failed scheduled refresh (`runPsPlusCheck` returns `ok:false`, OR throws) persists `psplus_refresh_failed='failed'` in `SETTING` for that user (mirror the `psn_auth` flag helpers). A successful `runPsPlusCheck` (ok:true) clears it — so the button is also a resolution path (FR-40, AR-14, NFR-4).
- The failed flag surfaces via `GET /api/settings` (`psPlusRefreshFailed:boolean`) → AppShell renders `AttentionBanner variant="failed-refresh"` (steel, already defined; UX-DR11). The FAB check's success handler must also invalidate `['settings']` so a manual fix clears the banner without a reload.

**Block If:** the free tier cannot register a Cron Trigger at all (would require a paid plan or an architecture change).

**Never:** no timestamp/"as of {date}" surface (that is 5.3); no change to the 5.1 flag-diff logic, provider wire, or the empty-catalog data-loss guard; no retry/backoff of a failed cron (next month's fire is the retry); no multi-user fan-out (single-tenant); no cron in the `env.e2e` block (local dev never fires it); no per-run email/push notice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cron success | Stored region, catalog reachable | Flags updated exactly as the button would; `psplus_refresh_failed` cleared | No error |
| Cron catalog failure | Catalog 4xx/5xx or empty-200 | No flag writes (5.1 guard); `psplus_refresh_failed` set | Logged; banner lights next open |
| Cron DB/unexpected throw | `runPsPlusCheck` throws | Caught; `psplus_refresh_failed` set | Logged; handler does not crash |
| No user yet | `AUTH_ALLOWED_EMAIL` has no `user` row | Handler no-ops, no flag written | No error |
| Region parity | Region persisted by an earlier button run | Cron sends the SAME stored region | No error |
| Manual self-heal | `psplus_refresh_failed` set, then button check succeeds | Flag cleared, banner gone after `['settings']` invalidation | No error |
| Settings read | Flag present | `GET /settings` returns `psPlusRefreshFailed:true` | No error |

</intent-contract>

## Code Map

- `worker/index.ts` -- export `{ fetch, scheduled }`; `scheduled` → cron service
- `src/services/psplus.ts` -- add `runScheduledPsPlusCheck(db, env)` (resolve user → run → set/clear failed flag); in `runPsPlusCheck` ok-path, clear the failed flag
- `src/services/settings.ts` -- `PSPLUS_REFRESH_FAILED_SETTING_KEY` + `markPsPlusRefreshFailed` / `clearPsPlusRefreshFailed` / `isPsPlusRefreshFailed` (mirror the `psn_auth` trio)
- `src/repositories/users.ts` -- reuse `findUserByEmail`
- `src/routes/settings.ts` -- `GET /settings` adds `psPlusRefreshFailed`
- `web/settings/api.ts` -- settings schema adds `psPlusRefreshFailed:boolean`
- `web/shell/AppShell.tsx` -- render `failed-refresh` banner when set
- `web/shell/Fab.tsx` -- check success also invalidates `['settings']`
- `wrangler.jsonc` -- root `triggers.crons`
- `test/integration/psplus-cron.test.ts` (NEW) -- drive `worker.scheduled(...)`; `src/routes/` settings test; jsdom AppShell banner test; `playwright/e2e/epic5-psplus.spec.ts` + COVERAGE row

## Tasks & Acceptance

**Execution:**
- [x] `src/services/settings.ts` -- add the `psplus_refresh_failed` flag helpers (set/clear/read), mirroring `markPsnAuthExpired`/`clear`/`is` -- AC3
- [x] `src/services/psplus.ts` -- `runScheduledPsPlusCheck(db, env)`: `findUserByEmail(AUTH_ALLOWED_EMAIL)`; if absent return; `try { const o = await runPsPlusCheck(...); if (!o.ok) markFailed } catch { markFailed }`. In `runPsPlusCheck` ok-path, `clearPsPlusRefreshFailed` before returning -- AC1/AC2/AC3
- [x] `worker/index.ts` -- default export `{ fetch: app.fetch, scheduled }` where `scheduled` awaits `runScheduledPsPlusCheck(createDb(env.DB), env)` -- AC1
- [x] `wrangler.jsonc` -- root `"triggers": { "crons": ["0 12 22 * *"] }` -- AC1
- [x] `src/routes/settings.ts` -- `GET /settings` returns `psPlusRefreshFailed` (add to the `Promise.all` + body) -- AC3
- [x] `web/settings/api.ts` -- settings zod schema gains `psPlusRefreshFailed: z.boolean()` -- AC3
- [x] `web/shell/AppShell.tsx` -- when `settings?.psPlusRefreshFailed`, render `AttentionBanner variant="failed-refresh"` with copy pointing at the FAB check -- AC3
- [x] `web/shell/Fab.tsx` -- check `onSuccess` also `invalidateQueries(['settings'])` so a manual fix clears the banner -- AC3
- [x] `test/integration/psplus-cron.test.ts` (NEW) -- drive `worker.scheduled`: cron success updates flags + clears failed flag; failure (stub 500 / empty) sets `psplus_refresh_failed` and writes no flags; region parity with the stored setting; no-user no-op -- AC1/AC2/AC3
- [x] `src/routes/settings` integration -- `GET /settings` exposes `psPlusRefreshFailed` after a failed cron -- AC3
- [x] `playwright/e2e/epic5-psplus.spec.ts` -- e2e: seed `psplus_refresh_failed` row → banner visible; COVERAGE.md rows for cron-fired flows (unstubbable schedule) pinned at integration tier -- AC3
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- mark 5.2 done -- bookkeeping

**Acceptance Criteria:**
- Given a monthly Cron Trigger, when it fires, then the same region-scoped `runPsPlusCheck` runs statelessly for the account user (AC1)
- Given the cron and the button, when either runs, then both read the same stored `psn_region` (AC2)
- Given a failed scheduled refresh, when the app is next opened, then a `failed-refresh` attention banner surfaces; a later successful refresh (cron or button) clears it (AC3)

## Spec Change Log

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (medium 1, low 3)
- defer: 0
- reject: 2: (low 2)
- addressed_findings:
  - `[medium]` `[patch]` no-region marked the cron as a failed refresh → un-clearable banner with misleading remediation (both reviewers). The banner now lights ONLY on a `provider` failure (retry may help); a `no-region` config gap is logged and skipped. New cron hazard test asserts no-region does not light the banner and never fetches.
  - `[low]` `[patch]` Banner copy over-promised the button as the fix — softened to "it'll retry next month, or run Check PS+ Extra from the menu to try now" (no guarantee, since catalog rot fails the button identically).
  - `[low]` `[patch]` `worker.scheduled?.` in the cron test would vacuously no-op if the export lost `scheduled` — added `expect(worker.scheduled).toBeDefined()` before invoking.
  - `[low]` `[patch]` COVERAGE.md had mixed LF/CRLF (5.1 block LF, older CRLF) — normalized the Epic 5 block to the file's dominant CRLF.
- rejected: concurrent cron-fail + button-success race clobbering the clear (rare under a monthly cron + single user; self-heals on the next successful check); `markPsPlusRefreshFailed` itself throwing and escaping `scheduled` (D1-down scenario where nothing persists anyway; Cloudflare logs + monthly retry).

## Design Notes

- Cloudflare cron does not support the Quartz nth-weekday (`#`) operator, so an exact "3rd Tuesday" is not expressible; a fixed day-of-month past the latest 3rd Tuesday (the 22nd) is the lazy, reliable alignment. The check is idempotent, so an occasional early/late fire is harmless.
- Failed-flag ownership: the cron SETS it (only a scheduled run has no user watching); any successful `runPsPlusCheck` CLEARS it — placing the clear inside the shared service means the button is automatically a resolution path without duplicating logic. A failed BUTTON run stays a toast (5.1), never the banner.
- `worker.scheduled` is awaited (not `ctx.waitUntil`-detached) so a throw is caught and turned into the failed flag rather than an unobserved crash.
- ponytail: single-user resolution via `AUTH_ALLOWED_EMAIL`. If the allowlist ever becomes multi-value, loop over users here.

## Verification

**Commands:**
- `bun run typecheck` / `bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. new cron integration + settings + AppShell banner tests
- `bun run test:e2e epic5-psplus` -- expected: green incl. the seeded failed-refresh banner

## Auto Run Result

Status: **done**

### Summary
A monthly Cloudflare Cron Trigger (`0 12 22 * *`) now fires a Worker `scheduled` handler that runs the same 5.1 `runPsPlusCheck` for the single account user — reading the same persisted `psn_region`, so button and cron never diverge. A genuine provider failure (or a throw) persists a `psplus_refresh_failed` flag surfaced as the steel `failed-refresh` attention banner; any successful refresh — cron OR button — clears it. A `no-region` config gap is deliberately NOT treated as a refresh failure (the banner would be an un-clearable dead-end). No timestamp surface (that is 5.3).

### Files changed
- `worker/index.ts` — default export becomes `{ fetch: app.fetch, scheduled }`; `scheduled` awaits the cron service.
- `src/services/psplus.ts` — `runScheduledPsPlusCheck(db, env)` (resolve user by `AUTH_ALLOWED_EMAIL`, run, mark failed only on `provider`/throw); `runPsPlusCheck` clears the failed flag on success.
- `src/services/settings.ts` — `psplus_refresh_failed` flag helpers (mark/clear/is), mirroring the `psn_auth` trio.
- `src/routes/settings.ts` — `GET /settings` returns `psPlusRefreshFailed`.
- `web/settings/api.ts` — settings schema gains `psPlusRefreshFailed` (defaulted for deploy-skew).
- `web/shell/AppShell.tsx` — renders the `failed-refresh` banner when set.
- `web/shell/Fab.tsx` — check success also invalidates `['settings']` so a manual fix clears the banner without reload.
- `wrangler.jsonc` — root `triggers.crons`.
- Tests: `test/integration/psplus-cron.test.ts` (NEW — scheduled handler, region parity, failure sets flag, no-region does not, no-user no-op), `test/integration/settings.test.ts` (GET exposes the flag), `playwright/e2e/epic5-psplus.spec.ts` + `playwright/COVERAGE.md` (seeded failed-refresh banner + Epic 5.2 rows).

### Review findings
- Patches applied (4): no-region no longer lights an un-clearable banner (+ hazard test); banner copy softened to not over-promise; cron test asserts `worker.scheduled` is defined; COVERAGE.md EOL normalized.
- Rejected (2): concurrent cron/button clear-vs-mark race (rare, self-heals); mark-failure itself throwing (D1-down, logged + monthly retry).
- No new deferrals.

### Verification
- `bun run typecheck` / `bun run lint` — clean.
- `bun run test` — 1180 passed (49 files).
- `bun run test:e2e epic5-psplus` — 2 passed.

### Residual risks
- Persistent catalog rot (Sony rotates the persisted-query hash / category id) fails the refresh every month and lights the banner legitimately, but the button remedy also fails until the wire constants are re-pinned in code — inherent to the pinned-query approach, flagged in 5.1's residual risks.
- Cron fires in UTC on a fixed day-of-month (no nth-weekday operator); an occasional early/late fire relative to Sony's rotation is harmless (idempotent check).

