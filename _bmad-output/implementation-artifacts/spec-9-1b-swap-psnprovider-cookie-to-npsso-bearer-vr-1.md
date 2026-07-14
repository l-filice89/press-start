---
title: 'Swap `PsnProvider` from the `pdccws_p` cookie to an NPSSO bearer'
type: 'feature'
created: '2026-07-13'
status: 'done'
baseline_revision: '7b2d9798fc645c89858185ff9e18d2b99dc5d935'
final_revision: 'ee18dc84ce1b41f7529f8559514c60a425f6cdb0'
review_loop_iteration: 0
followup_review_recommended: true # HIGH finding auto-forced it; the independent pass RAN in this story (see Auto Run Result)
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Spike S-1 (DW-10, probed live) proved the `pdccws_p` session cookie is rejected 401 by the trophy host `m.np.playstation.com`, so Story 9.2 cannot fetch trophies under the app's current credential. The NPSSO bearer serves trophies *and* returns byte-identical `data{purchasedTitlesRetrieve}` for the existing library sync — a superset — and lives ~60 days instead of hours-to-days.

**Approach:** Replace the cookie with the NPSSO token end to end: `PsnProvider` reads a stored `npsso`, performs the authorize → code → access-token exchange internally, and calls PSN with the resulting bearer. The setting key, the seed secret, the Settings field, the help copy, and the expired-credential copy all move with it; the cookie read path is deleted, not left beside it. The existing `psn_auth: 'expired'` flag, banner, and re-paste prompt are reused unchanged.

## Boundaries & Constraints

**Always:** The entire auth mechanism (NPSSO storage read, authorize, token exchange, bearer use) stays inside `src/providers/psn.ts` — services, routes, and core see only `PsnProvider` + `PsnAuthError` (AR-5). Auth failure is surfaced after exactly ONE attempt, never retried; it sets the existing `psn_auth: 'expired'` setting so the existing banner fires. HTTP 200 carrying `errors[]` is a DENIAL, not a success — it fails closed and existing data survives (DEGENERATE-RESPONSE GUARD; Epic 4's production bug). The NPSSO value crosses a trust boundary into an outbound `Cookie:` header — keep the route's charset/length validation.

**Block If:** the authorize/token exchange shape from `tmp/probe-psn-auth.ts` (probed live 2026-07-13) turns out to be unusable as written and a new live probe would be required — no live PSN credential can be minted unattended.

**Never:** Do not keep the cookie path as a parallel credential or a fallback. Do not persist the derived access token or the refresh token anywhere (no second credential at rest). Do not attempt to read the NPSSO from Sony cross-origin — CORS forbids it; the Settings control is a plain deep link. Do not change the state model, the append-only sync rules, or any PSN endpoint/persisted-query hash. Do not touch the frozen legacy `export_ps_catalog.py`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Valid stored `npsso` | authorize → `?code=` → token → `authorization: Bearer <jwt>` on the purchased-list request; games returned | No error expected |
| One exchange per sync | Valid `npsso`, multi-page library | Bearer obtained ONCE per provider instance and reused across pages | n/a — keeps the 50-subrequest budget |
| No credential | No `psn_npsso` setting, no `PSN_NPSSO` seed | `PsnAuthError('missing-npsso')`, zero fetches | Sync marks `psn_auth: 'expired'`; banner fires |
| Expired NPSSO | Stale `npsso` | Authorize redirect carries no `?code=` (or is not a redirect) → `PsnAuthError('denied')`, one attempt | Same expired path; no silent retry |
| Token exchange refused | Valid code, token endpoint non-2xx | `PsnAuthError('denied')` | Same expired path |
| Bearer rejected | PSN answers 401/403 | `PsnAuthError(401\|403)`, one attempt, no retry | Same expired path |
| Degenerate denial | HTTP 200 + `errors[]` "Access denied" | `PsnAuthError('denied')` — fails closed, no write | Existing games survive; captured-payload hazard test |
| Public catalog | PS+ Extra catalog fetch | Unchanged — no credential sent, `PsnAuthError` semantics do not apply | Plain error on failure |

</intent-contract>

## Code Map

- `src/providers/psn.ts` -- the adapter. `createPsnProvider({ getCookie })` → `{ getNpsso }`; add the internal `npssoToBearer` exchange (mirror `tmp/probe-psn-auth.ts` L151-187 verbatim: authorize `https://ca.account.sony.com/api/authz/v3/oauth/authorize` with `cookie: npsso=…` + `redirect: 'manual'`, pull `?code=` off the `location` header, POST `https://ca.account.sony.com/api/authz/v3/oauth/token` with the public Basic client credentials). Replace the `cookie:` request header with `authorization: Bearer`. `PsnAuthError` reason `'missing-cookie'` → `'missing-npsso'`; all three messages reword cookie→token.
- `tmp/probe-psn-auth.ts` -- the LIVE-PROBED source of the exchange's exact URLs, params, headers and failure shapes. Copy from it; do not re-derive from convention (PROBE-BEFORE-YOU-MAP).
- `src/services/settings.ts` -- `PSN_COOKIE_SETTING_KEY = 'psn_cookie'` → `PSN_NPSSO_SETTING_KEY = 'psn_npsso'`; `getPsnCookie(db, userId, env: { PSN_SESSION_COOKIE })` → `getPsnNpsso(db, userId, env: { PSN_NPSSO })` (same setting-wins-over-seed semantics). `psn_auth` flag helpers unchanged.
- `src/routes/settings.ts` -- `PUT /api/settings/psn-cookie` → `/api/settings/psn-npsso`, body `{ npsso }`, strip a pasted leading `npsso=`, keep the charset/length guard; GET field `psnCookieSet` → `psnNpssoSet`.
- `src/services/sync.ts`, `src/services/psplus.ts`, `src/routes/sync.ts` -- swap the injected getter and the `PSN_SESSION_COOKIE` env type to `PSN_NPSSO`; comments reworded. No structural change.
- `web/settings/SettingsPanel.tsx` + `web/settings/api.ts` -- the field takes the cookie's slot: label/aria "PlayStation NPSSO token", help copy replaced, plus a "Get / refresh token" deep link to `https://ca.account.sony.com/api/v1/ssocookie` (`target="_blank" rel="noreferrer"`), status testid `psn-npsso-status`, button "Save token", success "Token saved."
- `web/shell/AppShell.tsx`, `web/components/AttentionBanner.tsx`, `web/components/attention-banner.css`, `web/shell/Fab.tsx` -- banner variant `expired-cookie` → `expired-token`, action label "Update token", copy names the token and the ssocookie link route (Settings), toast reworded.
- `worker-configuration.d.ts`, `.dev.vars.example`, `.dev.vars.e2e`, `README.md` -- secret `PSN_SESSION_COOKIE` → `PSN_NPSSO` (`.dev.vars.e2e` stays deliberately EMPTY — the e2e no-credential sync test depends on it).
- `src/providers/psn.test.ts`, `src/providers/psn-encapsulation.test.ts`, `web/settings/SettingsPanel.test.tsx`, `web/components/AttentionBanner.test.tsx`, `test/integration/{settings,sync,discard}.test.ts`, `playwright/e2e/epic4-settings.spec.ts`, `playwright/COVERAGE.md` -- every test that names the cookie.
- `export_ps_catalog.py` -- frozen legacy script. DO NOT TOUCH.

## Tasks & Acceptance

**Execution:**
- [x] `src/providers/psn.ts` -- add the internal NPSSO→bearer exchange (memoized per provider instance) and send `authorization: Bearer`; rename the injection to `getNpsso`; reword `PsnAuthError` -- so trophies (9.2) become reachable and the library sync rides the same credential.
- [x] `src/services/settings.ts` + `src/routes/settings.ts` -- rename the setting key, the getter, the route, the request/response fields; strip a pasted `npsso=` prefix; DELETE `getPsnCookie` -- so no dead cookie path survives (AC of the epic).
- [x] `src/services/sync.ts`, `src/services/psplus.ts`, `src/routes/sync.ts` -- rewire the injected getter and the env type; no behaviour change -- the expired-flag path stays exactly as it is.
- [x] `web/settings/SettingsPanel.tsx`, `web/settings/api.ts`, `web/shell/AppShell.tsx`, `web/shell/Fab.tsx`, `web/components/AttentionBanner.tsx` (+ css) -- replace the cookie field in place, add the ssocookie deep link, reword banner/toast -- so the ~60-day re-paste is one click from the field.
- [x] `worker-configuration.d.ts`, `.dev.vars.example`, `.dev.vars.e2e`, `README.md` -- rename the seed secret; keep the e2e seed empty -- so the no-credential e2e row still passes.
- [x] `src/providers/psn.test.ts` -- rewrite the auth rows against the exchange: happy path asserts the `Bearer` header and ONE exchange across paginated pages; hazard rows for missing npsso (zero fetches), authorize-without-code, token-exchange refusal, 401/403 one-attempt, and the VERBATIM captured 200+"Access denied" payload failing closed -- the named hazards each get their own assertion.
- [x] `src/providers/psn-encapsulation.test.ts` -- confine the new `ca.account.sony.com` authorize/token URLs to `src/providers/psn.ts`; swap the `pdccws_p` allow-list to `npsso` (allowed additionally in `web/settings/SettingsPanel.tsx`, `src/routes/settings.ts`) -- so the auth mechanism cannot leak out of the adapter later.
- [x] `test/integration/{settings,sync,discard}.test.ts`, `web/settings/SettingsPanel.test.tsx`, `web/components/AttentionBanner.test.tsx` -- migrate to the new key/route/fields; keep the "setting wins over seed", "expired flag cleared on save", and "PSN 401 persists psn_auth=expired" rows green -- Epic 4's guarantees re-asserted against the bearer.
- [x] `playwright/e2e/epic4-settings.spec.ts` + `playwright/COVERAGE.md` -- update the three e2e flows to the token field, add a row asserting the "Get / refresh token" deep link's href/target, keep the no-credential sync → banner flow -- every UI-facing AC here has a UI flow, so it ships with an e2e test.

**Acceptance Criteria:**
- Given a stored NPSSO, when `fetchPurchasedGames` runs, then PSN is called with `authorization: Bearer <jwt>` obtained through the authorize→code→token exchange, and no `pdccws_p` cookie header is ever sent.
- Given the swap ships, then `grep` finds no `psn_cookie` setting key, no `getPsnCookie`, and no `PSN_SESSION_COOKIE` reference in `src/`, `web/`, or the env files — the cookie path is deleted, not parallel.
- Given the Settings panel, when the user opens the credential field, then it is the NPSSO field in the cookie's former slot, with a "Get / refresh token" link opening `https://ca.account.sony.com/api/v1/ssocookie` in a new tab, and the field is never pre-filled with the stored value.
- Given an expired/invalid NPSSO during a sync, when the exchange or a call is denied, then the run stops after one attempt, `psn_auth: 'expired'` is set, the existing attention banner fires, and no partial result is presented as complete.
- Given the full suite (`bun run check`, vitest, Playwright), when it runs after the swap, then the Epic 4 library-sync and Epic 5 PS+ catalog paths are green — the replacement did not regress working code.

## Spec Change Log

## Review Triage Log

### 2026-07-13 — Review pass (Blind Hunter + Edge Case Hunter, then a forced independent follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 1, medium 5, low 7)
- defer: 3: (medium 1, low 2)
- reject: 2
- addressed_findings:
  - `[high]` `[patch]` **Denial vs. outage was collapsed.** Both OAuth legs mapped ANY non-code answer — a Sony 5xx, a 429, a 403 bot-challenge/WAF page, a 200 HTML interstitial — to `PsnAuthError`, which persists `psn_auth: 'expired'` and tells the user to re-paste a token that is perfectly valid (a remedy that cannot work). Denial is now exactly: an app-scheme redirect carrying no `?code=` (the probed expired-NPSSO signal), or HTTP 400/401 (the statuses OAuth denies with). Everything else is a plain `Error` — surfaced, never flagged. Tests: 503 and 403 on each leg → not `PsnAuthError`; a non-token 2xx → not `PsnAuthError`.
  - `[medium]` `[patch]` The `location.replace(REDIRECT_URI, 'https://x')` substring rewrite would mine a `code` out of any Sony page whose query merely *contained* the redirect URI. Now guarded by `startsWith` before parsing; tested with a sign-in-page location carrying its own `code`.
  - `[medium]` `[patch]` `bearer ??= exchange()` memoized a REJECTED promise, replaying a stale failure on the next call of the same instance. Memo is cleared on rejection; tested.
  - `[medium]` `[patch]` The Settings deep link renders `{"npsso":"…"}` — users will paste the whole blob. `unwrapNpsso()` now unwraps the JSON, surrounding quotes, and a leading `npsso=`, with the charset/length guard still running on the FINAL value (the trust boundary holds). Integration rows per paste shape.
  - `[medium]` `[patch]` A live `psn_cookie` row survived at rest in a deployed D1 after the key rename. Migration `0006_drop_psn_cookie_setting.sql` deletes it.
  - `[medium]` `[patch]` `project-context.md`, the PS-catalog `SPEC.md`, and `ARCHITECTURE-SPINE.md` still documented the cookie as the auth mechanism — the docs agents read first would steer future stories onto the deleted path. Updated to the NPSSO bearer.
  - `[low]` `[patch]` The authorize `scope` was unasserted; pinned in its exact encoded form so a silent divergence from the probed shape goes red.
  - `[low]` `[patch]` Stale `npsso=` allow-list exemption for `SettingsPanel.tsx` dropped from the encapsulation guard (the panel has no wire form; the exemption would have let the UI hand-roll one).
  - `[low]` `[patch]` Encapsulation-test comment claiming `pdccws_p` is gone "nowhere, not even here" corrected: the scan only walks `.ts/.tsx`, and the frozen `export_ps_catalog.py` + the README legacy line still name it legitimately.
  - `[low]` `[patch]` MAX_PAGES budget comment recomputed: worst case is now 2 (exchange) + 40 = 42 of the 50 subrequests.
  - `[low]` `[patch]` Provider docstring cited `tmp/probe-psn-auth.ts` — gitignored, a dangling provenance reference. Now cites DW-10 in `deferred-work.md` (committed, probed live 2026-07-13).
  - `[low]` `[patch]` `settings-panel__cookie-input` class renamed to the token vocabulary.
  - `[low]` `[patch]` `.dev.vars.e2e` comment said the credential was "absent" above a `PSN_NPSSO=""` line; comment and line now agree.

## Design Notes

**Deliberate deviation from the epic AC's wording (epics.md L1628-1630).** The epic says the adapter "refreshes the bearer from the offline refresh token when the cached bearer expires". There is no bearer cache to expire: a Worker invocation is stateless, and caching the bearer across invocations would mean persisting a *derived* credential (access + refresh token) at rest beside the NPSSO — a second secret to store, invalidate and leak, to save two subrequests on a sync the user triggers a few times a day. Instead the NPSSO **is** the durable credential and the exchange runs once per provider instance (memoized promise), so a 175-game paginated sync exchanges once, not per page. The AC's user-visible promise holds exactly: no user interaction until the ~60-day NPSSO itself dies, at which point the existing expired-credential path fires. `access_type=offline` stays in the authorize call (it is what the probed flow sends); the returned `refresh_token` is simply not stored.

```ts
// ponytail: one exchange per provider instance, no cross-request bearer cache.
// Upgrade path if the 2 extra subrequests ever matter: persist access+refresh
// tokens in the setting table and refresh on 401.
let bearer: Promise<string> | undefined;
const getBearer = () => (bearer ??= exchange());
```

**Failure shapes come from the live probe, not from convention.** The authorize step answers an expired NPSSO with a redirect that carries no `?code=` (not a 401); the purchased-list answers an invalid credential with HTTP 200 + `errors[]`. Both map to `PsnAuthError` — the existing single-attempt, fail-closed, flag-the-banner path.

## Verification

**Commands:**
- `bun run check` -- expected: biome + tsc clean (no `PSN_SESSION_COOKIE`/`getPsnCookie` references left to typecheck).
- `bun run test` -- expected: green, including `psn-encapsulation.test.ts` (no auth URL leaks outside the provider) and the captured 200+"Access denied" degenerate-response row.
- `bun run test:e2e` (or the project's Playwright script) -- expected: the epic4-settings flows green against the token field, incl. the no-credential sync → banner row.

**Manual checks (if no CLI):**
- Settings panel renders one credential field (the NPSSO one) — no cookie field beside it — and its "Get / refresh token" link points at `https://ca.account.sony.com/api/v1/ssocookie` with `target="_blank"`.

## Auto Run Result

Status: done (2026-07-13)

**Change.** `PsnProvider` now authenticates with an NPSSO token instead of the `pdccws_p` session cookie: it reads the stored `npsso`, runs the authorize → `?code=` → access-token exchange (wire shape copied verbatim from the live probe recorded as DW-10), and calls PSN with `authorization: Bearer`. The exchange happens once per provider instance, so a paginated sync costs 2 extra subrequests, not 2 per page. The cookie path is deleted — key, seed secret, getter, UI field, help copy and banner all moved to the token — and migration 0006 deletes any `psn_cookie` row left at rest in a deployed D1. This unblocks Story 9.2 (trophies are unreachable under the cookie: 401) and re-homes the Epic 4 library sync + Epic 5 catalog paths on the bearer.

**Files changed.** `src/providers/psn.ts` (exchange + bearer + `PsnAuthError` rewording); `src/services/settings.ts` (`psn_npsso` key, `getPsnNpsso`, `getPsnCookie` deleted); `src/routes/settings.ts` (`PUT /api/settings/psn-npsso`, JSON-blob/quote/`npsso=` unwrapping, charset guard retained); `src/services/{sync,psplus}.ts` + `src/routes/{sync,psplus}.ts` (getter + env type rewiring, no behaviour change); `web/settings/{SettingsPanel.tsx,api.ts,settings-panel.css}` (token field in the cookie's slot + "Get / refresh token" deep link to the ssocookie endpoint); `web/shell/{AppShell,Fab}.tsx`, `web/components/AttentionBanner.tsx` + css (`expired-cookie` → `expired-token`, copy reworded); `migrations/0006_drop_psn_cookie_setting.sql` (+ meta); `worker-configuration.d.ts`, `.dev.vars.example`, `.dev.vars.e2e`, `README.md`, `vitest.config.ts` (`PSN_NPSSO` pinned empty so tests can never reach live PSN); `_bmad-output/project-context.md`, the PS-catalog `SPEC.md` and `ARCHITECTURE-SPINE.md` (auth statements updated); tests across `src/providers/`, `test/integration/`, `web/`, `playwright/`.

**Review findings.** 13 patched (1 high: denial-vs-outage misclassification would have flagged a valid token expired on any Sony 5xx/429/403-challenge; 5 medium; 7 low), 3 deferred to the ledger, 2 rejected. No intent gaps, no spec loopbacks. A HIGH finding fired the auto-force rule, so an independent follow-up pass ran over the final diff: it confirmed the header-injection boundary, migration 0006, credential handling (nothing logged/echoed/persisted beyond the setting row), and mutation-checked the hazard tests as non-vacuous; its one remaining defect (403 challenge pages still read as a denial) is patched above.

**Verification.** `bun run lint` (biome, 222 files) clean; `bun run typecheck` (`tsc -b`) clean; `bun run test` — 60 files / 1762 tests passed; `bun run test:e2e` — 77-82 passed with one recurring failure at Playwright 6.4a. That failure is PRE-EXISTING and not a regression: reproduced on the baseline commit with this story's changes stashed (1 of 2 baseline full-suite runs failed the same test the same way), and it passes in isolation and under `--repeat-each 3`. Logged to the deferred-work ledger.

**Residual risks.** The exchange has never run against live PSN from inside the Worker — only in the probe harness and against mocks; the first real sync after deploy is the true test (the credential itself must be pasted by a human either way). The expired-NPSSO signal is a redirect without a `?code=`, which is shape-matching rather than an explicit error code: if Sony changes that shape, an expired token surfaces as a plain error (banner stays dark) rather than as a false alarm — the safe direction.
