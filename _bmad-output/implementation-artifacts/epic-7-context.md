# Epic 7 Context: Browse the PS+ Catalog & Add

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn the full per-region PS+ Extra catalog (~490 games) into a browsable, genre-filterable, searchable destination — not just a membership flag on games already tracked — so what the subscription covers can be discovered before a title rotates out. Adding a game promotes it into the library through the existing add preview (IGDB enrichment on demand, saved as wishlisted); a "Claim now" deep-link opens the PS Store product page so the user claims it on their own account. Built tier-aware so PS+ Premium can layer on later without a migration rewrite. Post-v1.0.0 enhancement; unaffected by the 2026-07-15 PSN account-safety correct-course because every catalog call is anonymous.

## Stories

- Story 7.0: Foundation — architecture & UX design gate
- Story 7.1: Persist the PS+ catalog as browsable data
- Story 7.2: Browse the catalog (a genre-filterable destination)
- Story 7.3: Add — or claim — a game from the catalog

## Requirements & Constraints

- Full per-region catalog stored as a first-class dataset in its own table — never `game`/`game_tracking` rows (auto-add non-goal holds; availability is not ownership). Populated and pruned to a faithful snapshot by the monthly PS+ refresh. Tier-aware: `tier` column defaulting to `'extra'`.
- Catalog destination: shelf-style paged/virtualized grid with genre filter and name search; games already in the library are marked (dedup parity with add-by-name).
- Adding promotes via the existing add preview with the existing not-owned defaults (`owned: false`, status `Not started`, `wishlisted_on` stamped); catalog membership lights the PS+ flag, so the game derives Wishlisted + Playable-now.
- "Claim now" opens `store.playstation.com/{region}/product/{productId}` in a new tab. No direct in-app claim — an authenticated add-to-library mutation against the user's real PSN account was investigated and declined (undocumented write, irreversible on a mistaken tap).
- Nothing external on render: covers/genres come from the persisted PS-store payload; IGDB is hit only at add time.
- Empty catalog or unset region shows a how-to-refresh state, never a blank grid (failures surface).
- Free-tier subrequest budget (50 external per invocation) bounds the ingest; the genre sweep is chunked with a resumable cursor for partial-failure isolation and headroom.

**PSN account-safety correct-course (2026-07-15):** the credentialed PSN surface (library sync, trophy sync, NPSSO auth) is being removed by Epic 11; account-ban risk exists only where a credential goes on the wire. The anonymous PS+ catalog fetch (no cookie, no bearer — locale-override header only) carries no account identity and is explicitly unaffected. Do not add any credentialed call in this epic. Consequence for 7.2/7.3 wording that references "a sync observes the entitlement": the automated library sync no longer exists, so a claimed game becomes `owned` (`owned_via: 'membership'`) only through the manual ownership flow — the catalog still never infers that a claim succeeded.

## Technical Decisions

- **`ps_plus_catalog` is a snapshot table, never a `GAME`.** No `user_id`, no tracking, no FK to `GAME`; the only bridge is the shared normalized-title key used at render to mark "already in my library". Scoped by region + tier; browsable fields upserted from the store product payload (product id, `np_title_id`, title, `title_normalized`, cover URL, platforms, store URL). Rows become tracked games only via explicit add (7.3).
- **One catalog fetch feeds both the snapshot and the tracked-game flag pass.** The ingest fetches once, upserts + prunes the table; the `ps_plus_extra` flag pass then reads the table, not a second fetch (flag maintained for every tracked match, owned games included, so shelf and catalog never disagree). The empty-catalog wipe guard (200 with zero products = provider failure) runs before any prune and stays a hard abort — it now guards two datasets. Consolidation is mandatory, not optional.
- **Store payload has no release date and no genres** (live probe, 2026-07-14). Release date is dropped from the model. Genres are only obtainable as category facets, so genre tagging is a separate chunked, generation-stamped sweep (one query per facet key) writing `ps_plus_catalog_genre` — additive; a failed genre pass leaves the membership snapshot valid but partially tagged, never blocks it. Do not fold it back into one pass.
- **Two genre vocabularies, never merged.** PS-store facet keys (~19 locale-independent, e.g. `ROLE_PLAYING_GAMES`) live in `ps_plus_catalog_genre`; the shelf's IGDB vocabulary lives in `GENRE`/`GAME_GENRE`. PS facet keys must never be written into the IGDB tables.
- **react-router (library mode, v8 — import from `react-router`, not `react-router-dom`) replaces window CustomEvents.** Routes `/` (shelf), `/catalog`, `/game/:id`. The three `window` CustomEvents (`OPEN_DETAIL`/`SEED_SEARCH`/`SHELF_SEARCH`) are deleted, not extended — they were Epic 6's recurring mount-race bug source. URL is the state; cross-tree intent travels via `navigate()`/`useSearchParams`.
- **`/game/:id` resolves through its own by-id read route** (`GET /api/games/:id`), never an id lookup in the shelf list cache — otherwise add-then-navigate races the refetch and 404s. A pending fetch is a loading state; only a resolved 404 is "not found".
- Account region comes from the persisted setting (user-editable as of 2026-07-15); catalog membership stored per region.
- Provider seam: all PS-store calls go through the PSN provider adapter — now anonymous-only.

## UX & Interaction Patterns

- Header segmented toggle `SHELF | CATALOG` switches destinations in one tap. The `?q=` search param belongs to the active destination and is cleared on switch — a shelf search never silently filters the catalog. The `＋ Add "<name>"` search row stays shelf-only.
- Catalog cards reuse shelf card chrome (cover, title) but carry no status pill, no owned toggle, no flip — those are tracked-game concepts.
- Ordering is plain alphabetical (case-insensitive, locale-aware `localeCompare` with `sensitivity: 'base'`) — no state or ownership tiers. Do not reuse the shelf comparator (`compareShelf` in `core/shelf.ts`); reuse only its title comparison. Tracked games are neither hoisted nor hidden.
- Card states keyed on the remaining action: untracked → **Add** + **Claim now**; tracked-but-not-owned → **In library** (cyan) + **Claim now** still offered; owned → **Owned** (silver), no actions.
- Genre filter uses only the PS facet vocabulary; genre-only — no state/ownership filters. Catalog search is a case-insensitive substring match with a small debounce, scoped to the catalog dataset.
- After an add, navigate to the editable `/game/:id` detail; no read-only catalog detail page sits between browsing and the add preview.
- Standard dark-only token system, feedback channels, and accessibility floor (44×44 targets, always-on focus outlines, no color-alone signaling) apply as everywhere.

## Cross-Story Dependencies

- **7.0 gates 7.1–7.3:** no catalog code merges before the data model and catalog-destination UX are signed off (landed 2026-07-14 as architecture decisions AD-24–AD-28 and the amended story ACs).
- **7.1 → 7.2/7.3:** browsing and adding read the stored snapshot 7.1 builds. 7.1 extends the existing Epic 5 PS+ check (button + monthly cron) from a names-only diff to full product records.
- **Epic 6 dependency:** 7.3 reuses the add-by-name preview, IGDB provider, and dedup behavior; Epic 7 lands after Epic 6.
- **Downstream:** Epic 10's "leaving PS+ soon" warnings diff the snapshot 7.1 builds, so Epic 10 follows this epic. The `tier` column exists from row one so PS+ Premium is a later config + UI change, not a migration.
