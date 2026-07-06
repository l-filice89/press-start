# Epic 1 Context: Foundation & the Seeded Shelf

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Stand up the walking skeleton of the app — deployable Cloudflare scaffold with CI/CD, the pure domain core, the D1 data model and repository seam, magic-link auth with user-scoping, the design-token system and responsive app shell — and use it to deliver a read-only, cover-forward shelf populated by a one-time out-of-band seed import of Luca's real Notion + PlayStation library data. This is the foundation every later epic builds on, and it alone must make the library trustworthy: every owned game present without manual entry. Card flip-to-edit and status changes are deliberately deferred to Epic 2 — Epic 1's shelf is read-only.

## Stories

- Story 1.1: Deployable project scaffold & CI/CD
- Story 1.2: Domain core — state computation & title normalization
- Story 1.3: Sign in with a magic link (auth & user scoping)
- Story 1.4: Catalog & tracking data model + repositories
- Story 1.5: Design system & responsive PWA app shell
- Story 1.6: Seed import (out-of-band)
- Story 1.7: The read-only shelf

## Requirements & Constraints

- Play status is a single enum (`Not started` · `Up next` · `Playing` · `Paused` · `Dropped`), defaulting to `Not started`; it may be null only once a completion milestone exists.
- Completion milestones (`completed_on`, `platinum_on`) are dates; non-null means achieved. They are display-only in this epic (logging/editing lands in Epic 2).
- Effective state — the value every UI surface reads — is play status if set, else Platinum if `platinum_on`, else Story completed if `completed_on`.
- Derived states, never persisted: Released (real date ≤ today; TBA/missing = not released), Wishlisted (= not owned), Playable now ((owned OR in PS+ Extra) AND released) — PS+ Extra membership itself isn't wired until Epic 5, so Playable-now is only partially realized here.
- Ownership (`owned` flag + `digital`/`physical` type) is modeled and displayed; only manual/sync setting arrives in later epics.
- Default shelf view shows only games whose effective state is a live play status; Completed/Platinum/Dropped are hidden by default. Ordering: Playing → Paused → Up next → Not started, alphabetical within each group — driven entirely by the single core effective-state function, never a raw `ORDER BY`.
- At v1's ~344-game single-user scale, the sorted set is materialized in Worker/client and rendered progressively (infinite scroll), not keyset-paged in SQL.
- The persistent search bar runs a dedicated whole-library query (not a client-side filter over the paginated shelf) matching every game, ignoring active filters and hidden states.
- Genre vocabulary's single source of truth is the external games DB (IGDB); Notion's genre column is dropped at import and genres are re-tagged via lookup. New genres encountered are auto-created.
- Seed import (out-of-band script, no UI) loads the Notion CSV and PS library export, reconciles titles via the shared normalizer (strips trademark glyphs/edition suffixes/leading articles, case/whitespace-folds, collapses PS4/PS5 to one PS5 key — a non-unique candidate key, not identity), and enriches every game from IGDB (cover, genres, release date).
- Membership-sourced (PS+ claim) entries are excluded from seed import entirely — never created, never marked owned — and the skipped count is reported.
- Notion status mapping is fixed: `Completed` → null status + `completed_on` from *Date finished*; `Up next!` → `Up next`; `Not released` → `Not started`; `Not started`/`Playing`/`Paused` map 1:1; *Date started* → `started_on`; *Rating* is not imported. Anything the mapping can't place becomes a straggler, never guessed.
- CSV `Owned: Yes` rows import as owned, physical by default (editable later). No fabricated history: only dates the source actually provides are stamped; `bought_on`/`wishlisted_on` stay null for imported games.
- Auth is better-auth magic link; every tracking row and query is scoped by `user_id` from day one, even though this is single-user in practice (keeps a future multi-user door unwelded without building sharing/roles/tenancy).
- Installable, responsive PWA — desktop and phone both first-class, one app.
- Nothing external is ever fetched on a render/read path (covers, store links, genres all come from persisted data); third-party calls happen only at import/sync/refresh/add time.
- Free-tier Cloudflare hosting is a hard constraint driving several downstream choices (see Technical Decisions).

## Technical Decisions

- Single-vendor Cloudflare stack: one Worker serves both the React SPA (Workers Static Assets) and the Hono JSON API; persistence is D1 via binding; scheduled work (later epics) uses Cron Triggers. No second hosting vendor. Free-tier subrequest budget: 50 external + 1,000 Cloudflare-services calls per invocation.
- Deployed runtime is workerd/V8, TypeScript throughout. Bun is dev-toolchain-only (package manager, test runner, out-of-band scripts) — never a Bun-only runtime API in deployed code.
- Layered + ports-and-adapters with two seams. Source tree: `core/ services/ repositories/ providers/ routes/` (plus `web/` for the SPA, `migrations/`, `scripts/` for out-of-band jobs).
  - `core/` is strictly I/O-free (no `fetch`, no D1/Drizzle) — effective/derived state, normalization, and reconciliation are pure, unit-tested functions.
  - All DB access goes through `repositories/` (Drizzle); no raw D1 query anywhere else. This is the swap point for any future DB migration.
  - Every third-party call goes through a `providers/` adapter; Epic 1 doesn't build providers itself but the seam must exist for later epics.
  - Read/query paths use repositories only — a `fetch` in a query path is an architecture violation (structural enforcement of "nothing external on render").
- Effective state, and the title/match normalizer, each have exactly one `core/` implementation; every consumer (ordering, labels, filters, future ingest) calls it rather than recomputing.
- Data model for this epic: `GAME` (shared catalog facts — title, `title_normalized` with no uniqueness constraint, release_date, cover_url, store_url, PS+ Extra per region, `unenriched` flag), `GAME_TRACKING` (PK `(user_id, game_id)`, one row per user per game — play_status nullable, milestone/lifecycle dates, owned, ownership_type), `GENRE`, `GAME_GENRE`, `EXTERNAL_LINK` (many rows allowed per game+source, e.g. PS4 and PS5 ids both linking one GAME), `IMPORT_STRAGGLER`. Game identity is the `EXTERNAL_LINK (source, external_id)`, not the normalized title. `SETTING` and any tables needed only by later epics are explicitly NOT created yet.
- CI runs on every push/PR: Biome (lint+format), `tsc`, Vitest via `@cloudflare/vitest-pool-workers`. `package.json` exposes `lint`/`typecheck`/`test` scripts, and these exact scripts are what CI, local dev, and the bmad-loop verify gate all invoke — no drift between environments.
- CD on merge to `main`: `wrangler d1 migrations apply` runs before `wrangler deploy`; the Worker never migrates itself at startup. Migrations are generated via `drizzle-kit generate`.
- The one-time seed import (~344 games) exceeds the 50-external-subrequest budget, so it runs out-of-band as a script (not in-Worker) writing to D1 via the D1 HTTP API / Wrangler, sharing the same Drizzle schema as the app.
- Secrets (IGDB/Twitch creds, initial PSN cookie) are provided via Wrangler secrets; the D1 file, `.env`, and `node_modules/` are gitignored and never committed.
- Stack pins relevant to this epic: Drizzle ORM 0.45.x + drizzle-kit, Hono (+ typed RPC client), Zod (shared SPA↔Worker validation at every boundary), TanStack Query, React + Vite + vite-plugin-pwa, better-auth (magic link), Vitest + `@cloudflare/vitest-pool-workers`, Biome v2.

## UX & Interaction Patterns

- Dark-only design tokens: void/surface color palette, spacing scale (4/8/12/16/24/32), radii (8/12/18/pill 999), and four type faces by job — Orbitron (display/headings/card titles, single-line ellipsis, never wrap), Rajdhani (condensed UI labels), Inter (body/forms), JetBrains Mono (numerals/dates/timestamps).
- "PRESS START" wordmark (Orbitron 900, neon glow, blinking cursor) + tagline "Want it! Own it! Beat it!" over a void Tron-grid + blue→magenta radial wash background. Hard legal rule: no PlayStation/Sony marks anywhere in branding/chrome.
- Elevation comes from glow/tone, not drop-shadow: cards sit on `surface`; modals/popovers on `surface-raised` with a cyan glow-ring; the Playing card carries a soft magenta bloom.
- Card (read-only in this epic): cover-forward; top-left flag cluster (PS+ Extra badge, release-state flag, milestone badge that persists regardless of play status); top-right owned indicator; info strip with name (ellipsis), effective-state pill, genres shown desktop-only.
- Shared feedback primitives to build now (populated by later epics): Attention banner, Toast, Skeleton loader (cover-shaped shimmer on first load), and a polite live region for announcements.
- Empty states: no library → `INSERT GAMES` with "Sync library" / "＋ Add a game" actions (those actions themselves are built in later epics; the empty state itself is Epic 1 scope).
- Accessibility floor applies from the start: focusable shelf grid with arrow-key traversal in reading order; a distinct always-on focus outline (never glow-intensity alone); WCAG AA contrast (≥4.5:1 body, ≥3:1 large/UI) with muted text floored and no white-on-neon; ≥44×44 touch targets on compact controls via padding/invisible expander, decoupled from visual size; `prefers-reduced-motion` swaps flip/glow-pulse/shimmer for static/cross-fade equivalents.
- Responsive deltas: phone gets a 2-up lean card grid with genres hidden and a compact header; desktop gets an auto-fill dense grid and a full header. Installable PWA with home-screen icon; no offline requirement.

## Cross-Story Dependencies

- Story 1.1 (scaffold/CI/CD) underlies every other story in this epic and all later epics — it establishes the layer namespaces and the lint/typecheck/test scripts that CI, local dev, and bmad-loop share.
- Story 1.2 (domain core) must exist before Story 1.7 (the shelf) can render effective state, ordering, or derived flags, and before Story 1.6 (seed import) can reconcile titles.
- Story 1.4 (data model + repositories) must exist before Story 1.6 (seed import) can write data and before Story 1.7 (shelf) can read it.
- Story 1.3 (auth) gates Story 1.7: the shelf only renders behind a signed-in, user-scoped session.
- Story 1.5 (design system/shell) supplies the visual tokens and feedback primitives (skeleton, empty states) that Story 1.7's shelf consumes.
- Story 1.6 (seed import) is what makes Story 1.7 meaningful — the shelf must show Luca's real, seeded data, not placeholder content.
- The completion-invariant predicate built in Story 1.2 is pure/unenforced here; its enforcement at the edit boundary is wired in Epic 2. The `Dropped` reveal-pill UI (Epic 3) and PS sync/PS+ Extra/add-by-name flows (Epics 4–6) all depend on this epic's scaffold, core functions, schema, and shelf existing first.
