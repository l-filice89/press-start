# PRESS START — PS Game Catalog

A single-user installable PWA that replaces a Notion game-tracking database: a
React SPA + a Hono JSON API, both served by **one Cloudflare Worker**, backed
by **Cloudflare D1** (via Drizzle ORM).

**v1.0.0** — the full library tracker: magic-link auth (single allowed user),
the shelf with covers and status/ownership tracking, milestones, genres,
lifecycle dates, add-by-name (IGDB), straggler resolution, CSV export,
free-text search, and monthly PlayStation Plus Extra catalog awareness. Shipped
across Epics 1–6.

## Prerequisites

- [Bun](https://bun.sh) (package manager and script runner everywhere — local
  dev, tests, CI. Production itself runs on Cloudflare's `workerd` runtime,
  not Bun.)
- A Cloudflare account (only needed for the *remote* deploy — local dev works
  without one).

## Quick start (fresh clone)

```sh
bun install
bun run dev
```

This starts the Vite dev server with the
[`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/),
which runs the Worker *inside* workerd (with HMR) against a **local** D1
database (miniflare) — no Cloudflare account or credentials required.

Once running:

- `http://localhost:5173/` — the React SPA
- `http://localhost:5173/api/health` — `{ "status": "ok" }` (HTTP 200)

Local D1 schema is created/updated with:

```sh
npx wrangler d1 migrations apply ps-game-catalog --local
```

## Scripts

All scripts are run the same way locally, in CI, and by the bmad-loop
`[verify]` gate (`.bmad-loop/policy.toml`) — one set of commands, no drift.

| Script | Command | What it does |
| --- | --- | --- |
| `bun run dev` | `vite dev` | SPA + Worker + local D1, with HMR |
| `bun run build` | `tsc -b && vite build` | Typechecks, then builds the SPA + Worker for deploy |
| `bun run deploy` | `wrangler deploy` | Deploys the built Worker (+ SPA assets) to Cloudflare — run **after** migrations, never before |
| `bun run lint` | `biome check .` | Biome v2 lint + format check |
| `bun run typecheck` | `tsc -b` | Project-references type check, no emit |
| `bun run test` | `vitest run` | Vitest: a `core/`-only unit project (plain Node) + a `workers` project running real integration tests inside workerd via `@cloudflare/vitest-pool-workers` |
| `bun run db:generate` | `drizzle-kit generate` | Generates a new SQL migration from `src/schema/` into `migrations/` |

## Project structure

```text
src/
  core/          # pure domain logic — no I/O, no drizzle-orm, no fetch (AD-3)
  services/      # ingest + write jobs (seed, PS sync, PS+ check, add-by-name, stragglers)
  repositories/  # D1 access via Drizzle — the only persistence seam (AD-4)
  providers/     # PSN/IGDB adapters — the only external-I/O seam (AD-5)
  routes/        # Hono handlers + Zod schemas, mounted under /api/*
  schema/        # Drizzle schema (shared by app + drizzle-kit)
web/             # React SPA (Vite)
worker/          # Worker entry point (composition root) — mounts routes/, falls back to static assets
migrations/      # drizzle-kit SQL migrations, applied via `wrangler d1 migrations apply`
scripts/         # out-of-band scripts (seed import, bmad-loop helpers)
test/            # Vitest integration tests (run inside workerd)
wrangler.jsonc   # Worker config: D1 binding, static assets, compatibility flags
```

`core/` is enforced I/O-free by a Vitest test (`src/core/purity.test.ts`) plus
a Biome `noRestrictedImports` rule — see `biome.json`.

## Cloudflare setup

The live deploy targets a real D1 database (its `database_id` is committed in
`wrangler.jsonc`). Local dev and local D1 migrations work against a separate
miniflare copy — no Cloudflare account needed for local work. To stand up a
fresh remote environment:

1. `wrangler login` (or set `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`).
2. `npx wrangler d1 create ps-game-catalog` and put the `database_id` into
   `wrangler.jsonc`'s `d1_databases[0].database_id`.
3. Add these repo secrets under **Settings > Secrets and variables >
   Actions** — the CD workflow authenticates with the first two and syncs the
   last two into the Worker on every deploy:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `BETTER_AUTH_SECRET` (required — every `/api/auth/*` route 500s without it)
   - `RESEND_API_KEY` (magic-link email; without it the link is logged instead)
4. Optional: configure the `production` GitHub Environment (Settings >
   Environments) with required reviewers so the deploy job in
   `.github/workflows/deploy.yml` pauses for approval before a destructive
   migration/deploy runs.
5. Worker runtime secrets **not** synced by CD (`IGDB_CLIENT_ID` and
   `IGDB_CLIENT_SECRET`) are set with `wrangler secret put <NAME>` — never
   hardcoded, never committed. (The PSN credential secret was retired by
   Epic 11: all remaining PlayStation traffic is anonymous.)

## CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every push and pull request:
  a quality gate (lint → typecheck → test → build) plus Playwright e2e and,
  on PRs, an e2e burn-in that reruns changed specs 5×. All feed one `ci-ok`
  merge gate.
- **CD** (`.github/workflows/deploy.yml`) runs when a **GitHub Release is
  published** (and on manual `workflow_dispatch`) — merging a PR to `main` is
  not itself a release. The release's tag is the deployed ref, so work merged
  after it ships with the next release. The job re-runs the
  gate → `wrangler d1 migrations apply ps-game-catalog --remote` →
  `wrangler deploy` → syncs the auth/email secrets → smoke-tests `/api/health`
  and `/api/auth/get-session`, strictly in that order. If the migration step
  fails, deploy never runs (AD-16 — the Worker never migrates itself at
  startup). The job targets the `production` GitHub Environment so an optional
  manual-approval gate can be layered on top.

## One-time seed import (Story 1.6)

`bun run seed` (`scripts/seed-import.ts`) is a **one-time, out-of-band** job
that loads the real library into D1: it reads the two committed exports
(`ps_catalog.csv` + `Gaming list …_all.csv`), enriches every game from IGDB
(cover, genres, release date), and writes games / tracking / genres / links /
stragglers through the shared Drizzle schema + repositories. It has **no UI or
Worker surface** and is not run in CI (it needs live IGDB + remote-D1
credentials). The reconciliation, status mapping, and reconciliation-vs-
straggler decisions are pure `core/` functions with full unit + integration
coverage; this script is only the I/O wiring.

Run it after you have signed in once (so your `user` row exists):

```sh
cp .env.example .env      # fill in IGDB + Cloudflare D1 HTTP creds + SEED_USER_EMAIL
bun run seed
```

It prints a summary (games created, tracking rows, genre links, name-only
`unenriched` games, stragglers, and PS+ claims skipped). Key rules it enforces:
membership-sourced PS+ claims are excluded (never owned), PS4/PS5 collapse to
one PS5 game, Notion status maps onto the app's state model, genres come
**only** from IGDB, and anything unresolvable becomes a straggler — never a
guessed row. Re-running is idempotent (games resolve by external link).

## Legacy scripts

`export_ps_catalog.py` and `update_ps_catalog.py` are frozen Python bootstrap
scripts (seed data only, no new features land there). `export_ps_catalog.py`
reads the PlayStation session cookie from the `PSN_SESSION_COOKIE`
environment variable — see the script's own `COOKIE_HELP` for how to obtain
it; it is never hardcoded in source.
