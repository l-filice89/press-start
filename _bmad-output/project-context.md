---
project_name: 'ps-game-catalog'
user_name: 'Luca'
date: '2026-07-24'
sections_completed:
  ['technology_stack', 'architecture_seams', 'data_contracts', 'providers', 'testing', 'workflow', 'critical_rules']
status: 'complete'
rule_count: 26
optimized_for_llm: true
---

# Project Context for AI Agents

_Critical rules and unobvious patterns for implementing code in this project. Binding
architecture lives in `_bmad-output/planning-artifacts/architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md`
(AD-1…AD-33) — this file glosses only the load-bearing ones; read the spine for the rest.
The two `.bmad-loop/runs/**` spine copies are stale worktree snapshots — ignore them._

## Technology Stack & Versions

| Layer | Tech (version) |
|-------|----------------|
| Runtime | Cloudflare Worker (workerd, `wrangler` 4.107.0 **exact-pinned** — loose installs skew workerd↔miniflare and crash `bun dev`) |
| API | Hono 4.12.28, Zod 4.4.3, better-auth 1.6.23 (magic link + Google OAuth) |
| DB | D1 + Drizzle 0.45.2 (`drizzle-kit` 0.31.10), migrations in `migrations/` |
| SPA | React 19, Vite 8, react-router **v8** (import from `react-router` / `react-router/dom` — `react-router-dom` is gone), TanStack Query 5, PWA |
| Toolchain | Bun 1.3.14 (dev/CI only — never the deployed runtime, AD-2; no `bun:sqlite`/Bun globals in `src/`/`worker/`) |
| Test | Vitest 4.1.10 (3 projects: node unit / workers-pool integration / jsdom web) + Playwright ^1.61 |
| Lint/format | Biome 2.5.2 — tabs, single quotes; TS ~6.0.2 strict (`verbatimModuleSyntax`, `erasableSyntaxOnly`) |

## Architecture Seams (enforced, not aspirational)

- `src/core/` = pure domain, **I/O-free** (AD-3). Three guard tests enforce the seams — if your change trips one, the change is wrong, not the test:
  - `src/core/purity.test.ts` — bans `fetch`/D1/dynamic drizzle imports in core source; Biome `noRestrictedImports` bans the static imports.
  - `src/orphan-tests.test.ts` — every `*.test.*` file must match a vitest include glob.
  - `src/no-credential-code.test.ts` — no deleted PSN-credential identifier may reappear (npsso, fetchPurchasedGames, `ca.account.sony.com`, …).
- Layer flow: `routes` (Hono+Zod) → `services` (orchestration; **only** layer touching providers) → `repositories` (all Drizzle/D1, AD-4) → `schema`. External I/O only via `src/providers/` (AD-5). Nothing external on a render path (AD-6) — reads are repository-only.
- `worker/index.ts` is the composition root; cron routed by `controller.cron` (`0 3 * * *` = IGDB scores; the `15-28` twice-daily = PS+ rotation: one slot per fire — genre-sweep chunk, else leaving-sweep chunk, else membership pass, AD-31).
- Every tracking query filters by `user_id` (AD-13 — most-cited AD in the codebase). `game` = shared catalog facts; `game_tracking` (PK `user_id, game_id`) = per-user state (AD-19).

## Data Contracts

- Identity is `external_link (source, external_id)` unique — namespaces `PSN` (np_title_id `CUSA…`/`PPSA…`), `PSN_PRODUCT` (store product id), `IGDB`. **Never mix the two PSN namespaces** — that mints duplicates. Many links per (game, source) allowed (AD-20).
- `title_normalized` is the AD-9 join key: ONE normalizer (`src/core/title-normalizer.ts`), **non-unique** (AD-18). It strips ™®©, apostrophe/diacritic variants, edition suffixes, PS4/PS5 tags AND bare trailing "PS4 & PS5" runs, trailing Roman numerals II–IX, one leading article. Never join on raw titles; never fork a second normalizer.
- Milestone dates (`completed_on`, `platinum_on`) are write-once via automatic flows (AD-11); `play_status` nullable once a milestone exists, but never both absent (AD-12 — API refuses).
- `owned_via = purchase | membership` is the ownership *source*; `ownership_type = physical | digital` is the *format*. Claims never stamp `bought_on`.
- `ps_plus_catalog` is a region-keyed store **snapshot** (AD-24), never a `game`; membership derives per-user at read time (AD-30); departures live in the `ps_plus_departure` ledger keyed (region, product_id) — survives prunes. The browse view collapses PS4/PS5 SKU pairs (`collapseEditions`); the snapshot keeps both rows.
- Two genre vocabularies, never merged (AD-26): IGDB → `genre`/`game_genre`; PS store facet keys → `ps_plus_catalog_genre`.

## Provider Rules

- **PSN is anonymous-only** (Epic 11): `src/providers/psn.ts` calls the public store (persisted GraphQL, pinned hashes, region via `x-psn-store-locale-override`). No credential of any kind — the auth path is deleted and the guard test bans its identifiers. Do not re-add one.
- Degenerate responses fail closed: HTTP 200 + null grid/GraphQL errors throws `PsnStoreRejectionError`; empty catalog never prunes (AD-27); build hazard fixtures from CAPTURED payloads (`test/fixtures/psn/`), never hand-written.
- IGDB (Twitch OAuth2): filter on `game_type`, **not** `category` (retired field — string tests pass, live calls silently return zero). Degrades to name-only adds when creds absent; tests force that mode.
- Free-tier budgets are enumerated arithmetic (AD-32): 50 subrequests/invocation counts D1 binding calls too — batch writes, never per-row loops on data-scaled paths.

## Testing Rules

| Tier | Where | Runtime |
|------|-------|---------|
| Unit | co-located `src/**/*.test.ts`, `web/**/*.test.tsx` (jsdom + testing-library) | node / jsdom |
| Integration | `test/integration/` | real workerd + D1 (workers pool; migrations applied in setup, never at Worker startup — AD-16) |
| E2E | `playwright/e2e/` | isolated `env.e2e` D1; auth via magic link captured from server stdout; pre-authed storageState |

- `playwright/COVERAGE.md` is a per-AC ledger: every epic AC has a pinning spec row or a `skipped` row with a real reason. Keep it current in the same change.
- Hazard-named ACs need a test asserting exactly that hazard; guards need their **bypass** path tested, not just the refusal (standing rules — `_bmad/custom/standing-rules-core.md`).

## Development Workflow

- `main` is protected, PR-only; single required check `CI OK` (lint → typecheck → vitest → build, e2e, burn-in). Conventional commits.
- **Deploy = publish a GitHub Release** (checks out the tag): migrations apply → `wrangler deploy` → health smoke. Merging alone ships nothing.
- No manual PS+ refresh exists (button + routes deleted, AD-31): snapshot writes come only from the cron rotation and the >35-day stale guard. Sweeps completing set `cycle_complete` — the region then skips until the next window (opens the 15th).
- Never `rm -rf .wrangler/state` (that IS the local D1). Seed only with `bun dev` stopped (single-writer SQLite).

## Critical Don't-Miss Rules

- Never join the two datasets on raw title strings — always `normalizeTitle`.
- Never let any ingest overwrite user-entered tracking state (AD-10: append-only; sync may create games and flip `owned` false→true, nothing else).
- Never store derived state (Released/Wishlisted/Playable-now — AD-8); compute in `core/`.
- Never navigate outside react-router / use `window` CustomEvents for cross-tree state (AD-25).
- Never commit the D1 file or secrets; secrets ride Wrangler/CI, `.dev.vars` locally.
- Failures surface to the user (stragglers, banners) — no silent retries (AD-14).

---

## Usage Guidelines

**For AI Agents:** read before implementing; follow rules exactly; when in doubt, prefer the more restrictive option; the spine is authoritative where this file abbreviates.

**For Humans:** keep lean; update when the stack or an AD changes; drop rules that become obvious.

Last Updated: 2026-07-24
