---
title: 'Sign in with a magic link (auth & user scoping)'
type: 'feature'
created: '2026-07-07'
status: 'done'
baseline_revision: '58179e5ad6b9394adc7b037c8638b996dc9aec9c'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The app has no authentication: anyone hitting the Worker sees everything, and there is no `user_id` for Story 1.4's `GAME_TRACKING (user_id, game_id)` PK or Story 1.7's session-gated shelf to scope by (FR-47/FR-48, AD-13).

**Approach:** Wire better-auth (magic link plugin) into the Worker via its Drizzle/D1 adapter, creating only the tables auth itself needs; expose the auth handler under `/api/auth/*`; add a `requireAuth` middleware that turns the session into a `userId` every protected route/repository query will consume; gate the SPA behind a magic-link login screen. Email delivery goes through a new `providers/` email port (AD-5) with a Resend adapter for production and a console adapter for dev/test.

## Boundaries & Constraints

**Always:**
- Pin `better-auth` to an exact version (1.6.23 at spec time). Auth tables are defined in `src/schema/` as Drizzle tables matching better-auth's expected core + magic-link schema (`user`, `session`, `account`, `verification`), migrated via `drizzle-kit generate` + `wrangler d1 migrations apply` (AD-16) — the Worker never migrates at startup.
- The better-auth instance is created per-request via a factory (`createAuth(env, ...)`) because D1/secret bindings only exist per-request on Workers; the factory accepts an injectable email provider so tests can capture the magic-link URL.
- Magic-link email sending goes only through the `providers/` email port (AD-5). Provider selection: Resend adapter when `RESEND_API_KEY` is set, console-logging adapter otherwise (local dev, tests). No other module touches the email API.
- Sign-in is allowlisted: only `AUTH_ALLOWED_EMAIL` (case-insensitive) gets an email; other addresses receive the identical success response (no account enumeration) and never get a user row (magic link only creates the user at verification).
- Protected API routes use one shared `requireAuth` Hono middleware that 401s without a valid session and exposes `userId` (and email) via typed context vars — this is the AD-13/AD-14 user seam Story 1.4's repositories will consume; no route reads the session ad hoc.
- Secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`) come from Wrangler secrets / `.dev.vars` (gitignored); non-secret config (`AUTH_ALLOWED_EMAIL`, `AUTH_EMAIL_FROM`) from `wrangler.jsonc` `vars`. Regenerate `worker-configuration.d.ts` with `bun run cf-typegen`.
- The unauthenticated SPA shows only the login screen — no shelf/scaffold content leaks pre-auth (FR-47). Keep visuals minimal/functional; the PRESS START design system is Story 1.5.

**Block If:** (none — email transport was undecided in planning docs, resolved here via the AD-5 provider seam so swapping vendors is a one-adapter change)

**Never:**
- Don't build sharing, roles, tenancy, rate limiting, or any table beyond what better-auth's core + magic-link plugin need (AR-13; AC "only the tables auth needs are created"). `GAME`/`GAME_TRACKING` etc. are Story 1.4.
- Don't build the Settings surface — a minimal sign-out control on the authenticated placeholder is fine (real placement lands with the Story 1.5 shell).
- Don't add Google OAuth or passwords (v1.x per FR-47); don't hand-roll token/session logic better-auth already owns.
- Don't let auth code bypass the layer rules elsewhere: better-auth's own adapter owns its tables, but no new raw D1 access appears outside `repositories/`/better-auth.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cold unauthenticated SPA load | No session cookie | Login screen only; no shelf/app content (FR-47) | No error expected |
| Unauthenticated protected API call | `GET /api/me`, no cookie | `401` JSON `{ error: 'unauthorized' }` | No error expected |
| Magic-link request, allowed email | `POST /api/auth/sign-in/magic-link` with `AUTH_ALLOWED_EMAIL` | `200`; email provider receives a verify URL; SPA shows "check your email" state | No error expected |
| Magic-link request, other email | Same endpoint, non-allowlisted address | Same `200` shape; no email sent; no user row ever created | Silent skip (no enumeration) |
| Follow valid magic link | `GET` the emailed verify URL | Session cookie set; redirect to `/`; SPA renders authenticated view (AC "land on the shelf" = post-auth app view; the real shelf is Story 1.7) | No error expected |
| Follow expired/invalid link | Bad/used token | No session; land back on SPA with a sign-in error state (better-auth error callback URL) | Error surfaced, no retry loop |
| Authenticated identity read | `GET /api/me` with session cookie | `200` `{ id, email }` matching the signed-in user — proves the `userId` seam every future tracking query filters by (AD-13) | No error expected |
| Sign out | `POST /api/auth/sign-out` (via SPA control) | Session revoked; next `/api/me` is `401`; SPA returns to login | No error expected |
| Dev/test email fallback | `RESEND_API_KEY` unset | Console adapter logs the magic-link URL; flow fully works locally | No error expected |
| Schema audit | After migrations apply | Only better-auth tables (`user`, `session`, `account`, `verification`) added — no roles/sharing/tenancy columns (AR-13) | No error expected |

</intent-contract>

## Code Map

- `src/schema/auth.ts` + `src/schema/index.ts` -- better-auth Drizzle tables (user/session/account/verification); barrel re-export so drizzle-kit picks them up
- `src/repositories/db.ts` -- `createDb(d1)` Drizzle factory (the AD-4 seam; better-auth's adapter consumes it)
- `src/providers/email.ts` -- `EmailProvider` port + Resend adapter (fetch) + console adapter + `createEmailProvider(env)` selection
- `src/services/auth.ts` -- `createAuth(env, { emailProvider?, baseURL? })` better-auth factory: drizzle adapter, magicLink plugin with allowlist gate
- `src/routes/auth.ts` -- mounts `auth.handler` on `/api/auth/*`; `requireAuth` middleware; `GET /api/me`
- `src/routes/index.ts` -- register auth routes + `/api/me`
- `worker/index.ts` -- composition root wiring (auth routes already flow through `apiRoutes`)
- `web/auth-client.ts`, `web/Login.tsx`, `web/App.tsx` -- better-auth React client (magicLinkClient), login screen, session gate + sign-out control
- `wrangler.jsonc`, `worker-configuration.d.ts`, `.dev.vars.example`, `.gitignore` -- vars, regenerated Env types, local secrets template
- `migrations/` -- new drizzle-kit migration for the auth tables
- `test/integration/auth.test.ts` -- flow tests via vitest-pool-workers (see Verification)
- `vitest.config.ts` -- provide test-only `BETTER_AUTH_SECRET`/vars via miniflare bindings if wrangler.jsonc vars don't reach the test env

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- add pinned `better-auth` dependency -- auth framework (FR-47)
- [x] `src/schema/auth.ts` (+ barrel) -- define the four better-auth tables in Drizzle, snake_case columns -- schema source of truth for drizzle-kit
- [x] `migrations/*` -- run `bun run db:generate` -- versioned SQL applied from CI (AD-16)
- [x] `src/repositories/db.ts` -- `createDb(d1)` -- single Drizzle construction point
- [x] `src/providers/email.ts` -- port + Resend + console adapters + env-based selection -- AD-5 seam; dev/test works without secrets
- [x] `src/services/auth.ts` -- `createAuth` factory with magicLink plugin, allowlist gate, injectable email provider, request-derived `baseURL` -- per-request instantiation on Workers
- [x] `src/routes/auth.ts` + `src/routes/index.ts` -- auth handler mount, `requireAuth` middleware with typed `userId` var, `GET /api/me` -- the user-scoping seam (AD-13)
- [x] `wrangler.jsonc` + `bun run cf-typegen` + `.dev.vars.example` + `.gitignore` -- `AUTH_ALLOWED_EMAIL`/`AUTH_EMAIL_FROM` vars, secret plumbing -- config without leaking secrets (`.gitignore` already covered `.dev.vars`/`!.dev.vars.example` — no change needed)
- [x] `web/auth-client.ts`, `web/Login.tsx`, `web/App.tsx` -- session gate: login screen w/ email form + "check your email" + error state; authenticated view keeps scaffold content + sign-out -- FR-47 UX
- [x] `test/integration/auth.test.ts` (+ `vitest.config.ts` tweaks) -- cover the I/O matrix rows end-to-end against in-test D1 -- regression net

**Acceptance Criteria:**
- Given a cold, unauthenticated load, when the app is opened, then the magic-link login screen renders and no shelf/app content is reachable (FR-47)
- Given the allowed email is entered, when the emailed magic link is followed, then a session is established and the SPA lands on the authenticated view (FR-47)
- Given an authenticated session, when a protected API route runs, then the request context carries the session's `user_id` via the shared middleware — the seam every tracking read/write will filter by (FR-48, AR-13, AR-14)
- Given auth setup, when migrations apply, then only better-auth's needed tables exist and no sharing/roles/tenancy is built (AR-13)
- Given `bun run lint && bun run typecheck && bun run test`, when run, then all pass including the new integration tests and the untouched `src/core/purity.test.ts`

## Spec Change Log

## Review Triage Log

## Design Notes

- **Email transport decision (undecided in planning docs):** Resend chosen as the production adapter — free tier fits a single-user app and it's a plain `fetch` call, workerd-safe. The decision is deliberately confined to one adapter behind the `EmailProvider` port (AD-5), so replacing it (e.g. Cloudflare Email Routing, SES) touches one file. Until `RESEND_API_KEY` is set as a Wrangler secret, production falls back to the console adapter (link visible via `wrangler tail`) — acceptable for a single-user bootstrap; setting the secret is a documented manual step, not CI's job.
- **AD-4 tension:** better-auth's Drizzle adapter reads/writes its own tables directly rather than through `repositories/`. Treat better-auth's tables as library-owned (like migrations metadata): the AD-4 rule keeps meaning "no *app* module issues raw queries"; the Drizzle client construction still lives in `repositories/db.ts` so there is one seam.
- **Allowlist rationale:** magic link with open sign-up would let any visitor mint an account (empty but real). `AUTH_ALLOWED_EMAIL` keeps "the app is mine today" true without building roles/tenancy (explicitly out of scope per AR-13). Responding identically for unknown emails avoids account enumeration.
- **`baseURL`:** derived from the incoming request origin (per-request factory), so vite dev, preview, and prod all work without per-env config; `trustedOrigins` includes the same origin.
- **AC-3 scope note:** `GAME_TRACKING` doesn't exist until Story 1.4, so "every tracking row carries/filters by user_id" is delivered here as the enforced seam (`requireAuth` → typed `userId` context var + `/api/me` proof) that 1.4's repositories must consume — matching the epic's story ordering.

## Verification

**Commands:**
- `bun run lint` -- expected: Biome passes (including `src/core/**` restricted-import override untouched)
- `bun run typecheck` -- expected: `tsc -b` clean with regenerated `worker-configuration.d.ts`
- `bun run test` -- expected: all unit + integration tests pass; `test/integration/auth.test.ts` covers: 401 unauthenticated, allowed-email magic-link issuance (captured via injected email provider), non-allowlisted silent skip + no user row, verify-link → session → `/api/me` identity, sign-out revocation, invalid-token rejection, and a `sqlite_master` audit that only the four auth tables were added
- `bun run build` -- expected: SPA + Worker build clean

**Manual checks (if no CLI):**
- `bun run dev`: cold load shows login; request link for the allowed email; copy the console-logged URL, open it, land authenticated; sign out returns to login.
