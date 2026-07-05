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

- **Target app (decided, not yet built):** **Bun** runtime — React frontend + Bun TypeScript backend. **Database: SQLite-flavored is a preference, not a constraint** (product brief 2026-07-05): the app must be hosted on a free tier with the app stateless and data managed externally, and *free hosting outranks SQLite* — architecture picks the DB (candidates: Turso/libSQL, Cloudflare D1, Neon/Supabase Postgres). SSR remains an open question for the architecture step; default recommendation is a React SPA served by the Bun backend.
- **Python 3.11 scripts are legacy/bootstrap-only** (`export_ps_catalog.py`, `update_ps_catalog.py`) — used to seed the database, then frozen. New functionality goes in Bun TS, never in Python.
- **No test framework, linter, or formatter configured yet** — to be chosen at architecture time, not assumed.

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
- React/Bun conventions (component structure, state management, testing, SSR-or-not) are **deliberately not defined here** — they'll be set by `bmad-architecture` and must not be invented ad hoc.

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
