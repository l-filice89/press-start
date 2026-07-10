---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
inputDocuments:
  - prds/prd-ps-game-catalog-2026-07-05/prd.md
  - prds/prd-ps-game-catalog-2026-07-05/addendum.md
  - architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md
  - ux-designs/ux-ps-game-catalog-2026-07-05/DESIGN.md
  - ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md
  - ../implementation-artifacts/epic-2-retro-2026-07-09.md
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
- **FR-4** — `Dropped` games are hidden from the default shelf, reachable via the `Dropped` reveal pill.

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

- **FR-20** — Filter semantics: OR within a group, AND across groups. Groups: State (multiselect dropdown of live statuses), State-reveals (individual reveal pills for Completed/Platinum/Dropped that OR into the visible set), Genre (multiselect dropdown), Flags (individual pills `Owned`/`Wishlisted`/`Released`/`Playable now`, each its own AND group).
- **FR-21** — State-group selection rule: with nothing selected, the shelf shows the default visible set (FR-17); the moment anything in the state group is selected, the shelf shows exactly the selected states.
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
- **UX-DR10** — FAB + upward drawer: electric-blue launcher, bottom-right by default (configurable to bottom-left), opening chores (Sync library · Check PS+ Extra · Export CSV · Settings · About/Help); icons-only mobile, icons+text desktop; no Add here.
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

- **UX-DR26** — Responsive deltas: phone (2-up lean card, genres hidden, single Filters button + count → bottom sheet, icons-only FAB, full-screen detail, compact header "175 · 52 OWNED") vs desktop (auto-fill dense grid, full filter row + inline summary sentence, icons+text FAB, ~760px detail panel, full header with `PS+ CATALOG AS OF …` timestamp).
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
