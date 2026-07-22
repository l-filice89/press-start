---
title: 'Story 8.2: Real users can register (B1b)'
type: 'feature'
created: '2026-07-17'
status: 'done'
baseline_revision: 'eb137db'
final_revision: '5605fd0'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/publication-blockers.md'
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Only `AUTH_ALLOWED_EMAIL` can sign in — there is no registration. AD-29 (signed off 2026-07-17) rules registration OPEN: the "invite" is sharing the URL, and admission is **proven control of the email**, not a list.

**Approach:** Delete the allowlist wholesale — `isAllowedEmail`, the env var, the magic-link pre-gate, the `requireAuth` re-check, the `sendMagicLink` defense check, and the create-hook's allowlist half (the **`emailVerified` requirement stays** — it is the admission rule now). Gate the OAuth account-LINK path on a verified email match (no trusted-provider bypass). Add the `verification`-row TTL sweep to the cron. The cron's user resolution moves from env-email to oldest-registered-user (interim until 8.4's per-region model). WAF rate limiting is an edge/dashboard step, documented — never D1 counters.

## Boundaries & Constraints

**Always:**
- Every door still requires **proven email control**: magic link by construction; OAuth by `emailVerified`; the LINK path links a provider identity into an existing user **only on a verified email match** — better-auth's `trustedProviders` bypass (which links unverified) is explicitly disabled. This is the account-takeover door (deferred-work: OAuth link gate); it gets a hazard test that tries to link an UNVERIFIED matching email and must be refused [TEST-THE-BYPASS].
- Two-user scoping is now exercised for real: with two registered users, each sees only their own `GAME_TRACKING`; unauthenticated or cross-user tracking requests are refused server-side (tests drive both users through real routes).
- The scheduled cron keeps working with the env var gone: `runScheduledPsPlusCheck`/`runScheduledScoreRefresh` resolve the **oldest registered user** (`ORDER BY createdAt LIMIT 1`) — an interim single-tenant bridge that 8.4's per-region model deletes; marked `ponytail:` with that owner.
- The cron gains the **verification TTL sweep** (AD-29): expired `verification` rows (`expiresAt < now`) are deleted — guarded to run only on sweep invocations (`spentFanOut`), which skip the score refresh, so the 50-subrequest worst case is never exceeded; ledger comments updated with the arithmetic.
- The magic-link no-enumeration behavior stays: the sign-in route always answers better-auth's success shape. (The pre-gate goes; the shape stays.)
- Rejected-OAuth copy: the `ACCESS_DENIED` (uppercase) branch retires with the gate; Google's own cancelled-consent (`access_denied`, lowercase) branch stays. An OAuth callback for an UNVERIFIED email still lands on the login screen with a plain statement (the hook's rejection survives as the verified-email rule).
- Tests and e2e config migrate off `AUTH_ALLOWED_EMAIL` (session.ts helper, `.dev.vars*`, `wrangler.jsonc` if present, `worker-configuration.d.ts` via cf-typegen or hand-edit); `grep -rn "AUTH_ALLOWED_EMAIL" src worker web` returns nothing.
- Deferred-work items 312–324 are closed with rulings recorded in `deferred-work.md`: link gate → shipped here; de-allowlisted session → moot under open registration (no de-admission concept, AD-29); rate limiting → WAF edge rule (manual dashboard step, documented in the spec's Verification + a README/deploy note), residue → TTL sweep shipped here.

**Block If:**
- The LINK path cannot be restricted to verified matches without forking better-auth internals.
- Keeping the cron alive requires re-introducing an env-based user identity.

**Never:**
- No admission table, no invites, no roles, no sharing, no ban tooling (AD-29). No per-user data model changes (8.3's migration). No D1-metered rate limiting. No schema migration. No new dependencies. Do not touch the PS+ fan-out model (8.4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stranger registers via magic link | Any email, link followed | User row created, session established, empty shelf | No error |
| Stranger registers via Google | OAuth callback, `emailVerified: true` | User row created, session, empty shelf | No error |
| Unverified OAuth email | Callback with `emailVerified: false` | Refused before a user row exists; login screen states it | Plain copy, not a blank bounce |
| Link attempt, verified match | Google identity, verified email = existing user's | Linked into the existing account | No error |
| Link attempt, UNVERIFIED match | Provider reports the address unverified | Refused — no link, no session | The bypass hazard test |
| Cross-user request | User B's session, user A's game id | 404/refusal exactly as today (AD-13 scoping) | No error |
| Cron with no users | Fresh deploy, zero registered users | Scheduled run no-ops cleanly (no throw) | Logged, not a banner |
| Expired verification rows | Sweep invocation fires | Rows with `expiresAt < now` deleted; live rows survive | No error |

</intent-contract>

## Code Map

- `src/services/auth.ts:34-46` (`isAllowedEmail`), `:110-130` (create hook — keep `emailVerified`, drop allowlist), `:139-146` (`sendMagicLink` check — drop), + `account.accountLinking` config (verified-match only, no trusted bypass).
- `src/routes/auth.ts:35-48` (magic-link pre-gate — delete; keep the success-shape route only if needed for no-enumeration, else remove the middleware entirely), `:55-68` (`requireAuth` — drop the allowlist re-check; session alone gates).
- `src/services/psplus.ts:366-370` + `src/services/scores.ts` (cron user resolution → oldest user; repo fn `findOldestUser` in `src/repositories/users.ts` beside `findUserByEmail`).
- `worker/index.ts:39-71` -- TTL sweep call on `spentFanOut` invocations; `src/repositories/` gains `deleteExpiredVerifications(db, now)`.
- `web/Login.tsx` -- retire the uppercase `ACCESS_DENIED` copy branch; keep lowercase cancelled-consent; adjust the unverified-email rejection copy.
- `wrangler.jsonc` / `.dev.vars*` / `worker-configuration.d.ts` -- remove `AUTH_ALLOWED_EMAIL`.
- `test/integration/session.ts` (`ALLOWED_EMAIL` → a plain constant), `auth.test.ts` (allowlist suites → open-registration + link-gate + verified-email suites), new two-user scoping tests (shelf/tracking routes), cron no-user + TTL sweep tests.
- `playwright/` -- auth journey unchanged mechanically (any email works now); COVERAGE.md rows.

## Tasks & Acceptance

**Execution:**
- [x] `src/services/auth.ts` -- delete `isAllowedEmail` + its `sendMagicLink` check; reduce the create hook to the `emailVerified` requirement (message stays machine-readable for the login copy); add `account: { accountLinking: { enabled: true, trustedProviders: [] } }` so linking demands a provider-verified matching email — document WHY (takeover door).
- [x] `src/routes/auth.ts` -- delete the pre-gate middleware; `requireAuth` gates on session validity alone.
- [x] `src/repositories/users.ts` -- `findOldestUser(db)`; `src/repositories/` -- `deleteExpiredVerifications(db, now)`.
- [x] `src/services/psplus.ts` + `src/services/scores.ts` -- cron resolves the oldest user (`ponytail:` interim, 8.4 owns the real model); no-user = clean no-op; ledgers updated.
- [x] `worker/index.ts` -- TTL sweep on sweep invocations.
- [x] `web/Login.tsx` -- copy branches per Boundaries.
- [x] Config sweep -- env var removed everywhere; `bun run cf-typegen` or hand-edit the Env type.
- [x] `test/integration/` -- rewrite auth suites (open registration both paths; unverified OAuth refused; **unverified-match link refused** (bypass); verified-match link succeeds); two-user scoping through real routes; cron-no-user; TTL sweep (expired deleted, live kept).
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- close items 312–324 with the rulings above.
- [x] `playwright/COVERAGE.md` -- rows for 8.2's ACs; auth-journey re-run green.

**Acceptance Criteria:**
- Given any email address, when its owner completes a magic link or a verified Google sign-in, then they have an account and see only their own (empty) library.
- Given an OAuth identity whose email is unverified, when it hits creation OR linking, then it is refused with no database residue beyond better-auth's own state rows.
- Given two registered users, when each uses the app, then server-side scoping holds on every tracking route (proven by tests, not UI).
- Given the env var is deleted, when the cron fires, then the scheduled work still runs (oldest user) and expired verification rows are swept within budget.
- Given `grep -rn "AUTH_ALLOWED_EMAIL" src worker web test`, when the story lands, then it returns nothing.

## Spec Change Log

### 2026-07-17 — Post-review amendments (recorded rulings)

KEEP in any re-derivation: (1) the TTL sweep runs on EVERY cron invocation — the spec's "sweep invocations only" gating made it unreachable with zero users (exactly the abuse window) and rare otherwise; the honest cost is one D1 call and a ~50-of-50 combined worst case, recorded in worker/index.ts. (2) An IN-CODE rate limiter was added (better-auth's built-in, module-scope in-memory store, `AUTH_RATE_LIMIT=off` for tests): per-isolate burst damping with zero D1 writes — consistent with the contract's "never D1 counters"; the WAF dashboard rule remains the distributed backstop. (3) The LINK-path refusal reaches the browser as better-auth's literal `account_not_linked`, not our hook's code — Login.tsx carries a dedicated copy branch for it.

## Review Triage Log

### 2026-07-17 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 2, medium 3, low 8)
- defer: 0
- reject: 1
- addressed_findings:
  - `[high]` `[patch]` **TTL sweep was gated to near-nonexistence** (`spentFanOut`-only: unreachable with zero users — the fresh-deploy abuse window — and rare in steady state). Now runs first on every invocation; the zero-user + expired-row path is swept.
  - `[high]` `[patch]` **Deleting the `sendMagicLink` guard left an unmetered anonymous email cannon** (any POST → real Resend email to any address; per-IP WAF is the wrong shape and dashboard-only). better-auth's built-in in-memory rate limiter enabled (60/min global, 5/min on `/sign-in/magic-link`, per-isolate, zero D1 writes; `AUTH_RATE_LIMIT=off` for suites that hammer the route by design).
  - `[medium]` `[patch]` WAF-only defense had no runtime fallback — the in-code limiter is the fallback; comments no longer lean on the dashboard promise alone.
  - `[medium]` `[patch]` **Oldest-user cron identity is capturable** on any empty-user state (first stranger to register owns region/timezone/failure-flags). Cannot be fixed before 8.4 — made LOUD: the cron logs the resolved identity every run as the 8.4 cue.
  - `[medium]` `[patch]` LINK-path refusal showed generic copy (`account_not_linked` is better-auth's literal, not our hook's code) — dedicated Login.tsx branch added.
  - `[low]` `[patch]` Bypass test hardening: refusal literal pinned (`account not linked`), residue assert now queries the `account_id` a regressed link would actually write (`prov-1` — it was dead code against `google-link-attack`), malformed-body assert pinned to 400.
  - `[low]` `[patch]` `.dev.vars.example` allowlist sentence corrected; `TEST_EMAIL` rename (the `ALLOWED_EMAIL` name lied post-allowlist, 17 files); cron zero-user test re-seeds after `delete(user)` (order landmine); `requireAuth` comment no longer promises revocation tooling that doesn't exist; `emailVerified !== true` strict-boolean guard; TTL boundary `lte` (expires-at-now is expired); worker ledger note carries the sweep's +1 (~50 of 50 worst case, zero headroom).
  - Rejected (1): cookieCache serving a deleted user's session ≤5 min (no delete tooling exists; the AD-33 §6 bound covers it).

## Design Notes

The WAF rate limit is deliberately NOT code: Cloudflare's free tier includes one rate-limiting rule, configured in the dashboard against `/api/auth/*` — D1-metered counters would hand an attacker a write per anonymous hit (AD-29/AD-32). The deploy step is recorded in Verification; the TTL sweep is the in-code half of the residue defense.

## Verification

**Commands:**
- `bunx vitest run test/integration` / `bunx vitest run web` -- expected: green incl. the rewritten auth suites.
- `bunx tsc -b` / `bunx biome check src web test` -- expected: clean.
- `bunx playwright test playwright/e2e/auth-journey.spec.ts` -- expected: green.
- `grep -rn "AUTH_ALLOWED_EMAIL" src worker web test` -- expected: no hits.

**Manual checks (if no CLI):**
- Post-deploy: ~~add the WAF rate-limiting rule on `/api/auth/*`~~ RULED OUT 2026-07-19: rate-limiting rules are zone-only and cannot attach to workers.dev; the app has no custom domain. The in-code better-auth limiter (shipped in this story's review) is the sole rate defense. Revisit when a custom domain is routed: 1 free rule, per-IP, 10s counting window (free plan cannot express req/min).

## Auto Run Result

Status: done

**Implemented:** open registration per the signed-off AD-29. The allowlist is deleted wholesale — `isAllowedEmail`, `env.AUTH_ALLOWED_EMAIL`, the magic-link pre-gate, the `sendMagicLink` defense check, and `requireAuth`'s re-check (session alone gates). Admission is proven email control: magic link by construction, OAuth via a strict `emailVerified === true` create hook (`EMAIL_NOT_VERIFIED` is the wire code), and the account-LINK path refuses anything but a provider-verified matching email (`trustedProviders: []` — the takeover door). Abuse posture: better-auth's in-memory rate limiter (60/min, 5/min magic-link, per-isolate, no D1) + the documented WAF edge rule + a verification TTL sweep on every cron invocation. The cron resolves the oldest registered user (loud interim bridge; 8.4 deletes it). Deferred-work items 312–324 closed with rulings.

**Files changed:** `src/services/auth.ts` (gates → verified-email rule, accountLinking, rateLimit), `src/routes/auth.ts` (pre-gate deleted, requireAuth simplified), `src/repositories/users.ts` (`findOldestUser`, `deleteExpiredVerifications`), `src/services/psplus.ts` + `scores.ts` (oldest-user + identity log), `worker/index.ts` (TTL sweep every invocation), `web/Login.tsx` (+`Login.test.tsx`) copy branches, `wrangler.jsonc`/`.dev.vars*`/`worker-configuration.d.ts` (env var deleted; `AUTH_RATE_LIMIT` added), `test/integration/` (auth suites rewritten for open registration + link bypass via better-auth's real `handleOAuthUserInfo`; two-user scoping through real routes; TTL sweep; cron zero-user; `TEST_EMAIL` rename across 17 files), `deferred-work.md` closures, `playwright/COVERAGE.md`.

**Review:** 2 lenses, 21 raw findings → 13 patched (2 high: the TTL sweep gated to near-never, and the unmetered email cannon), 1 rejected, 0 deferred, 0 intent gaps/bad-spec. Reviewers confirmed the admission rule itself sound at every door (create, OAuth, both link doors) against better-auth internals. `followup_review_recommended: true` (2 highs on a security surface).

**Verification:** integration 293 passed (open-registration, link-bypass, two-user scoping, TTL sweep, cron zero-user suites included); web 348 passed; `tsc -b` + `biome check` clean; Playwright `auth-journey` 3 passed; `grep -rn "AUTH_ALLOWED_EMAIL" src worker web test` → nothing (one historical comment removed).

**Residual risks:** the WAF rate-limit dashboard rule is still a MANUAL deploy step (in-code limiter is per-isolate best-effort — a distributed attack needs the edge rule; do it at deploy). Resend's daily quota remains the hard ceiling on magic-link volume. The oldest-user cron identity is capturable until 8.4 on an empty-user deploy — mitigated by the loud log, deleted by 8.4. Combined cron worst case now ≈50 of 50 subrequests: the next addition to that invocation must re-budget or split.

## Follow-up Review Record (FOLLOW-UP-REVIEW CONTRACT — auto-forced on HIGH)

2026-07-17 — independent pass RAN (fresh reviewer, no shared context) over the epic range 14ae6d2..HEAD, this story's security surface. **Verdict: CLEAN.** Both HIGH patches verified in the final code: the TTL sweep runs unconditionally at the top of `scheduled` (`lte` boundary confirmed), and the magic-link route's 5/60s custom rule was traced through better-auth 1.6.23's `resolveRateLimitConfig` (customRules win; the module-scope memory store survives per-request `createAuth`; prod-on default confirmed). The admission rule was re-derived independently at all six doors — magic-link create, OAuth create (hook inside the transaction, no residue), implicit link, redirect link, idToken link, session issuance — with `trustedProviders: []` confirmed to refuse the takeover path; no unverified-email or attacker-controlled path issues a session. User enumeration: uniform response confirmed. One LOW applied: the limiter now keys on `ipAddressHeaders: ['cf-connecting-ip']` (`src/services/auth.ts`) instead of relying on Cloudflare's append-behavior for `x-forwarded-for`. Obligation discharged; merge gate clear for this story.
