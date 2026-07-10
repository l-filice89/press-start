---
title: 'Story 4.1: PSN provider & session-cookie settings'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: '04a10d665e836beecd46ac8085f5b2118de5a884'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Epic 4's sync (4.2) and Epic 5's PS+ check need PlayStation access, but no PSN adapter exists, the live `pdccws_p` cookie has nowhere editable to live, and an expired cookie has no user-visible path to recovery.

**Approach:** Build `PsnProvider` (AD-5: auth entirely inside the adapter; persisted `getPurchasedGameList` query ported verbatim from `export_ps_catalog.py`), store the cookie in the existing per-user `setting` table read fresh per call (Wrangler secret `PSN_SESSION_COOKIE` as seed fallback), add a minimal Settings surface (header gear → modal) to edit it, and wire the `expired-cookie` AttentionBanner off a persisted `psn_auth: expired` flag with refresh instructions and no retry.

## Boundaries & Constraints

**Always:**
- Persisted-query call only — copy `PERSISTED_QUERY_HASH`, headers (`library.playstation.com` origin/referer, `apollographql-client-name: my-playstation`), page size 100, loop until `pageInfo.isLast` from the Python script. Never hand-write GraphQL.
- Cookie is read fresh on every provider call (via a `getCookie` callback backed by `getSetting`); editing the setting takes effect without redeploy.
- The API never echoes the stored cookie value back to the client — GET reports presence only (`psnCookieSet: boolean`).
- On 401/403: throw a typed `PsnAuthError` after exactly one attempt (no retry, AD-14); callers persist `psn_auth = expired`; a successful cookie update clears it.
- `pdccws_p` / PSN auth mechanics appear ONLY inside `src/providers/psn.ts` (AR-5) — enforced by a scan test.
- Hazard tests (red-then-green) for: read-fresh-per-call, no-retry-on-401, encapsulation scan.

**Block If:** the `getPurchasedGameList` response shape needed for typing contradicts what the Python script's field usage implies and no sample data exists to resolve it.

**Never:** no sync logic, no FAB drawer, no game writes (all Story 4.2); no region/PS+ Extra (Epic 5); no NPSSO auth; no new DB table (reuse `setting`); no cookie value in logs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fetch, multi-page | 150 purchased titles, cookie valid | Two requests (start 0, 100); combined typed `PsnGame[]` incl. `membership`, image URL, store URL | No error expected |
| Expired cookie | PSN returns 401 or 403 | `PsnAuthError` thrown, exactly one HTTP attempt | Caller persists `psn_auth=expired`; banner shows refresh instructions |
| Cookie unset | No `psn_cookie` setting, no `PSN_SESSION_COOKIE` env | Provider call fails as `PsnAuthError` (missing cookie) without calling PSN | Same banner path |
| Env seed | Setting unset, env secret present | Provider uses env value; setting stays unset until user saves one | No error expected |
| Cookie edited between calls | Call 1, then setting updated, then call 2 | Call 2 sends the new cookie (read fresh) | No error expected |
| GraphQL-level error | 200 with `errors` array | Error thrown naming the GraphQL failure | Surfaces, never retried |
| PUT cookie | Non-empty value | Saved for user; `psn_auth` flag cleared; 200 `{psnCookieSet:true}` | Empty/oversized (>4096) value → 400 |
| GET settings | Cookie stored | `psnCookieSet:true, psnAuthExpired:false`; raw value absent from body | No error expected |

</intent-contract>

## Code Map

- `export_ps_catalog.py` -- source of truth: query hash, headers, pagination, cookie instructions, store-URL derivation
- `src/providers/igdb.ts` -- provider pattern to mirror (config, typed errors, AD-14)
- `src/schema/catalog.ts` -- `setting` table (per-user KV, PK user_id+key) — already exists, no migration
- `src/repositories/settings.ts` -- `getSetting`/`setSetting`
- `src/services/settings.ts` -- `TIMEZONE_SETTING_KEY` precedent for key constants
- `src/routes/settings.ts` -- GET/PUT settings routes to extend; `requireAuth` pattern
- `web/shell/Header.tsx`, `web/shell/AppShell.tsx` -- gear button home; banner slot comment at AppShell.tsx:39
- `web/components/AttentionBanner.tsx` -- `expired-cookie` variant, already built, unfed
- `web/components/useModalTrap.ts`, `ConfirmDialog.tsx` -- modal pattern for the settings panel
- `web/shelf/api.ts` -- fetch/TanStack Query conventions
- `test/integration/settings.test.ts` -- integration-test home to extend
- `playwright/e2e/`, `playwright/support/helpers/d1.ts`, `playwright/COVERAGE.md` -- e2e conventions + SQL seeding (seed `setting` rows directly)

## Tasks & Acceptance

**Execution:**
- [x] `src/providers/psn.ts` -- `PsnGame` type (name, platform, membership, titleId, productId, conceptId, entitlementId, imageUrl, storeUrl), `PsnAuthError`, `createPsnProvider({ getCookie })` with `fetchPurchasedGames()`: persisted query, headers, pagination, store-URL derivation ported from Python -- AC1
- [x] `src/providers/psn.test.ts` -- mocked-fetch unit tests for every I/O-matrix row incl. hazard tests (fresh-read, single-attempt-401) -- AC1/AC3
- [x] `src/providers/psn-encapsulation.test.ts` -- scan `src/` + `web/` sources: `pdccws_p`/PSN endpoint appear only in `src/providers/psn.ts` (+ its tests) -- AR-5 hazard
- [x] `src/services/settings.ts` -- add `PSN_COOKIE_SETTING_KEY`, `PSN_AUTH_SETTING_KEY`, `getPsnCookie(db,userId,env)` (setting → env seed fallback), `markPsnAuthExpired`/`clearPsnAuthExpired` -- AC2
- [x] `src/routes/settings.ts` -- GET adds `psnCookieSet`/`psnAuthExpired`; `PUT /settings/psn-cookie` validates (1–4096 chars), saves, clears expired flag -- AC2
- [x] `test/integration/settings.test.ts` -- cookie PUT/GET round-trip, no-echo masking, expired-flag set/clear -- AC2/AC3
- [x] `worker-configuration.d.ts` + `.dev.vars.example` -- optional `PSN_SESSION_COOKIE` secret declared/documented -- AC2 seed
- [x] `web/settings/SettingsPanel.tsx` (+ css + test) -- modal (useModalTrap): cookie paste field (never prefilled), refresh instructions (adapted from `_COOKIE_INSTRUCTIONS`), save via PUT -- AC2
- [x] `web/shell/Header.tsx` + `web/shell/AppShell.tsx` -- gear button (accessible name "Settings") opening the panel; settings query feeds `AttentionBanner variant="expired-cookie"` (message + "Update cookie" action opening the panel) when `psnAuthExpired` -- AC3
- [x] `playwright/e2e/epic4-settings.spec.ts` + `playwright/COVERAGE.md` -- e2e: gear→modal→save cookie→`psnCookieSet` reflected; seeded `psn_auth=expired` row → banner with instructions, action opens panel; Epic 4 COVERAGE section with AC1 row (no UI flow — Vitest) and 401-during-sync row (unreachable until 4.2) -- AC2/AC3

**Acceptance Criteria:**
- Given any PSN query, when the app talks to PlayStation, then it goes through `PsnProvider` using the persisted `getPurchasedGameList` query, and auth lives entirely inside the adapter (AC1)
- Given the `setting` table, when the cookie is configured, then the live `pdccws_p` value is stored per-user, editable from the Settings panel, read fresh per call, with the Wrangler secret only as unset-fallback (AC2)
- Given a 401/403 from PSN, when the provider is called, then it fails once (no retry) and the app surfaces cookie-refresh instructions in the attention banner until a new cookie is saved (AC3)

## Spec Change Log

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 1, medium 3, low 7)
- defer: 0
- reject: 6
- addressed_findings:
  - `[high]` `[patch]` `src/providers/*.test.ts` never ran — vitest unit project included only `src/core/**`; widened to `src/**/*.test.ts` (surfaced two latent test bugs: reused Response bodies, scan-allowlist gap)
  - `[medium]` `[patch]` cookie header injection: PUT now strips a leading `pdccws_p=` paste and rejects `;`/`,`/whitespace/control chars (value rides an outbound Cookie header); integration cases added
  - `[medium]` `[patch]` unbounded pagination: MAX_PAGES=40 brake + malformed-page and non-JSON-200 guards in the provider, each with a test
  - `[medium]` `[patch]` `psnCookieSet` ignored the env seed — GET now reports the effective cookie via `getPsnCookie`
  - `[low]` `[patch]` `clearPsnAuthExpired` wrote `''` instead of deleting; added `deleteSetting` repository fn and used it (matches the documented "absent" contract)
  - `[low]` `[patch]` `callApi` duplicated — exported from `web/shelf/api.ts`, reused in `web/settings/api.ts`
  - `[low]` `[patch]` encapsulation scan blind spots — added `worker/`, `scripts/`, `playwright/` dirs and the persisted-query hash pattern
  - `[low]` `[patch]` dead `PSN_COOKIE_INSTRUCTIONS` export removed (instructions live once, in the panel)
  - `[low]` `[patch]` silent platform coercion — `PsnGame.platform` is now the raw pass-through string, never stamped PS4
  - `[low]` `[patch]` env seed trimmed (`PSN_SESSION_COOKIE?.trim()`), whitespace-only secret is no seed; test added
  - `[low]` `[patch]` 401-mid-pagination test added (stops after page two, no retry)

Rejected (with reason): non-atomic PUT (500 surfaces, retry heals; no data loss), silent AppShell settings-query failure (query client already consumes status-carrying errors), e2e `LIMIT 1`/cross-user delete helpers (consistent with the suite's single-user convention), generated `worker-configuration.d.ts` churn (regenerated correctly against current wrangler.jsonc), gear glyph/focus styling (global always-on focus outline covers it; interim control until the Epic 6 FAB gear), banner prod wiring "dead code" (by design — 4.2's sync is the first real `markPsnAuthExpired` writer, stated in Design Notes and COVERAGE.md).

## Design Notes

- `psn_auth` flag persists in `setting` (`expired` | absent) so the banner survives reloads and is seedable in e2e; 4.2's sync is the first real writer of the flag — this story ships the helpers plus the read path (banner) and clear path (cookie save).
- Provider takes `getCookie: () => Promise<string | undefined>` rather than a Db so it stays dependency-light and 5.x-reusable; route/service composes it with `getPsnCookie`.

## Verification

**Commands:**
- `bun run typecheck` -- expected: clean
- `bun run lint` -- expected: clean
- `bun run test` -- expected: all Vitest suites pass incl. new provider/settings/encapsulation tests
- `bun run test:e2e` -- expected: Playwright green incl. `epic4-settings.spec.ts`

## Auto Run Result

**Summary:** Story 4.1 implemented — `PsnProvider` adapter (persisted `getPurchasedGameList` query, auth fully encapsulated, no-retry 401/403, pagination brake), PSN session cookie stored per-user in `setting` (Settings modal via header gear, presence-only readback, `PSN_SESSION_COOKIE` secret as unset-seed), and the persisted `psn_auth=expired` flag feeding the expired-cookie attention banner with refresh instructions.

**Files changed:**
- `src/providers/psn.ts` — new PSN adapter (wire mechanics ported from `export_ps_catalog.py`)
- `src/providers/psn.test.ts` — 12 mocked-fetch tests incl. hazard rows (fresh-read, single-attempt 401, runaway brake)
- `src/providers/psn-encapsulation.test.ts` — AR-5 scan guard over src/web/worker/scripts/playwright
- `src/providers/index.ts` — export psn
- `src/services/settings.ts` — cookie/auth-flag keys, `getPsnCookie` (setting → trimmed env seed), mark/clear/is expired helpers
- `src/repositories/settings.ts` — `deleteSetting`
- `src/routes/settings.ts` — GET reports effective `psnCookieSet` + `psnAuthExpired`; PUT `/settings/psn-cookie` (prefix-strip + header-safe validation, clears flag)
- `test/integration/settings.test.ts` — cookie round-trip, no-echo hazard, injection rejects, expired-flag lifecycle, seed fallback
- `web/settings/` (api, SettingsPanel + css + test) — settings modal, presence status, instructions, save
- `web/shell/Header.tsx` / `header.css` — interim gear entry point
- `web/shell/AppShell.tsx` — settings query feeds `AttentionBanner expired-cookie` with Update-cookie action
- `web/shelf/api.ts` — `callApi` exported for reuse
- `playwright/e2e/epic4-settings.spec.ts`, `playwright/support/helpers/d1.ts`, `playwright/COVERAGE.md` — e2e for both UI flows + Epic 4 coverage rows
- `vitest.config.ts` — unit project include widened to `src/**/*.test.ts` (provider tests were silently excluded)
- `worker-configuration.d.ts`, `.dev.vars.example`, `.dev.vars` — `PSN_SESSION_COOKIE` secret declared/documented

**Review findings:** 11 patches applied (1 high, 3 medium, 7 low — see Review Triage Log), 0 deferred, 6 rejected.

**Verification:** `bun run typecheck` clean; `bun run lint` clean; `bun run test` 964/964 (42 files); `bun run test:e2e` 51/51 (one epic2 flake under parallel load re-ran green — known-flaky suite per 3.5g).

**Residual risks:** the live PSN 401 → `markPsnAuthExpired` write path ships unexercised in production until 4.2's sync calls the provider (helpers + banner read/clear paths are tested); PSN's persisted-query hash is unversioned and may rot upstream.
