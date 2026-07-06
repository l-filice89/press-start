---
title: 'Deployable project scaffold & CI/CD'
type: 'feature'
created: '2026-07-06'
status: 'blocked'
baseline_revision: '031869a00308ddaafcdfa44d0f867abed6e22e68'
review_loop_iteration: 0
followup_review_recommended: false
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
- [ ] `wrangler d1 create ps-game-catalog` (remote), then wire `database_id`/`database_name` into `wrangler.jsonc` `DB` binding -- **BLOCKED**: no `CLOUDFLARE_API_TOKEN`/account in this environment; `wrangler.jsonc` carries an explicitly-commented placeholder `database_id` instead. Local D1 (miniflare, `--local`) fully works with this placeholder.
- [x] `src/schema/*.ts` + Drizzle ORM 0.45.x + pinned `drizzle-kit` + one minimal `meta` table; `drizzle-kit generate` → `migrations/` -- proves the migration pipeline without building real entities (deferred to Story 1.4)
- [x] `biome.json`, `tsconfig.json` (strict), `vitest.config.ts` (`@cloudflare/vitest-pool-workers`, `wrangler.configPath`, `readD1Migrations`) -- toolchain wiring
- [x] Two Vitest smoke tests: integration test hitting `GET /api/health` via the Worker fetch handler (200 + body), unit test of a trivial pure `core/` function
- [x] `package.json` scripts: `dev` (`vite dev`), `build`, `deploy` (`wrangler deploy`), `lint` (`biome check`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`) -- single source of truth CI/local/bmad-loop all call
- [x] `.github/workflows/ci.yml` -- checkout, `oven-sh/setup-bun`, `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build` on push + pull_request (authored and correct; execution unobserved -- no `gh`/push access in this environment)
- [x] `.github/workflows/deploy.yml` -- on push to `main`: build, `wrangler d1 migrations apply ps-game-catalog --remote`, then `wrangler deploy` (strict order, Cloudflare API token from repo secret) (authored and correct; execution unobserved -- no Cloudflare credentials/push access)
- [x] `.gitignore` -- append `.env`, `node_modules/`, `.wrangler/` (D1/Wrangler local state)
- [x] `export_ps_catalog.py` -- replace hardcoded `SESSION_COOKIE` literal (line 16) with an env/secret-backed read; keep `COOKIE_HELP` instructions
- [x] `README.md` -- document dev command, scripts, deploy flow
- [ ] Prove end-to-end: clean-state `bun run dev` → `/api/health` 200 JSON (✅ verified independently); `bun run lint|typecheck|test` green locally (✅ verified independently, incl. `build`); push branch → CI green (**BLOCKED**: no `gh` CLI/push access); merge to `main` → CD applies migration then deploys → deployed `/api/health` 200 (**BLOCKED**: no Cloudflare credentials, no push access)

**Acceptance Criteria:**
- Given a fresh clone with dependencies installed, when the developer runs the documented dev command (`bun run dev`, which runs `vite dev` inside workerd), then the SPA and Hono Worker run together against local D1 and `GET /api/health` returns HTTP 200.
- Given a push or pull request, when CI runs, then Biome (lint+format), `tsc --noEmit`, and Vitest (`@cloudflare/vitest-pool-workers`) all execute and must pass for the pipeline to go green.
- Given `package.json`, when inspected, then it defines `lint`, `typecheck`, and `test` scripts run via Bun, and CI, local dev, and the bmad-loop `[verify]` gate all invoke these same scripts by name with no inline reimplementation.
- Given a merge to `main`, when CD runs, then `wrangler d1 migrations apply --remote` completes before `wrangler deploy` runs, and the Worker never migrates itself at startup.
- Given the repository source tree, when inspected, then `core/ services/ repositories/ providers/ routes/` (plus `schema/`, `web/`, `migrations/`, `scripts/`) exist per the spine, and a Vitest test proves `core/` contains no I/O import or global `fetch`/D1 usage.
- Given the repo and its secrets, when inspected, then the D1 file, `.env`, and `node_modules/` are gitignored, Cloudflare/IGDB/Twitch secrets are provided via Wrangler secrets, and `export_ps_catalog.py`'s hardcoded `SESSION_COOKIE` is replaced with an env/secret-backed read.

## Spec Change Log

## Review Triage Log

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

Status: blocked
Blocking condition: implementation verification failed — two execution-time items require external access this environment does not have.

**What was implemented (independently re-verified by the orchestrator, not just the implementation subagent):**
- Full scaffold generated via `npm create cloudflare@latest ... --framework=react --platform=workers`, merged into the existing repo (history untouched), Bun as sole package manager (`bun.lock`, no `package-lock.json`).
- `wrangler.jsonc` with SPA-fallback assets config, `DB` D1 binding (placeholder id, see below), `compatibility_date`.
- `worker/index.ts` mounts Hono under `/api/*` ahead of the static/SPA fallback; `src/routes/health.ts` returns Zod-validated `{ status: "ok" }` at `GET /api/health`.
- Full spine layer directories (`src/core|services|repositories|providers|routes|schema`, `web/`, `migrations/`, `scripts/`), with a Vitest purity-guard test (`src/core/purity.test.ts`) scanning for banned imports/`fetch`/D1 usage.
- Drizzle ORM 0.45.2 + drizzle-kit 0.31.10 (pinned), one `meta` table, migration generated and applied against **local** D1 successfully.
- Biome v2, strict `tsconfig`, Vitest + `@cloudflare/vitest-pool-workers` (0.18.0, using that version's actual `cloudflareTest`/`readD1Migrations` API), two smoke tests (integration `/api/health`, unit core function).
- `package.json` scripts (`dev`, `build`, `deploy`, `lint`, `typecheck`, `test`) — exact names the CI workflow and `.bmad-loop/policy.toml`'s `[verify]` gate both already expect.
- `.github/workflows/ci.yml` and `.github/workflows/deploy.yml` authored correctly (migrate-before-deploy order preserved) but never executed.
- `.gitignore` extended (`.env`, `node_modules/`, `.wrangler/`, `*.sqlite*`), existing `.bmad-loop/` entries preserved.
- `export_ps_catalog.py`'s hardcoded `SESSION_COOKIE` replaced with `os.environ.get("PSN_SESSION_COOKIE", "")`; no git-history rewrite (per spec, this was already decided unnecessary).
- `README.md` documents the dev command, scripts, and deploy flow.
- Orchestrator independently re-ran and confirmed green: `bun run lint`, `bun run typecheck`, `bun run test` (3 files / 16 tests), `bun run build`, plus a live `bun run dev` session returning `GET /api/health` → 200 `{"status":"ok"}` and a deep client route → 200 `index.html` (SPA fallback). Dev-server and two stale scaffold-generator processes were cleaned up afterward.

**What could not be completed (both anticipated by this spec's own `Block If` clause):**
1. **Remote D1 database creation** (`wrangler d1 create ps-game-catalog`) — fails because no `CLOUDFLARE_API_TOKEN`/account is configured in this environment. `wrangler.jsonc` carries an explicit placeholder `database_id` with a comment explaining what to do once real credentials exist.
2. **End-to-end CI/CD proof** — no `gh` CLI or GitHub push access in this environment, so the branch was never pushed, CI was never observed running, and no real `wrangler deploy` occurred. AC2 ("CI runs ... on every push and PR") and AC4 ("CD deploys on merge to `main`") describe pipeline *behavior*, not just correct authoring — that behavior is unobserved.

**Failing acceptance criteria:** AC2 (CI green, unobserved) and AC4 (CD migrate-then-deploy on merge, unobserved). AC1, AC3, AC5, AC6 are satisfied and independently verified.

**Unrelated drift noticed, not touched:** `git status` also shows modifications to `.bmad-loop/bmad_loop_hook.py`, several `.claude/skills/bmad-loop-*` files, and `_bmad/config.yaml` — a BMAD Loop module version bump (`0.8.0` → `0.8.1`) that occurred independently of this story. Left as-is; not in scope.

**Recommended next step:** once Luca has Cloudflare credentials (`wrangler login` or `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`) and can push to the GitHub remote (with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` added as repo secrets for the `deploy.yml` workflow): run `wrangler d1 create ps-game-catalog` and paste the real `database_id` into `wrangler.jsonc`, then push the branch to observe CI, and merge to `main` to observe CD apply the migration and deploy. At that point re-run this workflow (or manually flip status) to close out AC2/AC4.
