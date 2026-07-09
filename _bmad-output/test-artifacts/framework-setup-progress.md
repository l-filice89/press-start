---
stepsCompleted:
  [
    'step-01-preflight',
    'step-02-select-framework',
    'step-03-scaffold-framework',
    'step-04-docs-and-scripts',
    'step-05-validate-and-summary',
  ]
lastStep: 'step-05-validate-and-summary'
lastSaved: '2026-07-10'
status: complete
---

# Framework Setup Progress — Epic 2.5 (Playwright Foundation)

## Step 1: Preflight

- **Detected stack:** frontend (`package.json` only manifest; backend is the same Cloudflare Worker via Hono — no separate backend manifest)
- **Project:** React 19 SPA + Vite 8 + Cloudflare Worker (Hono, D1, Drizzle), wrangler 4, Bun as local toolchain
- **Existing tests:** Vitest 4 + `@cloudflare/vitest-pool-workers` (unit/integration tier) — no e2e framework (no `playwright.config.*` / `cypress.*`) ✅
- **Auth:** better-auth magic link, console email provider in dev (link captured from console — see memory `press-start-dev-testing.md`)
- **Context docs:** `ARCHITECTURE-SPINE.md`, `_bmad-output/project-context.md`, epics.md Epic 2.5 (TR-1: Playwright vs real Worker+D1, magic-link via console; TR-2: backfill e2e per Epic 1+2 AC with UI flow; TR-3: standing rule in `_bmad/custom/bmad-dev-auto.toml`)
- **Config:** `tea_use_playwright_utils: true`, `test_framework: auto`, framework choice effectively pre-decided by Epic 2.5 = Playwright

## Step 2: Framework Selection

**Selected: Playwright.** Rationale:

- Epic 2.5 TR-1 explicitly requires Playwright (real browser vs real Worker + D1)
- Frontend stack default per selection logic; no Cypress-favoring factors (not component-testing focused — Vitest owns that tier)
- Console/network capture needed for the magic-link auth flow (console email provider) — first-class in Playwright
- CI parallelism + trace artifacts for the AC-backfill regression suite (TR-2)

## Step 3: Scaffold (executed sequential mode; playwright-utils fragments consulted: overview, fixtures-composition, auth-session, data-factories, network-error-monitor)

**Verified working: `bun run test:e2e` → 3/3 passed (40s), server torn down cleanly.**

Created:

- `playwright.config.ts` — testDir `playwright/e2e`, baseURL `http://localhost:5175` (env `BASE_URL` fallback), storageState pre-auth, timeouts 15s/30s/60s, trace/screenshot/video retain-on-failure, list+HTML (+JUnit on CI), chromium-only (single-user app; add browsers if cross-browser bugs appear)
- `playwright/support/global-setup.ts` — **the TR-1 core**: applies migrations to isolated e2e D1, spawns `vite dev --port 5175` with `CLOUDFLARE_ENV=e2e` (spawned directly, NOT Playwright `webServer`, because auth must read the magic link from server stdout), POSTs `/api/auth/sign-in/magic-link`, regex-captures `[auth] magic link for …` from stdout (console email provider — zero real emails), GETs the link, asserts `/api/me`, saves `playwright/.auth/user.json`
- `playwright/support/global-teardown.ts` — kills server tree (taskkill /T on win32, process-group kill on POSIX) via `playwright/.server.pid`
- `playwright/support/merged-fixtures.ts` — `mergeTests`: apiRequest + interceptNetworkCall + log + networkErrorMonitor (auto-fails tests on any 4xx/5xx; opt out per-test with `skipNetworkMonitoring` annotation)
- `playwright/support/factories/game-factory.ts` — `createGame(overrides)` / `createWishlistedGame`, uuid-unique titles (no faker dep — add if realistic data ever needed)
- `playwright/support/helpers/d1.ts` — `seedGame`/`deleteGame` via `wrangler d1 execute --env e2e --local` (no create-game API until Epic 6; tracking row attaches to the e2e user via subquery). Shells out per call (~1–2s) — switch to dev-only seed endpoint if setup time hurts
- `playwright/e2e/smoke.spec.ts` — 3 samples: API health (apiRequest fixture), authenticated shelf load, seeded game visible (factory + D1 seed + cleanup)
- `wrangler.jsonc` — new `env.e2e`: own `database_id` (isolated local D1 state), `AUTH_ALLOWED_EMAIL=e2e@press-start.local`, assets block replicated (named envs don't inherit)
- `.dev.vars.e2e` — committed on purpose: dummy `BETTER_AUTH_SECRET`, deliberately NO `RESEND_API_KEY` → console email provider guaranteed
- `tsconfig.e2e.json` (+ ref in `tsconfig.json`) — `moduleResolution: bundler` (playwright-utils types break under `nodenext`)
- `package.json` — `test:e2e`, `test:e2e:ui`; devDeps `@playwright/test`, `@seontechnologies/playwright-utils@4.4.0`; chromium installed
- `.gitignore` — test-results/, playwright-report/, playwright/.auth/, .server.pid; `!.dev.vars.e2e`
- `.env.example` — optional `BASE_URL` documented

Selector strategy note: no `data-testid` convention app-wide yet — cards expose `data-testid="shelf-card"` + rich aria-labels; backfill stories (TR-2) should prefer role/name selectors, adding testids only where accessible names don't reach.

Skipped: `.nvmrc` (Bun is the toolchain; no nvm on this machine), page-objects dir (add when specs repeat flows), faker, recurse/burn-in wiring (fixtures available in the package when needed).

## Step 4: Docs & scripts

- `playwright/README.md` — run commands, auth flow explanation, architecture map, practices (selectors, seed-not-UI, isolation, TR-3 standing rule), CI notes, fragment references
- Scripts landed in step 3: `test:e2e`, `test:e2e:ui`

## Step 5: Validation & summary

Checklist result: **PASS**. Evidence: `bun run test:e2e` 3/3 green (real run, artifacts on failure configured), `tsc -b` clean, `biome check` clean, teardown verified (no orphan on 5175, pid file removed), no secrets in committed files (`.dev.vars.e2e` is a dummy value by design).

Deliberate deviations from checklist boilerplate:

- No `.nvmrc` / `TEST_ENV` / `API_URL` env vars — Bun toolchain, single-origin app, one `BASE_URL` knob is the whole surface
- No faker — uuid-suffixed titles are collision-proof; add faker when a test needs realistic-looking data
- No `fixtures/index.ts` with custom auto-cleanup fixtures — auth is storage-state (global setup), seeding is explicit `seedGame`/`deleteGame`; promote to a fixture when >2 specs repeat the pattern
- Trace value is `retain-on-failure` (the checklist's `retain-on-failure-and-retries` isn't a valid Playwright literal)
- `on_complete` hook: empty — nothing to run

Handoff: TR-1 foundation done. Next → `bmad-testarch-ci` (CI workflow), then TR-2 backfill stories (one e2e per Epic 1+2 AC with a UI flow) via `bmad-testarch-atdd`/`bmad-testarch-automate`, and TR-3 persistent-fact wiring in `_bmad/custom/bmad-dev-auto.toml`.
