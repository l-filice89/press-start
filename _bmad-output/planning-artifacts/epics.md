---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
postV1Run:
  date: 2026-07-13
  scope: 'v1.x epics (E9, E10), Story 6.6, Epic 8 decomposition'
  stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
inputDocuments:
  - prds/prd-ps-game-catalog-2026-07-05/prd.md
  - prds/prd-ps-game-catalog-2026-07-05/addendum.md
  - architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md
  - ux-designs/ux-ps-game-catalog-2026-07-05/DESIGN.md
  - ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md
  - ../implementation-artifacts/epic-2-retro-2026-07-09.md
  - ../roadmap.md
  - sprint-change-proposal-2026-07-13.md
  - ../implementation-artifacts/publication-blockers.md
  - ../implementation-artifacts/post-v1-backlog.md
---

# ps-game-catalog - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for ps-game-catalog (product name **PRESS START**), decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

**State model — play status (§2)**

- **FR-1** — Play status is one per game (`Not started` · `Up next` · `Playing` · `Paused` · `Dropped`) and defaults to `Not started`.
- **FR-2** — Play status may be **null** only once a completion milestone exists. Logging a **platinum** auto-clears status to null; a **story completion** leaves it untouched (amended 2026-07-09); the user may also clear it manually; a replay sets it back to `Playing`.
- **FR-3** — Invariant: every game always has a play status **or** at least one completion milestone. The detail view refuses any edit that would leave neither (clearing the last milestone requires setting a play status first).
- **FR-4** — `Dropped` games are hidden from the default shelf, reachable via the `Dropped` reveal pill (exclusive view — shows only `Dropped` games; amended 2026-07-10).

**State model — completion milestones (§2)**

- **FR-5** — `completed_on` ("Story completed") and `platinum_on` ("Platinum achieved") are dates; non-NULL means achieved.
- **FR-6** — Milestones are immutable through normal flows — never cleared/overwritten by any sync, status change, or replay. Editable only in the detail view (subject to FR-3). Logging a milestone that already has a date does nothing.
- **FR-7** — Logging either milestone requires a confirmation modal (fat-finger protection).
- **FR-8** — Shelf ordering, card labels, and filter pills all operate on **effective state** (`play status if set, else Platinum if platinum_on, else Story completed if completed_on`), never on raw play status.

**State model — ownership & derived states (§2)**

- **FR-9** — `Owned` is a flag meaning **purchased**. Set by the PS library sync (digital source of truth) or manually in the detail view (physical). Membership-sourced PS entries (PS+ claims) never set it.
- **FR-10** — Sync may set `Owned` true on any existing game and never sets it false; nothing unsets it except the user.
- **FR-11** — Ownership type (`digital`/`physical`) is inferred (sync = digital, manual = physical) and editable in the detail view.
- **FR-12** — Derived **Released**: release date is a real date ≤ today; `TBA`/missing counts as not released.
- **FR-13** — Derived **Wishlisted**: not owned. No separate wishlist status or list.
- **FR-14** — Derived **Playable now**: (owned OR currently in the PS+ Extra catalog) AND released.

**The Shelf — cards & default view (§3)**

- **FR-15** — Cards are minimal by default: cover art, name, genre tags, owned indicator, flag icons for PS+ Extra and release state.
- **FR-16** — Clicking a card flips it into the full editable detail view: play status, milestones (with confirm modal), lifecycle dates, genres, ownership flag + type, and — for wishlisted games — a "View on PS Store" link (product URL when known, store search-by-title fallback).
- **FR-17** — Default view shows every game whose effective state is a live play status; `Story completed`, `Platinum achieved`, and `Dropped` are hidden by default (the default shelf is the backlog view).
- **FR-18** — Default ordering: `Playing` → `Paused` → `Up next` → `Not started`; owned before wishlisted, then alphabetical by name, within each group (ownership tier added 2026-07-09).
- **FR-19** — Infinite scroll with an always-visible name search bar. Search matches the entire library, ignoring active filters and hidden states.

**The Shelf — filters (§3)**

- **FR-20** — Filter semantics: OR within a group, AND across groups. Groups: State (multiselect dropdown of live statuses), State-reveals (own group, amended 2026-07-10 — reveal pills for Completed/Platinum/Dropped OR among themselves and replace the State group entirely when active), Genre (multiselect dropdown), Flags (individual pills `Owned`/`Wishlisted`/`Released`/`Playable now`, each its own AND group).
- **FR-21** — Selection rules (amended 2026-07-10): nothing selected → default visible set (FR-17); State-dropdown selection → exactly the selected live states; reveal-pill selection → exclusive view of the selected hidden state(s), State group cleared (State dropdown and reveal pills mutually exclusive).
- **FR-22** — Active pills are visually highlighted (toggle-on state).

**The Shelf — genre vocabulary (§3)**

- **FR-23** — Genre vocabulary single source: the third-party games DB (IGDB). Notion's genre column is dropped at import; the seed importer re-tags all games via external lookup.
- **FR-24** — Adding a game whose genres don't exist yet auto-creates the genre rows.
- **FR-25** — Genres are editable per-game in the detail view; a merge/rename tool is not v1.

**Getting games in — seed import (§4.1)**

- **FR-26** — Seed import imports the Notion CSV and PS library exports, then enriches every game from the games DB (cover, genres, release date). Membership-sourced PS entries are excluded (neither create games nor set `Owned`); the summary reports how many were skipped.
- **FR-27** — Title reconciliation joins the two sources and the external DB: case-insensitive after stripping trademark glyphs, leading articles, edition suffixes, and normalizing whitespace. PS4/PS5 duplicates collapse to one PS5 entry.
- **FR-28** — The import lands everything it can and lists stragglers visibly in the UI; unmatched/ambiguous titles are resolved by manual search. Resolving a straggler carries its Notion data (status, dates, owned flag) onto the matched game.
- **FR-29** — A manual match is permanent: resolving a straggler stores the external-ID/alias link so subsequent syncs recognize the game and never re-add it as a duplicate.
- **FR-30** — Notion status mapping onto the new model (`Completed` → null status + `completed_on` from *Date finished*; `Up next!` → `Up next`; `Not released` → `Not started`; `Not started`/`Playing`/`Paused` map 1:1; *Date started* → `started_on`). *Rating* not imported. Any row the mapping can't place goes to the stragglers list.
- **FR-31** — The CSV `Owned` column is honored: `Owned: Yes` games import as owned (physical by default, editable), never as wishlisted.
- **FR-32** — No fabricated history: the import stamps only the dates it knows (*Date started*, *Date finished*); `bought_on` and `wishlisted_on` remain null for imported games.

**Getting games in — PS library sync (§4.2)**

- **FR-33** — Sync is triggered by a button. Append-only to user data: it may create games (defaults `Owned`/digital/`Not started`) and flip `Owned` false→true on existing games (stamping `bought_on`); it never deletes, never sets `Owned` false, never touches status/milestones/dates/genres. Membership-sourced entries are skipped.
- **FR-34** — Matching order: stored external-ID/alias links first, then normalized title. PS4/PS5 collapse applies. A title-matched game carrying a *different* external-ID link is flagged in the sync summary's needs-attention list, never silently merged.
- **FR-35** — Cover art and PS Store product URL are captured at sync time and persisted; nothing is fetched on page render.
- **FR-36** — Auth is the PS session cookie, stored in a settings table and editable from the UI. On 401/403 the app surfaces the refresh instructions and does not retry.
- **FR-37** — Every sync ends with a visible summary: games added, `Owned` flips, membership entries skipped, and anything needing attention.

**Getting games in — PS+ Extra check (§4.3)**

- **FR-38** — PS+ Extra check sets/clears the flag on tracked, non-owned games only; catalog games are never auto-added; a refresh updates flags in both directions. Per-region (user's account region). The flag is ignored/hidden once a game becomes owned.
- **FR-39** — Triggered by a button and a scheduled job aligned to Sony's monthly catalog update (must fit the stateless free tier).
- **FR-40** — The shelf shows a "PS+ catalog as of {date}" timestamp; a failed scheduled refresh surfaces a notice on next app open.

**Getting games in — add-by-name (§4.4)**

- **FR-41** — Add-by-name searches the games DB by name, picks a result, and reviews pre-filled data (all editable; nothing committed until Save). If external search is unreachable or lacks the title, the user can save a name-only entry (lands in stragglers for later enrichment).
- **FR-42** — Search also matches the existing library: picking an already-tracked game opens its detail view instead of creating a duplicate.
- **FR-43** — Defaults on save: not owned (= wishlisted, `wishlisted_on` recorded), status `Not started`.

**Getting games in — lifecycle dates (§4.5)**

- **FR-44** — Lifecycle dates are auto-recorded on every transition, never asked for: `wishlisted_on`, `bought_on`, `started_on`, `completed_on`, `platinum_on`. Seed-imported games only get the dates the CSV knows.
- **FR-45** — All lifecycle dates are write-once through automatic flows (first value stands); they remain manually editable in the detail view. `started_on` is written only while no completion milestone exists; replays never write it.

**Platform, auth & quality (§5)**

- **FR-46** — Installable PWA — one responsive app, desktop and phone both first-class.
- **FR-47** — better-auth with magic link for v1; Google OAuth is v1.x.
- **FR-48** — Single user in practice, but all user-entered tracking data is scoped to a user id from day one (no sharing/roles/tenancy built).
- **FR-49** — CSV export in v1: the full library (games, statuses, milestones, lifecycle dates, genres, ownership) downloadable as CSV.

### NonFunctional Requirements

- **NFR-1** — Free-tier hosting is a hard constraint. The app is stateless; data lives in an externally managed database.
- **NFR-2** — The PS+ Extra scheduled job must also fit the free tier.
- **NFR-3** — Nothing external on render: covers and store links are served from persisted data; third-party APIs are hit only at import, sync, refresh, or add time.
- **NFR-4** — Failures surface, never silently retry (expired cookie → refresh instructions; failed lookup → stragglers list).

### Additional Requirements

_Architecture-derived implementation constraints (from `ARCHITECTURE-SPINE.md`, 23 ADs + delivery/ops). These govern how stories are built. No greenfield starter template is prescribed — Epic 1 is a from-scratch scaffold._

**Platform & runtime**

- **AR-1** (AD-1) — Cloudflare single-vendor stack: one Worker serves the React SPA (Workers Static Assets) **and** the Hono JSON API; persistence is Cloudflare D1 via binding; scheduled work is Cloudflare Cron Triggers. No second hosting vendor. Free-tier subrequest budget: 50 external + 1,000 Cloudflare-services per invocation.
- **AR-2** (AD-2) — Deployed runtime is workerd/V8, TypeScript throughout. Bun is local-only (package manager, test runner, out-of-band scripts) — no Bun-only runtime APIs.

**Layering (layered + ports-and-adapters, two seams)**

- **AR-3** (AD-3) — Domain `core/` is I/O-free: no `fetch`, no D1/Drizzle. Effective/derived state, normalization, reconciliation, invariant checks are pure functions, unit-tested without network/DB.
- **AR-4** (AD-4) — All DB access goes through `repositories/` (Drizzle). No raw D1 query in services/routes/core. Storage layer is the swap point for a future DB migration.
- **AR-5** (AD-5) — Every third-party call goes through a `providers/` adapter (`PsnProvider`, `IgdbProvider`). PSN auth (cookie, later NPSSO) lives entirely inside `PsnProvider`; account region is a provider input.
- **AR-6** (AD-6) — Nothing external on render, enforced structurally: read/query paths use repositories only; a provider is touched only by an ingest job. A `fetch` in a query path is an architecture violation.

**Domain rules with a single owner**

- **AR-7** (AD-7) — Effective-state computed by a single `core/` function; ordering, labels, filters consume it, none recomputes.
- **AR-8** (AD-8) — Released/Wishlisted/Playable-now are computed, never persisted. Distinct from stored inputs (`cover_url`, `store_url`, PS+ Extra catalog membership) which are fetched facts persisted by ingest jobs.
- **AR-9** (AD-9) — A single `core/` title-normalizer (strip glyphs/edition suffixes, drop leading articles, case/whitespace-fold, PS4/PS5→PS5) produces the shared `title_normalized` match key. Non-unique candidate key.
- **AR-10** (AD-10) — Append-only to user data at one write-path guard: no sync/import writes status/milestones/dates/genres; sync may only create games and flip `Owned` false→true. Membership entries filtered at the ingest boundary; when ambiguous, prefer skipping over flipping `Owned`.
- **AR-11** (AD-11) — Lifecycle & milestone dates write-once through automatic flows; manually editable in detail only. `started_on` written only while no completion milestone exists.
- **AR-12** (AD-12) — Completion invariant enforced at the API/detail boundary: refuse any edit leaving neither a play status nor a milestone; milestone logging confirm-gated.
- **AR-13** (AD-21) — A single `core/` milestone-write reconciliation function owns the auto-clear-status side-effect (symmetric to AR-7); every surface calls it.

**Data model & identity**

- **AR-14** (AD-13/17) — Every tracking row is user-scoped; `GAME_TRACKING` primary key is `(user_id, game_id)` (GAME 1:many GAME_TRACKING); every query filters by `user_id`.
- **AR-15** (AD-18/20) — `title_normalized` has no uniqueness constraint; identity is `EXTERNAL_LINK (source, external_id)`, which is many-per-(game, source) (both PS4 and PS5 ids → one GAME). Sync conflict = an external id resolving to a *different* GAME than the title match.
- **AR-16** (AD-19) — Attribute ownership: `GAME` holds shared catalog facts (title, normalized title, release_date, cover_url, store_url, genres via GAME_GENRE, PS+ Extra membership per region, `unenriched`); `GAME_TRACKING` holds per-user state (play_status, milestone/lifecycle dates, owned, ownership_type).
- **AR-17** (AD-22) — "Straggler" is a defined needs-attention record with two kinds: (a) import staging rows not yet matched to a GAME (carry Notion payload), (b) name-only add-by-name entries (real GAME rows flagged `unenriched`). Notion status-mapping is a pure `core/` function; anything unplaceable → a straggler, never a guess.
- **AR-18** (AD-23) — Account region persisted in `SETTING` (seeded from config or derived from PSN on first sync); both manual and cron PS+ Extra checks read it; catalog membership stored per region.
- **AR-19** — Structural seed entities: `USER`, `GAME`, `GAME_TRACKING`, `GENRE`, `GAME_GENRE`, `EXTERNAL_LINK`, `IMPORT_STRAGGLER`, `SETTING`.

**Delivery, ops & operational constraints**

- **AR-20** (AD-15) — Heavy bulk work runs out-of-band or chunked. The one-time seed import (~344 games, exceeds 50 external subrequests) runs out-of-band as a script writing D1 via the D1 HTTP API / Wrangler with the shared Drizzle schema. Steady-state incremental sync runs in-Worker.
- **AR-21** (AD-16) — Migrations run from CI, never at deploy: `drizzle-kit generate` → `wrangler d1 migrations apply` before `wrangler deploy`. The Worker never migrates at startup.
- **AR-22** (AD-14) — Failures surface, never silently retry; four UI feedback channels (toast / summary modal / attention banner / loading); every user-triggered long op ends in a summary; anything needing action seeds the persistent attention banner.
- **AR-23** — CI on every push/PR: Biome (lint+format) + Vitest (workers pool) + `tsc`. CD on merge to `main`: migrations apply → deploy (optional manual gate on destructive migrations). Trunk-based development.
- **AR-24** — Secrets: IGDB/Twitch creds + initial PSN cookie via Wrangler secrets; live `pdccws_p` cookie in a D1 settings table, editable in-UI, read fresh per call; D1 file and secrets never committed.
- **AR-25** — Backup/DR: D1 Time Travel is the primary safety net; the FR-49 CSV export is the user-held second copy.
- **AR-26** — Stack pins: Drizzle ORM 0.45.x + drizzle-kit, Hono (+ typed RPC client), Zod (shared SPA↔Worker at every boundary), TanStack Query, React + Vite + vite-plugin-pwa, better-auth (magic link), IGDB via Twitch OAuth2 client-credentials, Vitest + `@cloudflare/vitest-pool-workers`, Biome v2.

### Test Requirements (Epic 2 retro, 2026-07-09)

_Source: `epic-2-retro-2026-07-09.md` action items 1–3. Scoped 2026-07-09: Epic 2.5 is Playwright-only; the retro's other items live in `deferred-work.md`._

- **TR-1** — Playwright e2e framework running against the real app (real Worker + D1, real browser); magic-link auth via console-captured link (console email provider — no real email sent by tests).
- **TR-2** — Backfill: one e2e test per Epic 1+2 acceptance criterion that has a matching UI user flow.
- **TR-3** — Standing rule wired into `_bmad/custom/bmad-dev-auto.toml` as a persistent fact (same mechanism as the hazard-test rule): every AC with a matching UI flow ships with a Playwright test.

### UX Design Requirements

_From `DESIGN.md` (visual identity) and `EXPERIENCE.md` (behavior). Both spines win on conflict with any mock. Dark-only, no light theme in v1._

**Design foundation (tokens & identity)**

- **UX-DR1** — Implement the dark-only design token system: color palette (void `#05090f`; surfaces `#0b1622`/`#0a1120`; borders hairline/soft; text primary/secondary/muted with muted floored at `#6b8ba0`; brand blue; electric `#12b3ff` + glow `#35e0ff` cyan; heat magenta `#ff2e88`/`#ff8bc2` ink; milestone silver `#d6e6f5`; state colors; semantic warn amber / success green), spacing scale (4/8/12/16/24/32), radii (sm 8 / md 12 / lg 18 / pill 999).
- **UX-DR2** — Typography system: four faces by job — Orbitron (display: wordmark, headings, pills/labels, card titles), Rajdhani (condensed UI labels: buttons, segmented controls, dropdowns), Inter (body/detail/forms), JetBrains Mono (numerals, dates, counts, timestamps, tagline, filter-logic labels). Implement the type ramp; card titles single-line ellipsis, never wrap.
- **UX-DR3** — Wordmark "PRESS START" lockup (Orbitron 900, neon glow, blinking cursor) + tagline "Want it! Own it! Beat it!" (JetBrains Mono, tracked). Hard legal rule: never use PlayStation/Sony marks in branding/chrome — only as descriptive text.
- **UX-DR4** — Void background texture: faint Tron light-grid + subtle blue→magenta radial wash behind the shelf.
- **UX-DR5** — Elevation/depth via glow and tone (not drop-shadow): cards on `surface`; modals/popovers on `surface-raised` with a cyan glow-ring; Playing card carries a soft magenta bloom; focus/selection as neon halos.

**Components (custom React; behavioral + visual)**

- **UX-DR6** — Card: cover-forward flip target; top-left display-only flag cluster (PS+ Extra badge ◈ when in-catalog & not owned, release-state flag TBA/upcoming until released, milestone badge silver ✓/🏆 persisting regardless of play status); top-right owned toggle (reversible, no confirm); info strip below (name Orbitron ellipsis, status pill, genres desktop-only); Playing card glows magenta.
- **UX-DR7** — Status pill: shows effective state; tap opens the status popover.
- **UX-DR8** — Status popover: menu anchored to the pill (flips above/below to stay on-screen) with 5 play statuses (instant, no confirm) + 2 milestone rows (confirm-gated); menu ARIA semantics, arrow traversal, Escape closes and returns focus to the pill.
- **UX-DR9** — Filter row: State multiselect dropdown, Genre multiselect dropdown, Flags solid toggle pills, State-reveal dashed pills; solid = narrow (AND), dashed = reveal hidden state; a live plain-English summary sentence (OR-connectors in glow-cyan, AND-connectors in heat-magenta); active pills glow.
- **UX-DR10** — FAB + upward drawer: electric-blue launcher, bottom-right by default (configurable to bottom-left), opening chores (Sync library · Check PS+ Extra · Sync trophies · Export CSV · Settings · About/Help); icons+text on all sizes (revised 2026-07-14 — icons-only on mobile was too unclear); no Add here.
- **UX-DR11** — Attention banner: full-width under-header notice zone, shown only when action is needed, persistent until cleared; amber (stragglers), magenta (expired cookie), steel (failed refresh); self-clears when the condition resolves.
- **UX-DR12** — Toast: transient bottom, `surface-raised` cyan-edged, ~3s auto-dismiss; UNDO variant for reversible risky actions (mark Dropped, un-own).
- **UX-DR13** — Summary modal: post-op readout (sync/import/PS+), `surface-raised` with glow-ring; counts + needs-attention + a button jumping to the problem.
- **UX-DR14** — Confirm modal: milestone fat-finger gate, uses silver for milestone gravity.
- **UX-DR15** — Detail panel: flip-then-grow; centered ~760px on desktop, full-screen on mobile; holds play-status segmented control, milestone rows + dates, lifecycle dates (editable here only), genres (editable), ownership flag+type, "View on PS Store" for wishlisted; enforces the FR-3 invariant.
- **UX-DR16** — Search bar: persistent, pill-shaped, cyan focus glow; combobox semantics (`role=combobox`, `aria-controls`/`aria-activedescendant`); results dropdown lists library matches + the `＋ Add "<name>"` row; global focus shortcut; bottom-pinned mobile, header-left desktop.
- **UX-DR17** — Skeleton loader: cover-shaped shimmer (`surface` → lighter sweep) on first load.
- **UX-DR18** — Empty states: no filter match → `NO MATCH` + "Clear filters"; empty library → `INSERT GAMES` + "Sync library"/"＋ Add a game"; search no-library-match → the `＋ Add` path (never a dead end).

**Accessibility floor**

- **UX-DR19** — Keyboard operability: focusable shelf grid with arrow traversal in reading order; pills/toggles are buttons; the detail is a focus-trapped dialog returning focus to its originating card on close; search bar has a global focus shortcut.
- **UX-DR20** — Focus indicator: a distinct, always-on outline, never conveyed by glow-intensity alone.
- **UX-DR21** — Accessible names + state for icon-only controls (FAB and drawer items, owned toggle, flag icons, status pill, e.g. "Owned, on" / "Playing — change status"); status/milestone changes and toasts announce via a polite live region.
- **UX-DR22** — Contrast WCAG AA (≥4.5:1 body, ≥3:1 large/UI); status pills use translucent tint + light ink, solid active pills use dark ink on neon — never white-on-neon; muted text floored per token.
- **UX-DR23** — No color-alone signaling: the text status pill is the status indicator on every surface (the early dot-only treatment is superseded and must not ship); milestones also carry a badge shape; the filter summary's OR/AND coloring is redundant to the literal words.
- **UX-DR24** — Reduced motion (`prefers-reduced-motion`): replace flip-then-grow with a fast cross-fade/scale; drop glow pulses and skeleton shimmer (static placeholder); static neon stays.
- **UX-DR25** — Touch/hit targets ≥ 44×44, decoupled from visual size (compact controls keep their small look via padding/invisible expander).

**Responsive & platform**

- **UX-DR26** — Responsive deltas: phone (2-up lean card, genres hidden, single Filters button + count → bottom sheet, icons+text FAB [revised 2026-07-14 — was icons-only], full-screen detail, compact header "175 · 52 OWNED") vs desktop (auto-fill dense grid, full filter row + inline summary sentence, icons+text FAB, ~760px detail panel, full header with `PS+ CATALOG AS OF …` timestamp).
- **UX-DR27** — PWA: installable, home-screen icon; no offline requirement; when the games DB is unreachable, add-by-name falls back to a name-only entry landing in stragglers.

### FR Coverage Map

Each FR is assigned a **primary** epic; FRs that genuinely span epics list each contributing epic.

- **FR-1** — E1: play-status enum + `Not started` default, modeled and displayed on cards.
- **FR-2** — E2: platinum logging auto-clears status to null (story completion keeps it, amended 2026-07-09); replay returns it to `Playing`.
- **FR-3** — E2: completion invariant enforced at the detail-edit boundary.
- **FR-4** — E1 (hidden from default shelf) / E3 (`Dropped` reveal pill).
- **FR-5** — E1 (milestone-date model + silver badge on cards) / E2 (logging).
- **FR-6** — E2: milestone immutability through normal flows (ingest guard reinforced in E4).
- **FR-7** — E2: milestone confirmation modal.
- **FR-8** — E1: single effective-state core function consumed by shelf ordering/labels/filters.
- **FR-9** — E1 (Owned = purchased, modeled/displayed) / E2 (manual set) / E4 (sync set).
- **FR-10** — E4: sync sets Owned false→true only, never false.
- **FR-11** — E2 (edit ownership type) / E4 (sync infers digital).
- **FR-12** — E1: derived Released in core.
- **FR-13** — E1: derived Wishlisted (= not owned) in core.
- **FR-14** — E1 (core computation) / E5 (fully realized once PS+ Extra membership lands).
- **FR-15** — E1: minimal card display (cover, name, genres, owned, flags).
- **FR-16** — E2: card flip → editable detail view + "View on PS Store" for wishlisted.
- **FR-17** — E1: default backlog view (Completed/Platinum/Dropped hidden).
- **FR-18** — E1: default ordering Playing→Paused→Up next→Not started, alpha within.
- **FR-19** — E1: infinite scroll + always-visible search-as-lookup.
- **FR-20** — E3: filter semantics (OR-within / AND-across groups).
- **FR-21** — E3: state-group selection rule (default set vs exactly-selected).
- **FR-22** — E3: active-pill highlight.
- **FR-23** — E1: genre vocabulary from the games DB (seed re-tags all games).
- **FR-24** — E1 (seed auto-creates genres) / E6 (add-by-name auto-creates genres).
- **FR-25** — E2: per-game genre editing in detail.
- **FR-26** — E1: seed import (Notion CSV + PS export + games-DB enrichment; membership excluded).
- **FR-27** — E1: title reconciliation via the core normalizer; PS4/PS5 collapse.
- **FR-28** — E1 (seed produces stragglers) / E6 (straggler resolution UI).
- **FR-29** — E6: permanent manual match stores external-ID/alias link (used by E4 sync).
- **FR-30** — E1: Notion status mapping; unplaceable rows → stragglers.
- **FR-31** — E1: CSV `Owned: Yes` honored (physical default).
- **FR-32** — E1: no fabricated history (stamp only known dates).
- **FR-33** — E4: PS sync, append-only to user data, membership skipped.
- **FR-34** — E4: matching order (links then title) + conflict flagging.
- **FR-35** — E4: cover art + PS Store URL captured at sync, persisted.
- **FR-36** — E4: cookie auth in settings + 401/403 refresh-instruction surfacing.
- **FR-37** — E4: visible sync summary.
- **FR-38** — E5: PS+ Extra flag set/clear on tracked non-owned games, per region.
- **FR-39** — E5: button + monthly Cron Trigger.
- **FR-40** — E5: "PS+ catalog as of {date}" stamp + failed-refresh notice on next open.
- **FR-41** — E6: add-by-name search/preview/save + name-only fallback to stragglers.
- **FR-42** — E6: search matches existing library → detail, never duplicate.
- **FR-43** — E6: add defaults (not owned = wishlisted, status Not started).
- **FR-44** — E1 (seed stamps known dates) / E2 (transition stamps) / E4 (`bought_on` on sync flip).
- **FR-45** — E2: lifecycle dates write-once through automatic flows, editable in detail (guard shared by E4).
- **FR-46** — E1: installable PWA, responsive shell (both surfaces first-class).
- **FR-47** — E1: better-auth magic link.
- **FR-48** — E1: every tracking row user-scoped.
- **FR-49** — E6: full-library CSV export.

**NFR coverage:** NFR-1 → E1 (Cloudflare free-tier platform, whole app) · NFR-2 → E5 (Cron within free tier) · NFR-3 → E1 (nothing-external-on-render, structural across all read paths) · NFR-4 → E1 (feedback-channel shell) + E4/E5/E6 (surfaced per ingest op).

**TR coverage (added 2026-07-09):** TR-1 → E2.5 (framework + console-link auth) · TR-2 → E2.5 (Epic 1+2 backfill) · TR-3 → E2.5 (standing rule in `_bmad/custom/bmad-dev-auto.toml`).

### Post-v1 Requirements (added 2026-07-13)

The v1.x tier of `roadmap.md`. The PRD lists these as unnumbered bullets in §6, so they carry **VR-** IDs here; the multi-user blockers keep their existing **B-** IDs and `publication-blockers.md` stays their live source.

- **VR-1** — **Spike S-1 — PSN auth surface** (one afternoon): probe the PS Store **wishlist** endpoint, `getPurchasedGameList`, and the **trophy** endpoints under the `pdccws_p` cookie, then under an NPSSO bearer. Output: an endpoint × auth-path table appended to `deferred-work.md`. Subsumes PRD open-q #2. [sprint-change-proposal-2026-07-13 §3.2]
- **VR-2** — **Trophy sync from PSN**: per-game trophy counts synced and persisted; completion % and a PSNProfiles-style letter grade computed from them. [PRD §6 v1.x]
- **VR-3** — **One-off trophy backfill**: for games with a Platinum but no dates on record, set `platinum_on` from PSN and assume `completed_on` = `platinum_on`. A backfill heuristic only — never the rule for games synced going forward. [roadmap.md]
- **VR-4** — **Wishlist sync from PSN**: pull the PS Store wishlist and add those titles to the Press Start wishlist (PS Store product IDs are already captured, FR-16/FR-35). **Gated by VR-1**: reachable over `pdccws_p` → ships with VR-2; needs NPSSO → the auth swap becomes its prerequisite and it slips to Future. [roadmap.md]
- **VR-5** — **Critic & user scores from IGDB**: `aggregated_rating` / `aggregated_rating_count` (critic) and `rating` / `rating_count` (user) from the `/games` endpoint `IgdbProvider` already calls — no second adapter. Persisted fields + a scheduled refresh; surfaced on the card/detail view. OpenCritic is the fallback only if coverage proves thin on real titles. [PRD open-q #5, RESOLVED 2026-07-13]
- **VR-6** — **"Leaving PS+ Extra soon" warnings**: flag backlog games about to exit the region's catalog. [PRD §6 v1.x]
- **VR-7** — **Shared IGDB match picker (PV-6)**: extract `<IgdbMatchPicker>` from `RematchDialog`, migrate `StragglersDialog`'s `ResolveView` onto it, and mount it in `AddGameDialog` behind a "Not the right game?" affordance — so a wrong auto-match is caught before the row exists. No new endpoint. [`implementation-artifacts/post-v1-backlog.md`]
- **VR-8** — **Time to beat**: hours to finish the story and hours to 100% a game, shown next to the scores. **Source: IGDB `/game_time_to_beats`** (`normally` / `completely` + `count`), keyed by the `igdbId` already stored — same provider, same credentials, no fuzzy title matching. **HowLongToBeat is the fallback**, a second adapter behind the same port, only if IGDB coverage proves thin on real titles. Persisted fields + the same scheduled refresh as VR-5. [new 2026-07-13, sprint-change-proposal-2026-07-13-hltb]

**Multi-user blockers (B1a–B6):** owned by Epic 8; the table in `implementation-artifacts/publication-blockers.md` is the live source and is not duplicated here.

**Post-v1 coverage map:** VR-1, VR-2, VR-3, VR-4 → E9 · VR-5, VR-6, VR-8 → E10 · VR-7 → E6 (Story 6.6) · FR-50, FR-51, FR-52 → E7 · B1a–B6 → E8

## Epic List

### Epic 1: Foundation & the Seeded Shelf
Luca signs in with a magic link and sees his real game library as a cover-forward shelf — cards with effective-state pills, default backlog ordering, infinite scroll, and find-or-lookup search — populated by the one-time out-of-band seed import. This epic stands up the walking skeleton (scaffold, CI/CD, D1 schema, the pure domain core, auth + user-scoping, the design-token system and app shell) and delivers the read-only face of the product with real, trustworthy data.
**FRs covered:** FR-1, FR-5 (display), FR-8, FR-12, FR-13, FR-14 (compute), FR-15, FR-17, FR-18, FR-19, FR-23, FR-24 (seed), FR-26, FR-27, FR-28 (produce), FR-30, FR-31, FR-32, FR-44 (seed), FR-46, FR-47, FR-48 · NFR-1, NFR-3

### Epic 2: Track Your Games
From the shelf, Luca changes play status in a tap and, via the flip-to-detail view, logs Story/Platinum milestones (confirm-gated), edits ownership flag + type, edits genres, and corrects lifecycle dates — with the completion invariant enforced and lifecycle dates auto-recorded write-once. Logging a status change takes seconds, not a Notion-editing session.
**FRs covered:** FR-2, FR-3, FR-6, FR-7, FR-9 (manual), FR-11 (edit), FR-16, FR-25, FR-44 (transitions), FR-45

### Epic 2.5: Playwright Foundation — Trust Every Click
The verification gap named in the Epic 2 retro closes: a Playwright e2e tier runs the real app in a real browser (real Worker + D1, magic-link auth via console-captured link, zero real emails), every Epic 1+2 acceptance criterion with a UI flow gets a regression-pinning e2e test, and the standing rule — every future AC with a UI flow ships with a Playwright test — is wired into `bmad-dev-auto` as a persistent fact. Must complete before Epic 3.
**TRs covered:** TR-1, TR-2, TR-3

### Epic 3: Filter & Focus the Backlog
Luca narrows the shelf with State/Genre multiselect dropdowns, Flag pills, and reveal pills — OR within a group, AND across groups — read back by a live plain-English summary sentence, so filtering the backlog beats what Notion's views offered.
**FRs covered:** FR-4 (Dropped reveal), FR-20, FR-21, FR-22

### Epic 4: Fill the Library from PlayStation (Sync)
One button appends new purchases from the PlayStation library: append-only to user-entered data, membership claims skipped, covers and PS Store URLs captured at sync, an expired cookie surfaced with refresh instructions, and every run ending in a visible summary. The library fills itself.
**FRs covered:** FR-9 (sync), FR-10, FR-11 (infer), FR-33, FR-34, FR-35, FR-36, FR-37 · NFR-4

### Epic 5: Know What's Playable — PS+ Extra Awareness
A button and a monthly Cron Trigger flag which non-owned games are in the user's (per-region) PS+ Extra catalog, lighting up the **Playable now** signal and a "PS+ catalog as of {date}" timestamp — closing the pre-purchase blind spot of buying a game already covered by the subscription.
**FRs covered:** FR-14 (realized), FR-38, FR-39, FR-40 · NFR-2, NFR-4

### Epic 6: Add at the Moment of Discovery + Chores
Luca types a name and adds a game from the games DB — or a name-only fallback — in the seconds the discovery moment lasts; resolves import stragglers by search; exports the full library to CSV; and manages settings. The wishlist moment never depends on a third party being up.
**FRs covered:** FR-24 (add), FR-28 (resolve), FR-29, FR-41, FR-42, FR-43, FR-49 · NFR-4

### Epic 7: Browse the PS+ Catalog & Add — _Post-v1.0.0_
The full per-region PS+ Extra catalog becomes a browsable, genre-filterable, searchable destination — not just a flag on games already tracked — so Luca can discover what the subscription covers before it rotates out. Adding a game promotes it into the library (Epic 6's add preview + IGDB enrichment), and a "Claim now" deep-link jumps to the PS Store to add it to the account. Built tier-aware so PS+ Premium can layer on later. **Not in the v1 milestone** — a post-release enhancement.
**FRs covered:** FR-50, FR-51, FR-52 (PRD §6, post-v1) · reuses AR-5 (provider seam), FR-38/39 (catalog fetch), FR-41/42 (add preview)

### Epic 8: Multi-user Readiness — _Post-v1.0.0, demand-driven_
Everything that is correct while `AUTH_ALLOWED_EMAIL` is one address but breaks the moment a second user exists: real auth (registration/invite, drop the single-email gate), and turning the global facts (`ps_plus_extra` flag, PSN region, the cron's single-user refresh) into per-user data. The backlog is `publication-blockers.md` (B1–B6) — this epic is its home. **Sequenced after Epic 7 and only when a second user is actually wanted** — no plumbing is front-loaded; nothing here matters under single-user auth.
**Blockers covered:** B1a–B6 (see `publication-blockers.md`) · Epic 6 retro action item 4 · decomposed into Stories 8.0–8.5 (2026-07-13)

### Epic 9: The PSN Record — Trophies (and maybe Wishlist) — _v1.x_
Luca's trophy progress lands in Press Start: per-game completion % and a PSNProfiles-style letter grade, plus a one-off backfill that recovers the platinum/completion dates PSN knows and the app doesn't. Opens with the S-1 spike, which also decides whether PSN wishlist sync ships in this epic or slips to Future.
**VRs covered:** VR-1, VR-2, VR-3, VR-4 (conditional on VR-1's outcome) · reuses AR-5 (`PsnProvider`), AR-11 (write-once dates), AR-15 (bulk work chunked)

### Epic 10: Know Before You Play — Scores & Expiry Warnings — _v1.x, after Epic 7_
Three decision-support signals on the card: what the world thinks of a game (IGDB critic + user scores), how long it takes (hours to beat the story, hours to 100%), and whether a backlog game is about to leave PS+ Extra. All stored and refreshed on a schedule — never fetched on render.
**VRs covered:** VR-5, VR-6, VR-8 · reuses AR-5 (`IgdbProvider`), AR-6 (nothing external on render), AR-15 (bulk work chunked), AR-23 (per-region catalog)
**Sequencing:** VR-6 diffs the `ps_plus_catalog` snapshot Story 7.1 builds, so this epic follows Epic 7. Stories 10.1 (scores) and 10.3 (time to beat) carry no such dependency and are pullable ahead alone; 10.3 rides 10.1's refresh job, so it follows 10.1.

---

## Epic 1: Foundation & the Seeded Shelf

Stand up the walking skeleton (scaffold, CI/CD, D1 schema, pure domain core, auth + user-scoping, design-token system and app shell), run the one-time out-of-band seed import, and deliver the read-only cover-forward shelf populated with Luca's real library. Ties to success metric #1 — the library can be trusted, every game present without manual entry. The card flip-to-edit and status changes are deliberately deferred to Epic 2; Epic 1's shelf is read-only.

### Story 1.1: Deployable project scaffold & CI/CD

As Luca (developer/owner),
I want a Cloudflare Worker serving a React SPA and JSON API, wired to D1 with the full toolchain and an automated deploy pipeline,
So that every later story ships on a proven, one-command path to production.

**Acceptance Criteria:**

**Given** a fresh clone
**When** I run the documented dev command
**Then** the Vite React SPA and the Hono Worker run together locally against a local D1 (wrangler dev / miniflare)
**And** a `/api/health` route returns 200 (AR-1, AR-2)

**Given** a push or pull request
**When** CI runs
**Then** Biome (lint+format), `tsc`, and Vitest via `@cloudflare/vitest-pool-workers` all execute and must pass (AR-23, AR-26)

**Given** the toolchain
**When** `package.json` is created
**Then** it exposes `lint` (Biome), `typecheck` (`tsc --noEmit`), and `test` (Vitest workers pool) scripts
**And** CI, the local dev flow, and the bmad-loop `[verify]` gate all invoke these **same** scripts, so local / CI / loop checks can never drift (AR-23, AR-26)

**Given** a merge to `main`
**When** CD runs
**Then** `wrangler d1 migrations apply` runs before `wrangler deploy`
**And** the Worker never migrates itself at startup (AR-16, AR-21)

**Given** the layer namespaces `core/ services/ repositories/ providers/ routes/`
**When** the scaffold is created
**Then** the source tree matches the architecture scaffold
**And** `core/` contains no imports that perform I/O (AR-3)

**Given** secrets (IGDB/Twitch, initial PSN cookie) and the D1 database file
**When** the project is configured
**Then** secrets are provided via Wrangler secrets
**And** the D1 file, `.env`, and `node_modules/` are gitignored and never committed (AR-24)

### Story 1.2: Domain core — state computation & title normalization

As Luca,
I want the state model and matching rules implemented as pure, unit-tested functions in `core/`,
So that every surface computes effective state, derived states, and title matches identically.

**Acceptance Criteria:**

**Given** a game's play status and milestone dates
**When** effective state is computed
**Then** a single function returns play status if set, else "Platinum achieved" if `platinum_on`, else "Story completed" if `completed_on` (FR-8, AR-7)

**Given** ownership, release date, and PS+ Extra membership
**When** derived states are computed
**Then** Released (real date ≤ today; TBA/missing = false), Wishlisted (= not owned), and Playable-now (= (owned OR in PS+ Extra) AND released) are returned and never persisted (FR-12, FR-13, FR-14, AR-8)

**Given** raw titles with trademark glyphs, leading articles, edition suffixes, or case/whitespace variance
**When** normalized
**Then** a single normalizer yields the shared match key
**And** collapses PS4/PS5 to one PS5 key (FR-27, AR-9)

**Given** a candidate status/milestone edit
**When** the invariant is checked
**Then** a pure predicate reports whether it would leave neither a play status nor a milestone (enforcement wired in Epic 2) (FR-3 predicate, AR-12)

**Given** all core functions
**When** tests run
**Then** they execute with no network or database and cover the rules above (AR-3)

### Story 1.3: Sign in with a magic link (auth & user scoping)

As Luca,
I want to sign in via a better-auth magic link and have every tracking row scoped to my user id,
So that the app is mine today and the publish door stays open without a data rewrite.

**Acceptance Criteria:**

**Given** the app on a cold, unauthenticated load
**When** I open it
**Then** I see the magic-link login screen and no shelf (FR-47)

**Given** I enter my email
**When** I follow the emailed magic link
**Then** a session is established
**And** I land on the shelf (FR-47)

**Given** an authenticated session
**When** any tracking data is written or read
**Then** it carries and filters by my `user_id` (FR-48, AR-13, AR-14)

**Given** the USER entity
**When** auth is set up
**Then** only the tables auth needs are created
**And** no sharing, roles, or tenancy is built (AR-13)

### Story 1.4: Catalog & tracking data model + repositories

As Luca,
I want the game/genre/link/tracking entities and a repository layer,
So that seed, shelf, and later ingest jobs persist and read data through one seam.

**Acceptance Criteria:**

**Given** the Drizzle schema
**When** migrations are generated
**Then** `GAME` (shared facts: title, `title_normalized`, release_date, cover_url, store_url, ps_plus_extra per region, `unenriched`), `GAME_TRACKING` (PK `(user_id, game_id)`: play_status nullable, milestone/lifecycle dates, owned, ownership_type), `GENRE`, `GAME_GENRE`, `EXTERNAL_LINK`, and `IMPORT_STRAGGLER` exist (AR-15, AR-16, AR-17, AR-19, AR-22)

**Given** `title_normalized`
**When** the schema is defined
**Then** it carries no uniqueness constraint (AR-18)

**Given** a game
**When** external links are stored
**Then** multiple `EXTERNAL_LINK` rows per (game, source) are allowed (PS4 + PS5 → one GAME) (AR-20)

**Given** any data access
**When** services or routes need data
**Then** they go through `repositories/` (Drizzle) only — no raw D1 queries elsewhere (AR-4)

**Given** only Epic 1's needs
**When** tables are created
**Then** `SETTING` and other later-epic tables are NOT created yet (entity-as-needed)

### Story 1.5: Design system & responsive PWA app shell

As Luca,
I want the PRESS START visual system and an installable, responsive app shell with the shared feedback primitives,
So that the shelf and every later surface render in one consistent, glance-and-go identity.

**Acceptance Criteria:**

**Given** the design tokens
**When** the shell is built
**Then** the dark-only palette, spacing scale (4/8/12/16/24/32), radii (8/12/18/999), and the four type faces (Orbitron/Rajdhani/Inter/JetBrains Mono) are implemented as reusable tokens (UX-DR1, UX-DR2)

**Given** the header and background
**When** the app loads
**Then** the PRESS START wordmark + tagline render over the void Tron-grid + blue→magenta wash
**And** no PlayStation/Sony marks appear in branding (UX-DR3, UX-DR4)

**Given** the app in a browser
**When** installed
**Then** it installs as a PWA with a home-screen icon
**And** adapts responsively across the phone↔desktop deltas (FR-46, UX-DR26, UX-DR27)

**Given** the feedback channels
**When** the shell is built
**Then** reusable Attention-banner, Toast, and Skeleton primitives exist (fed by later stories)
**And** a polite live region is available for announcements (UX-DR11, UX-DR12, UX-DR17, UX-DR21)

**Given** elevation and depth
**When** surfaces render
**Then** depth comes from glow and tone (not drop-shadow): cards on `surface`, modals/popovers on `surface-raised` with a cyan glow-ring, and the Playing card carries a soft magenta bloom (UX-DR5)

**Given** the palette and text tokens
**When** any text or pill renders
**Then** contrast meets WCAG AA (≥4.5:1 body, ≥3:1 large/UI), the muted tone is floored, and status pills use translucent-tint-with-light-ink or dark-ink-on-neon — never white-on-neon (UX-DR22)

**Given** compact controls (status pill, owned toggle, flag icons, popover rows, sheet chips)
**When** they render
**Then** each carries a ≥44×44 touch/hit area via padding or an invisible expander, decoupled from its visual size (UX-DR25)

**Given** `prefers-reduced-motion` is set
**When** the app renders
**Then** flip, glow pulses, and shimmer reduce to static/cross-fade equivalents (UX-DR24)

**Given** keyboard navigation
**When** an element is focused
**Then** a distinct, always-on focus outline is visible (not glow-intensity alone) (UX-DR19, UX-DR20)

### Story 1.6: Seed import (out-of-band)

As Luca,
I want a one-time out-of-band script that loads my Notion and PS exports and enriches every game from IGDB,
So that my real, trustworthy library exists in the database from day one.

**Acceptance Criteria:**

**Given** the Notion CSV and PS library exports
**When** the seed script runs out-of-band
**Then** it writes games/tracking/genres/links to D1 via the D1 HTTP API using the shared Drizzle schema, with no UI surface (FR-26, AR-20)

**Given** the PS export
**When** importing
**Then** membership-sourced (PS+ claim) entries are excluded — never created, never Owned
**And** the count skipped is reported (FR-26, AR-10)

**Given** the two sources and IGDB
**When** reconciling titles
**Then** matching uses the core normalizer, PS4/PS5 collapse to one PS5
**And** every game is enriched (cover, genres, release date) with genres taken exclusively from IGDB (FR-27, FR-23, AR-9)

**Given** Notion rows
**When** mapping status
**Then** `Completed`→null + `completed_on` (from Date finished), `Up next!`→Up next, `Not released`→Not started, `Not started`/`Playing`/`Paused` map 1:1, `Date started`→`started_on`, Rating not imported (FR-30)

**Given** the CSV `Owned` column
**When** importing
**Then** `Owned: Yes` rows import as owned (physical by default)
**And** only known dates are stamped — no `bought_on`/`wishlisted_on` fabricated (FR-31, FR-32, FR-44 seed)

**Given** any row the mapping can't place, or any unmatched/ambiguous title
**When** importing
**Then** it lands in the stragglers list, never guessed (FR-28 produce, FR-30, AR-17)

### Story 1.7: The read-only shelf

As Luca,
I want to open the app and see my whole library as a cover-forward, backlog-first shelf I can scroll and search,
So that "what's my gaming life right now?" and "did I ever finish that?" are answered at a glance.

**Acceptance Criteria:**

**Given** seeded games
**When** the shelf loads
**Then** a cover-forward responsive grid renders cards showing cover art, name (Orbitron, ellipsis), effective-state pill, owned indicator, and flag icons (PS+ Extra, release-state, milestone badge)
**And** genres show on desktop only (FR-15, FR-8, UX-DR6, UX-DR26)

**Given** the default view with no filters active
**When** the shelf renders
**Then** only live-play-status games show (Completed/Platinum/Dropped hidden)
**And** they are ordered Playing→Paused→Up next→Not started, owned-then-alphabetical within each group (FR-17, FR-18, FR-4 hide)

**Given** a large library
**When** I scroll
**Then** the shelf renders progressively (infinite scroll) over the **effective-state-sorted set**, where ordering derives from the single `core/` effective-state function (AD-7) — never a raw `ORDER BY play_status`
**And** at v1's single-user ~344-game scale the sorted set is materialized in the Worker/client rather than keyset-paged in SQL (progressive rendering, not a cursor) (FR-19, FR-8, AD-7)

**Given** the persistent search bar
**When** I type a title
**Then** a **dedicated whole-library query** — separate from the filtered-shelf query, not a client filter over the paginated shelf — matches every game, ignoring active filters and hidden states
**And** existing matches are listed (FR-19, UX-DR16)

**Given** first load or an empty library
**When** the shelf renders
**Then** cover-shaped skeletons show while pending
**And** an empty library shows `INSERT GAMES` with "Sync library" / "＋ Add a game" (UX-DR17, UX-DR18)

**Given** a read/render path
**When** the shelf renders
**Then** covers and store links come only from persisted data — no third-party fetch on a read path (NFR-3, AR-6)

**Given** the shelf grid
**When** navigating by keyboard
**Then** it is a focusable grid with arrow traversal in reading order (UX-DR19)

---

## Epic 2: Track Your Games

From the shelf, Luca changes play status in a tap and, via the flip-to-detail view, logs Story/Platinum milestones (confirm-gated), edits ownership flag + type, edits genres, and corrects lifecycle dates — with the completion invariant enforced and lifecycle dates auto-recorded write-once. Ties to success metric #2: logging a status change takes seconds, not a Notion-editing session.

### Story 2.1: Change play status from the shelf

As Luca,
I want to tap a card's status pill and set its play status instantly,
So that logging a status change takes seconds, not a Notion session.

**Acceptance Criteria:**

**Given** a card
**When** I tap its status pill
**Then** a popover opens with the 5 play statuses
**And** selecting one applies instantly (no confirm) and a toast confirms (FR-1 set, UX-DR7, UX-DR8, UX-DR12)

**Given** the first transition to `Playing`
**When** the status is applied
**Then** `started_on` is stamped once (write-once), only while no completion milestone exists (FR-44, FR-45, AR-11)

**Given** I set `Dropped`
**When** the status is applied
**Then** the toast carries a one-tap UNDO
**And** the card leaves the default shelf (FR-4, UX-DR12)

**Given** a status change
**When** it is applied
**Then** effective state, ordering, and pill label update everywhere from the single core function (FR-8, AR-7)

**Given** the popover
**When** it is open
**Then** it has menu ARIA semantics, arrow-key traversal, and Escape returns focus to the pill (UX-DR8, UX-DR19)

### Story 2.2: Log completion milestones (confirm-gated)

As Luca,
I want to log Story-completed / Platinum from the status popover behind a confirmation,
So that the record is trustworthy and fat-finger-proof.

**Acceptance Criteria:**

**Given** the status popover
**When** I tap a milestone row
**Then** a confirm modal (silver) gates it before anything is written (FR-7, UX-DR14)

**Given** I confirm
**When** the milestone is logged
**Then** `completed_on`/`platinum_on` is written
**And** play status auto-clears to null via the single core milestone-write reconciliation function (FR-2, FR-5, AR-13, AR-21) — _amended 2026-07-09: only a platinum auto-clears; a story completion leaves the status untouched_

**Given** a milestone that already has a date
**When** I log it again
**Then** nothing changes — the first achievement stands (FR-6)

**Given** a logged milestone
**When** the card renders
**Then** a permanent silver badge appears on the cover regardless of later play status
**And** a toast confirms (FR-5, UX-DR6)

### Story 2.3: Flip a card to its detail view

As Luca,
I want to tap a cover to flip into an editable detail panel showing everything about the game,
So that I can read and correct one game in one place.

**Acceptance Criteria:**

**Given** a card
**When** I tap a non-control area of the cover
**Then** it flips-then-grows into the detail panel (centered ~760px desktop / full-screen mobile) (FR-16, UX-DR15)

**Given** the panel
**When** it opens
**Then** it shows play status (segmented control), milestone rows + dates, lifecycle dates, genres, and ownership flag + type — reusing the 2.1/2.2 status and milestone logic (FR-16)

**Given** a wishlisted game
**When** the panel opens
**Then** it shows a "View on PS Store" link (product URL when known, store search-by-title fallback) (FR-16)

**Given** any edit that would leave neither a play status nor a milestone
**When** I attempt it
**Then** the panel refuses it (clearing the last milestone requires setting a status first) (FR-3, AR-12)

**Given** the panel is open
**When** I close it
**Then** it is a focus-trapped dialog that returns focus to the originating card (UX-DR19)

### Story 2.4: Edit ownership and lifecycle dates in detail

As Luca,
I want to set a game owned (physical disc) and correct its lifecycle dates in the detail view,
So that ownership the PS API can't see and any date slips are fixable.

**Acceptance Criteria:**

**Given** the detail view or the card owned toggle
**When** I mark a game owned
**Then** `owned` flips true, ownership type defaults to physical, `bought_on` is stamped once
**And** un-owning carries a toast UNDO (FR-9 manual, FR-11, FR-44, UX-DR12)

**Given** ownership type
**When** I edit it
**Then** I can switch digital/physical (FR-11)

**Given** a lifecycle date
**When** I edit it in detail
**Then** the manual correction is saved (a deliberate override of the write-once automatic value) (FR-45)

**Given** automatic flows (sync, status change, replay)
**When** they run
**Then** they never overwrite an already-recorded date (FR-45, AR-11)

### Story 2.5: Edit genres in detail

As Luca,
I want to fix a game's genres in the detail view,
So that a bad auto-fill from import doesn't stick.

**Acceptance Criteria:**

**Given** the detail view
**When** I add or remove genres
**Then** the game's genre set updates (many-to-many) (FR-25)

**Given** I add a genre not yet in the vocabulary
**When** it is saved
**Then** the genre row is auto-created (FR-24)

**Given** genre editing
**When** the detail view renders
**Then** no merge/rename tool is offered (out of v1 scope) (FR-25)

---

## Epic 2.5: Playwright Foundation — Trust Every Click

Added 2026-07-09 from the Epic 2 retrospective (action items 1–3). Closes the epic's named verification gap: jsdom-only UI testing (popover anchoring, portal layering, breakpoints, hit areas, focus traps untested by a real layout engine). A Playwright e2e tier drives the real app in a real browser, backfills every Epic 1+2 AC with a matching UI flow, and wires the standing every-UI-AC-ships-with-an-e2e-test rule into `bmad-dev-auto`. Must complete before Epic 3.

### Story 2.5.1: Playwright framework & auth smoke test

As Luca,
I want a Playwright e2e tier that drives the real app in a real browser and signs in via the console-captured magic link,
So that every later e2e test has a proven, email-free path through auth.

**Acceptance Criteria:**

**Given** a fresh clone
**When** I run the documented e2e command
**Then** Playwright starts the real app (real Worker + local D1, real browser) and runs the suite (TR-1)

**Given** the magic-link auth flow
**When** an e2e test signs in
**Then** it captures the magic link from the console email provider's output and follows it — no real email is sent by any test run (TR-1)

**Given** e2e tests need known data
**When** the suite runs
**Then** it runs against a seeded local D1 fixture, deterministic and resettable between runs (TR-1)

**Given** a push or pull request
**When** CI runs
**Then** the Playwright suite executes as a required gate alongside Biome/`tsc`/Vitest, invoked via the same `package.json` script locally and in CI (AR-23)

**Given** the smoke test
**When** it runs
**Then** it proves the full path: open app → magic-link sign-in → shelf renders with seeded games (TR-1)

### Story 2.5.2: Backfill Epic 1 e2e flows

As Luca,
I want one e2e test per Epic 1 acceptance criterion that has a matching UI user flow,
So that the seeded shelf's behavior is pinned by a real layout engine, not jsdom.

**Acceptance Criteria:**

**Given** Epic 1's stories (1.3 auth, 1.5 shell, 1.7 shelf)
**When** the backfill is complete
**Then** every AC with a matching UI user flow has a Playwright test (login gate, shelf render/card content, default visible set + ordering, infinite scroll, whole-library search, skeleton + empty states, keyboard grid traversal, focus outline) (TR-2)

**Given** an Epic 1 AC with no UI user flow (build/CI/schema/seed-script ACs)
**When** the backfill is complete
**Then** it is listed as skipped with a one-line reason in the suite's coverage note (TR-2)

**Given** the jsdom blind spots the retro named
**When** Epic 1 flows are tested
**Then** real-layout concerns (breakpoints/responsive deltas, hit areas) are exercised in at least one viewport pair (phone + desktop) (TR-2)

### Story 2.5.3: Backfill Epic 2 e2e flows

As Luca,
I want one e2e test per Epic 2 acceptance criterion that has a matching UI user flow,
So that the tracking write paths and every dialog's focus/ARIA behavior are regression-pinned.

**Acceptance Criteria:**

**Given** Epic 2's stories (2.1–2.5)
**When** the backfill is complete
**Then** every AC with a matching UI user flow has a Playwright test (status popover incl. viewport flip, Dropped UNDO toast, milestone confirm + badge, card flip → detail panel, invariant refusal, ownership toggle + UNDO, lifecycle date edit, genre edit) (TR-2)

**Given** the dialog regression class from the retro (Escape scope, focus trap, portal layering, popover anchoring)
**When** dialog flows are tested
**Then** each dialog surface (popover, confirm modal, detail panel) has focus-trap and Escape/focus-return assertions (TR-2)

**Given** an Epic 2 AC unreachable in the UI today (e.g. flows needing Epic 3 reveal pills)
**When** the backfill is complete
**Then** it is listed as skipped with a one-line reason in the coverage note (TR-2)

### Story 2.5.4: Standing rule — every UI AC ships with a Playwright test

As Luca,
I want the e2e rule wired into the dev automation as a persistent fact,
So that the suite grows with every future story instead of rotting.

**Acceptance Criteria:**

**Given** `_bmad/custom/bmad-dev-auto.toml`
**When** the rule is wired
**Then** a persistent fact states: every AC with a matching UI user flow ships with a Playwright test (same mechanism as the hazard-test rule) (TR-3)

**Given** the next story run through `bmad-dev-auto`
**When** its session starts
**Then** the fact loads and binds the dev agent (TR-3)

---

## Epic 3: Filter & Focus the Backlog

Luca narrows the shelf with State/Genre multiselect dropdowns, Flag pills, and reveal pills — OR within a group, AND across groups — read back by a live plain-English summary sentence, so filtering the backlog beats what Notion's views offered (success metric #4).

> **Build/verify note:** No seed-imported game is ever `Dropped` — FR-30 maps Notion statuses only to live statuses or null — so the `Dropped` reveal pill correctly shows an empty set until Epic 2 (Story 2.1) sets a game to `Dropped`. This is expected, not a defect. If Epic 3 is verified/demoed before Epic 2, seed a manual `Dropped` fixture (or accept the empty reveal).

### Story 3.1: Filter the shelf by State and Genre

As Luca,
I want State and Genre multiselect filters,
So that I can narrow the shelf to the statuses and genres I care about.

**Acceptance Criteria:**

**Given** the filter row
**When** I open the State group
**Then** it is a multiselect of live statuses (Not started/Up next/Playing/Paused)
**And** Genre is a multiselect of the vocabulary (FR-20)

**Given** selections across groups
**When** the shelf filters
**Then** it is OR within a group and AND across groups (a State pick AND a Genre pick) (FR-20)

**Given** nothing selected in the State group
**When** the shelf renders
**Then** it shows the default visible set
**And** the moment anything in the state group is selected, it shows exactly the selected states (FR-21)

**Given** an active filter
**When** it is applied
**Then** its pill/entry is visually highlighted (toggle-on) (FR-22)

### Story 3.2: Flag pills and state-reveal pills

As Luca,
I want Flag pills and hidden-state reveal pills,
So that I can view owned/wishlisted/playable subsets and pull completed or dropped games back in.

**Acceptance Criteria:**

**Given** the Flags group
**When** the filter row renders
**Then** `Owned`, `Wishlisted`, `Released`, `Playable now` are individual pills, each its own AND group (FR-20)

**Given** the reveal pills (`Story completed`, `Platinum achieved`, `Dropped`)
**When** I toggle one
**Then** it ORs that state into the visible set (extends the state group) (FR-4, FR-20, FR-21)

**Given** pill shape
**When** the row renders
**Then** solid pills narrow (AND) and dashed pills reveal a hidden state — encoding behavior visually (UX-DR9)

**Given** an active pill
**When** it is toggled on
**Then** it glows/highlights (FR-22)

**Given** a revealed hidden-state card whose play status was auto-cleared by a milestone (previous status null)
**When** I set it to `Dropped` and the toast shows
**Then** UNDO restores the cleared (null) status through the milestone-invariant write path (FR-2, FR-3; deferred-work: 2.1 "no UNDO when previous status null" — reveal pills make this reachable)

**Given** a detail panel open on an already-hidden game (Dropped or milestone-only, reached via reveal pill or search)
**When** a milestone write completes without changing the card's visibility
**Then** the panel stays open — auto-close fires only on a visible→hidden transition (FR-4, FR-17; deferred-work: platinum-only auto-hide "onHidden false-close")

### Story 3.3: Live filter summary, empty state & responsive filters

As Luca,
I want a plain-English readback of my active filter and a mobile filter sheet,
So that the model never needs decoding and filtering works under the thumb.

**Acceptance Criteria:**

**Given** active filters
**When** the shelf renders
**Then** a live summary sentence narrates them, with "or"/"and" as literal words (OR-connectors in glow-cyan, AND-connectors in heat-magenta, color redundant to the words) (FR-20, UX-DR9, UX-DR23)

**Given** filters that match nothing
**When** the shelf renders
**Then** a `NO MATCH` empty state with "Clear filters" shows (UX-DR18)

**Given** the phone surface
**When** filters are shown
**Then** they collapse to a single Filters button + count badge opening a grouped bottom sheet with a "Show N games" action
**And** desktop shows the full row inline with the summary sentence (UX-DR26)

### Story 3.4: Focus & interaction hardening (deferred-work sweep)

As Luca (keyboard/screen-reader user),
I want focus to survive shelf re-renders and mutations to be race-safe,
So that filtering and tracking never silently drop me to the top of the document or interleave writes.

Bundles the open focus/interaction deferred-work items — placed in Epic 3 because filters and reveal pills churn the visible set constantly, turning each from a corner case into a daily path. Each AC cross-references its `deferred-work.md` entry.

**Acceptance Criteria:**

**Given** a card holding keyboard focus
**When** a viewport resize changes the auto-fill column count and re-chunks the ARIA rows
**Then** focus stays on that card (no unmount-to-body) (UX a11y floor; deferred-work: spec-dw-shelf-grid-aria-row-regrouping follow-up)

**Given** the session gate swaps the authenticated shell for the login screen (401 re-auth or sign-out)
**When** `<Login />` mounts
**Then** focus moves into the login form and the change is announced to assistive tech (deferred-work: spec-dw-3-central-401-reauth-redirect follow-up)

**Given** a card leaving the visible set after a write (e.g. marked `Dropped`)
**When** the shelf refetch unmounts it
**Then** focus lands on a deliberate target (neighbor card or shelf container) from which the toast's UNDO is reachable by keyboard (deferred-work: spec-2-1 focus item)

**Given** an open detail panel
**When** a write's shelf refetch re-chunks the grid rows
**Then** the panel stays open (open-panel game id hoisted to Shelf level, not Card) (deferred-work: spec-2-5-3 item; also converts the epic2-detail.spec.ts workaround assertions back to direct ones)

**Given** a pending tracking mutation on a game
**When** a toast UNDO for that game is activated
**Then** the UNDO respects the same in-flight guard as every other entry point (ref-backed, not render-scoped) (deferred-work: spec-2-4 UNDO-guard item)

### Story 3.5: Reveal-pill exclusive mode

As Luca (backlog reviewer),
I want a dotted reveal pill to show only the matching hidden games,
So that Completed/Platinum/Dropped games are immediately visible instead of appended behind the infinite scroll.

Semantics change decided at the Epic 3 retro (2026-07-10, Significant Discovery — see epic-3-retro-2026-07-10.md): additive reveals push hidden games to the end of the FR-18 order, behind infinite scroll. Requires FR-4/FR-20 amendment in the PRD before implementation (John). Bundles three assigned deferred-work items touching the same surfaces.

**Acceptance Criteria:**

**Given** any dotted reveal pill selected
**When** the shelf renders
**Then** the visible set contains only games in the selected hidden state(s) — the State group is replaced entirely (state pills clear) (FR-4, FR-20 as amended)

**Given** two or more dotted pills selected
**Then** they OR among themselves (Completed + Platinum = either)

**Given** an active exclusive reveal view
**When** Genre or Flag selections are also active
**Then** they still AND with it (e.g. Completed + RPG + Owned → only completed, owned RPGs)

**Given** an active exclusive reveal view
**Then** the summary sentence states it literally ("Showing Completed games.") — the additive-semantics live-status enumeration is removed (FR-21)

**Given** an exclusive reveal view with zero matching games
**When** ShelfGrid unmounts for the empty state
**Then** focus lands on a deliberate target (Clear filters or the empty-state heading), never `<body>` (deferred-work: spec-3-4 last-visible-card boundary entry)

**Given** the three modal surfaces (ConfirmDialog, DetailPanel, FilterSheet)
**Then** they share one extracted focus-trap implementation (deferred-work: spec-3-3 trap-triplication entry)

**Given** the e2e suites rewritten for the new reveal contract
**Then** epic2-detail.spec.ts:127 and epic2-tracking.spec.ts:165 also get the loadAllPages fold-position fix (deferred-work: spec-3-1 parallel-flake entry)

### Story 3.6: Write-path hardening (pre-sync)

As Luca (soon syncing from PSN),
I want every client write path safe against stale reads and stale intent,
So that Epic 4's automated sync writes cannot render stale panels, be clobbered by old UNDO toasts, or kill open menus.

Bundles the three write-path deferred-work items assigned at the Epic 3 retro triage. Must land before Story 4.2 introduces sync as a new write source.

**Acceptance Criteria:**

**Given** any tracking write settles
**Then** both `['shelf']` and `['shelf-search']` query keys are invalidated — a detail panel opened from search never renders stale (deferred-work: spec-3-2 search-staleness entry)

**Given** a toast UNDO activated after a newer write on the same game has settled
**Then** the stale UNDO cannot overwrite the newer intent (latest-write token, or stale undo toasts dismissed on newer writes) (deferred-work: spec-3-4 stale-UNDO entry)

**Given** an open status-popover menu
**When** a refetch re-chunks the grid and remounts its Card
**Then** the menu survives (open-state hoisted like the 3.4 detail-panel fix) AND the `openStatusMenu` retry loop in epic2-tracking.spec.ts is removed in the same change (deferred-work: spec-3-4 popover-remount entry)

---

## Epic 4: Fill the Library from PlayStation (Sync)

One button appends new purchases from the PlayStation library: append-only to user-entered data, membership claims skipped, covers and PS Store URLs captured at sync, an expired cookie surfaced with refresh instructions, and every run ending in a visible summary. Ties to success metric #1, ongoing — the library fills itself. This epic creates the `SETTING` table (cookie) and the FAB drawer shell (Sync is its first item), need-scoped.

### Story 4.1: PSN provider & session-cookie settings

As Luca,
I want the PlayStation data access encapsulated in a provider with an editable session cookie,
So that sync has a single, swappable auth path and an expired cookie tells me what to do.

**Acceptance Criteria:**

**Given** all PSN access
**When** the app queries PlayStation
**Then** it goes through a `PsnProvider` adapter using the persisted `getPurchasedGameList` query
**And** the auth mechanism lives entirely inside the adapter (AR-5)

**Given** the `SETTING` table
**When** the cookie is configured
**Then** the live `pdccws_p` cookie is stored there, editable from a settings surface, and read fresh per call (initial value may seed from a Wrangler secret) (FR-36, AR-24)

**Given** a 401/403 response
**When** the provider is called
**Then** the app surfaces the cookie-refresh instructions in the attention banner
**And** does not retry (FR-36, NFR-4, AR-14, UX-DR11)

### Story 4.2: Sync the PlayStation library (append-only)

As Luca,
I want a button that appends new purchases from my PS library without touching anything I've entered,
So that the library fills itself.

**Acceptance Criteria:**

**Given** the FAB drawer (the shell is created by whichever of Epic 4 / Epic 6 is built first; when Epic 4 lands first it stands up the shell carrying its Sync item, and later epics add only their own items — need-scoped)
**When** I tap Sync
**Then** an in-Worker incremental sync runs with a spinner (FR-33, UX-DR10)

**Given** purchase-sourced entries
**When** syncing
**Then** new games are created (defaults Owned/digital/Not started, `bought_on` stamped)
**And** existing games may have `Owned` flipped false→true (stamping `bought_on`, type digital) (FR-9 sync, FR-10, FR-11 infer, FR-33)

**Given** any existing game
**When** syncing
**Then** sync never deletes it, never sets `Owned` false, and never touches status/milestones/dates/genres (FR-33, AR-10)

**Given** membership-sourced (PS+ claim) entries
**When** syncing
**Then** they are skipped — never created, never Owned
**And** a claim matching a tracked game leaves it untouched (FR-33, AR-10)

**Given** matching
**When** syncing
**Then** stored external-ID/alias links are tried first, then normalized title, with PS4/PS5 collapse
**And** an external id resolving to a different game than the title match is flagged, never silently merged (FR-34, AR-9, AR-20)

**Given** each synced game
**When** its data is captured
**Then** cover art and the PS Store product URL are persisted (nothing fetched on render) (FR-35, AR-6)

### Story 4.3: Sync summary & needs-attention

As Luca,
I want every sync to end in a clear summary,
So that I can trust what changed and act on anything that needs me.

**Acceptance Criteria:**

**Given** a completed sync
**When** it resolves
**Then** a summary modal reports games added, `Owned` flips, membership entries skipped, and anything needing attention (failed lookups, conflicts) (FR-37, UX-DR13)

**Given** the summary has needs-action items
**When** the modal is shown
**Then** they also seed the persistent attention banner so they survive dismissing the modal (AR-14, AR-22, UX-DR11)

**Given** the summary
**When** a needs-attention item is present
**Then** it offers a button jumping to the problem (FR-37, UX-DR13)

---

## Epic 5: Know What's Playable — PS+ Extra Awareness

A button and a monthly Cron Trigger flag which non-owned games are in the user's (per-region) PS+ Extra catalog, lighting up the Playable-now signal and a "PS+ catalog as of {date}" timestamp — closing the pre-purchase blind spot of buying a game already covered by the subscription (success metric #3). Builds on the `PsnProvider` + `SETTING` table from Epic 4 (natural build order 4 → 5).

### Story 5.1: Region setting & PS+ Extra check (button)

As Luca,
I want a button that flags which non-owned games are in my region's PS+ Extra catalog,
So that I can see what I can already play.

**Acceptance Criteria:**

**Given** the account region
**When** the check runs
**Then** the region is persisted in `SETTING` (seeded from config or derived from PSN on first sync) and read by the check (AR-18, AR-23)

**Given** the FAB drawer's "Check PS+ Extra" item
**When** I tap it
**Then** the check runs against my region's catalog via `PsnProvider` with a spinner (FR-38, FR-39, AR-5, UX-DR10)

**Given** the check result
**When** flags are applied
**Then** it sets/clears the PS+ Extra flag on tracked, non-owned games only, updating flags in both directions
**And** catalog games are never auto-added to the library (FR-38, AR-10)

**Given** a game that becomes owned
**When** the shelf renders
**Then** its PS+ Extra flag is ignored and hidden (FR-38)

**Given** stored PS+ Extra membership
**When** derived state is computed
**Then** Playable now (Epic 1 core) returns true for in-catalog released games, lighting up the card flag and filter pill (FR-14 realized, AR-8)

**Given** the check completes
**When** it resolves
**Then** a summary modal reports the flag changes (UX-DR13)

### Story 5.2: Scheduled monthly refresh (Cron Trigger)

As Luca,
I want the PS+ Extra check to also run itself monthly,
So that the catalog stays current without me remembering.

**Acceptance Criteria:**

**Given** a Cloudflare Cron Trigger aligned to Sony's monthly catalog update
**When** it fires
**Then** it runs the same region-scoped check within the stateless free tier (FR-39, NFR-2, AR-1, AR-23)

**Given** the cron and the button
**When** either runs
**Then** both read the same stored region (no divergence) (AR-18, AR-23)

**Given** a failed scheduled refresh
**When** the app is next opened
**Then** a notice surfaces in the attention banner (FR-40, NFR-4, AR-14, UX-DR11)

### Story 5.3: "PS+ catalog as of {date}" timestamp

As Luca,
I want the shelf to show when the PS+ catalog was last refreshed,
So that I know how much to trust the Playable-now signal.

**Acceptance Criteria:**

**Given** a successful refresh
**When** it completes
**Then** its timestamp is persisted (in `SETTING`) and shown in the header as "PS+ catalog as of {date}" (FR-40, AR-18)

**Given** the surface
**When** the header renders
**Then** the readout is full on desktop and compact on mobile (UX-DR26)

---

## Epic 6: Add at the Moment of Discovery + Chores

Luca types a name and adds a game from the games DB — or a name-only fallback — in the seconds the discovery moment lasts; resolves import stragglers by search; exports the full library to CSV; and manages settings. Ties to Flow 1 (the wishlist moment) plus data-safety insurance. The `IgdbProvider` adapter is built here.

> **Dependency note:** This epic's *value* stories (6.1 add-by-name, 6.2 stragglers) depend only on Epic 1's search bar and shelf. The *chores* story (6.3) uses the **FAB drawer shell, which is shared with Epic 4** — whichever of Epic 4 / Epic 6 is built first creates the shell; the other adds its own drawer items (need-scoped). If Epic 6 lands before Epic 4, Story 6.3 stands up the shell.

### Story 6.1: Add a game by name (the wishlist moment)

As Luca,
I want to type a name and add a game from the games DB in seconds,
So that a game I spot never slips away.

**Acceptance Criteria:**

**Given** the persistent search bar
**When** I type and pick an existing library match
**Then** its detail view opens instead of creating a duplicate (FR-42, AR-9)

**Given** no library match
**When** results render
**Then** the top row is `＋ Add "<name>"`; tapping it opens a preview pre-filled from IGDB (cover, genres, release date), everything editable, nothing committed until Save (FR-41, AR-5, UX-DR16, UX-DR18)

**Given** the preview
**When** I save
**Then** the CTA names the outcome — "Add to wishlist" / "Add as owned"
**And** saving defaults to not owned (= wishlisted, `wishlisted_on` recorded), status Not started (FR-41, FR-43)

**Given** a saved game whose genres are new
**When** it is saved
**Then** the genre rows are auto-created (FR-24)

**Given** a successful add
**When** it completes
**Then** a toast confirms and the game appears on the shelf (FR-41)

### Story 6.2: Name-only fallback & straggler resolution

As Luca,
I want to still capture a game when the games DB is down and clean up unmatched imports later,
So that discovery never depends on a third party and no game is lost.

**Acceptance Criteria:**

**Given** IGDB is unreachable or lacks the title
**When** I add by name
**Then** I can save a name-only entry (an `unenriched` game, release date unknown = not released) that lands in the stragglers list (FR-41, NFR-4, AR-17)

**Given** the stragglers list (import staging rows + name-only entries)
**When** action is needed
**Then** the attention banner surfaces it and each straggler is resolvable by manual search (FR-28, AR-17, AR-22, UX-DR11)

**Given** I resolve an import straggler
**When** I match it to a game
**Then** its Notion payload (status, dates, owned flag) is carried onto the matched game (FR-28)

**Given** a manual match
**When** it is confirmed
**Then** a permanent external-ID/alias link is stored so future syncs recognize the game and never re-add it as a duplicate (FR-29, AR-9)

### Story 6.3: Chores — CSV export & settings

As Luca,
I want to export my whole library and manage app settings,
So that my data has a second copy and the app fits my hand.

**Acceptance Criteria:**

**Given** the FAB drawer (its shell is shared with Epic 4 — whichever epic is built first creates it; this epic contributes the "Export CSV", "Settings", and "About/Help" items, need-scoped)
**When** I tap "Export CSV"
**Then** the full library (games, statuses, milestones, lifecycle dates, genres, ownership) streams from D1 as a CSV download (FR-49, AR-25)

**Given** the settings surface
**When** I change FAB handedness
**Then** the FAB moves between bottom-right/bottom-left (UX-DR10)

**Given** settings
**When** it opens
**Then** I can sign out and view About/Help (FR-47 session)

> **Delivered ahead of Epic 6:** the centralized 401 re-auth redirect (DW-3) and the shelf-grid ARIA row regrouping (DW-4) shipped as deferred-work bundles and were removed from this story's ACs. Story 6.3 is scoped to CSV export and settings.

### Story 6.4: Ownership source — purchased vs claimed, and un-claim on cancel

As Luca,
I want the app to know whether I *bought* a game or only *claimed* it with PS+, and to drop my claimed games if I ever cancel,
So that "owned" always tells the truth and a lapsed subscription doesn't leave me thinking I still own games I don't.

**Context:** Epic 4's FR-9 amendment counts a PS+ claim as owned (`owned_via = 'membership'`), set automatically by sync. But a *manual* owned-toggle has no way to record "I claimed this" — it defaults to `purchase` — and the detail panel doesn't teach the difference. And the escape hatch the `owned_via` flag was designed for (drop claims when the sub ends) was never surfaced. This story closes both. Distinct from PS+ **Extra catalog** availability (Story 5.1): a catalog game you never claimed stays un-owned — this story is only about games you deliberately mark owned.

**Acceptance Criteria:**

**Given** an un-owned game that carries the PS+ Extra pill
**When** I mark it owned in the card or detail panel
**Then** a confirm asks *"Did you buy this, or claim it with PS+?"* with **[Purchased]** / **[Claimed]**, writing `owned_via = 'purchase'` or `'membership'` per my choice [FR-9 amended; DW `spec-psn-claims-count-as-owned`]

**Given** an un-owned game that is NOT in the PS+ catalog
**When** I mark it owned
**Then** no prompt — it defaults silently to `owned_via = 'purchase'` (only a PS+ game is ambiguous) [FR-9 amended]

**Given** an owned game in the detail panel
**When** it opens
**Then** the acquisition source is stated plainly — "Owned · via PS+" for a claim, "Owned · purchased" otherwise — so a subscription-bound game is never mistaken for a permanent one [FR-9 amended]

**Given** the settings surface (Story 6.3) and at least one `owned_via = 'membership'` row
**When** I tap "I cancelled PS+"
**Then** every claimed row is un-owned (reverted to not-owned, purchases untouched), a confirm names the count first, and any of those games still in the Extra catalog re-shows its PS+ pill (availability without ownership) [FR-9 amended; DW `spec-psn-claims-count-as-owned` (un-own flow)]

> Resolves the Epic 4 retro item #5 (subscription-cancel scope) and the `owned_via` manual-set gap surfaced 2026-07-11. The un-own is a reversal of ownership only; it never deletes tracking, milestones, or dates.

### Story 6.5: Free-text shelf search

As Luca,
I want to type in the search bar and filter my shelf to matching games,
So that I can find a game I already track without scrolling.

**Acceptance Criteria:**

**Given** the persistent search bar and a tracked shelf
**When** I type free text
**Then** the visible shelf filters live to games whose title substring-matches the input (normalized, case/diacritic-insensitive) — distinct from Story 6.1's add-a-new-game suggestions

**Given** an active filter that matches no tracked game
**When** results render
**Then** the shelf shows an empty state, and Story 6.1's `＋ Add "<name>"` row remains offered so a non-match still routes to adding

**Given** an active filter
**When** I clear the input
**Then** the full shelf restores

> Closes the `spec-free-text-shelf-search` deferred-work item. Today `SearchBox.tsx` is a suggestion-combobox only; the visible shelf (`Shelf.tsx`) never sees the input. Pairs with the disambiguation rule (normalized-exact-match) shared across the add/revive paths.

### Story 6.6: One picker for every IGDB match (PV-6)

As Luca,
I want to correct a wrong IGDB match **before** the game is added, from the same picker every other screen uses,
So that a bad auto-match never becomes a row I have to go rematch — and there is one picker to fix, not three.

**Acceptance Criteria:**

**Given** the add-game modal has pre-filled a preview from IGDB's auto-match
**When** the match is wrong
**Then** a "Not the right game?" affordance opens the candidate picker inline, and picking a candidate **overwrites the whole draft** (cover, genres, release date) and resets the `seeded` ref — prior edits were edits to the wrong game [VR-7]

**Given** the preview reports `available: false` (IGDB down or unset — `searchGamesForResolve` returns `[]`)
**When** the add modal renders
**Then** the affordance is hidden, never an always-empty picker [VR-7, NFR-4]

**Given** the picker is stacked inside the add modal
**When** I press Escape
**Then** the picker closes first and the add modal stays open (the trap-stacking dance `DetailPanel` already does for rematch) [VR-7]

**Given** `RematchDialog` and `StragglersDialog`'s `ResolveView` are today deliberate near-duplicates of the same picker
**When** this story lands
**Then** both are migrated onto the shared `<IgdbMatchPicker>` — no bespoke picker survives — while `resolveStraggler`, `rematchGame`, and straggler-kind handling stay page-side; only the candidate list/search UI is shared [VR-7]

**Given** the existing `RematchDialog.test.tsx` and `StragglersDialog.test.tsx` suites, which drive the picker through its "Use this match" button
**When** the migration completes
**Then** they still pass unchanged — they are the migration's safety net — and a Playwright test covers the add-modal correction path (TR-3 standing rule)

> No new endpoint, no server change: the picker reuses the existing `searchIgdb` → `GET /games/search` → `searchGamesForResolve` seam. Full scope and decisions: `implementation-artifacts/post-v1-backlog.md` (PV-6).

## Epic 7: Browse the PS+ Catalog & Add

**Status: Post-v1.0.0** — not required for the first release. The MVP (Epics 1–6) is the personal shelf + tracking + PS+ *awareness*; browsing the full catalog is a discovery enhancement that earns its way in after v1 ships. Scheduled, not scoped into the v1 milestone.

Epic 5 flags which games *you already track* are in the PS+ Extra catalog. This epic surfaces the **whole** catalog (~473 games/region) as a browsable destination so Luca can discover — and add — what the subscription covers before a title rotates out. The catalog stops being a name-only diff and becomes a stored, first-class dataset.

> **Scope:** PS+ **Extra** only, but the data model and ingest are **tier-aware** (a `tier` column defaulting to `'extra'`) so a later epic can add PS+ Premium's Classics catalog + a tier filter without a migration rewrite. Covers/genres come from the PS-store payload already fetched; IGDB enrichment happens only on add.
>
> **Dependency:** lands **after Epic 6** — Story 7.3 reuses Epic 6's add-by-name preview and `IgdbProvider`. Independent of Epics 1–5 otherwise.
>
> **Invariant preserved:** catalog games are **not** `game`/`game_tracking` rows. They live in their own `ps_plus_catalog` table and only become tracked games when explicitly added (7.3) — the "availability is not ownership" rule from Epic 5 holds.

### Story 7.0: Foundation — architecture & UX design gate

As the team,
I want the `ps_plus_catalog` data model and the catalog-destination UX designed and signed off before any 7.1–7.3 code,
So that a stored dataset, a new navigation destination, and a paged/searchable grid aren't improvised mid-build.

**Acceptance Criteria:**

**Given** Epic 7 is ready to start
**When** design begins
**Then** the architecture spine gains the `ps_plus_catalog` table (fields, region + `tier` scoping, upsert/prune ingest, its relationship to `game`/`game_tracking`, and whether the Story 5.1 flag check reads from it) — a `bmad-architecture` update, reviewed [AR-5]

**Given** the browse destination is new IA (a second place besides the shelf)
**When** UX is designed
**Then** a `bmad-ux` spec covers the catalog destination's navigation entry, the paged/virtualized grid, the genre filter + name search, card states (in-library marker, Add, Claim now), and the empty/needs-refresh state — desktop + phone [UX-DR reuse]

**Given** the shelf's cross-tree `CustomEvent` bus (`OPEN_DETAIL` / `SEED_SEARCH` / `SHELF_SEARCH`) is the recurring Epic 6 bug source (mount-races, two-live-surfaces-from-one-input) and Epic 7 adds a SECOND destination that would inherit those failure modes
**When** the architecture is designed
**Then** it decides the cross-tree communication approach for the new destination — router/shared context vs. more fire-and-forget window events — and records the decision, so 7.1–7.3 don't accrete another `CustomEvent` under load [Epic 6 retro action item 2]

**Given** both artifacts exist
**When** 7.1 is picked up
**Then** they gate it: no catalog code merges before the data model and UX are signed off (foundation-first, the Epic 4/5 pattern)

> A design/architecture gate, not runtime code — its "done" is signed-off artifacts. Prevents the improvisation risk called out when this epic was scoped (new table + new destination + paged/searchable grid are not shelf-reuse).

### Story 7.1: Persist the PS+ catalog as browsable data

As Luca,
I want the monthly refresh to store the full catalog, not just match it against my library,
So that the whole subscription catalog is queryable without a live fetch.

**Acceptance Criteria:**

**Given** the PS+ check (button or cron, Story 5.1/5.2)
**When** it fetches the region's catalog
**Then** each product's browsable fields (product id, `np_title_id`, title, `title_normalized`, cover URL, platforms, store URL, `tier='extra'`) are upserted into a new region+tier-scoped `ps_plus_catalog` table [AR-5; AD-24]

> **Amended 2026-07-14 (Story 7.0 gate, from a live probe of `categoryGridRetrieve`):** the store product payload exposes **no release date** and **no genres**. Release date is dropped from this story (AD-24 — the architecture will not carry a field the source can't fill). Genres are obtainable **only** as a category facet, so they are a **separate chunked, generation-stamped sweep** (`filterBy: ["productGenres:<KEY>"]` once per facet key) writing `ps_plus_catalog_genre` — additive, and never blocking the membership snapshot [AD-26, AD-28].

**Given** the catalog snapshot is written
**When** the tracked-game `ps_plus_extra` flag pass runs
**Then** it reads **the stored table**, not a second fetch, and maintains the flag for **every** tracked game with a match — **owned games included** — so the shelf pill and the catalog grid can never give opposite answers for the same game [AD-27]

**Given** a catalog that changed since the last run (games left)
**When** the refresh completes
**Then** rows for products no longer in the region's catalog are pruned, so the table is a faithful current snapshot (same both-directions discipline as the flag check) [new]

> The fetch is extended from `string[]` (names) to full product records; the empty-catalog wipe guard (Story 5.1) still applies before any prune — it now guards **two** datasets, so it stays a hard abort. *(The "MAY consolidate the flag check" option is now mandatory, not optional — see AD-27 above: two fetch paths were found to be a divergence hazard, not a nicety.)*

### Story 7.2: Browse the catalog (a genre-filterable destination)

As Luca,
I want a shelf-style view of the whole PS+ catalog I can filter by genre,
So that I can explore what's playable through the subscription.

**Acceptance Criteria:**

**Given** the app has only ever had one screen
**When** the Catalog destination is introduced
**Then** **react-router** is adopted (library mode) with routes `/` (shelf), `/catalog`, `/game/:id`, and the three `window` CustomEvents (`OPEN_DETAIL`, `SEED_SEARCH`, `SHELF_SEARCH`) are **deleted** and replaced by `navigate()` / `useSearchParams` — closing the Epic 6 mount-race bug class instead of extending it to a second destination [AD-25; Epic 6 retro item 2]

**Given** both destinations
**When** I switch between them
**Then** a **header segmented toggle** (`SHELF | CATALOG`) moves me in one tap, and the search term (`?q=`) is **scoped to the active destination and cleared on switch** — a shelf search never silently filters the catalog. The `＋ Add "<name>"` row stays **shelf-only** [AD-25; EXPERIENCE.md IA]

**Given** a stored catalog for my region (Story 7.1)
**When** I open the Catalog destination
**Then** its games render in a shelf-style grid (cover, title), paged/virtualized for the full ~490-item set, reusing the shelf card chrome — but with **no status pill, no owned toggle and no flip**, because catalog games are not tracked games [AD-24; UX-DR reuse]

**Given** the catalog grid
**When** I filter by genre
**Then** only catalog games in the selected genre(s) show — the **PS-store facet vocabulary** (~19 locale-independent keys, from `ps_plus_catalog_genre`), **never** the shelf's IGDB genre list; the two vocabularies must not mix. Genre-only — no state/ownership filters, since these aren't tracked games [AD-26]

**Given** the catalog grid
**When** I type in the catalog search bar
**Then** the grid narrows to titles matching the query (case-insensitive substring; live with a small debounce) — scoped to the catalog dataset, separate from the shelf/library search [new]

**Given** a catalog game I already track
**When** it renders in the grid
**Then** it carries the state that says what I can still do — **`In library`** (cyan) if tracked but **not owned**, with **`Claim now` still offered** (it's on my shelf but not yet claimed to my PlayStation account), or **`Owned`** (silver) with **no actions** if I own it (purchased or already claimed). Never the shelf's status pill — that shows play state, a tracked-game concept the catalog must not carry [FR-42 dedup parity; AD-24]

> The whole catalog renders, tracked games included — hiding what I already have would just read as a missing game. The three states are keyed on the remaining action, not on tracking alone: dropping `Claim now` the moment a game is tracked would strand exactly the games the catalog itself just added (`owned:false, ownership_type:'ps_plus'`).

**Given** the catalog is empty or its region unset
**When** I open the destination
**Then** an empty/how-to-refresh state shows (mirrors the needs-attention posture), never a blank grid [NFR-4]

### Story 7.3: Add — or claim — a game from the catalog

As Luca,
I want to add a catalog game to my library, or jump to claim it on PlayStation,
So that discovery in the catalog turns into a tracked game (or a claimed one) in one step.

**Acceptance Criteria:**

**Given** a catalog game not yet in my library
**When** I add it
**Then** Epic 6's add preview opens pre-filled (IGDB enrichment on demand) and saves a tracking row of exactly `{owned: false, ownership_type: 'ps_plus', wishlisted_on: null}` — **not owned** (availability is not ownership) but **not wishlisted either**; catalog membership lights its PS+ flag → it shows Playable-now on the shelf [FR-41/42/43; AD-24, AD-8 as amended]

> **Amended 2026-07-14 (7.0 gate):** the original AC said "saving as wishlisted". That was wrong in two ways — `Wishlisted` is *derived* (`not owned AND not in the PS+ catalog`, AD-8 as amended), so a catalog add can't "save as" it, and a game the subscription already gives you is not one you still want to buy. AD-8 was tightened so the derivation can't produce that state.

**Given** the newly added game
**When** the app returns from the add preview
**Then** it navigates to `/game/:id` — the real, **editable** detail — resolved through a **by-id read route**, never an id lookup in the shelf list cache (or the add-then-navigate races the refetch and 404s) [AD-25]

**Given** the catalog grid
**When** a game is already tracked
**Then** it offers **no Add action** (there is no second add) — but **`Claim now` stays live while the game is not owned**, since a catalog-added game sits on the shelf unclaimed until I claim it on PlayStation. Once owned, the card shows **`Owned`** and offers nothing. No read-only catalog detail page stands between browsing and the add preview [AD-24; EXPERIENCE.md IA]

**Given** I claim a tracked-but-unowned game on the PlayStation Store
**When** the next library sync runs
**Then** the existing claim/purchase ownership path (Story 6.4) takes over — the catalog does not try to guess that the claim succeeded, because it cannot observe the PS Store tab [AD-10]

**Given** a catalog game
**When** I tap "Claim now"
**Then** the PS Store product page for my region opens in a new tab (`store.playstation.com/{region}/product/{productId}`) where I add it to my PlayStation library myself [new]

**Given** the add completes
**When** the shelf refetches
**Then** the game appears tracked and the catalog grid marks it as in-library [FR-42]

> **Investigated & declined — direct in-app claim:** firing PlayStation's authenticated add-to-library mutation from press-start (using the stored `pdccws_p` cookie) is an undocumented write against the user's real PSN account — high breakage risk and a real irreversible side effect on a mistaken tap. The "Claim now" deep-link delivers the value with the user performing the account-side action themselves. Revisit only if PlayStation ships a supported API.

## Epic 8: Multi-user Readiness

**Status: Post-v1.0.0, demand-driven** — sequenced after Epic 7 and only picked up when a second user is actually wanted. The app ships single-tenant by design (FR-48 "the app is mine today"); every item here is correct under one `AUTH_ALLOWED_EMAIL` and only wrong once a second user exists. No plumbing is front-loaded.

The backlog is **`publication-blockers.md`** (kept as the live source, cross-referenced from `deferred-work.md`) — this epic is its home rather than a second copy of the table. Each blocker is a story.

**Order:** 8.2 (B1b) → 8.3 (B2+B3) → 8.4 (B4+B5) → 8.5 (B6), as `publication-blockers.md` states. **Story 8.1 (B1a, Google OAuth) sits outside that ordering** — single-tenant-safe, gates nothing, and is pullable into v1.x whenever wanted. Story 8.0 gates 8.2 onward, not 8.1.

### Story 8.0: Foundation — auth model & data-scoping design gate

As the team,
I want the multi-user auth model and the per-user data scoping designed and signed off before any of B1b–B6 is coded,
So that registration, per-user PS+ facts, and a multi-user cron aren't improvised against a schema shaped for one tenant.

**Acceptance Criteria:**

**Given** Epic 8 is picked up for real (a second user is actually wanted)
**When** design begins
**Then** the architecture spine records the multi-user auth model — registration vs invite, what replaces `isAllowedEmail`, and what a second user may and may not see (no sharing, no roles: FR-48's seam, not a tenancy platform) — a reviewed `bmad-architecture` update [AR-13]

**Given** `ps_plus_extra` is a column on the shared `GAME` row and PSN region is a single global `env.PSN_REGION`
**When** the data scoping is designed
**Then** the spine states where each global fact moves (user-scoped table vs derived per-user), honouring AR-19's shared-`GAME`-facts / per-user-`GAME_TRACKING`-state split, so 8.3 is a migration with a known target rather than a design exercise [B2, B3; AR-17, AR-19, AR-23]

**Given** the cron must fan out over N users, each with a region and a PSN cookie
**When** the design lands
**Then** it names the free-tier subrequest budget per run and the chunking strategy that stays inside it as user count grows [B4, B5; NFR-1, NFR-2, AR-15]

**Given** the design artifacts exist
**When** Story 8.2 is picked up
**Then** they gate it: no multi-user code merges before the auth model and the scoping target are signed off (foundation-first, the Story 7.0 pattern)

> A design gate, not runtime code — its "done" is signed-off artifacts. Story 8.1 does **not** wait on it: adding an OAuth provider behind an unchanged allowlist gate changes no data model.

### Story 8.1: Sign in with Google (B1a)

As Luca,
I want to sign in with my Google account instead of waiting for a magic-link email,
So that getting into my own app takes one tap.

**Acceptance Criteria:**

**Given** better-auth is configured with magic link (FR-47)
**When** this story lands
**Then** Google is added as a provider **alongside** magic link — both paths work, neither replaces the other [FR-47, B1a; `src/services/auth.ts`]

**Given** an OAuth callback for an email that is not `AUTH_ALLOWED_EMAIL`
**When** it completes
**Then** the `isAllowedEmail` gate **still rejects it** — the gate is unchanged by this story and applies to the OAuth path exactly as it does to magic link (dropping it is Story 8.2) [B1a, B1b]

**Given** a rejected OAuth sign-in
**When** the user lands back in the app
**Then** the rejection is stated plainly, not swallowed into a blank login screen [NFR-4, AR-14]

**Given** the sign-in screen
**When** it renders
**Then** the Google button and the magic-link form both appear, styled to the existing token system (no new palette) [UX-DR reuse]

**Given** the Google client secret
**When** it is configured
**Then** it lives in a Worker secret, never in `wrangler.jsonc` or the repo [AR-1]

> No schema migration; single-tenancy holds throughout. This is why it is pullable into v1.x ahead of the rest of the epic.

### Story 8.2: Real users can register (B1b)

As a second user,
I want to register (or accept an invite) and get my own account,
So that the app is no longer one hard-coded email address.

**Acceptance Criteria:**

**Given** Story 8.0's signed-off auth model
**When** registration/invite is implemented
**Then** `isAllowedEmail` (`src/services/auth.ts:34`) stops being the gate — a new user can reach an account through the designed path (magic link or Google, per 8.1) [B1b]

**Given** two registered users
**When** each signs in
**Then** each sees only their own `GAME_TRACKING` rows — the AR-13/AR-17 user scoping that has been in the schema since Epic 1 is now actually exercised by more than one user id [FR-48, AR-13, AR-17]

**Given** an unauthenticated or cross-user request
**When** it hits any tracking read/write path
**Then** it is refused — the scoping is enforced server-side, not by the UI hiding things [AR-13]

**Given** a user who is no longer admitted (removed from the allowlist, or de-provisioned under whatever replaces it) but still holds a valid session cookie
**When** they open the app
**Then** they land on the login screen, not a shell that renders while every data route 401s — the session check the SPA gates on (`/api/auth/get-session`) applies the same admission rule as `requireAuth`, and their `session` rows are revoked [deferred-work: de-allowlisted session; AR-13, NFR-4]

**Given** OAuth account linking is at better-auth defaults (a Google identity links into an existing user row by matching email, without `user.create.before` running)
**When** registration opens the door to real addresses
**Then** the admission rule gates the LINK path too, not just user creation — no one links a Google identity into an account they weren't admitted to [deferred-work: OAuth link gate; B1a, B1b]

**Given** the auth endpoints are reachable by strangers once registration is open (a started-but-never-finished Google sign-in writes an OAuth state row to `verification` before any admission check can run)
**When** the endpoints are hardened
**Then** they are rate-limited — the residue of an unfinished sign-in cannot be grown without bound [deferred-work: OAuth verification residue; NFR-1]

> Gates 8.3–8.5. Nothing below matters until a second user exists.

### Story 8.3: Per-user PS+ facts — region and catalog flag (B2 + B3)

As a user in my own region,
I want the PS+ Extra flag and the PSN region to be *mine*,
So that another user's catalog check never rewrites what is playable for me.

**Acceptance Criteria:**

**Given** `ps_plus_extra` is today a global column on the shared `GAME` row, written from one user's catalog check (`setPsPlusExtraFlags`, `src/services/psplus.ts`)
**When** this story lands
**Then** the flag becomes per-user (per Story 8.0's chosen shape: user-scoped table or derived), so user B's check never lands on user A's row [B2; AR-19]

**Given** PSN region is today a single global `env.PSN_REGION` seeded into every SETTING (`getPsnRegion`, `src/services/settings.ts`)
**When** this story lands
**Then** region is a per-user setting with an editor in the settings surface, ideally seeded from PSN on first sync [B3; AR-23]

**Given** two users in different regions with the same game tracked
**When** both catalog checks have run
**Then** each user sees the PS+ pill according to **their** region's catalog — the two answers coexist [B2 + B3 together; AR-23]

**Given** existing single-user data
**When** the migration runs
**Then** the current global flag and region are carried onto the existing user, losing nothing [AR-16]

**Given** every writer of the global flag — the PS+ check (`setPsPlusExtraFlags`), the scheduled refresh, and Story 6.4's "I cancelled PS+" un-claim, which re-flags the games it un-owns
**When** the flag becomes per-user
**Then** all three write the per-user shape — one user's cancel can no longer repaint another user's catalog pills [deferred-work: cancel-PS+ global write; B2, AD-19]

> B2 and B3 are one story on purpose: both are "a global fact that must become per-user", and a per-user flag is meaningless without a per-user region.

### Story 8.4: The scheduled refresh serves every user (B4 + B5)

As any user of the app,
I want the monthly PS+ refresh and the sync to run for **my** account, not just the first one,
So that the automation is not silently single-tenant.

**Acceptance Criteria:**

**Given** `runScheduledPsPlusCheck` (`src/services/psplus.ts:140`) resolves exactly one user by `AUTH_ALLOWED_EMAIL`
**When** this story lands
**Then** the cron loops **all** users, each with their own region (8.3) and their own `pdccws_p` cookie from SETTING (`getPsnCookie`) [B4, B5]

**Given** the free-tier subrequest budget named in Story 8.0
**When** the user count grows
**Then** the run chunks to stay inside it rather than failing the whole cron [NFR-1, NFR-2, AR-15]

**Given** one user's refresh fails (expired cookie, unset region)
**When** the run continues
**Then** the other users still refresh, and that user's failure surfaces to **that user** on next app open — never a silent skip, never a poisoned run [NFR-4, AR-14, FR-40]

### Story 8.5: Backfill legacy `owned_via` rows (B6)

As the maintainer,
I want the pre-FR-9 rows to carry an acquisition source,
So that `owned_via` means something on every row instead of being NULL on the oldest ones.

**Acceptance Criteria:**

**Given** `game_tracking` rows written before the FR-9 amendment carry `owned_via = NULL`
**When** the backfill runs
**Then** each is either resolved to `purchase`/`membership` from the PSN library or explicitly accepted as unknown — and the choice is recorded, not left ambiguous [B6]

**Given** the backfill
**When** it completes
**Then** no user-entered data (status, milestones, dates) is touched — this is a hygiene pass over one column [AR-10]

> Lowest priority in the epic; data hygiene, not a correctness gate.

## Epic 9: The PSN Record — Trophies (and maybe Wishlist)

**Status: v1.x** — enriches a working app. All PSN I/O stays behind `PsnProvider` (AR-5); nothing here changes the state model.

Epic 4 fills the library from PlayStation. This epic brings across the *record*: trophy progress per game (completion % and a PSNProfiles-style letter grade), plus a one-off backfill that recovers milestone dates PSN knows and the app never captured. It opened with the S-1 spike (Story 9.1, **done 2026-07-13** — see `implementation-artifacts/deferred-work.md` DW-10), which probed what the `pdccws_p` cookie authorizes. Verdict: **trophies require an NPSSO bearer** (the cookie is rejected 401 by the trophy host), and the bearer is a *superset* — it also serves the existing library sync. So the epic now runs on a **full cookie→NPSSO swap (Story 9.1b)**, which gates trophy sync. The wishlist endpoint was identified (`storeRetrieveWishlist`, an Apollo persisted query) but its hash and auth path still need one capture (Story 9.1c), on which Story 9.4 is conditional.

### Story 9.1: Spike S-1 — what does `pdccws_p` authorize? (VR-1)

As the team,
I want a probed, written-down table of which PSN endpoints work under the session cookie and which need an NPSSO bearer,
So that trophy sync and wishlist sync get sequenced on evidence instead of on a guess, and the long-open NPSSO question is closed.

**Acceptance Criteria:**

**Given** a valid `pdccws_p` cookie
**When** the spike probes the PS Store **wishlist** endpoint, `getPurchasedGameList`, and the **trophy** endpoints
**Then** each is recorded as reachable / not reachable, with the observed status and response shape [VR-1]

**Given** an NPSSO bearer token
**When** the same three are probed again
**Then** the same table is filled for the NPSSO path — the output is an **endpoint × auth-path** table appended to `implementation-artifacts/deferred-work.md` [VR-1]

**Given** the table
**When** the spike closes
**Then** it states the consequence explicitly: wishlist reachable over `pdccws_p` → **Story 9.4 stays in this epic**; wishlist needs NPSSO → the auth swap becomes its prerequisite, **9.4 is dropped to Future**, and 9.2/9.3 proceed on their own (unless trophies need NPSSO too — then the swap is promoted out of Deferred and gates this epic)

**Given** the spike is complete
**When** the planning docs are updated
**Then** PRD open-q #2 is closed by it, and the spine's Deferred entry is resolved [sprint-change-proposal-2026-07-13 §3.2]

> Timebox: one afternoon. A spike, not a feature — its "done" is a written table and a sequencing decision. No production code need survive it. Any auth swap it recommends stays a `PsnProvider` internal (AR-5).
>
> **Outcome (done 2026-07-13, DW-10):** trophies need NPSSO (cookie → 401); the bearer also serves `getPurchasedGameList`; the wishlist is a persisted query `storeRetrieveWishlist` whose hash is not client-computable. Consequences homed as Stories 9.1b (swap) and 9.1c (wishlist hash capture) below.

### Story 9.1b: Swap `PsnProvider` from the `pdccws_p` cookie to an NPSSO bearer (VR-1) — _gates Story 9.2_

As Luca,
I want the app to authenticate to PlayStation with an NPSSO token instead of the short-lived session cookie,
So that trophy sync is possible at all and I stop re-pasting a cookie that expires every few days.

**Acceptance Criteria:**

**Given** the S-1 evidence that the NPSSO bearer serves both `getPurchasedGameList` and the trophy endpoints while the `pdccws_p` cookie serves neither trophies (401) nor is durable,
**When** `PsnProvider` authenticates,
**Then** it reads a stored `npsso` token, performs the authorize → code → access-token exchange, and calls PSN with the resulting bearer — the whole mechanism confined to `PsnProvider` (AR-5), no auth detail leaking into services, routes, or core [VR-1, AR-5]

**Given** the access token is short-lived (~1 hour) and the exchange returns an offline refresh token,
**When** a call finds the cached bearer expired,
**Then** the adapter refreshes it from the refresh token without user interaction, and only a fully-expired/invalid NPSSO (~60-day life) raises the alarm — by **reusing the existing expired-credential path unchanged**: it sets the same `psn_auth: 'expired'` setting flag the cookie uses today, so the same needs-attention banner and re-paste prompt fire with no new UI surface [FR-36, NFR-4, AR-14]

**Given** the settings table today stores `psn_cookie` with a paste field in the Settings panel,
**When** the swap ships,
**Then** the `npsso` field **takes the place of the cookie slot in the same Settings location** (not a new field beside it): the cookie input, its label, and its help text are replaced by the NPSSO equivalents, the setting key moves `psn_cookie` → `psn_npsso`, the `PSN_SESSION_COOKIE` seed secret becomes `PSN_NPSSO`, and the dead cookie read path (`getPsnCookie`) is removed — not left as parallel dead weight [AR-5, FR-36]

**Given** the ~60-day NPSSO re-paste is the only manual step and hunting for the token is the friction,
**When** the user opens that Settings field,
**Then** a "Get / refresh token" control **deep-links** to `https://ca.account.sony.com/api/v1/ssocookie` in a new tab — a signed-in Sony session renders `{"npsso":"…"}` to copy straight into the field; a signed-out one lands on Sony login first (try-the-session-first, fall back to manual login). It is a plain link, no cross-origin read — CORS forbids scraping the value silently [FR-36]

**Given** the existing library sync (Epic 4) and PS+ Extra catalog paths currently run on the cookie,
**When** the swap ships,
**Then** both are migrated to the bearer and verified green — the swap is a *replacement*, and Epic 4's append-only + degenerate-response guarantees (200-with-errors fails closed, existing data survives) are re-asserted against the bearer with a captured-payload hazard test [AR-5, FR-10, DEGENERATE-RESPONSE GUARD]

**Given** an expired or invalid NPSSO mid-sync,
**When** the exchange or a call fails,
**Then** the refresh instructions surface and the run stops — no silent retry, no partial write presented as complete [NFR-4, AR-14, FR-36]

> The one story that touches the working Epic 4 auth path. All risk is contained behind `PsnProvider`; the probe already confirmed the bearer returns byte-identical `data{purchasedTitlesRetrieve}`.

### Story 9.1c: Final wishlist spike — capture the `storeRetrieveWishlist` hash and confirm its auth path (VR-1) — _gates Story 9.4_

As the team,
I want the real persisted-query hash for the PS Store wishlist and a confirmed answer on which credential it needs,
So that Story 9.4 is sequenced on evidence instead of the open question S-1 left behind.

**Acceptance Criteria:**

**Given** S-1 identified the wishlist as the Apollo persisted query `storeRetrieveWishlist` (freeform GraphQL is refused; the computed sha256 candidates 404'd because Apollo hashes the printed AST),
**When** a real client-side navigation to the wishlist is captured,
**Then** the actual `sha256Hash` is recorded from that request — not computed, not guessed [VR-1]

**Given** the captured hash,
**When** the wishlist endpoint is probed under the NPSSO bearer (and, if it matters, the cookie),
**Then** its reachability and required auth path are recorded in `deferred-work.md` (extending DW-10): reachable → **Story 9.4 stays in Epic 9**; not reachable under either → 9.4 drops to Future [VR-1, VR-4]

> A spike, timeboxed. Runs after 9.1b so the probe uses the bearer the app will actually carry. Its deliverable is the recorded hash + auth-path decision; no production code need survive it.
>
> **Outcome (done 2026-07-14, DW-10 extension):** the wishlist read is **server-side-rendered** — `__NEXT_DATA__` carries the data, the browser issues no client-side `storeRetrieveWishlist` request, so no hash is client-observable. The bundle's query, hashed with the app's own `parse`/`print` pipeline (validated exact against the client-executed `getCartItemCount` query), returns `PersistedQueryNotFound` under the bearer for every candidate; freeform stays refused. **Reachable under neither credential → Story 9.4 is removed from Epic 9 and filed to Future.**

### Story 9.2: Trophy progress on every game (VR-2)

As Luca,
I want each game to show how far I got — completion % and a letter grade,
So that "did I ever finish that?" gets a number, not just a status pill.

**Acceptance Criteria:**

**Given** a synced PSN account
**When** the trophy sync runs (button, alongside the existing library sync)
**Then** per-game trophy counts (earned/total, by tier) are fetched through `PsnProvider` and **persisted** — nothing is fetched on render [VR-2, AR-5, AR-6, NFR-3]

**Given** persisted trophy counts
**When** completion % and the letter grade are computed
**Then** both are derived in the I/O-free domain core from the stored counts, with the grade bands documented in one place — never stored as a second source of truth [VR-2, AR-3, AR-8]

**Given** a game with trophy data
**When** its card and detail view render
**Then** the completion % and grade show; a game with no trophy data shows nothing rather than a fake 0% [VR-2, UX-DR reuse]

**Given** the trophy sync
**When** it runs
**Then** it **never** writes play status, milestones, or lifecycle dates — trophy data is its own surface (the milestone backfill is Story 9.3, a deliberate one-off) [AR-10, AR-11]

**Given** an expired cookie or a PSN error mid-sync
**When** the run fails
**Then** the refresh instructions surface and the run stops — no silent retry, no partial write presented as complete [NFR-4, AR-14, FR-36]

**Given** a library of ~175 games, each needing a trophy lookup
**When** the sync runs
**Then** it fits the free-tier subrequest/CPU budget — chunked or out-of-band if it does not [NFR-1, AR-15]

### Story 9.3: One-off backfill — recover the platinum dates PSN knows (VR-3)

As Luca,
I want the platinum dates PSN has on record filled in for games where I never logged them,
So that my milestone history isn't blank for everything I platinumed before this app existed.

**Acceptance Criteria:**

**Given** a game with a Platinum trophy earned on PSN and **no** `platinum_on` on record
**When** the backfill runs
**Then** `platinum_on` is set from PSN's earned date [VR-3]

**Given** such a game also has **no** `completed_on`
**When** the backfill runs
**Then** `completed_on` is set to the same date as `platinum_on` — **a backfill heuristic only**, recorded as such, and explicitly **not** the rule for games synced going forward (Story 9.2 never writes milestones) [VR-3]

**Given** a game that already carries `platinum_on` or `completed_on`
**When** the backfill runs
**Then** it is left untouched — write-once holds; the first value stands [FR-6, FR-45, AR-11]

**Given** the backfill is a one-off over the whole library
**When** it is run
**Then** it runs out-of-band or chunked (never a blocking request), reports what it changed, and is safe to re-run (idempotent by construction — it only ever fills nulls) [AR-15, FR-37 posture]

> The only place in the app where a sync writes a milestone. It is a one-time reconciliation with a documented heuristic, not a standing behaviour.

### Story 9.4: Sync the PS Store wishlist (VR-4) — **DROPPED TO FUTURE (2026-07-14, DW-10 extension)**

> **Removed from Epic 9.** Story 9.1c found the wishlist read is server-side-rendered on `library.playstation.com` — the browser issues no client-side `storeRetrieveWishlist` request, and the bundle's query returns `PersistedQueryNotFound` under the NPSSO bearer for every hash variant (the hashing recipe validated exact against the client-executed `getCartItemCount` query). Freeform GraphQL stays refused. The endpoint is reachable under neither credential from the app's server-to-server position, so per this story's own first AC it is filed to Future. **Revisit if PSN re-exposes a client-side wishlist fetch or publishes a REST wishlist endpoint.** The acceptance criteria below are preserved for that revisit.

As Luca,
I want the games I wishlisted on the PS Store to appear in my Press Start wishlist,
So that the two lists stop drifting apart and the store wishlist stops being a second place I have to check.

**Acceptance Criteria (preserved for a Future revisit):**

**Given** Story 9.1c captured the `storeRetrieveWishlist` hash and concluded the wishlist endpoint is reachable (under the bearer the app now carries post-9.1b, or the cookie)
**When** this story is picked up
**Then** it proceeds in this epic — **if 9.1c concluded the endpoint is reachable under neither credential, this story is removed from Epic 9 and filed to Future** [VR-1, VR-4] — _9.1c concluded NEITHER; this story is Future._

**Given** the PS Store wishlist
**When** the sync runs
**Then** each wishlisted product is matched to the library by stored PS Store product id first, then normalized title (the FR-34 matching order), and unmatched titles are **added as wishlisted games** (not owned, `wishlisted_on` recorded, status `Not started`) [VR-4, FR-43, AR-9, AR-18]

**Given** a wishlist entry that matches a game I already **own**
**When** the sync runs
**Then** nothing changes — ownership is never unset, and the store wishlist does not un-own anything [FR-10, AR-10]

**Given** a wishlist entry that no longer appears on PSN
**When** the sync runs
**Then** the Press Start game is **not** deleted — sync is append-only to user data; removal stays the user's decision [AR-10]

**Given** the sync completes
**When** the summary shows
**Then** it names games added, entries already tracked, and anything needing attention — the FR-37 posture [FR-37, NFR-4]

### Story 9.5: Post-retro hardening sweep — the merge gate (Epic 9 retro, 2026-07-14)

As Luca,
I want the traps Epic 9's review left in the ledger closed before the epic reaches main,
So that the first live trophy sync on production runs against hardened code, not against known-and-shrugged-at defects.

The Epic 9 retrospective triaged 11 deferred entries. Five are accepted or watch-only; one was a migration-ordering artifact that cannot occur in production. These are the six that ship.

**Acceptance Criteria:**

**Given** the NPSSO→bearer exchange stub is copy-pasted verbatim into `test/integration/sync.test.ts` and `test/integration/discard.test.ts`
**When** this story ships
**Then** one shared helper backs both — a stale exchange shape can no longer keep two suites green while production breaks [DW: 9.1b]

**Given** `Db` types a `batch()` method while `scripts/seed-import.ts` builds its sqlite-proxy driver with **no batch callback**
**When** this story ships
**Then** the seed driver supplies a batch callback (or the type stops promising one) — a future repository function that batches and is reused by the seed path must fail at COMPILE time, never at runtime [DW: 9.2]

**Given** the library sync, the trophy sync, and the platinum backfill all run unlocked — two tabs double the PSN fan-out and both loops report the same rows as written
**When** this story ships
**Then** a single-flight guard covers **all three** long-running PSN operations per user, and a second concurrent run is refused with a human message rather than racing [DW: 9.2, 9.3; deferred since Epic 4]

**Given** the npsso charset guard in `src/routes/settings.ts` admits non-Latin1 codepoints that the outbound `Cookie:` header cannot carry
**When** this story ships
**Then** such a value is refused at SAVE time with a 400, not at sync time with a 502 [DW: 9.1b]

**Given** `listLibraryForUser` excludes discarded rows, so a discarded game's trophy title falls through to the trophy sync's "no library match" list as noise on every run
**When** this story ships
**Then** trophy titles matching a discarded game are matched and dropped SILENTLY — they are not unmatched, they matched a game the user threw away [DW: 9.2]

**Given** `epic6.spec.ts` 6.4a ("Claimed with PS+" writes `owned_via=membership`) flakes under full-suite load — it asserts the D1 row immediately after the dialog closes, without awaiting the ownership PUT
**When** this story ships
**Then** the test awaits the write (a response or a UI settle) before querying D1, and the full suite runs green three times consecutively — the flake is proven PRE-EXISTING (reproduced on baseline `7b2d979` with Epic 9 stashed), so it is fixed here rather than carried [DW: 9.1b]

> **Explicitly NOT in scope** (accepted at the retro, recorded so nobody re-litigates them): trophy counts are never cleared or aged — they are historic data and staleness is fine (Luca's call); no e2e for the FAB → trophy sync → shelf-repaint seam (PSN is unstubbable in Playwright, same limitation `epic5-psplus.spec.ts` records); pre-migration-0008 trophy rows falling back to `trophy2` (unreachable in production — CI applies 0007 and 0008 together before the first deploy, so only a local dev D1 can hold such a row).

## Epic 10: Know Before You Play — Scores & Expiry Warnings

**Status: v1.x, after Epic 7** — Story 10.2 diffs the `ps_plus_catalog` snapshot Story 7.1 builds, so this epic follows Epic 7. **Stories 10.1 and 10.3 carry no such dependency and are pullable ahead alone** (10.3 extends 10.1's refresh job, so it follows 10.1).

Three signals that help pick what to play (or buy) next: what the world thinks of a game, how much of your life it will take, and whether a backlog game is about to disappear from the subscription. All are stored and refreshed on a schedule — never fetched on render (NFR-3).

### Story 10.1: Critic & user scores on every game (VR-5)

As Luca,
I want to see how a game was received before I sink a weekend into it,
So that the shelf helps me choose, not just remember.

**Acceptance Criteria:**

**Given** the `IgdbProvider` already calls IGDB's `/games` endpoint for covers, genres, and release dates
**When** scores are added
**Then** `aggregated_rating` + `aggregated_rating_count` (critic) and `rating` + `rating_count` (user) are requested on the **same call** and persisted — **no second provider adapter, no new credentials** [VR-5, AR-5, AR-6]

**Given** the score fields exist
**When** the **first task** of this story runs
**Then** coverage is verified against the library's **real titles** — how many of the ~175 games actually carry a critic score — and the result is recorded. If coverage is thin, OpenCritic is the fallback (a second adapter behind the same port); RAWG is out [VR-5, sprint-change-proposal-2026-07-13 §3.3]

**Given** a game with scores
**When** its card and detail view render
**Then** critic and user scores show, from stored data, with their sample counts available — a score backed by 3 reviews must not read like one backed by 300 [VR-5, NFR-3, AR-6]

**Given** a game IGDB has no score for (unreleased, obscure, or unenriched)
**When** it renders
**Then** the score area is absent, never a zero or a fabricated placeholder [VR-5]

**Given** scores drift as reviews land
**When** the scheduled refresh runs (a Cron Trigger, aligned with the existing scheduled work)
**Then** stored scores are updated within the free-tier budget — batched/chunked over the library, not one subrequest per game per run [VR-5, NFR-1, NFR-2, AR-15]

**Given** a failed score refresh
**When** the next app open happens
**Then** the failure surfaces (the FR-40 posture) rather than leaving stale scores silently passing as current [NFR-4, AR-14]

### Story 10.2: "Leaving PS+ Extra soon" (VR-6)

As Luca,
I want a warning on backlog games that are about to leave the PS+ Extra catalog,
So that I play them before they vanish instead of finding out when the shelf goes quiet.

**Acceptance Criteria:**

**Given** the `ps_plus_catalog` table (Story 7.1) holds the region's current snapshot
**When** the monthly refresh runs
**Then** the **previous** snapshot is retained long enough to diff against the new one — a game present before and absent now has left the catalog [VR-6, AR-23]

**Given** a tracked, non-owned backlog game whose catalog membership is ending
**When** the shelf renders
**Then** it carries a "leaving soon" warning, visually distinct from the steady-state PS+ Extra pill [VR-6, UX-DR reuse]

**Given** the app cannot know Sony's *future* removals (no departure date is published)
**When** the warning is defined
**Then** it is grounded in what is observable — a game that **left** the catalog while still in the backlog is flagged as gone/expired, and any predictive "leaving soon" signal is only claimed if the ingest genuinely exposes an end date. **The warning never guesses** [VR-6, NFR-4, PRD §6 non-goal: "automating anything Sony's API can't give reliably"]

**Given** a game that has left the catalog
**When** it is still un-owned and in the backlog
**Then** its PS+ pill clears (both-directions discipline, Story 5.1) and the game stops counting as **Playable now** — the warning is the human-facing half of a flag change that already happens [FR-14, FR-38]

**Given** an owned game
**When** the catalog changes
**Then** no warning — ownership makes catalog membership irrelevant (FR-38: the flag is hidden the moment a game is owned) [FR-38]

> **Open at design time:** whether the PS+ ingest exposes any leave-date signal at all. If it does not, this story ships as *"left the catalog"* (observable, honest) rather than *"leaving soon"* (a guess) — and that is the correct outcome, not a degraded one.

### Story 10.3: Time to beat — the story, and 100% (VR-8)

As Luca,
I want to know how many hours a game takes to finish and how many to 100% it,
So that I pick a game that fits the time I actually have, instead of stalling out 40 hours into a 90-hour completionist grind.

**Depends on Story 10.1** — it extends the same fields-on-`/games` habit and rides the same scheduled refresh job. Not on Epic 7.

**Acceptance Criteria:**

**Given** every enriched game already stores an `igdbId`, and IGDB exposes `/game_time_to_beats` (`normally`, `completely`, `count`, keyed by `game_id`)
**When** time-to-beat is added
**Then** it is fetched from **IGDB** — the provider, credentials, and rate-limit budget the `IgdbProvider` already owns — and persisted as hours-to-beat-the-story, hours-to-100%, and the submission count. **No fuzzy title matching**: the join is on `igdbId`, not on a name [VR-8, AR-5, AR-6]

**Given** IGDB's numbers are its own user submissions, not HowLongToBeat's
**When** the **first task** of this story runs
**Then** coverage is verified against the library's **real titles** — how many of the ~175 games carry a `normally` and a `completely` value — and the result is recorded next to Story 10.1's score-coverage finding. **HowLongToBeat is the fallback and only the fallback**: a second adapter behind the same port, taken only if IGDB coverage is thin. Its cost is named up front — an unofficial endpoint that breaks on their rebuilds, and matching by title because there is no shared id [VR-8, AR-5]

**Given** a game with time-to-beat data
**When** its card and detail view render
**Then** both numbers show from stored data, next to the scores, labelled so the difference is unmistakable — **story** vs **100%** — with the submission count available, since 4 submissions and 400 are not the same claim [VR-8, NFR-3, UX-DR reuse]

**Given** a game IGDB has no time-to-beat data for (unreleased, obscure, or unenriched), or has only one of the two values
**When** it renders
**Then** the missing value is **absent** — never a zero, never an estimate, never a completionist figure silently standing in for the story figure [VR-8, NFR-4]

**Given** these numbers drift as more players submit
**When** the Story 10.1 score refresh runs
**Then** time-to-beat is refreshed **in the same scheduled pass** — one cron, one chunked walk of the library, not a second job competing for the same free-tier budget [VR-8, NFR-1, NFR-2, AR-15]

**Given** a failed refresh
**When** the next app open happens
**Then** the failure surfaces (the FR-40 posture) rather than leaving stale hours passing as current [NFR-4, AR-14]
