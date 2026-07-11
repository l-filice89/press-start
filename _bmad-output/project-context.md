---
project_name: 'ps-game-catalog'
user_name: 'Luca'
date: '2026-07-04'
sections_completed:
  [
    'technology_stack',
    'data_contracts',
    'playstation_api',
    'cover_art',
    'legacy_python',
    'development_workflow',
    'critical_rules',
  ]
existing_patterns_found: 6
status: 'complete'
rule_count: 27
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- **Target app (architecture decided 2026-07-05 — see `ARCHITECTURE-SPINE.md`):** **Cloudflare** single-vendor stack — one Worker (workerd/V8, TypeScript) serves a **React SPA** (Vite, Workers Static Assets) + a Hono JSON API; **Cloudflare D1** (SQLite) via binding; **Cron Triggers** for scheduled work. **Bun is demoted to a local dev toolchain only** (package manager, test runner, out-of-band scripts) — it is NOT the deployed runtime (AD-2). Runtime code must not use Bun-only APIs (`bun:sqlite`, Bun globals). SSR resolved: SPA, not SSR.
- **Python 3.11 scripts are legacy/bootstrap-only** (`export_ps_catalog.py`, `update_ps_catalog.py`) — used to seed the database, then frozen. New functionality goes in Bun TS, never in Python.
- **Test/lint/format decided (2026-07-05):** Vitest + `@cloudflare/vitest-pool-workers` for tests; **Biome** for lint+format. Other pinned tools: Drizzle ORM 0.45.x (D1), Hono, Zod, TanStack Query, better-auth (magic link), IGDB (games DB). See `ARCHITECTURE-SPINE.md` Stack table.

## Critical Implementation Rules

### Data Contracts (most important)

- **SQLite is the single source of truth.** The two CSVs exist **only to bootstrap** the database, then become read-only reference:
  - `ps_catalog.csv` — 175 owned games from the PlayStation API. Columns: `name, platform, membership`. Encoding **utf-8-sig**.
  - `Gaming list …_all.csv` — 169 tracked games from Notion. Columns: `Title, Category, Date finished, Date started, Owned, Rating, Release date, Status`.
- **Notion CSV status enum** (exact values in the file): `Not started`, `Completed`, `Paused`, `Not released`, `Playing`, `Up next!`. **The app's state model is different** (PRD 2026-07-05): play status `Not started` / `Up next` / `Playing` / `Paused` / `Dropped` (nullable once a completion milestone exists) plus immutable `completed_on` / `platinum_on` milestone dates. The importer maps old values onto the new model.
- **`Category` is multi-valued** — a quoted comma-separated list ("Action Adventure, Open world"). Model as many-to-many (game ↔ genre) in SQLite, never as a single string column.
- **Genres come exclusively from the third-party games DB** (PRD 2026-07-05): the Notion `Category` column is ignored at import — every game is re-tagged via external lookup so the vocabulary stays consistent. The old typo-normalization mapping (`Turn-Basaed RPG`, `Rythm`) is obsolete.
- **Game titles are the join key between the two datasets and don't match exactly** — PS names carry trademark glyphs (`HEAVY RAIN™`, `®`) and edition suffixes. Title matching must strip symbols and normalize case/whitespace; expect manual overrides for stragglers.
- **PS4/PS5 duplicates collapse to one PS5 entry** — preserve the `dedupe_games` rule in the Bun sync function.
- **Library sync is append-only by game**: syncing from the PS API adds new games, never modifies or deletes existing rows (user-entered status/dates must survive every sync; personal ratings dropped per PRD 2026-07-05 — the Notion `Rating` column is not imported).
- **PS+ claims COUNT as owned (FR-9 amended 2026-07-11)**: a claimed game is playable, so sync and seed both mark it Owned — but `game_tracking.owned_via` records the source (`purchase` | `membership`). Claims never stamp `bought_on`; buying a claimed game upgrades `owned_via` and stamps it. A future subscription-cancel flow un-owns `membership` rows only — never touch that flag casually. Only WEBMAF web-app entitlements are excluded from sync/seed.
- "Owned" ≠ "tracked": the PS export has games missing from the Notion data and vice versa (wishlist has `Owned: No`). The UI must handle games present in only one source.

### PlayStation API Rules

- Endpoint: `web.np.playstation.com/api/graphql/v1/op`, persisted GraphQL query `getPurchasedGameList` (sha256 hash pinned in `export_ps_catalog.py` — copy it verbatim). **Do not hand-write GraphQL queries** — only persisted-query calls work.
- Required headers: mimic `library.playstation.com` origin/referer + `apollographql-client-name: my-playstation` (see `HEADERS` in the Python script).
- Pagination: page size 100, loop until `pageInfo.isLast`.
- **Auth = `pdccws_p` session cookie, expires regularly. It lives in a SQLite settings table, editable from the UI** (paste from DevTools per the instructions in `COOKIE_HELP`); the sync function reads it fresh per call — no restart needed. `.env` may seed an initial value only. On 401/403, surface the refresh instructions in the UI, don't retry.

### Cover Art Rules

- Source order: **PlayStation Store image URLs first** (captured during sync), **external games DB fallback** (IGDB/RAWG) for wishlist titles not in the PS library.
- Persist resolved image URLs (or cached files) in SQLite — never re-hit external APIs on page render.

### Legacy Python Script Rules (bootstrap phase only)

- Stdlib only, full type hints, `SystemExit` with actionable messages for expected failures.
- CSVs are always read/written with `utf-8-sig` + `newline=""` (Excel round-trip).
- **Windows console is cp1252** — scripts print ASCII only, or set `PYTHONIOENCODING=utf-8`.

### Development Workflow Rules

- **Git repo is initialized but has zero commits and no remote yet.** Before the first commit: (1) scrub the hardcoded `SESSION_COOKIE` value from `export_ps_catalog.py`, (2) extend `.gitignore` with the SQLite DB file, `node_modules/`, and `.env`. Nothing has leaked yet — keep it that way.
- The SQLite database file is **never committed** (contains the session cookie + personal library data).
- React/Cloudflare-Worker conventions (paradigm, boundaries, state model invariants, testing, SSR-or-not) are now **set by `ARCHITECTURE-SPINE.md`** (2026-07-05) — follow its ADs; do not invent conventions ad hoc.

### Critical Don't-Miss Rules

- Never join the two datasets on raw title strings without normalization.
- Never commit the PlayStation session cookie or the SQLite DB.
- Never let a PS-library sync overwrite user-entered tracking data (status, dates).
- Don't add features to the Python scripts — all new code is Bun TypeScript.

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes (e.g. once architecture decides SSR/testing)
- Remove rules that become obvious over time (e.g. legacy Python rules after bootstrap)

Last Updated: 2026-07-04
