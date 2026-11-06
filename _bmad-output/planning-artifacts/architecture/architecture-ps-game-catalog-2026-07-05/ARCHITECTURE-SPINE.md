---
name: 'PRESS START — PS Game Catalog'
type: architecture-spine
purpose: build-substrate
altitude: feature
paradigm: layered + ports-and-adapters (two seams — persistence, external providers)
scope: 'Current 3.6.0 architecture: user-scoped installable PWA, React SPA + one Cloudflare Worker API on D1, manual library upkeep and anonymous regional PS+ catalog ingestion.'
status: final # AD-29..33 signed off by Luca 2026-07-17 (Epic 8 gate): open registration, diff-upserts dropped
created: '2026-07-05'
updated: '2026-11-07'
binds:
  - prd-ps-game-catalog-2026-07-05 (FR-1..FR-66 (retired IDs retained), NFR-1..NFR-5)
  - ux-ps-game-catalog-2026-07-05 (DESIGN.md, EXPERIENCE.md)
sources:
  - ../../prds/prd-ps-game-catalog-2026-07-05/prd.md
  - ../../prds/prd-ps-game-catalog-2026-07-05/addendum.md
  - ../../ux-designs/ux-ps-game-catalog-2026-07-05/DESIGN.md
  - ../../ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md
  - ../../../project-context.md
companions: []
---

# Architecture Spine — PRESS START (PS Game Catalog)

Current baseline: package `3.6.0`. Approved amendments and shipped code supersede the historical v1 seed; decision history remains in `.memlog.md`. Source versions below describe repository dependencies, not newly researched provider limits.

## Design Paradigm

**Layered, with a ports-and-adapters seam at exactly two places: persistence and external providers.** The persistence and provider seams carry portability and testability; user tracking remains isolated under AD-13.

One Cloudflare **Worker is the composition root**: it wires adapters to a pure domain core and serves both the React SPA (Workers Static Assets) and the JSON API.

```mermaid
flowchart TD
  SPA["React SPA — cover-forward shelf, detail flip, filters, search<br/>(Workers Static Assets)"]
  SPA -->|JSON API, typed| ROUTES

  subgraph Worker["Cloudflare Worker (composition root)"]
    ROUTES[routes — Hono] --> SVC[services / ingest jobs]
    SVC --> CORE[["DOMAIN CORE — pure, no I/O<br/>effective-state · derived-state · reconciliation · invariants"]]
    SVC --> REPO[repositories — Drizzle/D1 seam]
    SVC --> PORTS[provider ports — PSN · IGDB]
    CORE -.->|types only| REPO
    ROUTES --> REPO
  end

  REPO --> D1[(Cloudflare D1)]
  PORTS -->|external I/O only here| EXT["PSN API · IGDB"]
  CRON[[Cron Triggers — regional PS+ rotation and daily scores]] --> SVC
```

Layer map (namespaces):

```text
core/        # pure domain — imports nothing with I/O
services/    # ingest jobs + orchestration (the only place providers are touched)
repositories/# D1 access via Drizzle (persistence seam)
providers/   # PSN + IGDB adapters (external-I/O seam)
routes/      # Hono handlers + Zod validation
```

## Invariants & Rules

Dependency direction — an arrow means "may depend on"; the domain core is a sink.

```mermaid
flowchart LR
  routes --> services
  services --> core
  services --> repositories
  services --> providers
  repositories --> core
  routes --> repositories
  core:::sink
  classDef sink fill:#123,stroke:#0aa,color:#fff;
```

### AD-1 — Platform is Cloudflare, single vendor [ADOPTED]

- **Binds:** NFR-1, NFR-2, all backend/hosting.
- **Prevents:** divergent hosting/DB/cron choices; a stateful server; an external cron pinger.
- **Rule:** One Worker serves the SPA (Static Assets) **and** the JSON API. Persistence is **Cloudflare D1**, reached via a Workers binding. Scheduled work is **Cloudflare Cron Triggers**. No second hosting vendor. Free-tier hosting is the hard constraint that outranks the SQLite preference, which outranks the Bun preference. (Free-tier subrequest budget per invocation: **50 external** + 1,000 Cloudflare-services; D1 binding calls draw on the latter — see AD-15.)

### AD-2 — Deployed runtime is workerd; Bun is dev-toolchain-only [ADOPTED]

- **Binds:** all backend; supersedes the project-context "Bun runtime" preference.
- **Prevents:** code depending on Bun-only APIs (`bun:sqlite`, Bun globals) that can't run on Workers.
- **Rule:** Production runtime is workerd/V8, TypeScript throughout. Bun is allowed only as a **local** package manager, test runner, and out-of-band script runner — never assumed at runtime. `project-context.md` is updated to reflect this.

### AD-3 — Domain core is I/O-free [ADOPTED]

- **Binds:** `core/`; all state/reconciliation logic.
- **Prevents:** an untestable domain; `fetch`/DB access leaking into business logic; two units computing the same rule differently.
- **Rule:** `core/` imports **no** `fetch` and **no** D1/Drizzle. Effective-state, derived-state, title-normalization, reconciliation, and invariant checks are pure functions, unit-tested without a network or database.

### AD-4 — Persistence only through repositories (the D1 seam) [ADOPTED]

- **Binds:** all data access; the "publish someday" migration path (FR-48).
- **Prevents:** D1 calls scattered across services; lock-in that makes a future storage move rewrite domain logic.
- **Rule:** All database access goes through `repositories/` using Drizzle. No service, route, or core module issues a raw D1 query. Storage may later migrate (D1 → Turso → Postgres) by replacing this layer alone.

### AD-5 — External I/O only through provider ports [ADOPTED; amended Epic 11]

- **Binds:** anonymous PS Store and IGDB access; all ingest jobs.
- **Prevents:** third-party calls escaping adapters; account credentials returning through a new sync path.
- **Rule:** Every third-party call goes through a `providers/` adapter. `PsnProvider` supports anonymous store/catalog operations only; no PSN account credential, credential exchange, library sync, trophy sync, or platinum backfill. Region is an explicit input (AD-23). Region refresh locking follows AD-31.
- **Source:** [approved PSN Account Safety proposal](../../sprint-change-proposal-2026-07-15.md).

### AD-6 — Nothing external on render, enforced structurally (NFR-3) [ADOPTED]

- **Binds:** all read/query paths; card render; shelf load.
- **Prevents:** a page render triggering a third-party fetch; slow, flaky, rate-limited page loads.
- **Rule:** Read/query paths use **repositories only**. A provider is touched **only** by an ingest job (seed, regional catalog refresh, enrichment, add-by-name). A provider lookup required to build a query response is an architecture violation. The Shelf GET may schedule the independent stale-snapshot membership job through `waitUntil` (AD-31); its response still uses persisted facts. Cover URLs and store URLs come from storage; browser image loading may follow those persisted URLs.

### AD-7 — Effective-state is computed in one place (FR-8) [ADOPTED]

- **Binds:** shelf ordering, card labels, filter pills — FR-8/17/18/21.
- **Prevents:** two surfaces disagreeing on a game's state (e.g. a replay showing "Playing" on one surface and "Platinum" on another).
- **Rule:** A single `core/` function computes effective state (`play status if set, else Platinum if platinum_on, else Story completed if completed_on`). Ordering, labels, and filters consume it; none recomputes it.

### AD-8 — Derived states are never stored; stored inputs are distinct (FR-12/13/14) [ADOPTED]

- **Binds:** Released, Wishlisted, Playable-now; and, by contrast, the stored inputs they consume.
- **Prevents:** a stored derived flag drifting out of sync with its inputs; **and** the opposite error — treating a fetched fact (cover, PS+ Extra membership) as "derived" and refusing to store it.
- **Rule:** Released, Wishlisted (= **not owned**), and Playable-now (owned-or-in-PS+Extra-catalog AND released) are **computed, never persisted** — no `wishlisted` column exists. This is disjoint from **stored inputs** — `cover_url`, `store_url`, and PS+ Extra **catalog membership** are *facts fetched from a third party*, persisted by ingest jobs (AD-6, AD-19), never user-writable; Playable-now derives *from* the stored PS+ Extra fact. "Anything that can be computed is computed" governs derivations, not fetched facts.

### AD-9 — One title-normalization function (FR-27/42) [ADOPTED]

- **Binds:** seed import, catalog ingestion, add-by-name, library-match.
- **Prevents:** three normalizers producing different keys and breaking the cross-source joins.
- **Rule:** A single `core/` normalizer (strip `™`/`®` and edition suffixes, drop leading articles, case/whitespace-fold, collapse PS4/PS5 → one PS5) produces the `title_normalized` matching key, shared by every ingest and search path. It is a **non-unique candidate key** (AD-18) — the first-pass match, not the identity anchor; the `EXTERNAL_LINK` is the true identity (AD-20).

### AD-10 — Imports preserve user data; acquisition source is distinct from format [ADOPTED; amended 2026-07-11]

- **Binds:** seed import and automatic enrichment; ownership mutations.
- **Prevents:** imported facts overwriting tracking history; confusing subscription claims, purchases, and physical/digital format.
- **Rule:** Automatic import/enrichment does not overwrite existing status, milestones, lifecycle dates, or user-edited genres. Seed import may create games and flip `owned` false→true. Membership claims count as owned with `owned_via='membership'`; purchases use `owned_via='purchase'`. Claims never stamp `bought_on`; purchasing a claim upgrades source and stamps that date write-once. `ownership_type` remains `physical|digital`. Manual ownership changes and cancellation may un-own tracking rows; automatic ingestion never clears ownership. Catalog availability alone never claims or owns a game (AD-24).
- **Source:** [approved ownership amendment](../../prds/prd-ps-game-catalog-2026-07-05/addendum.md#ownership-rationale). Credentialed sync is retired (AD-5).

### AD-11 — Lifecycle & milestone dates are write-once through automatic flows (FR-44/45/6) [ADOPTED]

- **Binds:** `wishlisted_on`, `bought_on`, `started_on`, `completed_on`, `platinum_on`.
- **Prevents:** a repeat import or re-transition overwriting a recorded date; lost history that can't be reconstructed.
- **Rule:** Automatic flows write each date **once** (first value stands); no import, status change, or replay overwrites it. `started_on` is written only while no completion milestone exists. All dates remain **manually editable in the detail view only**.

### AD-12 — The completion invariant is enforced at the boundary (FR-3) [ADOPTED]

- **Binds:** every status/milestone edit.
- **Prevents:** a game left with neither a play status nor a completion milestone.
- **Rule:** Every game always has a play status **or** at least one completion milestone. The API (and detail view) **refuse** any edit that would leave neither — clearing the last milestone requires first setting a play status. Milestone logging is confirm-gated (FR-7); milestones are immutable through normal flows.

### AD-13 — Every tracking row is user-scoped (FR-48) [ADOPTED]

- **Binds:** all user-entered tracking data; the multi-user seam.
- **Prevents:** a future publish requiring a data-model rewrite; cross-user leakage the day a second user exists.
- **Rule:** Every tracking-data row carries a `user_id`; every query filters by it — from row one. No sharing/roles/tenancy is built beyond this seam.

### AD-14 — Actionable failures surface; automatic catalog failures remain passive [ADOPTED; amended AD-31]

- **Binds:** external lookups, seed/add operations, scheduled regional refresh.
- **Prevents:** retry storms and attention banners users cannot resolve.
- **Rule:** Failed enrichment preserves a saved name-only game or import staging record in the stragglers list (AD-22). User-triggered long operations end in a result/summary; persistent attention is reserved for actionable records. Automatic PS+ refresh failures produce structured logs and stale as-of information, never an attention banner or credential-refresh instructions. AD-31 owns background retry/quarantine; providers do not silently retry failed jobs.

### AD-15 — Heavy bulk work runs out-of-band or chunked [ADOPTED]

- **Binds:** seed import; any all-games fan-out.
- **Prevents:** blowing the free-tier **50-external-subrequests**/invocation cap (the IGDB/PSN fan-out; D1 binding calls draw on the separate 1,000-Cloudflare-services bucket, AD-1).
- **Rule:** The one-time **seed import** (enrich ~344 games) exceeds 50 external subrequests, so it runs **out-of-band as a script** (no UI — matches EXPERIENCE.md), writing D1 via the D1 HTTP API / Wrangler with the shared Drizzle schema. Individual add-by-name enrichment and bounded catalog chunks run in-Worker. Any future all-games fan-out that can't fit one invocation must chunk (Cloudflare Workflows/Queues) or run out-of-band.

### AD-16 — Migrations run from CI, never at deploy [ADOPTED]

- **Binds:** schema evolution; deployment.
- **Prevents:** a deploy attempting to run a Node migration script inside workerd (impossible).
- **Rule:** `drizzle-kit generate` emits versioned SQL from the TS schema; `wrangler d1 migrations apply` runs pending files from CI **before** the Worker deploy. The Worker never migrates itself at startup.

### AD-17 — `GAME_TRACKING` is keyed per user, not per game [ADOPTED]

- **Binds:** the `GAME` ↔ `GAME_TRACKING` relationship; every schema/seed/auth unit.
- **Prevents:** one dev keying tracking on `game_id` (1:1) while another keys on `(user_id, game_id)` — both "obeying" AD-13, producing incompatible schemas.
- **Rule:** `GAME_TRACKING`'s primary key is **`(user_id, game_id)`** — one tracking row per user per game (`GAME` 1:many `GAME_TRACKING`). All user-entered state (AD-13) lives here.

### AD-18 — `title_normalized` is a non-unique candidate key; external-ID is identity [ADOPTED]

- **Binds:** schema constraints; add-by-name dedupe (FR-42); cross-source conflict handling.
- **Prevents:** one dev adding a `UNIQUE(title_normalized)` constraint (for FR-42) that makes FR-34's "two distinct games normalize alike" unrepresentable.
- **Rule:** `title_normalized` carries **no uniqueness constraint**. Game identity is the `EXTERNAL_LINK (source, external_id)` (AD-20). Add-by-name dedupe matches on normalized title *then* confirms against the external link; a normalized-title clash with a *different* external id is two games, not one.

### AD-19 — Attribute ownership: shared `GAME` facts vs per-user `GAME_TRACKING` state [ADOPTED]

- **Binds:** every column's home; seed, ingestion, and render units.
- **Prevents:** two owners of shared catalog facts or region-dependent availability.
- **Rule:** **`GAME`** holds shared catalog identity — `title`, `title_normalized`, `release_date`, `cover_url`, `store_url`, genres (via `GAME_GENRE`), and region-independent enrichment such as scores/time-to-beat. PS+ membership and departure facts are regional data under AD-30, never shared `GAME` flags. These are stored inputs (AD-8), written by ingest jobs, not user-editable except via the detail-view genre/cover overrides. **`GAME_TRACKING`** holds per-user mutable state — `play_status`, the milestone/lifecycle dates, `owned`, `ownership_type`, `owned_via`. `owned` is per-user (a physical disc is one user's), so it lives on `GAME_TRACKING`, not `GAME`.

### AD-20 — `EXTERNAL_LINK` is many-per-(game, source) [ADOPTED]

- **Binds:** PS4/PS5 collapse (AD-9); cross-source identity matching and conflict handling.
- **Prevents:** a dev modeling one external id per source, which the PS4/PS5 collapse (two PSN ids → one `GAME`) immediately violates.
- **Rule (namespace fixed 2026-07-14, Epic 7):** `source='PSN'` external ids are **`np_title_id` values only** (`CUSA…`/`PPSA…`, the historical sync namespace). A store **`product_id` is a different source** (`'PSN_PRODUCT'`) and is never written into the `'PSN'` namespace — the unique index makes the two mutually unjoinable, so mixing them would make an add-from-catalog of an already-synced game miss on link, match on title, and (by this AD's own clash rule) create a **mandatory duplicate**. A `GAME` may hold **multiple** `EXTERNAL_LINK` rows per source (both PS4 and PS5 PSN ids resolve to the one PS5 game). Identity matching resolves stored links first (AD-9). The FR-34 conflict is redefined: **an external id that resolves to a *different* `GAME`** than the title match — treated as an identity conflict, never silently merged; the historical sync summary is retired.

### AD-21 — The milestone-log status side-effect has one owner [ADOPTED]

- **Binds:** every surface that logs a completion milestone (shelf popover, detail view) — FR-2.
- **Prevents:** the popover path auto-clearing `play_status` to null (effective "Platinum") while the detail path leaves it "Playing" — two surfaces disagreeing though both obey AD-7's *read* rule.
- **Rule:** A single `core/` milestone-**write** reconciliation function (symmetric to AD-7's read) owns the side-effect: logging `platinum_on` auto-clears `play_status` to null per FR-2 (amended 2026-07-09 — logging `completed_on` leaves the status untouched). Every surface calls it; none hand-rolls the transition.

### AD-22 — "Straggler" is a defined needs-attention record [ADOPTED]

- **Binds:** seed import (FR-28/30), add-by-name name-only (FR-41), the attention banner.
- **Prevents:** one dev treating a straggler as an import staging row and another as a saved-but-unenriched game — two schemas behind one UI list.
- **Rule:** The stragglers list is a view over two explicit kinds: **(a) import staging rows** that couldn't be matched to a `GAME` (carry the Notion payload; *not yet* a `GAME`), and **(b) name-only add-by-name entries** (real `GAME` rows flagged `unenriched`, awaiting IGDB data). FR-30's Notion status-mapping is a pure `core/` function reusing the AD-9 normalizer; **anything it can't place → a straggler, never a guess.**

### AD-23 — PS+ Extra is per-region; region is per-user setting [ADOPTED; amended Epic 8]

- **Binds:** regional ingestion, catalog browsing, Playable-now, and user settings.
- **Prevents:** one user's region repainting another user's availability; different refresh paths choosing different regions.
- **Rule:** Region is a per-user `SETTING` row. `env.PSN_REGION` is a first-boot default for a new user, never a global membership fact or a credential-derived value. Catalog reads derive membership for the requesting user's region; automatic refresh operates over distinct registered-user regions (AD-30/31).

### AD-24 — `PS_PLUS_CATALOG` is a snapshot table, never a `GAME` [Epic 7]

- **Binds:** catalog ingestion, browsing, and explicit add paths.
- **Prevents:** a dev upserting catalog products into `GAME` (which would break "availability is not ownership", AD-10) or hanging `GAME_TRACKING` off a catalog row.
- **Rule:** Catalog products live in **`PS_PLUS_CATALOG`**, keyed **`(region, tier, product_id)`** with `tier` defaulting to `'extra'` (Premium's Classics catalog layers on without a migration rewrite). Its columns are **exactly what the store payload gives** — `product_id`, `np_title_id`, `name`, `title_normalized` (AD-9), `cover_url`, `platforms`, `store_classification`, `store_url` — plus `first_seen_at` / `last_seen_at`. There is **no `release_date` column**: the payload has none (see Deferred). A catalog row becomes a `GAME` **only** through the explicit add path (7.3).
- **What the 7.3 add writes** (or two devs pick differently, both legally): the new `GAME` gets `EXTERNAL_LINK('PSN_PRODUCT', product_id)` (AD-20), IGDB-enriched genres (AD-26), and **the existing add-by-name not-owned default** — `{owned: false, play_status: 'Not started', wishlisted_on: today}` (`services/games.ts` `newTracking`). It is **not owned**: browsing the catalog is not claiming, and `owned_via: 'membership'` is written only by an explicit claim/ownership action or seed entitlement import (AD-10). There is **no `ps_plus` ownership type** — `ownership_type` is `physical|digital` (the format); the *source* is `owned_via: purchase|membership`. When the user's regional catalog contains the game (AD-27/30), it derives as **Wishlisted** and, if released, **Playable-now** — precisely the pre-purchase signal ("I want this; the subscription already covers it"), not a contradiction. `store_url` from the catalog row powers "Claim now".

### AD-25 — Destinations and cross-tree intent travel through the router, never window events [Epic 7; amended Epic 13]

- **Binds:** `web/` shell, shelf, catalog, stats, Play Next, detail; supersedes the Story 6.1 event pattern.
- **Prevents:** the Epic 6 mount-race class (a listener not yet mounted swallowing an event; two live surfaces fed by one input) inheriting into a second destination — Epic 6 retro action item 2.
- **Rule:** **react-router (declarative/library mode)** owns navigation: `/` shelf, `/play-next` Play Next, `/catalog` catalog, `/stats` stats, `/game/:id` detail, `?q=` the active searchable destination's term. `OPEN_DETAIL_EVENT`, `SEED_SEARCH_EVENT`, and `SHELF_SEARCH_EVENT` are **deleted**, replaced by `navigate()` / `useSearchParams`. Adding a new `window` `CustomEvent` for cross-tree state is an **architecture violation, not a judgment call**. Imports come from `react-router` + `react-router/dom` (`react-router-dom` no longer exists in v8).
- **`?q=` belongs to the active destination.** The `SearchBox` is a single global component in the header, rendered above the route outlet — so one input feeding both a shelf `?q=` and a catalog `?q=` would **reintroduce the exact "two live surfaces from one input" class through the URL** instead of a CustomEvent. The header box writes **only the current route's** param, the term is **cleared on destination change**, and the "Add ⟨term⟩ to library" affordance is **shelf-only**.
- **`/game/:id` resolves through its own by-id read route** (`GET /api/games/:id`) — **never** an id lookup in the `['shelf']` list cache. Otherwise 7.3's add-then-navigate lands on the new id before the shelf query refetches and the route renders not-found: the same mount-race, now with a hard 404 on reload. A pending fetch is a **loading state**; only a *resolved* 404 is "not found".
- **Already satisfied:** `wrangler.jsonc` sets `assets.not_found_handling: "single-page-application"` (root + `e2e` env) and carves `/api/*` out via `run_worker_first`, so deep links survive reload and `/api/*` still reaches the Worker. **Keep both** — a router change must not touch that carve-out.

### AD-26 — Two genre vocabularies, never merged [Epic 7]

- **Binds:** the catalog genre filter (7.2) vs. the shelf genre filter (FR-23); the 7.3 add path.
- **Prevents:** PS facet keys being written into `GENRE`/`GAME_GENRE` (IGDB vocabulary, AD-19), so the shelf's genre pills silently grow a `ROLE_PLAYING_GAMES` next to `Role-playing (RPG)`.
- **Rule:** PS-store genres are the `productGenres` **facet keys** (`ACTION`, `ADVENTURE`, `ROLE_PLAYING_GAMES`, …), stored in **`PS_PLUS_CATALOG_GENRE`** — catalog-local, region+tier-scoped.
- **The key list is DISCOVERED per region at ingest, never hardcoded.** Probed 2026-07-14: `de-de` returns **19** keys, `en-us` returns **20** (it adds `MUSIC/RHYTHM`). A pinned 19-key enum would silently drop an entire genre for any region that has one we didn't see — the Story 9.3 `npServiceName` failure exactly (a constant asserted from one sample, wrong across the population). Read the facet list from the unfiltered response each run and sweep whatever it names. Keys are **not** identifier-safe: `MUSIC/RHYTHM` contains a slash and filters correctly only as a URL-encoded `filterBy: ["productGenres:MUSIC/RHYTHM"]` variable — never interpolate a key into a path or an unencoded query. `GENRE`/`GAME_GENRE` stays **IGDB-only**. Localized display names are rendered, never stored. On add (7.3), the new `GAME`'s genres come from **IGDB enrichment**, not from the catalog facet.

### AD-27 — One regional snapshot is the membership truth [ADOPTED; amended AD-30]

- **Binds:** catalog ingestion, shelf membership, Playable-now, and catalog reads.
- **Prevents:** a separate flag-refresh path disagreeing with catalog browsing or another user's region.
- **Rule:** Anonymous ingestion fetches once and upserts/prunes the regional `PS_PLUS_CATALOG` snapshot. Empty catalog responses abort before prune/clear. All membership answers use that snapshot for the requesting user's region through the shared membership derivation; no `GAME.ps_plus_extra` cache is maintained. Owned status does not change membership truth; presentation may hide a redundant PS+ badge on owned games. Departure facts survive snapshot pruning in AD-30's regional ledger.

### AD-28 — The genre sweep is a separate, chunked, additive pass [Epic 7]

- **Binds:** the 7.1 ingest.
- **Prevents:** the genre sweep being coupled into the membership pass, so one flaky genre query takes down the whole snapshot — and an unbounded page count (the sweep grows with the catalog and the facet list, both outside our control) silently walking into AD-15's 50-external-subrequest cap.
- **Rule:** Per-game genre is **not in the product record** — it is only obtainable by re-querying the category once per genre facet key (`filterBy: ["productGenres:HORROR"]`). So the **membership pass** (products) and the **genre-tagging sweep** are separate chunked passes with a resumable cursor (the Story 9.3 backfill pattern). Genre tags are **additive**; a failed genre pass leaves the snapshot valid but partially tagged — it never blocks or invalidates the membership snapshot.
- **Generation-stamped, or the sweep corrupts the snapshot:** each membership pass stamps a **snapshot generation** on the rows it writes; the sweep **carries that generation**, tags only rows belonging to it, and a generation change (a cron prune landing mid-sweep) **invalidates the cursor** rather than resuming into a re-ordered product list and silently skipping a band of games. `PS_PLUS_CATALOG_GENRE` rows **cascade-delete** with their pruned product, so a prune can never leave orphan genre tags.
- **Budget model (2026-07-17 gate; estimates, not live measurements):** fetches are anonymous. Shipped accounting (`psplus.ts` Epic-7 H3 guard): the **membership pass alone ≈ 34 subrequests**, a **genre-sweep chunk ≈ 25+**, the leaving-sweep chunks run ≤ ~42 — the passes are **never combined in one invocation** and each cron fire consumes **one rotation slot**. The decoupled slot model **stands unchanged** under the per-region refresh; AD-31/AD-32 budget regions in rotation slots, not single-invocation regions.

### AD-29 — Registration is open; admission is proven email control [ADOPTED 2026-07-17 — Epic 8 gate, signed off by Luca]

- **Binds:** stories 8.2+; deletes `env.AUTH_ALLOWED_EMAIL` and every allowlist gate. Consumed by 8.2.
- **Prevents:** a Google identity linking into an account without proven control of its email; strangers growing the `verification` table unmetered; free-tier abuse with no throttle.
- **Rule:** Registration is **open** — the "invite" is sharing the URL (Luca's ruling at sign-off, 2026-07-17, overriding the drafted invite-table proposal; no admission table exists). What every door requires instead is **proven control of the email**: magic link proves it by construction; OAuth requires `emailVerified` (the shipped 8.1 rule); the account-**LINK** path links a provider identity only on a **verified** email match — better-auth's by-email linking without that proof is the account-takeover door and stays gated. Story 8.2 **deletes** `isAllowedEmail`, the env var, the magic-link pre-gate, and the `requireAuth` allowlist re-check (a valid session alone gates; emails still stored lowercased). **No de-admission concept exists** — no ban/disable tooling until real abuse appears (the deferred-work "de-allowlisted session" item retires as moot; session-revocation machinery is not built for it).
- **Abuse posture, since the door is open:** better-auth's built-in **in-memory rate limiter** provides per-isolate best-effort burst damping (60 requests/minute; magic-link sign-in 5/minute) — never D1 counter rows, which would hand an attacker a write per anonymous hit against the 100k/day budget (AD-32). The `verification`-row residue gets a **TTL sweep**: expired rows (better-auth stamps `expiresAt`) are deleted on every cron invocation. Capacity is guarded by AD-32's ceilings, not by gating sign-ups (~14k logins/day before the write budget binds; DAU is the real limit). A distributed WAF rate-limit rule is **not configured**: the deployment uses `workers.dev` without a custom domain, and the planned zone rule was ruled out in [Story 8.2 verification](../../../implementation-artifacts/spec-8-2-real-users-can-register-b1b.md#verification). Revisit that deployment constraint only if a custom domain is adopted. No roles, no sharing, no tenancy beyond AD-13's seam.

### AD-30 — PS+ facts are per-region data; per-user answers are derivations [ADOPTED 2026-07-17 — Epic 8 gate, signed off by Luca]

- **Binds:** `game.ps_plus_extra`, `ps_plus_left_on`, `ps_plus_leaving_on`, `psn_concept_id`; the three flag writers; stories 8.3/8.4. Consumed by 8.3.
- **Prevents:** user B's region check repainting user A's catalog pills (the B2 write-collision); per-user snapshot copies burning the 100k/day write budget (~100 users/day ceiling).
- **Rule:** The former four PS+ columns on shared `GAME` are removed; regional facts split by lifecycle: **membership** (`ps_plus_extra`) derives from `PS_PLUS_CATALOG` itself — extending AD-27: the table is sole truth, and the former cache answer is a **derivation**: *user's region (AD-23) joined against region-scoped data, through the existing single `core/` membership function*. **The departure facts (`ps_plus_left_on`, `ps_plus_leaving_on`, `psn_concept_id`) cannot live in the snapshot** — a departed game is precisely the one whose snapshot row the prune deleted (AD-28 cascade). They move to a **mandatory region-keyed departure ledger**, keyed **`(region, tier, product_id)`** (carrying `np_title_id`/normalized title for the library join), written by the leaving/left sweeps and **surviving every prune**; the 8.3 migration preserved existing values in region rows. **Never a per-user copy of catalog rows.** Writer map: the **stale guard** writes the membership snapshot; **cron** writes snapshot and departure data; the **cancel-PS+ un-claim** (Story 6.4, `POST /settings/cancel-ps-plus` — shipped, not future) mutates only per-user `GAME_TRACKING` (`owned`/`owned_via`) and, post-8.3, touches **no shared flag** — the "per-user shape" it writes *is* the tracking row; the per-user membership answer re-derives. `critic_score`/`user_score`/`ttb_*` are region-independent shared facts and **stay on `GAME`**.

### AD-31 — The scheduled refresh is per-region, with a region-state ledger [ADOPTED 2026-07-17 — Epic 8 gate, signed off by Luca]

- **Binds:** `runScheduledPsPlusCheck`, the cron trigger, story 8.4. Consumed by 8.4.
- **Prevents:** a cron that loops N users (N fetches of the same catalog, N snapshot writes — the write cliff); silent regional starvation when a refresh fails; failure banners users can't act on.
- **Rule:** The cron fans out over the **distinct regions of registered users** — one **anonymous** fetch, one shared snapshot per region. *(External surface: the public PS+ catalog endpoint, no account identity, no credential on the wire — the credentialed path died with Epic 11.)* A **region-state ledger** row per region/tier — `last_success`, `last_attempt`, `failure_count`, cycle-complete, **`last_user_activity`** — drives each fire under AD-28's rotation-slot model (one slot per fire, a full region cycle ≈ 7–8 slots, AD-32). Ordering: **failed/stale regions first**, with a **quarantine guard**: after **3 consecutive failures** a region drops to **one attempt per cycle** at the back of the rotation (the shipped 2-attempt leaving-sweep livelock guard's shape) — a poison region can never starve the rotation it sorts ahead of.
- **Target activity/guard contract (implementation gap DW-15):** `last_user_activity` is touched by any authenticated request of an admitted user in that region (at most one ledger write per region per day). **Skip** a region idle **60 days by that measure**, or already cycle-complete. The **stale-snapshot guard** (> **35 days**) fires on session establishment, on a **region-setting change** (to a region with a missing/stale snapshot), and on the **first authenticated request of a day** — long-lived sessions and mid-session region moves both reach it; a user with no region setting gets the first-boot default (AD-23) and is never region-less. The guard triggers a `waitUntil` **membership pass only** (≈34 subrequests fit beside a request; AD-28 forbids bundling sweeps), under a **region-keyed single-flight lock** (the `withPsnLock` pattern re-keyed region-wide — concurrent same-region sign-ins or a sign-in landing mid-cron coalesce to one refresh); genre tags and departure data follow via the cron, where the revived region sorts first. The UI shows "PS+ catalog updating…" beside the as-of timestamp.
- **Cycle-complete** (the definition `epics.md` defers here): membership pass **and** full genre sweep **and** leaving sweep all succeeded within the current **rotation window** (the `15-28` cron window of the calendar month); the flag resets when a new window opens. Sweep cursors and leaving-state live in the **region ledger**, having moved from per-user `SETTING` rows — a userless per-region cron cannot key state by user. Ledger rows remain permanent. The adopted target also calls for pruning idle-region snapshot/genre/departure data after a full idle cycle and rebuilding on revival; that cleanup is **not implemented** in baseline 3.6.0 (DW-16). This is distinct from ordinary membership prune, which preserves departure history (AD-30).
- **Refresh failures are passive** (structured logs + staleness via the as-of date — no attention banners; amends AD-14's banner rule for this path: users have no action to take). The former refresh-failure banner machinery and manual button are retired. In multi-user, the **manual check button is removed** — snapshot writes come only from cron and the stale-snapshot guard.

**Baseline implementation gaps:** the adopted targets above remain requirements, not claims of shipped coverage.

| Tracking | Current 3.6.0 behavior | Remaining adopted target |
|---|---|---|
| [DW-15](../../../implementation-artifacts/deferred-work.md#dw-15-ad-31-activity-and-stale-guard-triggers-are-narrower-than-approved) | Only Shelf GET, including its 304 path, touches activity and schedules stale recovery. Region save waits for the next Shelf GET. Guard attempts are daily-gated, skipped after three failures, and protected by the region lock. | Cover other authenticated activity/session/region-change triggers without violating daily, quarantine, locking, or response-path rules. |
| [DW-16](../../../implementation-artifacts/deferred-work.md#dw-16-ad-31-idle-region-data-cleanup-is-not-implemented) | Cron skips regions with activity older than 60 days; it does not delete their stored datasets. | Implement the approved full-idle-cycle cleanup/revival policy, preserving the region ledger and avoiding cross-region deletion. |

### AD-32 — Free-tier budgets are enumerated arithmetic, not intents [ADOPTED 2026-07-17 — Epic 8 gate, signed off by Luca]

- **Binds:** every cron fan-out and read path; stories 8.4/8.6; extends AD-15. Consumed by 8.4 and 8.6.
- **Prevents:** a budget that counts the fetches it's thinking about and ignores D1 binding calls or middleware reads (the Epic 9 bug, twice).
- **Rule:** The adopted planning budget (capacity research 2026-07-17; not a current provider-capacity verification): **50 external subrequests/invocation**, **5M D1 rows read/day**, **100k rows written/day** (indexed writes bill ~double; D1 bills rows *scanned*, not returned) — and the configured rotation budget, **cron fires: ~28/month** (`0 9,21 15-28 * *`).
- **Per-region rotation arithmetic** (shipped H3 accounting, AD-28 amendment): membership pass ≈ **34** subrequests, genre sweep ≈ **5 chunks** of ~25+, leaving sweep ≈ 1–2 chunks of ≤~42 — a full region cycle ≈ **7–8 rotation slots**, one slot per fire. **~28 fires/month ÷ ~8 slots ≈ a 3–4-region ceiling per month at the current cadence.** That is the real region cap and it is fine at launch scale (the gate's initial single-region example); when the distinct-region count approaches it, the remedy is **denser fires inside the 15–28 window** (subject to provider limits verified at that change) or splitting slots across two triggers — named here so 8.4 states its plan against this number, not discovers it.
- **Write arithmetic:** a full ~490-row snapshot write ≈ **~1,000 row-writes** → regions × ~1,000/**month** ≪ 100k/**day**, vs the rejected per-user model ≈ 1,000/user/**day** = a ~100-user hard cliff. Writes are **not** the binding constraint per-region — reads are (which is why AD-33 §5 rejects the diff-upsert micro-optimization).
- **Per request:** a whole-library scan ≈ **~1,500 rows** (historical shelf and pre-8.6 game-by-id paths) + the session read + the library-version read (AD-33 ETag) (a version bump also costs +1–2 indexed writes per tracking edit; the signed-off open-registration model adds no per-request admission read). Research's session model: an active session ≈ **~9,000 rows** → 5M ÷ 9,000 ≈ **~550 DAU** pre-8.6 (the oft-quoted ~3,300/day is a *single-endpoint* max, not a DAU figure). 8.6's enumerated fixes lift the read ceiling to ≈ **~2,000 DAU** (research); the **~6,600** figure is the change proposal's *request-cap* ceiling — reachable only once reads stop binding (ETag/cache multipliers, unquantified). Any new fan-out or scan states its arithmetic against these numbers before merging.

### AD-33 — Catalog delivery is paged and version-keyed; unchanged reads answer 304 [ADOPTED 2026-07-17 — Epic 8 gate, signed off by Luca]

- **Binds:** the shelf/catalog read routes, story 8.6's read-budget work. Consumed by 8.6 (and 8.4's snapshot writes).
- **Prevents:** every shelf refetch re-scanning the whole library; the catalog route hauling 490 rows per page view; stale cached answers surviving mutations or snapshot refreshes.
- **Rule:** (1) **Single-row reads for single rows** — `GET /games/:id` reads `WHERE id = ?`, never load-library-and-find; counts use SQL `COUNT(*)`. (2) **Catalog delivery to the FE is paged** with SQL `LIMIT/OFFSET` in stable `ORDER BY title_normalized, product_id` display order, never whole-snapshot per page. Page zero may scan the filtered set once to compute collapsed-card totals. Each page carries its generation; the client restarts paging when that changes. (3) **Per-active-region catalog cache, version-keyed on the snapshot generation** (AD-28's stamp) — every completed refresh rotates the generation (full write, AD-28), so the cache key rotates with it, including a zero-change refresh. (4) **Per-user library version for ETag/304** — an unchanged shelf refetch answers 304, not a re-scan. The invariant, not just the mechanism: **every repository write path that mutates a user's tracking or library bumps that user's version** — 8.6 enumerates the writer list (status, milestones, dates, ownership, add/discard/revive, un-claim, the 8.5 backfill) and a missed bump is a correctness bug (a stale 304 never self-heals). (5) **Diff-based snapshot upserts are REJECTED** — deliberately overriding the change proposal here: a diff write leaves unchanged rows on an old generation, which silently breaks AD-28's generation-carried sweep and prune (the "skipped band of games" failure it exists to prevent), to save ~1,000 row-writes/region/*month* against a 100k/*day* budget (AD-32) — integrity bought back for ~1% of a day's writes. (6) Optional: better-auth `session.cookieCache` — if enabled, its TTL **bounds revocation latency** (a revoked session stays live until expiry — relevant to sign-out-everywhere and any future ban path), so the TTL is capped at **≤ 5 minutes** or the option stays off. The shipped cookie cache uses a five-minute TTL; user scoping remains mandatory (AD-13).

### AD-34 — Play Next is a pure derivation over cached Shelf data [ADOPTED 2026-08-02 — Epic 13]

- **Binds:** Epic 13; `/play-next`; recommendation eligibility, ranking, explanations, diversity, and visit state.
- **Prevents:** a second recommendation data path, persisted preference machinery the product did not request, opaque scoring, external render I/O, and UI components independently inventing candidate rules.
- **Rule:** `core/` owns pure candidate eligibility, Finish them classification, additive scoring, explanation facts, closest-match relaxation, slate diversity, and seeded tie-breaking. Missing data is absence, never zero or a guessed fact. Play Next's release rule is deliberately conservative but distinct from FR-12: known future dates are excluded; known released and unknown/TBA dates remain eligible.
- **Access rule:** owned and currently playable PS+ games are always candidates when lifecycle-eligible. `Include wishlist` adds only non-owned, non-PS+-playable wishlist games. `Playing`, `Platinum`, and `Dropped` are always excluded. `Paused` and story-completed-but-not-platinumed games form Finish them; default Surprise me allows at most one such card, while explicit Finish them intent lifts the cap.
- **Client boundary:** `web/play-next/` owns ephemeral `draftIntent`, `activeIntent`, current slate, `seenGameIds`, and pool-exhaustion state. It reuses TanStack Query's cached `['shelf']` payload and existing ETag behavior. State resets when the destination unmounts; nothing is persisted.
- **Actions:** router owns `/play-next` and detail travel per AD-25. `Open details` preserves the mounted visit state. `Play this` reuses the existing status-to-`Playing` mutation, lifecycle reconciliation, query invalidation, toast, and race guards.
- **No new backend surface:** no new route, schema, migration, provider, cron, external recommendation service, LLM, or machine-learning system.
- **Verification:** pure core tests pin rule boundaries and seeded selection; web tests pin draft/applied intent and exhaustion state; Playwright covers every visible Epic 13 acceptance criterion. Every UI-changing story remains blocked until its implementation-specific mock is approved.

## Consistency Conventions

| Concern | Convention |
| --- | --- |
| Language / modules | TypeScript throughout; layer namespaces `core/ services/ repositories/ providers/ routes/` (AD paradigm). Core is a dependency sink. |
| API contract | Hono routes; **Zod** schema at every boundary, shared SPA↔Worker; typed RPC client. |
| Entities & keys | `snake_case` DB columns; normalized title (AD-9) is the cross-source match key; a permanent external-ID/alias link (FR-29) survives re-sync. |
| Dates | Milestones & lifecycle dates are `DATE`/ISO-8601; write-once automatic, edit-only-in-detail (AD-11). Derived "Released" compares release date ≤ today (AD-8). |
| State | Play status is the only user-set mutable state; everything else is computed (AD-7/8) or write-once (AD-10/11). |
| Auth | better-auth magic link + configured Google OAuth, open verified-email registration (AD-29); every tracking query is `user_id`-scoped (AD-13). |
| Navigation | react-router owns destinations and cross-tree intent (AD-25); URL is the state. **No `window` `CustomEvent` for cross-tree state.** |
| Play Next | Pure derivation in `core/`; ephemeral visit state in `web/play-next/`; cached `['shelf']` input only (AD-34). |
| Genre vocabularies | IGDB genres → `GENRE`/`GAME_GENRE` (the shelf). PS facet keys → `PS_PLUS_CATALOG_GENRE` (the catalog). Never merged (AD-26). |
| Secrets | Auth, email, IGDB/Twitch and optional Google OAuth credentials via Worker secrets; local development values stay uncommitted. No PSN account credential exists (AD-5). |
| Errors / feedback | Actionable feedback follows EXPERIENCE.md; automatic catalog failures use logs + as-of staleness (AD-14/31). |
| Testing | Vitest via `@cloudflare/vitest-pool-workers` for Worker+D1; pure core unit-tested without runtime. Lint+format = Biome. |

## Stack

| Name | Version / pin |
| --- | --- |
| Runtime | Cloudflare Workers (workerd), TypeScript |
| Hosting | One Worker + Workers Static Assets (SPA) |
| Database | Cloudflare D1 (SQLite) |
| ORM / migrations | Drizzle ORM 0.45.x + drizzle-kit |
| API router | Hono (+ typed RPC client) |
| Validation | Zod |
| Client server-state | TanStack Query |
| UI / build / PWA | React 19.2 + Vite 8 + vite-plugin-pwa |
| Routing | **react-router 8.2.x** — installed; Declarative/library mode (no Vite plugin, so no Vite floor). ESM-only; peer React ≥19.2.7 (repo: 19.2.7 ✓); `engines.node ≥22.22` is metadata only — CI and the build run **Bun 1.3.14**, no Node. Import from `react-router` / `react-router/dom` (`react-router-dom` is gone in v8). AD-25 |
| Scheduling | Cloudflare Cron Triggers |
| Auth | better-auth 1.6.23 (magic link + optional Google OAuth) |
| PS data | Anonymous PS Store catalog operations only (AD-5) |
| Games DB | IGDB (Twitch OAuth2 client-credentials) |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` |
| Lint + format | Biome v2 |
| Legacy (frozen) | Python 3.11 bootstrap scripts — seed only, no new code |

## Structural Seed

Core entities (names + relationships only; attribute-level rules are ADs, not this diagram):

```mermaid
erDiagram
  USER ||--o{ GAME_TRACKING : tracks
  GAME ||--o{ GAME_TRACKING : "tracked by (1 row per user, AD-17)"
  GAME ||--o{ GAME_GENRE : tagged
  GENRE ||--o{ GAME_GENRE : groups
  GAME ||--o{ EXTERNAL_LINK : "identified by (many per source, AD-20)"
  USER ||--o{ SETTING : configures
  PS_PLUS_CATALOG ||--o{ PS_PLUS_CATALOG_GENRE : "tagged (PS facet keys, AD-26)"

  GAME { string title string title_normalized "non-unique, AD-9/18" date release_date string cover_url string store_url bool unenriched "AD-22b" }
  GAME_TRACKING { string user_id PK string game_id PK string play_status "nullable per FR-2" date completed_on date platinum_on date started_on date bought_on date wishlisted_on bool owned string ownership_type string owned_via }
  GENRE { string name "IGDB vocabulary, FR-23" }
  EXTERNAL_LINK { string source "PSN|PSN_PRODUCT|IGDB" string external_id }
  IMPORT_STRAGGLER { string source_title string notion_payload "AD-22a, not yet a GAME" }
  SETTING { string key string value "per-user region and preferences" }
  PS_PLUS_CATALOG { string region PK string tier PK "default 'extra'" string product_id PK string np_title_id string name string title_normalized "AD-9, non-unique" string cover_url string platforms string store_classification string store_url date first_seen_at date last_seen_at }
  PS_PLUS_DEPARTURE { string region PK string tier PK string product_id PK date leaving_on date left_on }
  PS_PLUS_REGION_STATE { string region PK string tier PK date last_success date last_user_activity }
  PS_PLUS_CATALOG_GENRE { string region PK string tier PK string product_id PK string genre_key PK "PS facet enum, NOT IGDB (AD-26)" }
```

Attribute ownership is an invariant (AD-19): `GAME` = shared catalog facts (stored inputs); `GAME_TRACKING` = per-user mutable state. `PS_PLUS_CATALOG` is a **third** owner class — a fetched store snapshot that is neither (AD-24): no `user_id`, no tracking, no link to `GAME` except the AD-9 normalized title used to mark "already in my library" at render.

Deployment & environments:

```mermaid
flowchart LR
  Dev["Local: wrangler dev / miniflare + local D1"] -->|drizzle-kit generate| CI
  CI["CI: wrangler d1 migrations apply → wrangler deploy"] --> Prod
  subgraph Prod["Cloudflare (production)"]
    W[Worker: SPA + API] --> D[(D1)]
    C[[Cron: regional PS+ rotation and daily scores]] --> W
  end
  W -->|ingest jobs only| PSN[PSN API]
  W -->|ingest jobs only| IGDB[IGDB]
  Seed["Out-of-band seed script → D1 HTTP API"] -.-> D
```

**Delivery & operations:**

- **Trunk-based development:** `main` is the trunk; short-lived branches merged fast. Production release is explicit; merging a branch does not deploy.
- **CI on every push/PR:** Biome (lint+format) + Vitest (workers pool) + `tsc`.
- **Deploy on published GitHub Release** (checkout released tag), or `workflow_dispatch`: `wrangler d1 migrations apply` → `wrangler deploy` (AD-16 order). Optional manual-approval gate on the production step guards *destructive* migrations — the one real footgun for a DB-backed app.
- **Deployment source:** [release workflow](../../../../.github/workflows/deploy.yml) owns triggers, verification, secrets synchronization, and serialized production deployment. [Worker configuration](../../../../wrangler.jsonc) owns scheduled expressions.
- **Observability:** structured logs over ingest jobs + cron runs, inspected via `wrangler tail`; automatic catalog failures stay passive, with as-of staleness in-app (AD-14/31).
- **Backup/DR:** D1 **Time Travel** (point-in-time recovery) is the primary safety net; the FR-49 **CSV export** is the user-held second copy — the DB provider's backups are deliberately not the only copy.

Source tree (scaffold, not a mirror):

```text
ps-game-catalog/
  src/
    core/          # pure domain (AD-3): effective/derived state, normalize, reconcile
    services/      # seed, regional catalog/scores ingestion, add-by-name
    repositories/  # Drizzle/D1 access (AD-4)
    providers/     # psn/, igdb/ adapters (AD-5)
    routes/        # Hono handlers + Zod (API)
    schema/        # Drizzle schema + zod contracts (shared)
  web/             # React SPA (Vite) — shelf, detail, filters, search
  migrations/      # drizzle-kit SQL (applied in CI, AD-16)
  scripts/         # out-of-band seed (AD-15); legacy Python (frozen)
  wrangler.jsonc   # Worker + D1 binding + cron
```

## Capability → Architecture Map

| Capability / Area | Lives in | Governed by |
| --- | --- | --- |
| The Shelf, cards, filters, search (§3) | `web/` + read routes | AD-6, AD-7, AD-8 |
| State model & effective/derived state (§2) | `core/` | AD-3, AD-7, AD-8, AD-11, AD-12 |
| Seed import (§4.1) | `scripts/` (out-of-band) + `services/` | AD-9, AD-10, AD-15, AD-18, AD-20, AD-22 |
| PS library/trophy sync (retired) | No route, provider credential, or UI | AD-5 |
| PS+ Extra check (§4.3) | `services/` + Cron Trigger | AD-1, AD-5, AD-14, AD-19, AD-23, AD-27 |
| PS+ catalog snapshot + genre sweep (7.1) | `services/psplus` + `providers/psn` + `repositories/` | AD-24, AD-26, AD-27, AD-28, AD-15 |
| Catalog destination — browse/filter/search (7.2) | `web/catalog/` + read routes | AD-6, AD-25, AD-26 |
| Add or claim from the catalog (7.3) | `services/` + `providers/igdb` | AD-10, AD-18, AD-24, AD-26 |
| Navigation & cross-tree intent | `web/` router | AD-25 |
| Play Next eligibility, ranking, explanations, diversity | `core/` | AD-3, AD-7, AD-8, AD-34 |
| Play Next destination and visit state | `web/play-next/` + router | AD-25, AD-34 |
| Add-by-name (§4.4) | `services/` + `providers/igdb` | AD-5, AD-9, AD-14, AD-18, AD-22 |
| Stragglers (§4.1/4.4) | `services/` + attention banner | AD-22 |
| State model & milestone writes (§2) | `core/` | AD-7, AD-11, AD-12, AD-21 |
| Game vs tracking schema | `schema/`, `repositories/` | AD-17, AD-18, AD-19, AD-20 |
| Lifecycle dates (§4.5) | `core/` + `repositories/` | AD-11 |
| Auth, open registration, permanent account deletion | better-auth + `repositories/users` | AD-13, AD-29, AD-33 |
| Scores/time-to-beat and departure warnings | IGDB enrichment + regional catalog/ledger | AD-5, AD-6, AD-19, AD-30 |
| Stats and platform preferences | User-scoped read routes + settings | AD-6, AD-13, AD-23 |
| Persistence / migrations | `repositories/`, `migrations/` | AD-4, AD-16 |
| CSV export (FR-49) | `routes/` streaming from D1 | AD-4, AD-6 |

## Deferred

| Area | Revisit condition |
| --- | --- |
| Sale detection and notifications | Product approves pricing source and delivery channel; [PRD addendum](../../prds/prd-ps-game-catalog-2026-07-05/addendum.md#sale-detection--notifications--future). |
| Roles, sharing, per-user rate isolation, per-tenant D1 | Demonstrated product or abuse need; open registration already ships under AD-29. |
| Distributed auth rate limiting / custom domain | Deployment gains a zone/custom domain; current limiter is per-isolate (AD-29). |
| Staging environment or release branches | Delivery need beyond current release-tag production workflow. |
| Storage migration | Measured need beyond current D1 deployment; AD-4 preserves repository seam. |
| Catalog release dates | Approved ingest source and budget; current anonymous snapshot has no release date. Added library games may use IGDB enrichment. |
| PS+ Premium/Classics | Product approves tier support; AD-24 already scopes keys by tier. |

Historical proposals for credentialed PSN auth/trophies are retired by [Epic 11's approved proposal](../../sprint-change-proposal-2026-07-15.md). Scores/time-to-beat, departure warnings, Google OAuth, Stats, Play Next, platform preferences, and permanent account deletion are shipped baseline, not deferred work. Implementation evidence: [package](../../../../package.json), [auth](../../../../src/services/auth.ts), [catalog browsing](../../../../src/services/psplus-browse.ts), and [release deployment](../../../../.github/workflows/deploy.yml).
