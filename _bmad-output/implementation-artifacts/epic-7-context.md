# Epic 7 Context: Browse the PS+ Catalog & Add

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 5 only told you which games *you already track* are in the PS+ Extra catalog. Epic 7 turns the catalog itself into a stored, first-class dataset and a second place in the app you can *be*: the monthly PS+ refresh persists the whole per-region catalog (~490 products), a new Catalog destination lets Luca browse and filter it, and any catalog game can be promoted into the library in one step (or claimed on the PS Store). The point is discovery before rotation — seeing what the subscription already covers instead of only diffing it against the shelf. Scope is PS+ **Extra**, but the data model is tier-aware from row one so Premium's Classics catalog layers on without a migration rewrite. Landing this epic also forces the app's first real router, retiring the window-event bus that produced Epic 6's mount-race bugs.

## Stories

- Story 7.0: Foundation — architecture & UX design gate (artifacts, no runtime code)
- Story 7.1: Persist the PS+ catalog as browsable data
- Story 7.2: Browse the catalog (a genre-filterable destination)
- Story 7.3: Add — or claim — a game from the catalog

## Requirements & Constraints

- The full per-region catalog is stored as its own dataset — never as `game` / `game_tracking` rows. The monthly refresh both upserts and prunes so the table is a faithful current snapshot (FR-50).
- The catalog destination renders that stored data as a shelf-style, paged/virtualized grid with a genre filter and name search, and marks games already in the library so they can't be re-added (FR-51, FR-42 dedup parity). Covers/genres are read from storage, never fetched at render time.
- Adding a catalog game promotes it into the library through the existing add preview with IGDB enrichment on demand; catalog membership immediately lights its PS+ flag. **"Claim now"** is only ever a deep link to the regional PS Store product page — there is no in-app claim (that would be an undocumented authenticated write against the user's real account) (FR-52).
- No auto-adding of catalog games, ever. Availability is not ownership; catalog games rotate out. The whole catalog sitting in the DB makes "just join it onto the shelf" tempting — it is explicitly rejected.
- Never a blank grid: the empty/needs-refresh state is a first-class surface (NFR-4).
- Depends on Epic 6 (7.3 reuses its add-by-name preview and `IgdbProvider`); otherwise independent of Epics 1–5.

## Technical Decisions

**Catalog storage (AD-24).** `ps_plus_catalog` is a snapshot table keyed `(region, tier, product_id)`, `tier` defaults to `'extra'`. Columns are exactly what the store payload gives — `product_id`, `np_title_id`, `name`, `title_normalized` (shared normalizer), `cover_url`, `platforms`, `store_classification`, `store_url` — plus `first_seen_at` / `last_seen_at`. **There is no `release_date` column: the store payload has none** (confirmed by a live probe of `categoryGridRetrieve`). Catalog rows are **not** `GAME` rows, get no `GAME_TRACKING`, and become games only via the explicit 7.3 add path.

**Genres (AD-26, AD-28).** Genre is **not on the product record**. It exists only as a store category facet (`productGenres`, ~19 locale-independent enum keys) reachable by one filtered re-query per key (`filterBy: ["productGenres:HORROR"]`). Store them in `ps_plus_catalog_genre` — a **separate vocabulary** from the shelf's IGDB `GENRE`/`GAME_GENRE`; the two must never merge (a PS key must never land in the IGDB tables, and vice versa). Localized names are rendered, never stored. On add, the new game's genres come from IGDB enrichment, not the facet.
The genre sweep is a **separate, chunked, generation-stamped, additive pass** with a resumable cursor: the membership pass stamps a snapshot generation on the rows it writes; the sweep carries that generation and a generation change invalidates the cursor rather than resuming into a re-ordered list. A failed sweep leaves the snapshot valid but partially tagged — it never blocks membership. Genre rows cascade-delete with pruned products. (Today's page arithmetic ~30 of the 50-subrequest cap — the decoupling buys partial-failure isolation, not headroom; don't "optimize" it back into one pass.)

**One fetch, one source of truth (AD-27).** The ingest fetches **once**, upserts + prunes `ps_plus_catalog`, and the tracked-game `ps_plus_extra` flag pass then reads **the table**, not a second fetch. `ps_plus_catalog` is the **sole source of truth** for membership; `game.ps_plus_extra` is a denormalized cache that must be maintained for **every** tracked game with a match — **including owned ones**. Today's flag pass writes only non-owned rows, so an owned catalog game reads `true` in the table and `false` on the flag: that is the bug 7.1 fixes. Every membership read (shelf pill, Playable-now, catalog in-library marker) goes through one `core/` function, never a hand-rolled join. The **empty-catalog guard** (a 200 with zero products = provider failure) stays a hard abort and runs **before any prune or clear** — it now guards two datasets.

**Routing (AD-25).** 7.2 adopts **react-router 8.x, library/declarative mode** (import from `react-router` / `react-router/dom`; `react-router-dom` no longer exists). Routes: `/` shelf, `/catalog`, `/game/:id`. The three window CustomEvents — `OPEN_DETAIL`, `SEED_SEARCH`, `SHELF_SEARCH` — are **deleted** and replaced by `navigate()` / `useSearchParams`; adding a new cross-tree `CustomEvent` is an architecture violation, not a judgment call. `?q=` belongs to the **active destination only** and is cleared on switch (one header box writing both destinations' params would reintroduce the "two live surfaces, one input" bug class through the URL). `/game/:id` **must** resolve through a by-id read route (`GET /api/games/:id`), never an id lookup in the shelf list cache — otherwise 7.3's add-then-navigate races the shelf refetch and renders not-found. A pending fetch is a loading state; only a resolved 404 is "not found". The SPA `not_found_handling` + `/api/*` `run_worker_first` carve-out in wrangler config must survive the router change untouched.

**External-id namespaces (AD-20).** `source='PSN'` external ids are `np_title_id` values **only** (`CUSA…`/`PPSA…`). A store `product_id` is a **different source** (`'PSN_PRODUCT'`) and must never be written into the `'PSN'` namespace — mixing them makes an add-from-catalog of an already-synced game miss on link, match on title, and create a mandatory duplicate. A game may hold multiple links per source.

**What a catalog add writes (AD-24).** The new game gets `EXTERNAL_LINK('PSN_PRODUCT', product_id)` (AD-20), IGDB genres (AD-26), and the **existing add-by-name not-owned default** — `{owned: false, play_status: 'Not started', wishlisted_on: today}` (`services/games.ts` `newTracking`). Browsing the catalog is not claiming it.

**Ownership vocabulary — do not invent values.** `ownership_type` is **`physical | digital`** (the *format*). The acquisition *source* is **`owned_via: purchase | membership`**. A PS+ claim **counts as owned** with `owned_via: 'membership'` and never stamps `bought_on` (FR-9 amended, 2026-07-11; un-claimed on subscription cancel, Story 6.4) — but ownership is set **only when a sync observes the real entitlement**, never because the user opened the PS Store tab. There is no `ps_plus` ownership type.

**Derived state is unchanged by this epic.** `wishlisted = !owned`; `playableNow = (owned || inPsPlusExtraCatalog) && released` (`core/derived-state.ts`). So a catalog-added game is **Wishlisted *and* Playable-now** — that pairing is the point (*I want it; the subscription covers it, so don't buy it*), not a contradiction to be designed away. `store_url` on the catalog row powers "Claim now".

## UX & Interaction Patterns

- **Two destinations.** Shelf is home; Catalog is the one other place you can be. Everything else (modals, popovers, banner) surfaces *over* the active destination.
- **Header segmented toggle `SHELF | CATALOG`** — both labels always visible, one tap either way, same control on phone and desktop.
- **One search box, scoped to what you're looking at.** Library on the Shelf, catalog on the Catalog; term clears on switch. Catalog search = case-insensitive substring, live with a small debounce. The `＋ Add "<name>"` row is **Shelf-only** — on the Catalog, no match means `NO MATCH` (you cannot conjure a game into Sony's catalog by typing it).
- **Catalog card** reuses shelf card chrome but is *not* a shelf card: **no status pill, no owned toggle, no flip, no release date**. Shows cover, title, the `◈ PS+` flag. Three exclusive states: **already in library** (text marker, no CTA), **addable** (`＋ Add` → add preview → on save navigate to `/game/:id`), and alongside Add, **`Claim now`** (opens the regional PS Store deep link in a new tab).
- **No catalog detail page.** The add preview (IGDB-enriched, with the "Not the right game?" picker) *is* the confirm surface; a read-only detail in front of it would duplicate the decision and be the one screen where tapping a cover doesn't flip it.
- **Genre filter only** — multiselect over the PS-store facet vocabulary, OR within the group. No state/ownership/flag filters, since these aren't tracked games. Phone: the existing Filters bottom sheet (genre group only). Desktop: inline genre dropdown in the filter row.
- **Empty state has three distinct causes, three distinct answers**: no region set → `NO REGION` + button into Settings; region set but never refreshed → `EMPTY CATALOG` + run **Check PS+ Extra** right there; last refresh failed → the existing attention banner posture plus a stale-but-labeled grid where one exists (a stale catalog beats no catalog, as long as it says so).
- **Freshness readout** reuses the header timestamp: `PS+ CATALOG AS OF <date>`.
- **Paging**: ~490 games virtualize/page (same infinite scroll as the shelf) — never a 490-card DOM. Phone 2-up, desktop auto-fill.
- **Accessibility**: `＋ Add` and `Claim now` are real buttons with game-specific accessible names ("Add Crow Country to library", "Claim Crow Country on the PlayStation Store" — and say it opens a new tab), not two bare icons repeated 490 times. The in-library marker is text, not a color state.

## Cross-Story Dependencies

- **7.0 gates 7.1–7.3**: no catalog code merges before the data model and the catalog-destination UX are signed off (already satisfied by the amended architecture and UX spines).
- **7.1 → 7.2/7.3**: the grid and the add path read the stored snapshot; the flag-pass fix in 7.1 is what keeps the shelf pill and the catalog grid from giving opposite answers for the same game.
- **7.2 → 7.3**: the router lands in 7.2; 7.3's post-add navigation to `/game/:id` depends on it *and* on the by-id read route.
- **7.2 deletes live code**: the three CustomEvents exist in `web/shelf/SearchBox.tsx` and `web/shelf/open-detail.ts`, are consumed by `web/shelf/Shelf.tsx`, and are asserted in `Shelf.test.tsx`, `SearchBox.test.tsx`, `SyncSummaryModal.test.tsx` — removing them rewrites those suites. Not a doc-only change.
- **Epic 6 → 7.3**: reuses the add preview, the "Not the right game?" picker, and `IgdbProvider`.
- **Epic 5 → 7.1**: extends `runPsPlusCheck` (manual button + cron) rather than adding a parallel ingest; the region comes from the stored setting, and the empty-catalog abort guard is inherited.
