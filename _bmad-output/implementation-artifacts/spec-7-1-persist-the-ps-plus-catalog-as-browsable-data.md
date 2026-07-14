---
title: 'Story 7.1 — Persist the PS+ catalog as browsable data'
type: 'feature'
created: '2026-07-14'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** The monthly PS+ check fetches the region's catalog, keeps only the product *names*, flags tracked non-owned games, and throws the rest away. The catalog itself is never stored, so it cannot be browsed (7.2) or added from (7.3). The flag it maintains is also wrong for owned games — they never get one — so a stored catalog and the existing flag would give opposite answers for the same game.

**Approach:** Widen the provider's catalog fetch from `string[]` to full product records, persist them into a new region+tier-scoped `ps_plus_catalog` snapshot table (upsert + prune, generation-stamped), and make the existing `ps_plus_extra` flag pass read *that table* instead of a second fetch — maintaining the flag for every matched tracked game, owned included. Genres are not on the product record, so they arrive via a separate chunked, resumable sweep that re-queries the category once per discovered genre facet key.

## Boundaries & Constraints

**Always:**
- `ps_plus_catalog` rows are **never** `game` / `game_tracking` rows (AD-24). No `user_id`. No FK to `game`. A catalog row becomes a game only through 7.3's explicit add.
- **One fetch feeds both** the snapshot and the flag pass (AD-27). `ps_plus_catalog` is the sole membership truth; `game.ps_plus_extra` is a denormalized cache maintained for **every** tracked game whose normalized title matches — **owned games included** (today's code writes only non-owned rows; that is the bug this story fixes).
- **The empty-catalog guard runs before any prune or clear** and now protects two datasets, so it stays a hard abort (`{ok:false, reason:'provider'}`), never a warning.
- The genre facet key list is **discovered from the response at ingest, never hardcoded** — probed 2026-07-14: `de-de` = 19 keys, `en-us` = 20 (adds `MUSIC/RHYTHM`). Keys are not identifier-safe (`MUSIC/RHYTHM` has a slash) and must only travel inside the URL-encoded `filterBy` variable.
- Genre tagging is **additive and generation-stamped** (AD-28): a failed or partial sweep leaves the membership snapshot valid, never blocks it. Genre rows die with their pruned product.
- Reuse the existing patterns, don't invent: `acquirePsnLock`/`releasePsnLock` with a **rotating token as the capability** (a cursor is never authority), keyset cursor paging where a short page *is* the end, and `db.batch()` in slices for any write whose row count scales with the catalog.
- Restate the subrequest arithmetic honestly, counting **D1 binding calls and the auth middleware's own reads**, not just external fetches.

**Block If:**
- The persisted-query hash (`CATALOG_QUERY_HASH`) stops resolving (`PersistedQueryNotFound`) — the wire contract has moved and no amount of local reasoning recovers it.
- Storing per-product cover art turns out to require a second per-product fetch (~490 extra subrequests) rather than riding the `media[]` array already in the grid payload.

**Never:**
- No release-date column. The store payload has none (probed) — do not synthesize one, do not fetch one per product.
- Do not write PS facet genre keys into `genre` / `game_genre` (the IGDB vocabulary) — separate table, separate vocabulary (AD-26).
- Do not write a store `product_id` into the `'PSN'` external-link namespace (AD-20). No external links at all in this story.
- No UI. 7.1 is ingest + schema only; the destination is 7.2.
- Do not auto-add catalog games to the library. Availability is not ownership.
- **Do not touch ownership or derived state.** `ownership_type` stays `physical|digital`, the source stays `owned_via: purchase|membership`, and `wishlisted = !owned` / `playableNow = (owned || inPsPlusExtraCatalog) && released` stay exactly as shipped. This story only makes `ps_plus_extra` *correct* (owned games included) — it changes no derivation and invents no ownership value. A game being in the catalog has never meant, and must not start meaning, anything about who owns it.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Happy refresh | Region set, catalog returns 490 products | Products upserted; rows absent from the response pruned; `ps_plus_extra` set/cleared on every matched tracked game (owned included); `psplus_refreshed_at` stamped | None |
| Degenerate: empty catalog | HTTP 200, `products: []`, `totalCount: 0` | **Hard abort** `{ok:false, reason:'provider'}`. Snapshot and every flag survive untouched | Provider failure; cron lights the attention banner |
| Degenerate: bad region | HTTP 200, `categoryGridRetrieve: null`, error with empty message | Same hard abort — a 200 is not success | Provider failure |
| Degenerate: bad category id | HTTP 200, `errors: ["Category ID … "]`, null grid | Same hard abort | Provider failure |
| Legit end of pagination | HTTP 200, `products: []` **but `totalCount: 490`** and offset > 0 | Normal loop termination — **not** the wipe case. The guard must key on the *accumulated* product count, not on any single empty page | None |
| Game leaves the catalog | Product in snapshot, absent from this run's response | Row pruned; its genre rows cascade away; the tracked game's `ps_plus_extra` cleared | None |
| Owned game in catalog | Tracked, `owned: true`, title matches | `ps_plus_extra` = **true** (today: never set — the divergence bug) | None |
| Genre sweep partial failure | Sweep dies on key 12 of 20 | Membership snapshot stays valid and complete; 11 keys' tags are live; the sweep resumes from its cursor | Per-key failure is a skip, not an abort |
| Concurrent refresh | A refresh already holds the PSN lock | Second caller gets 409 busy; PSN sees no second fan-out | 409 |
| Genre key with a slash | `MUSIC/RHYTHM` (en-us) | Filters correctly via the URL-encoded `filterBy` variable; tag stored verbatim | None |

</intent-contract>

## Code Map

- `src/providers/psn.ts` -- `fetchPsPlusExtraCatalog(region): Promise<string[]>` currently drops everything but `name`; `CatalogPage.products` is typed `{name?: string}[]`. Widen both. Catalog consts (`CATALOG_QUERY_HASH`, `PS_PLUS_CATALOG_CATEGORY`, `CATALOG_PAGE_SIZE=100`, `CATALOG_MAX_PAGES=30`) and `catalogPageUrl(offset)` live here; `filterBy` is already a variable in that URL builder.
- `src/schema/catalog.ts` -- Drizzle tables. Add `psPlusCatalog` + `psPlusCatalogGenre`. Conventions: snake_case columns, composite PK via `primaryKey({columns:[…]})` in the array-returning third arg, index names `<table>_<cols>_idx`.
- `migrations/` -- highest is `0008_classy_skin.sql`; this story generates `0009_*` via `drizzle-kit generate`. Applied in CI, never at runtime (AD-16).
- `src/repositories/psplus-catalog.ts` -- **new.** Snapshot upsert/prune + genre tag writes. Batch idiom to copy: `setTrophyCountsBatch` (`src/repositories/tracking.ts`), which slices at 50 and `db.batch(statements as [Stmt, ...Stmt[]])`, returning the set of ids that actually persisted.
- `src/repositories/games.ts` -- `setPsPlusExtraFlags(db, gameIds, value)` (bulk `inArray` update) and `listLibraryForUser` (returns `LibraryRow[]`, filters `discarded`). The flag pass's candidate filter `!row.owned` is what must go.
- `src/services/psplus.ts` -- `runPsPlusCheck` / `runScheduledPsPlusCheck`. The fetch-completes-before-any-write ordering and the empty-catalog guard are load-bearing; keep both, extend to two datasets.
- `src/services/psn-lock.ts` -- `PsnOp` is `'library-sync'|'trophy-sync'|'platinum-backfill'` — **no catalog member, and `routes/psplus.ts` takes no lock today.** Add `'catalog-refresh'`.
- `src/services/backfill.ts` + `src/routes/sync.ts` -- the chunked-cursor + rotating-lock-token pattern to mirror for the genre sweep (`CHUNK_SIZE`, `nextCursor` null-on-short-page, `acquirePsnLock(…, cursor ? heldToken : undefined)`, release only on the terminating chunk, `?release=1` brake).
- `src/routes/psplus.ts` -- `POST /api/ps-plus-check`, `no-region`→409 / `provider`→502. Gains the lock + the sweep's chunk endpoint.
- `worker/index.ts` -- `scheduled()` cron calls `runScheduledPsPlusCheck`; cron is `0 21 15-21 * *`.
- `test/integration/psplus.test.ts`, `psplus-cron.test.ts` -- hand-rolled `stubCatalog(names, status)` returning `{data:{categoryGridRetrieve:{products:names.map(n=>({name:n})), pageInfo:{totalCount}}}}`. Must be rebuilt around real captured payloads.
- `test/integration/psn-lock.test.ts` -- the bypass tests (a cursor is not a capability; a forged token gets 409). The sweep needs its equivalents.

## Tasks & Acceptance

**Execution:**
- [ ] `test/fixtures/psn/` -- **new.** Land the captured payloads probed 2026-07-14 (dated, verbatim, from the live endpoint): a real catalog page (products carry `id`, `name`, `npTitleId`, `platforms`, `media[]`, `price`, `storeDisplayClassification` — and **no** genres, **no** release date), a genre-facet response (`de-de` 19 keys / `en-us` 20 incl. `MUSIC/RHYTHM`), a genre-filtered page, and the three degenerate 200s (empty catalog, null grid on a bad region, null grid + error on a bad category). -- No fixture convention exists yet; hazard tests must assert against reality, not a stub built from the assumption (PROBE-BEFORE-YOU-MAP, DEGENERATE-RESPONSE GUARD).
- [ ] `src/providers/psn.ts` -- Widen `CatalogPage.products` to the real record and change `fetchPsPlusExtraCatalog(region)` to return `PsnCatalogProduct[]` (`productId` = `id`, `npTitleId`, `name`, `platforms`, `coverUrl` picked from `media[]`, `storeClassification`). Add `fetchPsPlusCatalogGenreKeys(region)` (reads `facetOptions[name='productGenres'].values[].key` off the unfiltered page) and `fetchPsPlusExtraCatalogByGenre(region, genreKey)` (adds `filterBy: ["productGenres:<KEY>"]` to the existing variables). -- The adapter is the only place external I/O may live (AD-5); genres are only reachable as a facet re-query (AD-28).
- [ ] `src/schema/catalog.ts` + `migrations/0009_*.sql` -- Add `ps_plus_catalog` (PK `(region, tier, product_id)`, `tier` default `'extra'`, cols `np_title_id`, `name`, `title_normalized`, `cover_url`, `platforms`, `store_classification`, `store_url`, `generation`, `first_seen_at`, `last_seen_at`; index on `title_normalized`) and `ps_plus_catalog_genre` (PK `(region, tier, product_id, genre_key)`, FK to the snapshot **`onDelete: 'cascade'`**). **No `release_date` column.** -- AD-24/AD-26/AD-28.
- [ ] `src/repositories/psplus-catalog.ts` -- **new.** `upsertCatalogProducts(db, region, tier, generation, products)` (batched in 50s), `pruneCatalogGeneration(db, region, tier, generation)` (deletes rows not of this generation → genre rows cascade), `listCatalogTitleKeys(db, region, tier)` (normalized titles, for the flag pass), `setCatalogGenres(db, region, tier, generation, tags)` (batched, additive), `listGenreSweepCandidates(…, {after, limit})` (keyset cursor over genre keys). -- Copy `setTrophyCountsBatch`'s batch idiom; a per-row loop over ~490 products would blow the subrequest budget (BUDGET-COUNTS-EVERY-SUBREQUEST).
- [ ] `src/services/psplus.ts` -- Rewrite `runPsPlusCheck` to: fetch once → **guard** (see below) → upsert + prune the snapshot under a new generation → derive the flag pass **from the stored table**, over **all** tracked games (drop the `!row.owned` filter) → stamp freshness. Keep fetch-completes-before-any-write. -- AD-27; the owned-game flag gap is the divergence the gate found.
- [ ] `src/services/psplus-genres.ts` -- **new.** The chunked sweep: discover the facet keys, walk them by keyset cursor, `filterBy` each, write tags additively under the current generation, return `nextCursor` (null on a short page). A per-key failure is a skip, not an abort. -- AD-28, mirroring `backfill.ts`.
- [ ] `src/services/psn-lock.ts` + `src/routes/psplus.ts` -- Add `'catalog-refresh'` to `PsnOp`; wrap the refresh route in the lock; add the sweep's chunk endpoint using the `acquirePsnLock(…, cursor ? heldToken : undefined)` / release-on-terminating-chunk / `?release=1` shape. Decide and state whether the **cron** path takes the lock (it should — the cron and the button fan out to the same host). -- The PS+ path is unguarded today; this story multiplies its fan-out by ~6×.
- [ ] `test/integration/psplus.test.ts` (+ new `psplus-genres.test.ts`) -- Hazard tests, each from a **captured** payload: empty catalog leaves snapshot **and** every flag intact; a null grid (bad region) is a provider failure, not an empty catalog; an empty page at `offset>0` with `totalCount: 490` terminates normally and **does not** trip the wipe guard; an **owned** catalog game gets `ps_plus_extra: true`; a departed product is pruned and its genre rows cascade; a genre key containing a slash round-trips; the sweep resumes from its cursor after a mid-key failure with the membership snapshot intact. -- HAZARD-TEST RULE: every named hazard gets a red-then-green test.
- [ ] `test/integration/psn-lock.test.ts` -- The **bypass** tests for the new op: a second refresh while one holds the lock → 409, PSN sees zero extra calls; a sweep continuation presenting a **forged/stale token** → 409; a continuation presenting its own token renews (and **rotates**) it and proceeds; the terminating chunk leaves no lock row. -- TEST-THE-BYPASS-NOT-JUST-THE-REFUSAL + CAPABILITY-IS-NOT-AN-IDENTIFIER: the sweep's cursor (a genre key) is server-published data and authorizes nothing.
- [ ] `playwright/COVERAGE.md` -- Add rows for 7.1's ACs with the reason `no UI flow — ingest only; the catalog destination lands in 7.2`. -- PLAYWRIGHT-COVERAGE RULE: no UI-facing AC in this story, so every AC gets a coverage row instead of a test.

**Acceptance Criteria:**
- Given a region and a healthy catalog, when the refresh runs, then every product is stored with its cover and store URL, products that left are pruned, and no `game` or `game_tracking` row is created for any of them.
- Given the snapshot is written, when the flag pass runs, then it reads the stored table (not a second fetch) and `game.ps_plus_extra` is correct for **every** tracked game with a matching normalized title — including owned ones — so the shelf pill and the catalog table can never disagree.
- Given a catalog response that is syntactically fine but semantically empty (zero products, or a null grid on HTTP 200), when the refresh runs, then it fails closed: the previous snapshot and every existing flag survive, and the cron surfaces the failure.
- Given the genre facet list differs by region, when the sweep runs, then it sweeps the keys the *response* named — not a hardcoded list — and a region carrying an extra genre loses none of it.
- Given a genre sweep that fails partway, when it is resumed, then the membership snapshot was never invalidated and the sweep continues from its cursor without re-walking completed keys.
- Given a refresh or sweep is already running for a user, when a second one is triggered (including with a hand-crafted cursor or a stale lock token), then it is refused with 409 and PlayStation is never called twice concurrently.

## Design Notes

**The wipe guard must not confuse "empty" with "finished".** Probed reality: an offset past the end returns HTTP 200, `products: []`, **and `totalCount: 490`** — a legitimate loop terminator. The degenerate wipe case is a *first* page with nothing in it. So the guard keys on the **accumulated** product count after pagination completes (`products.length === 0` overall → abort), never on a single empty page. Getting this backwards either wipes the shelf on a bad response or hangs the pagination loop.

**Flagging owned games changes no UI — verified, do not "fix" the guards.** `ps_plus_extra` is a *stored fact* (is this game in the catalog?); every surface already renders the *derivation* `psPlusExtra && !owned`: the card badge (`web/shelf/Card.tsx:155`), the PS+ filter pill (`web/shelf/filters.ts:97`, `Shelf.tsx:214`), and Story 6.4's buy-vs-claim prompt (`useTrackingMutations.ts:298`, which only fires while `!game.owned`). So maintaining the flag for owned games surfaces no badge on an owned card — it merely stops the stored fact from being false. `services/tracking.ts`'s "re-flag on un-own" becomes a harmless no-op. **Do not remove those `&& !owned` guards** to compensate; they are the display rule, not a workaround.

**Generation stamping** is what keeps a cron prune from corrupting an in-flight sweep (AD-28). Each membership pass mints a generation (a timestamp or uuid) and stamps every row it writes; the prune deletes rows *not* of that generation; the sweep carries the generation it started under and refuses to write tags for a different one — a generation change invalidates its cursor instead of letting it resume into a re-ordered product list.

**Cover art** rides the `media[]` array already in the grid payload (roles include `MASTER`, `GAMEHUB_COVER_ART`, `PORTRAIT_BANNER`). Pick a portrait role, fall back down a preference list; a product with no usable image stores `null` rather than costing a second fetch.

**Subrequest ledger (honest, per AD-15's 50 external / invocation):**
- *Membership pass:* 5 catalog pages (490 / 100) + 0 auth legs (the catalog endpoint needs no bearer) + D1: auth middleware (~3) + region/npsso reads (~2) + snapshot batch writes (`ceil(490/50)` = 10) + prune (1) + flag reads/writes (~3) + lock claim (1) ≈ **25 of 50.**
- *Genre sweep, per chunk:* keys are swept a few per request, each key costing `ceil(count/100)` pages (ACTION 240 → 3; most → 1). Chunk size must be set so `pages + D1 writes + auth (~3) + lock (1–2)` stays under 50 — state the chosen constant with its arithmetic in the code, as `backfill.ts` does.

## Verification

**Commands:**
- `bun run lint` -- expected: Biome clean.
- `bun run typecheck` -- expected: `tsc --noEmit` passes (the `db.batch` tuple cast is required — copy `setTrophyCountsBatch`).
- `bun run test` -- expected: all Vitest projects green, including the new hazard + bypass tests.
- `bunx drizzle-kit generate` -- expected: emits `0009_*.sql`; verify by inspection that it creates both tables with the composite PKs and the cascade, and **adds no `release_date` column**.

**Manual checks:**
- After a local refresh against the real endpoint, `ps_plus_catalog` holds ~490 rows for the region with covers populated, `ps_plus_catalog_genre` holds tags across every key the facet response named, and no row appeared in `game` or `game_tracking`.
