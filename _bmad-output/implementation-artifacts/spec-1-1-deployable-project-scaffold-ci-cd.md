---
title: 'Deployable project scaffold & CI/CD'
type: 'feature'
created: '2026-07-06'
status: 'done'
baseline_revision: '031869a00308ddaafcdfa44d0f867abed6e22e68'
final_revision: '30ea85e4ff54220762f2c9e9dd1034d78cb09acb'
review_loop_iteration: 0
followup_review_recommended: true
context: ['{project-root}/_bmad-output/implementation-artifacts/1-1-deployable-project-scaffold-ci-cd.md', '{project-root}/.bmad-loop/policy.toml']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The repo is greenfield — no `package.json`, Worker, SPA, or D1 wiring exists yet. Every later story needs a working, deployable Cloudflare Worker+SPA+API+D1 stack with automated quality gates and CI/CD to build on.

**Approach:** Scaffold via the official Cloudflare React+Workers generator, reshape it into the architecture spine's layered source tree, wire D1+Drizzle with one placeholder migration, add Biome/tsc/Vitest gates driven by canonical `package.json` scripts, and stand up GitHub Actions CI (quality gate) + CD (migrate-then-deploy) pipelines.

## Boundaries & Constraints

**Always:**
- Bun is the package manager/runner for install/lint/typecheck/test everywhere (local, CI, `.bmad-loop/policy.toml`'s `[verify]` gate) — one lockfile (Bun's), delete the generator's `package-lock.json`, never commit it.
- Deployed runtime is workerd/V8 only — no Bun-only APIs (`bun:sqlite`, Bun globals) anywhere under `src/`/`web/`.
- `src/core/` stays I/O-free: no `drizzle-orm`/`repositories/`/`providers/` imports, no global `fetch`/D1-binding usage. Enforce with a Vitest test — Biome `noRestrictedImports` can catch the import case but not global `fetch` usage.
- Migrations always run before deploy, never at Worker startup: `drizzle-kit generate` → `wrangler d1 migrations apply --remote` → `wrangler deploy`, in that order, in CD only.
- `package.json` exposes exactly `lint`, `typecheck`, `test` by those names; CI, local dev, and the bmad-loop `[verify]` gate (`.bmad-loop/policy.toml`) all invoke these same scripts unchanged — never re-implement a check inline elsewhere.
- All secrets (Cloudflare API token, IGDB/Twitch creds, initial PSN cookie) go through Wrangler secrets / GitHub Actions secrets, never hardcoded or committed. `.gitignore` covers `.env`, `node_modules/`, and Wrangler/D1 local state (`.wrangler/`).

**Block If:**
- Cloudflare authentication (`wrangler login` / `CLOUDFLARE_API_TOKEN`) is unavailable when creating the remote D1 database or performing the remote deploy.
- The GitHub remote lacks push access, or repo secrets needed by the CD workflow (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) cannot be configured, such that end-to-end CI/CD proof (pushed branch → green CI; merge to `main` → green CD → live `/api/health` 200) cannot be observed.

**Never:**
- Don't build beyond the walking skeleton — no shelf, auth, or real schema (a placeholder `meta` table only). "Done" = green CI + a successful deploy serving `/api/health` 200.
- Don't rewrite git history over the already-committed `SESSION_COOKIE` in `export_ps_catalog.py` (commit `b6b0d88`) — already decided unnecessary since it's a short-lived, self-expiring cookie. Only fix the value going forward: replace the hardcoded literal with an env/secret-backed read.
- Don't hand-assemble the Vite↔Workers integration — it must come from `npm create cloudflare@latest ps-game-catalog -- --framework=react --platform=workers`.
- Don't run migrations at Worker startup, ever.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Health check happy path | `GET /api/health` (local or deployed) | HTTP 200, JSON `{ status: "ok" }` validated against a Zod schema | No error expected |
| SPA deep link | `GET /some/client/route` (not under `/api/*`) | `index.html` served (SPA fallback), not a 404 | No error expected |
| `core/` purity violation | A file under `src/core/` imports `drizzle-orm`, `repositories/`, `providers/`, or references global `fetch` | Vitest purity-guard test fails | Test failure blocks merge |
| CD migration-before-deploy | Merge to `main` triggers CD | `wrangler d1 migrations apply --remote` completes before `wrangler deploy` starts | If migration step fails, deploy step must not run |

</intent-contract>

## Code Map

- `wrangler.jsonc` -- Worker config: `assets.not_found_handling: "single-page-application"`, `DB` binding (D1), `compatibility_date`
- `src/routes/health.ts` -- `GET /api/health` handler returning `{ status: "ok" }` with a Zod response schema, mounted under Hono `/api/*`
- `src/core/` -- pure domain layer, purity-guarded by test; one trivial function for the unit-test smoke check
- `src/services/`, `src/repositories/`, `src/providers/`, `src/schema/` -- empty layer directories with placeholder index files so imports resolve (spine layer map)
- `src/schema/` -- Drizzle schema (0.45.x) with one minimal `meta` table
- `migrations/` -- `drizzle-kit generate` output, applied via `wrangler d1 migrations apply`
- `biome.json`, `tsconfig.json` (strict), `vitest.config.ts` -- toolchain config; Vitest via `@cloudflare/vitest-pool-workers` pointed at `wrangler.configPath`, wired to `readD1Migrations` + `migrations/`
- `package.json` -- canonical `dev`, `build`, `deploy`, `lint`, `typecheck`, `test` scripts, Bun as the runner
- `.github/workflows/ci.yml` -- push/PR: install, lint, typecheck, test, build
- `.github/workflows/deploy.yml` -- push to `main`: build, migrate `--remote`, deploy
- `.gitignore` -- extend with `.env`, `node_modules/`, `.wrangler/` (append; keep existing `.bmad-loop/` entries)
- `export_ps_catalog.py` -- replace hardcoded `SESSION_COOKIE` (line 16) with an env/secret-backed read
- `README.md` -- dev command, scripts, deploy flow, clone-runnable from README alone

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- scaffold via `npm create cloudflare@latest ps-game-catalog -- --framework=react --platform=workers`, then delete `package-lock.json` and switch to Bun (`bun install`) -- establishes the baseline Vite↔Workers glue without hand-assembly
- [x] `wrangler.jsonc` -- set `assets.not_found_handling`, add `DB` binding placeholder, set `compatibility_date` -- SPA fallback + D1 wiring point
- [x] `src/routes/health.ts` + Hono mount under `/api/*` ahead of SPA fallback -- proves the Worker serves API and SPA from one origin
- [x] `src/core/ src/services/ src/repositories/ src/providers/ src/routes/ src/schema/`, `web/`, `migrations/`, `scripts/` -- create real directories matching the spine source tree -- AR-3 layer boundaries
- [x] `src/core/*.test.ts` -- Vitest purity-guard test (no `drizzle-orm`/`repositories`/`providers` import, no global `fetch`) -- enforces AR-3 where Biome can't
- [x] `wrangler d1 create ps-game-catalog` (remote), then wire `database_id`/`database_name` into `wrangler.jsonc` `DB` binding -- done by Luca once Cloudflare credentials were available (`wrangler login` run locally); real `database_id` now in `wrangler.jsonc`.
- [x] `src/schema/*.ts` + Drizzle ORM 0.45.x + pinned `drizzle-kit` + one minimal `meta` table; `drizzle-kit generate` → `migrations/` -- proves the migration pipeline without building real entities (deferred to Story 1.4)
- [x] `biome.json`, `tsconfig.json` (strict), `vitest.config.ts` (`@cloudflare/vitest-pool-workers`, `wrangler.configPath`, `readD1Migrations`) -- toolchain wiring
- [x] Two Vitest smoke tests: integration test hitting `GET /api/health` via the Worker fetch handler (200 + body), unit test of a trivial pure `core/` function
- [x] `package.json` scripts: `dev` (`vite dev`), `build`, `deploy` (`wrangler deploy`), `lint` (`biome check`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`) -- single source of truth CI/local/bmad-loop all call
- [x] `.github/workflows/ci.yml` -- checkout, `oven-sh/setup-bun`, `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build` on push + pull_request -- pushed and confirmed green by Luca.
- [x] `.github/workflows/deploy.yml` -- on push to `main`: build, `wrangler d1 migrations apply ps-game-catalog --remote`, then `wrangler deploy` (strict order, Cloudflare API token from repo secret) -- merged to `main` and confirmed green by Luca; live deploy verified at `https://ps-game-catalog.l-filice-89.workers.dev/api/health` → 200 `{"status":"ok"}` (re-verified independently by the orchestrator too). Hardened in review pass: added a concurrency guard, re-runs lint/typecheck/test before deploy, pinned `bun-version`, and added a post-deploy health-check verification step.
- [x] `.gitignore` -- append `.env`, `node_modules/`, `.wrangler/` (D1/Wrangler local state)
- [x] `export_ps_catalog.py` -- replace hardcoded `SESSION_COOKIE` literal (line 16) with an env/secret-backed read; keep `COOKIE_HELP` instructions
- [x] `README.md` -- document dev command, scripts, deploy flow
- [x] Prove end-to-end: clean-state `bun run dev` → `/api/health` 200 JSON (✅ verified independently); `bun run lint|typecheck|test` green locally (✅ verified independently, incl. `build`); push branch → CI green (✅ confirmed by Luca); merge to `main` → CD applies migration then deploys → deployed `/api/health` 200 (✅ confirmed by Luca, re-verified independently by the orchestrator against the live URL)

**Acceptance Criteria:**
- Given a fresh clone with dependencies installed, when the developer runs the documented dev command (`bun run dev`, which runs `vite dev` inside workerd), then the SPA and Hono Worker run together against local D1 and `GET /api/health` returns HTTP 200.
- Given a push or pull request, when CI runs, then Biome (lint+format), `tsc --noEmit`, and Vitest (`@cloudflare/vitest-pool-workers`) all execute and must pass for the pipeline to go green.
- Given `package.json`, when inspected, then it defines `lint`, `typecheck`, and `test` scripts run via Bun, and CI, local dev, and the bmad-loop `[verify]` gate all invoke these same scripts by name with no inline reimplementation.
- Given a merge to `main`, when CD runs, then `wrangler d1 migrations apply --remote` completes before `wrangler deploy` runs, and the Worker never migrates itself at startup.
- Given the repository source tree, when inspected, then `core/ services/ repositories/ providers/ routes/` (plus `schema/`, `web/`, `migrations/`, `scripts/`) exist per the spine, and a Vitest test proves `core/` contains no I/O import or global `fetch`/D1 usage.
- Given the repo and its secrets, when inspected, then the D1 file, `.env`, and `node_modules/` are gitignored, Cloudflare/IGDB/Twitch secrets are provided via Wrangler secrets, and `export_ps_catalog.py`'s hardcoded `SESSION_COOKIE` is replaced with an env/secret-backed read.

## Spec Change Log

## Review Triage Log

### 2026-07-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11 (high 2, medium 4, low 5)
- defer: 2 (low 2)
- reject: 3 (low 3)
- addressed_findings:
  - `high` `patch` Unmatched `/api/*` paths fell through to the SPA `index.html` (200) instead of a JSON 404, contradicting the Worker's own "always JSON, never index.html" invariant — confirmed empirically by both reviewers, and also crashed 500 in the test environment (no `ASSETS` binding there). First fix attempt (`apiRoutes.notFound()`) was verified to be a no-op — Hono's `.route()` only merges matched routes, it does not delegate an unmatched path to the sub-app's own `notFound` handler. Correct fix: `app.all('/api/*', ...)` catch-all registered in `worker/index.ts` before the `ASSETS` fallback. Added a regression test (`test/integration/health.test.ts`).
  - `high` `patch` CD workflow (`deploy.yml`) had no concurrency guard — two rapid merges to `main` could race `wrangler d1 migrations apply --remote` / `wrangler deploy` against the same production D1 database. Added `concurrency: { group: deploy-production, cancel-in-progress: false }`.
  - `medium` `patch` `core/` purity-guard test (`src/core/purity.test.ts`) was gameable via `globalThis.fetch(...)`, dynamic `import()`/`require()` of `drizzle-orm`/`repositories/`/`providers/`, and `env['DB']`/destructured `{ DB }` access — none of which its regexes caught. Added patterns for all four.
  - `medium` `patch` `deploy.yml` deployed straight from `build` with no re-run of lint/typecheck/test, and both `ci.yml`/`deploy.yml` pinned `bun-version: latest` (undermines the "one deterministic toolchain everywhere" invariant). Added lint/typecheck/test steps before build in `deploy.yml`; pinned `bun-version: '1.3.14'` in both workflows.
  - `medium` `patch` `deploy.yml` had no post-deploy verification — a successful `wrangler deploy` only proves the upload succeeded, not that the Worker serves traffic correctly. Added a step that parses the deployed URL from `wrangler deploy`'s output and curls `/api/health`, failing the job on a non-200.
  - `medium` `patch` `update_ps_catalog.py` imports `fetch_all_games` directly from `export_ps_catalog.py` and never checks `SESSION_COOKIE`, bypassing the missing-cookie guard added to `export_ps_catalog.py`'s own `main()` — an unset cookie there hits the network instead of failing fast with an actionable message. Mirrored the guard in `update_ps_catalog.py`'s `main()`.
  - `low` `patch` `__pycache__/export_ps_catalog.cpython-311.pyc` was tracked in git with no `.gitignore` coverage for Python bytecode. Added `__pycache__/`, `*.pyc`, `.venv/` to `.gitignore` and untracked the committed `.pyc`.
  - `low` `patch` `package.json`'s `preview` script called `npm run build`, violating the "Bun everywhere" invariant. Changed to `bun run build`.
  - `low` `patch` `COOKIE_HELP`/`MISSING_COOKIE_HELP` in `export_ps_catalog.py` duplicated the same 4-step instructions verbatim. Extracted a shared `_COOKIE_INSTRUCTIONS` constant.
  - `low` `patch` Neither GitHub Actions workflow declared a `permissions:` block, defaulting to broad `GITHUB_TOKEN` scope. Added `permissions: contents: read` to both.
  - `low` `patch` `web/App.tsx`'s demo health-check button had an unhandled promise rejection on `fetch('/api/health')` failure. Added a `.catch(() => setHealth('error'))`.
  - `low` `defer` The I/O matrix's "SPA deep link" scenario has no automated test — `vitest-pool-workers` has no working `ASSETS` binding without a real assets directory wired into `wrangler.jsonc`, and wiring one risks disturbing the already-verified production deploy path (the `@cloudflare/vite-plugin` generates its own assets config at build time) for a scenario already confirmed working twice by hand (local dev + live production curl). Logged to `deferred-work.md` for later attention if `web/`'s build wiring is revisited.
  - `low` `defer` GitHub Actions (`actions/checkout@v4`, `oven-sh/setup-bun@v2`) are pinned to floating major-version tags rather than commit SHAs — a supply-chain hardening step worth doing before the repo is public, not urgent for a private solo repo today. Logged to `deferred-work.md`.
  - `low` `reject` "Zod validation on the health route only validates a hardcoded literal, so it can never fail" — this is by design; the story explicitly frames the route as establishing the Zod-at-every-boundary convention for later real handlers, not exercising real validation coverage yet.
  - `low` `reject` "`formatHealthStatus` in `src/core/status.ts` is dead code" — intentional; the spec's own Code Map calls for exactly "one trivial function for the unit-test smoke check," not real domain logic.
  - `low` `reject` "Inconsistent dependency pinning (some exact, some `^`)" — the spec only mandated an exact pin for Drizzle ORM/drizzle-kit; the rest follow the Cloudflare generator's normal convention, which is not a deviation from anything this story required.

## Design Notes

- Spine text says `wrangler.toml`; current Cloudflare tooling defaults to `wrangler.jsonc`. Either satisfies AR-1/AR-2 — prefer the generator's default (`wrangler.jsonc`) over hand-converting.
- `@cloudflare/vitest-pool-workers` API varies by version: newer releases export `cloudflareTest`; older examples use `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config`. Check the installed package's actual exports rather than assuming one form.
- No `wrangler` CLI is preinstalled in the dev environment (only `node`, `bun`, `npm` confirmed) — install it as a project dependency via the generator/`bun add -d wrangler`, don't assume a global install.

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: installs cleanly, no lockfile drift
- `bun run lint` -- expected: Biome check passes
- `bun run typecheck` -- expected: `tsc --noEmit` passes
- `bun run test` -- expected: Vitest passes, including the `core/` purity-guard test and the two smoke tests
- `wrangler d1 migrations apply ps-game-catalog --local` -- expected: applies cleanly against local D1
- `bun run dev` then `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/api/health` -- expected: `200`

**Manual checks (if no CLI):**
- Push the working branch and confirm the GitHub Actions CI workflow run is green.
- Merge to `main` and confirm the CD workflow applies the migration before deploying, and that the deployed Worker's `/api/health` returns 200.

## Auto Run Result

Status: done

**Summary:** Story 1.1 scaffolds a single Cloudflare Worker serving a React SPA + Hono JSON API, wired to D1/Drizzle, with Biome/tsc/Vitest quality gates and CI/CD pipelines. The initial implementation pass halted `blocked` because remote D1 creation and end-to-end CI/CD proof needed Cloudflare credentials and GitHub push access this environment didn't have (both anticipated by this spec's own `Block If` clause). Luca then obtained Cloudflare credentials, ran `wrangler d1 create` himself, pushed the branch, and merged to `main` — CI went green, CD applied the migration and deployed, and the live Worker was confirmed serving `/api/health` at `https://ps-game-catalog.l-filice-89.workers.dev`. That closed AC2 and AC4, the two previously-unsatisfied acceptance criteria. A review pass (Blind Hunter + Edge Case Hunter) then ran against the full diff and found one real functional bug plus several hardening gaps, all fixed in this pass (see Review Triage Log).

**Files changed with one-line descriptions:**
- `worker/index.ts` — composition root; mounts Hono API under `/api/*`, falls back to `env.ASSETS` for the SPA; added a `/api/*` catch-all so unmatched API paths return JSON 404 instead of falling through to the SPA fallback.
- `src/routes/health.ts`, `src/routes/index.ts` — `GET /api/health` handler and route aggregator.
- `src/core/`, `src/services/`, `src/repositories/`, `src/providers/`, `src/schema/` — spine layer directories; `src/core/status.ts` (trivial pure function), `src/core/purity.test.ts` (I/O purity guard, hardened this pass against `globalThis.fetch`, dynamic `import()`/`require()`, and bracket/destructured `env.DB` access).
- `wrangler.jsonc` — Worker config: SPA-fallback assets, D1 `DB` binding (real `database_id` since Luca ran `wrangler d1 create`), `compatibility_date`.
- `drizzle.config.ts`, `migrations/0000_even_kitty_pryde.sql` — Drizzle ORM 0.45.2 + drizzle-kit 0.31.10 (pinned), one `meta` table proving the migration pipeline.
- `biome.json`, `tsconfig*.json`, `vitest.config.ts` — toolchain config (Biome v2, strict TS, `@cloudflare/vitest-pool-workers` 0.18.0).
- `test/integration/health.test.ts` — integration smoke tests; added a regression test for the unmatched-`/api/*`-path 404 fix this pass.
- `package.json` — canonical `dev`/`build`/`deploy`/`lint`/`typecheck`/`test` scripts; fixed `preview` to use Bun instead of `npm` this pass.
- `.github/workflows/ci.yml` — push/PR quality gate; pinned `bun-version`, added `permissions: contents: read` this pass.
- `.github/workflows/deploy.yml` — migrate-then-deploy on merge to `main`; hardened this pass with a concurrency guard, a re-run of lint/typecheck/test before deploy, pinned `bun-version`, `permissions: contents: read`, and a post-deploy `/api/health` verification step.
- `.gitignore` — Node/Bun/Wrangler/D1 ignores from the original pass; added Python (`__pycache__/`, `*.pyc`, `.venv/`) this pass, and untracked the previously-committed `.pyc`.
- `export_ps_catalog.py` — hardcoded `SESSION_COOKIE` replaced with an env read; deduplicated `COOKIE_HELP`/`MISSING_COOKIE_HELP` this pass.
- `update_ps_catalog.py` — this pass added the same missing-cookie guard `export_ps_catalog.py` already had, closing a gap where it silently skipped that check.
- `web/App.tsx` — demo landing page from the generator; added a `.catch` on the health-check button's fetch this pass.
- `README.md` — dev command, scripts, deploy flow.

**Review findings breakdown:** 11 patch (severity: high 2, medium 4, low 5), 2 defer, 3 reject, 0 bad_spec, 0 intent_gap. Full detail in Review Triage Log above and `deferred-work.md`. Headline fix: unmatched `/api/*` paths were falling through to the SPA `index.html` (200) instead of a JSON 404 — the first fix attempt (a `notFound()` handler on the API sub-app) was verified to be a no-op due to how Hono's `.route()` merges sub-app routes, then corrected with an explicit catch-all in the composition root, with a regression test added.

**Verification performed:**
- Independently re-ran after every patch: `bun run lint` (Biome, 28 files, 0 errors), `bun run typecheck` (`tsc -b`, clean), `bun run test` (3 files, 25 tests passed, including the new unmatched-route regression test), `bun run build` (Worker + client bundles built).
- `python -m py_compile` + `ast.parse` on both edited Python scripts — clean.
- Live production verification: `curl https://ps-game-catalog.l-filice-89.workers.dev/api/health` → HTTP 200, `{"status":"ok"}`.
- CI and CD both confirmed green by Luca on the real GitHub Actions runs (this environment cannot observe Actions runs directly).

**Residual risks:**
- The CD hardening added this pass (concurrency guard, pre-deploy quality gate, post-deploy verification, deploy-URL parsing via grep on `wrangler deploy` output) has not yet been exercised by a real push/merge — it's been verified by local reasoning and Hono/shell semantics, not a live Actions run. Recommend watching the next `main` merge closely.
- The SPA-fallback I/O-matrix scenario has no automated regression test (deferred — see `deferred-work.md`); it's manually verified working in both local dev and production, so functionally low risk, but a future change could regress it silently.
- `.bmad-loop/bmad_loop_hook.py`, several `.claude/skills/bmad-loop-*` files, and `_bmad/config.yaml` show an unrelated BMAD Loop module version bump (`0.8.0` → `0.8.1`) that occurred independently of this story; left untouched, out of scope.

Follow-up review recommended: `true` — this pass made a behavior-changing fix to routing semantics (with an initial wrong attempt caught only by actually running the test) and non-trivial edits to the production CD pipeline that haven't yet been exercised by a live run. Worth an independent second look once the next deploy is observed.
