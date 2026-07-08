# Story 1.1: Deployable project scaffold & CI/CD

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Luca (developer/owner),
I want a Cloudflare Worker serving a React SPA and JSON API, wired to D1 with the full toolchain and an automated deploy pipeline,
so that every later story ships on a proven, one-command path to production.

## Acceptance Criteria

1. **Local dev runs the whole app.** From a fresh clone, the documented dev command (`vite dev` — the `@cloudflare/vite-plugin` runs the dev server *inside* workerd, so it supersedes `wrangler dev` for the dev loop) runs the Vite React SPA and the Hono Worker **together** locally against a **local D1** (miniflare), and a `GET /api/health` route returns HTTP 200. (AR-1, AR-2)
2. **CI runs the quality gate on every push and PR.** Biome (lint+format check), `tsc --noEmit`, and Vitest via `@cloudflare/vitest-pool-workers` all execute and must pass for the pipeline to be green. (AR-23, AR-26)
3. **`package.json` exposes the canonical scripts.** It defines `lint` (Biome), `typecheck` (`tsc --noEmit`), and `test` (Vitest workers pool). **CI, the local dev flow, and the bmad-loop `[verify]` gate all invoke these same `package.json` scripts by name** — no gate re-implements the command inline — so local / CI / loop checks can never drift. **Bun is the package manager and script runner in all three contexts** — local dev, the bmad-loop `[verify]` gate (`.bmad-loop/policy.toml:25`), and CI — so there is one lockfile and reproducible installs everywhere (`bun install --frozen-lockfile`, `bun run lint|typecheck|test`). Only the *deployed* runtime is workerd (Bun never runs in production). (AR-23, AR-26, AD-2)
4. **CD deploys on merge to `main`, migrations first.** `wrangler d1 migrations apply` runs **before** `wrangler deploy`, and the Worker never migrates itself at startup. (AR-16, AR-21)
5. **Source tree matches the architecture layer map.** The namespaces `core/ services/ repositories/ providers/ routes/` (plus `schema/`, `web/`, `migrations/`, `scripts/`) exist per the spine scaffold, and **`core/` contains no import that performs I/O** (no `fetch`, no D1/Drizzle). (AR-3)
6. **Secrets and the D1 file are never committed.** Secrets (IGDB/Twitch, initial PSN cookie) are provided via Wrangler secrets; the D1 file, `.env`, and `node_modules/` are gitignored. The hardcoded PSN value in `export_ps_catalog.py` is replaced with an env/secret read for hygiene (it is a short-lived, self-expiring session cookie, not a durable secret — low urgency). (AR-24)

> This is a walking-skeleton scaffold, not a feature. "Done" = a green CI run + a successful deploy of a Worker that serves the SPA and answers `/api/health` with 200. No shelf, no auth, no real schema beyond what a migration + `/api/health` smoke test needs.

## Tasks / Subtasks

- [ ] **Task 1 — Scaffold the single-Worker app (SPA + API)** (AC: #1, #5)
  - [ ] Generate the project with the official Cloudflare React+Workers generator as the baseline, then reshape to the spine's source tree: `npm create cloudflare@latest ps-game-catalog -- --framework=react --platform=workers` (this wires the `@cloudflare/vite-plugin`, `wrangler`, and a version-matched TS config for you — do **not** hand-assemble the Vite↔Workers glue). The `npm create` bootstrap is a one-time scaffold; **thereafter Bun is the package manager/runner everywhere** (`bun install`, `bun run …`) per AD-2 and the bmad-loop gate. Delete the generator's `package-lock.json` and commit only Bun's lockfile — one lockfile, no mixed-manager drift.
  - [ ] Confirm the app is **one Worker serving both** the React SPA (Workers Static Assets) and the JSON API — a single deploy, single origin. In `wrangler.jsonc` set `"assets": { "not_found_handling": "single-page-application" }` (nested under `assets`; the bare-key `not_found_handling = …` form is `wrangler.toml`-only) so deep client routes serve `index.html`.
  - [ ] Introduce Hono as the API router mounted under `/api/*` inside the Worker entry. Add `routes/health.ts` returning `{ status: "ok" }` with HTTP 200 at `GET /api/health`; wire a Zod response schema (establishes the AR-26 "Zod at every boundary" pattern even for this trivial route). **Ensure `/api/*` is handled by the Worker ahead of static-asset/SPA-fallback routing** (the Worker entry runs the API; the SPA fallback only serves genuine not-founds) — verify `/api/health` returns JSON 200, not `index.html`.
  - [ ] Create the layer namespaces as real directories with an index/placeholder so imports resolve: `src/core/ src/services/ src/repositories/ src/providers/ src/routes/ src/schema/`, plus top-level `web/` (SPA), `migrations/`, `scripts/`. Match the spine "Source tree" block, not a mirror of the generator's default.
  - [ ] Add a lightweight **`core/` purity guard** as a **Vitest test** asserting nothing under `core/` reaches I/O — no `import` from `drizzle-orm`/`repositories/`/`providers/` **and** no use of the `fetch`/D1-binding globals. Note: Biome `noRestrictedImports` can catch the *import* violations but **cannot** see global `fetch` usage (it is not an import), so a test (scan source or assert via a lint-rule + test combo) is the reliable mechanism. Core is a dependency sink (AR-3).
- [ ] **Task 2 — Wire D1 and the first migration** (AC: #1, #4)
  - [ ] **Create the remote D1 database first:** `wrangler d1 create ps-game-catalog`, then put its `database_id` + `database_name` in the Wrangler config under a `DB` binding. Without this, the CD `migrations apply --remote` step (Task 5) fails on its first run. The same `DB` binding name serves local (miniflare) and remote.
  - [ ] Add Drizzle ORM **0.45.x** + a compatible **`drizzle-kit`** (pin the version drizzle documents for 0.45.x — do not float it) and a `schema/` entry with one minimal table sufficient to prove the migration pipeline (e.g. a trivial `meta` table — the real entities land in Story 1.4, do **not** build them here). Set a `compatibility_date` in the Wrangler config (and expect `nodejs_compat` to be added in Story 1.3 for better-auth — leave the field present).
  - [ ] Generate the first migration with `drizzle-kit generate` into `migrations/`. Verify `wrangler d1 migrations apply ps-game-catalog --local` works against local D1 and the dev server (`vite dev`) serves against it.
  - [ ] Do **not** run migrations at Worker startup — the Worker never migrates itself (AR-16/AR-21). Migration application is a CI/CD and local-CLI step only.
- [ ] **Task 3 — Toolchain: Biome, tsc, Vitest** (AC: #2, #3)
  - [ ] Add **Biome v2** for lint+format; add a `biome.json`. Add `tsconfig.json` with `strict` on.
  - [ ] Add `@cloudflare/vitest-pool-workers` + Vitest. Write `vitest.config.ts` with the current API: `cloudflareTest` imported from `@cloudflare/vitest-pool-workers`, pointed at the Wrangler config (`wrangler.configPath`) so tests run in workerd with the `DB` binding. (Older examples use `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config`; match whatever version the generator installs — check the installed package's exports.) Wire `readD1Migrations` (from `@cloudflare/vitest-pool-workers/config`) + the `migrations/` dir so the test D1 is schema-current.
  - [ ] Write two smoke tests: (a) an **integration** test hitting `GET /api/health` via the Worker fetch handler asserting 200 + body; (b) a **unit** test of a trivial pure `core/` function (proves the no-runtime core test path, AR-3).
  - [ ] Define `package.json` scripts as the **single source of truth**: `dev` (`vite dev`), `build`, `deploy` (`wrangler deploy`), `lint` (`biome check` — same invocation in local/loop/CI), `typecheck` (`tsc --noEmit`), `test` (`vitest run`). Optionally add `verify` chaining the three gates for one call. **Every gate calls these scripts by name — never inline the raw command.**
- [ ] **Task 4 — CI pipeline (push + PR)** (AC: #2, #3)
  - [ ] Add `.github/workflows/ci.yml` triggering on `push` and `pull_request`. Steps: checkout → `oven-sh/setup-bun` → `bun install --frozen-lockfile` → `bun run lint` → `bun run typecheck` → `bun run test` → **`bun run build`** (a broken Vite/Worker build must fail CI, not surface only at deploy). All must pass.
  - [ ] The bmad-loop `[verify]` gate (`.bmad-loop/policy.toml:25`) already runs `bun run lint|typecheck|test` — the **same runner and script names** as CI. Do not change the gate; just ensure those `package.json` scripts exist. Local, loop, and CI are now identical (Bun + same script names) — zero drift.
- [ ] **Task 5 — CD pipeline (merge to `main`)** (AC: #4)
  - [ ] Add `.github/workflows/deploy.yml` triggering on push to `main`. Steps: build → `wrangler d1 migrations apply ps-game-catalog --remote` → `wrangler deploy`, **in that order** (migrations strictly before deploy, AR-16). Requires the remote D1 DB created in Task 2.
  - [ ] Add an **optional manual-approval gate** guarding the deploy step (GitHub Environment protection) so destructive migrations can be paused — this is the one real DB footgun (spine Delivery & ops).
  - [ ] Store the Cloudflare API token as a GitHub Actions secret; never in the repo. Trunk-based: `main` is the trunk, no release branches/tags in v1.
- [ ] **Task 6 — Secrets & gitignore hygiene** (AC: #6)
  - [ ] Extend `.gitignore` with the D1 local file (`.wrangler/` and any `*.sqlite`/`d1` local state), `.env`, and `node_modules/`. (Current `.gitignore` only has `.bmad-loop/` entries — do not remove those.)
  - [ ] Document that IGDB/Twitch creds + the initial PSN cookie are provided via **Wrangler secrets** (`wrangler secret put …`), and that the live `pdccws_p` cookie will live in a D1 `SETTING` row later (Epic 4) — no secret is hardcoded in source.
  - [ ] **Hygiene (low urgency):** replace the hardcoded `SESSION_COOKIE` value at `export_ps_catalog.py:16` with an env/secret read (or empty placeholder + `COOKIE_HELP`), so no long-lived value is ever committed there. The current value is a **short-lived, self-expiring** PS session cookie (PS rotates it regularly) — not a durable secret, so **no cookie rotation or git-history rewrite is warranted**. Legacy Python is frozen otherwise (project-context) — this is the one allowed touch.
- [ ] **Task 7 — Prove the path end-to-end** (AC: all)
  - [ ] From a clean state, run the documented dev command and hit `/api/health` → 200 (verify it returns JSON, not the SPA `index.html`). Run the three gate scripts (`bun run lint|typecheck|test`) green locally. Push a branch, open a PR, confirm CI is green. Merge to `main`, confirm CD applies the migration then deploys, and the deployed `/api/health` returns 200.
  - [ ] Write/refresh the root `README.md` documenting the one dev command, the scripts, and the deploy flow (a fresh clone must be runnable from the README alone — AC #1 says "documented dev command").

## Dev Notes

### What this story is (and is not)
- **Is:** the walking skeleton + the deploy rails every later story rides on. One Worker, one deploy, one set of quality scripts.
- **Is not:** schema (1.4), domain core logic (1.2), auth (1.3), design system (1.5), or any shelf/UI. Only build enough of each layer to prove the pipeline.

### Architecture guardrails (from `ARCHITECTURE-SPINE.md`)
- **One Worker is the composition root** — it serves the SPA (Workers Static Assets) *and* the Hono JSON API. No second hosting vendor, no separate frontend host. (AD-1)
- **Deployed runtime is workerd/V8, TypeScript.** Bun is **local-only** (package manager / test runner / out-of-band scripts) — never assume Bun runtime APIs (`bun:sqlite`, Bun globals) in deployed *code*. **Bun IS the package manager and script runner** (`bun install`, `bun run …`) in local dev, the bmad-loop `[verify]` gate (`.bmad-loop/policy.toml:25`), **and** CI — one lockfile, reproducible installs everywhere. Do not use npm for install/run (a Bun lockfile + `npm ci` can't install reproducibly). Bootstrapping via `npm create cloudflare` is the one-time exception; delete any `package-lock.json` it leaves and commit only Bun's lockfile. (AD-2)
- **Layered + ports-and-adapters, two seams** (persistence = `repositories/`, external = `providers/`). Dependency direction: `routes → services → core`; `services → repositories`; `services → providers`; `repositories → core`; `routes → repositories`. **`core/` is a sink** — it imports nothing that does I/O. Enforce this now with the purity guard (Task 1) so it can't rot. (AD-3, AD-4, AD-5)
- **Nothing external on render** (AD-6): not exercised yet (no provider calls in 1.1), but the layout must make it structurally natural later — read/query paths touch repositories only; providers are touched only by ingest jobs in `services/`.
- **Migrations from CI, never at deploy-in-Worker** (AD-16): `drizzle-kit generate` → `wrangler d1 migrations apply` (CI/CD or local CLI) → `wrangler deploy`. The Worker must not call migrate on startup.

### Source tree to create (spine scaffold — target shape)
```text
ps-game-catalog/
  src/
    core/          # pure domain (AD-3): effective/derived state, normalize, reconcile  [placeholder in 1.1]
    services/      # ingest jobs: seed, sync, ps-plus-check, add-by-name               [placeholder]
    repositories/  # Drizzle/D1 access (AD-4)                                           [placeholder]
    providers/     # psn/, igdb/ adapters (AD-5)                                        [placeholder]
    routes/        # Hono handlers + Zod (API)  ← health.ts lives here
    schema/        # Drizzle schema + zod contracts (shared)  ← minimal table for 1.1
  web/             # React SPA (Vite) — shelf/detail/filters/search land later
  migrations/      # drizzle-kit SQL (applied in CI, AD-16)
  scripts/         # out-of-band seed (AD-15, Story 1.6); legacy Python (frozen)
  wrangler.jsonc   # Worker + D1 binding + (cron added in Epic 5)
```
**Variance to note:** the spine writes `wrangler.toml`; current Cloudflare tooling and the `@cloudflare/vite-plugin` default to `wrangler.jsonc`. Either is acceptable — prefer whatever the generator produces (likely `.jsonc`) and keep it consistent. This is a naming variance, not an architecture change.

### Stack pins (do not deviate without cause) — spine Stack table + AR-26
| Concern | Pin |
| --- | --- |
| Runtime / lang | Cloudflare Workers (workerd), TypeScript, `strict` |
| SPA + build + PWA | React + Vite + `vite-plugin-pwa` (PWA config lands in Story 1.5; just leave room) |
| Worker↔SPA glue | `@cloudflare/vite-plugin` (official) |
| API router | Hono (+ typed RPC client) |
| Validation | Zod (shared SPA↔Worker at every boundary) |
| DB / ORM / migrations | Cloudflare D1 + Drizzle ORM **0.45.x** + `drizzle-kit` |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` |
| Lint + format | **Biome v2** |
| Client server-state | TanStack Query (not needed in 1.1; do not add yet) |
| Auth | better-auth magic link (Story 1.3 — not here) |

### Testing standards
- Worker + D1 tests run through `@cloudflare/vitest-pool-workers` (real workerd + miniflare D1), not mocked `fetch`.
- Pure `core/` functions are unit-tested with **no** network/DB (AR-3) — this is the fast path and the reason core is I/O-free.
- 1.1 ships two smoke tests (health integration + trivial core unit) — enough to prove both test paths run in CI. Real coverage arrives with each feature story.
- Use `readD1Migrations()` + the migrations dir so the test D1 is schema-current.

### Latest tech notes (verified 2026-07-06)
- The current, officially-recommended way to run "one Worker serves a React SPA + an API" is the **`@cloudflare/vite-plugin`** — it runs Vite's dev server *inside* workerd (HMR + Workers features together) and deploys SPA assets + Worker in a **single** `wrangler deploy`. You do **not** hand-wire `assets.directory`. Scaffold via `npm create cloudflare@latest … --framework=react --platform=workers`. ([Cloudflare Vite plugin tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/), [React + Vite guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/))
- `@cloudflare/vitest-pool-workers` config: the current docs use **`cloudflareTest` imported from `@cloudflare/vitest-pool-workers`** (older examples use `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config`). Match whatever the installed package version exports — check its `exports` rather than pinning from memory. Wire `wrangler.configPath` and `readD1Migrations` (from `@cloudflare/vitest-pool-workers/config`). ([Vitest integration config](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/))
- SPA fallback: in `wrangler.jsonc` set `"assets": { "not_found_handling": "single-page-application" }` so deep client routes serve `index.html` (the bare `not_found_handling = …` key is the `wrangler.toml` form). ([Static Assets](https://developers.cloudflare.com/workers/static-assets/))

### Security / hygiene (from `project-context.md` + repo scan)
- A `pdccws_p` value is hardcoded at `export_ps_catalog.py:16`. It is a **short-lived, self-expiring** PS session cookie (PS rotates it regularly) — **not a durable secret**. Task 6 replaces it with an env/secret read as forward hygiene so no long-lived value ever lands there; no cookie rotation or git-history rewrite is warranted (confirmed with Luca).
- Never commit: the D1 file, `.env`, `node_modules/`, or any durable secret (IGDB/Twitch creds, API tokens → Wrangler/GitHub secrets). Legacy Python scripts are **frozen** — no new features there; all new code is TS.

### Project Structure Notes
- Greenfield: **no `package.json`/`wrangler`/`tsconfig` exists yet** — this story creates them. Existing tracked files are the two Python bootstrap scripts, the two CSVs, `.bmad-loop/`, and BMAD artifacts; leave them in place (CSVs are seed inputs for Story 1.6).
- Keep the generator's default folder names only where they match the spine; otherwise reshape to the spine source tree above. The `web/` SPA and `src/` Worker layers are distinct — don't collapse them.
- `.gitignore` currently contains only `.bmad-loop/runs/` and `.bmad-loop/cache/` — **append** to it, don't replace.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1: Deployable project scaffold & CI/CD] — ACs, user story.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md#AD-1..AD-6, AD-16] — platform, layering, migration-from-CI rules.
- [Source: ARCHITECTURE-SPINE.md#Stack] and [#Delivery & operations] — version pins, CI/CD order, trunk-based, manual gate, backup/DR.
- [Source: ARCHITECTURE-SPINE.md#Source tree] — the scaffold shape.
- [Source: _bmad-output/project-context.md#Technology Stack & Development Workflow Rules] — Bun-is-dev-only, scrub cookie, gitignore D1/.env, frozen Python.
- [Source: Epics AR-1, AR-2, AR-3, AR-16, AR-21, AR-23, AR-24, AR-26] — the additional-requirement IDs cited in the ACs.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
