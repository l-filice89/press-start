---
title: 'Story 8.6: Free-tier read-budget hardening'
type: 'refactor'
created: '2026-07-17'
status: 'done'
baseline_revision: '81bce7c'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/research/technical-cloudflare-free-tier-capacity-research-2026-07-17.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** The hot routes scan the whole library per hit: `GET /games/:id` bakes ~350 games to return one (~1,500 rows), `GET /settings` runs two full scans for two counts, the catalog route reads all ~490 snapshot rows plus the user's whole library every page view, and every shelf refetch re-reads everything even when nothing changed. DAU ceiling ≈ ~550 (5M D1 rows/day ÷ ~9,000 rows per active session).

**Approach:** AD-33 (signed off 2026-07-17), minus the dropped diff-upserts: single-row by-id reads, SQL `COUNT(*)`, SQL-paged catalog with page-scoped in-library markers, a two-component version ETag (per-user library version + global shared-facts version) answering 304 on unchanged shelf refetches, and better-auth `session.cookieCache` (TTL ≤5 min). Target: active session ~9,000 → ~2,500 rows (~2,000 DAU).

## Boundaries & Constraints

**Always:**
- Response SHAPES are unchanged on every route (same Zod schemas); this story changes how rows are read, never what clients see — except catalog ordering (below).
- **Catalog ordering ruling:** SQL becomes the source of truth — `ORDER BY title_normalized COLLATE NOCASE, product_id` paged with `LIMIT/OFFSET`; the in-memory `compareTitle` sort and whole-snapshot read retire for the catalog route. Edition-collapse runs per page; a group straddling a page boundary may render in both pages — accepted cosmetic ceiling, marked with a `ponytail:` comment.
- **In-library markers are page-scoped:** matched via `IN` clauses over the returned page's normalized titles / np-title-ids / product-ids — never a whole-library or whole-links-table read per request.
- **ETag invariant (the version bump):** ETag = `W/"<library_version>-<shared_facts_version>"`. `library_version` is a per-user SETTING row bumped by **every user-scoped writer** (status, milestone, ownership, dates, discard/revive, genre add/remove, add-game, straggler resolve, cancel-membership, seed import, rematch). `shared_facts_version` is a global SETTING-style row bumped by **every shared `game`-fact writer** (PS+ flags, leaving sweep, concept-id clear, score refresh, enrich/backfill). One bump per service call, at the service seam — not per repo primitive. **A missed bump is a stale-304 correctness bug**: after ANY write, the next conditional GET must return 200 with fresh data (this is the bypass path — test it per writer category, not just the 304 refusal).
- 304s are conditional-GET only (`If-None-Match`); an unconditional GET always answers 200 + body. The SPA's `callApi` sends `If-None-Match` and treats 304 as "use retained data", never as an error.
- `session.cookieCache` enabled with `maxAge` ≤ 300s (AD-33 §6 revocation-latency bound).
- Single-row `GET /games/:id` returns byte-identical card data to today's bake for the same game (parity-tested against the whole-library path).
- No schema migration, no D1 DDL — versions live in the existing `setting` table (global row under a reserved user-id-like key or a dedicated well-known userId constant; pick one, document it).
- Free-tier arithmetic honesty (AD-32): the ETag check adds ≤2 setting reads per request; state the net per-session row estimate in the Auto Run Result.

**Block If:**
- The catalog SQL ordering cannot preserve the genre/search filters' correctness (filters must stay in SQL as today).
- Achieving 304 on the shelf requires changing the shelf response schema.

**Never:**
- No diff-based snapshot upserts (dropped at the 8.0 sign-off — AD-33 §5).
- No per-user copies of catalog data; no new dependencies; no Workers KV/Cache API in this story (the per-region response cache can layer later — YAGNI until read metrics demand it).
- Do not touch auth gates, cron logic, or the PS+ write paths beyond inserting version bumps.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| By-id hit | `GET /games/:id`, id in user's library | Single-row read (+genres for that id), card identical to old bake | No error |
| By-id miss | id absent/another user's | 404, same shape as today | No error |
| Conditional shelf, unchanged | `If-None-Match` matches current versions | 304, empty body; SPA renders retained data | Not an error in `callApi` |
| Conditional shelf, after a write | Any writer ran since the ETag was minted | 200 + fresh body + new ETag | No error |
| First-ever request | No version rows exist | Versions lazily initialized; 200 + ETag | No error |
| Catalog page boundary | Edition group straddles pages N/N+1 | Group may appear in both — accepted, `ponytail:` documented | No error |
| Catalog filters | genre/search + LIMIT/OFFSET | Filtered in SQL, paged in SQL, counts correct | No error |
| Stale cookieCache | Session revoked, cache TTL not expired | Access persists ≤300s then dies | Accepted bound (AD-33 §6) |

</intent-contract>

## Code Map

- `src/repositories/games.ts` -- `listLibraryForUser` (:419); add `findLibraryRowById(db, userId, gameId)` (same join, `WHERE game.id = ?`); add SQL count helpers (stragglers/membership).
- `src/services/shelf.ts:132-189` -- `loadLibrary`/`getGameById` (whole-library + `.find()`, ponytail-flagged); `getGameById` switches to the single-row read + `listGenresForGames([id])` + `bakeCard`.
- `src/services/stragglers.ts` / `src/services/tracking.ts:159` -- `countStragglers` / `countMembershipClaims` become SQL `COUNT(*)`.
- `src/services/psplus-browse.ts` (:11-19 ponytail note, :188 whole-library marker read, :251-252 full link scans, :259-265 in-memory slice) + `src/repositories/psplus-catalog.ts` `listCatalogForBrowse` (:301) -- SQL paging + page-scoped markers; `listCatalogGenreFacets` (:316) loses its second full read.
- `src/services/library-version.ts` (new) -- `bumpLibraryVersion(db, userId)`, `bumpSharedFactsVersion(db)`, `readVersions(db, userId)`; SETTING-backed.
- Writer seams gaining one bump each: `src/services/tracking.ts` (:40, :88, :122, :187, :212, :247), `src/services/genres.ts` (:35, :60), `src/services/games.ts` (`addGame` :303, `rematchGame` :469 — also shared bump), `src/services/stragglers.ts` (resolve), `src/services/seed-import.ts` (:51), shared-fact writers in `src/services/psplus.ts`, `src/services/psplus-leaving.ts`, `src/services/scores.ts`.
- `src/routes/shelf.ts:65-72` -- ETag mint + `If-None-Match` check; `src/routes/games.ts:171-173` -- by-id route unchanged shape.
- `src/services/auth.ts:68-146` -- add `session: { cookieCache: { enabled: true, maxAge: 300 } }`.
- `web/shelf/api.ts:97` (`callApi`), :286 (`fetchShelf`) -- send `If-None-Match`, retain last body per URL, return retained data on 304.
- Tests: `test/integration/shelf.test.ts`, `games.test.ts`, `settings.test.ts`, `psplus-browse.test.ts`; `playwright/COVERAGE.md` (+ existing e2e stay green: `epic1-shelf`, `epic2-detail`, `epic7-catalog`).

## Tasks & Acceptance

**Execution:**
- [x] `src/repositories/games.ts` -- `findLibraryRowById` + `countUnenrichedForUser` + `countMembershipClaimsForUser` (drizzle `count()`), reusing `listLibraryForUser`'s join/filter semantics.
- [x] `src/services/shelf.ts` + `src/services/stragglers.ts` + `src/services/tracking.ts` -- swap `getGameById` and the two counts onto the new reads; delete the stale ponytail flags.
- [x] `src/repositories/psplus-catalog.ts` + `src/services/psplus-browse.ts` -- `LIMIT/OFFSET` in `listCatalogForBrowse` (NOCASE order), page-scoped marker lookups (`IN` over page keys), facets path stops re-reading the snapshot; update the header ponytail note to the new ruling.
- [x] `src/services/library-version.ts` (new) + one bump per writer seam listed in the Code Map -- user-scoped writers bump user version; shared-fact writers bump shared version; `rematchGame` bumps both.
- [x] `src/routes/shelf.ts` -- mint the version ETag (single-component — see Spec Change Log #1), answer 304 on match; lazily init versions.
- [x] `src/services/auth.ts` -- `session.cookieCache` (300s).
- [x] `web/shelf/api.ts` -- `If-None-Match` + per-URL retained body + 304 handling in `callApi`/`fetchShelf`.
- [x] `test/integration/` -- (a) by-id parity vs old bake + 404; (b) counts equal full-scan truth incl. zero cases; (c) shelf 304 hazard suite: 304 on unchanged, then **200-after-write for EVERY writer category** (status, milestone, ownership, dates, discard, genre, add, cancel-membership, rematch, PS+ flag write, score write) — the bypass tests; (d) catalog paging: page N ∪ N+1 covers the filtered set in order, filters+counts intact.
- [x] `playwright/COVERAGE.md` -- rows for the transport-level ACs (no UI flow: ETag/304, cookieCache, counts); existing shelf/detail/catalog specs re-run green as the UI-parity evidence.

**Acceptance Criteria:**
- Given a library of N games, when `GET /games/:id` runs, then D1 reads for it are O(1) rows (~10), not O(N), and the payload is unchanged.
- Given `GET /settings`, when counts are computed, then no whole-library rows are read for them.
- Given the catalog route, when a page is served, then rows read scale with the page (~60 + page-scoped marker keys), not the snapshot (~490) plus the whole library.
- Given an unchanged library, when the SPA refetches the shelf with `If-None-Match`, then the Worker answers 304 and the shelf renders identically from retained data.
- Given any write from any writer category, when the next conditional shelf GET runs, then it answers 200 with the change visible (no stale 304 — per-writer hazard tests).
- Given the full suite, when `vitest`, `tsc -b`, `biome check`, and the existing Playwright specs run, then all green.

## Spec Change Log

### 2026-07-17 — Recorded deviations from the intent-contract (review finding: undocumented divergence)

Schema reality overrode two contract prescriptions; the invariant (any write → new ETag; no whole-set reads per hit) is fully held, the mechanisms differ. KEEP all of the following in any re-derivation:

1. **ETag is single-component `W/"<library_version>"`, not `W/"<user>-<shared>"`.** The contract's global shared-facts row cannot exist: `setting.user_id` carries a FK to `user` (schema/catalog.ts:238-241) and the contract also forbids migrations — the stronger rule wins. Shared-fact writers instead rotate EVERY user's row in one `UPDATE ... WHERE key='library_version'` (`updateSettingForAllUsers`). Same invalidation, one statement; the write cost is N rows per sweep instead of 1 — at sweep cadence (monthly per region) this is noise against 100k/day, re-examine only if sweeps ever run per-request.
2. **`clearPsnConceptIds` does not bump**: `psn_concept_id` is not in the shelf DTO — no rendered surface changes, so no invalidation is owed. (The contract listed "concept-id clear" mechanically.)
3. **Catalog page 0 reads the full filtered set** (later pages read `PAGE_SIZE+1`): the collapsed-card `total` (DW-11 chip parity — "Fighting 13" must equal the filtered grid) is a whole-set fact. A pure LIMIT/OFFSET page 0 would reintroduce the DW-11 SKU-vs-card mismatch. `listCatalogGenreFacets` keeps its full read for the same parity-by-construction reason.
4. **First-ever shelf request costs 3 setting reads** (get + insert-if-absent + re-read), not the contract's "≤2" — one-time per user, then 1/request.

## Review Triage Log

### 2026-07-17 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 2, medium 3, low 8)
- defer: 0
- reject: 2
- addressed_findings:
  - `[high]` `[patch]` **`resolveStraggler`'s `enrichGame` rewrote SHARED game facts (title/cover/scores) with only an actor bump** — any other user tracking the row 304'd against a renamed game forever. Both resolve paths now `bumpAllLibraryVersions`.
  - `[high]` `[patch]` **`addGame`'s existing/converged branches touch a shared row** (`applyCatalogOrigin` backfills cover/store URL) with only an actor bump — same stale-304 class. Both shared-row branches now bump-all.
  - `[medium]` `[patch]` **The bypass suite tested the helper, not the writers**: shared-fact rotation is now driven through the real seams (`rematchGame`, `resolveStraggler`, `addGame`-on-shared-row) — deleting a writer's bump fails the suite. (The cron writers' gates share the same one-line pattern; their suites already pin the write paths.)
  - `[medium]` `[patch]` **No `Cache-Control` on an ETag'd per-user body** — heuristically cacheable by shared proxies (RFC 9111). `Cache-Control: private` on 200 and 304.
  - `[medium]` `[patch]` **Undocumented spec deviations** — recorded above in the Spec Change Log; task text corrected.
  - `[low]` `[patch]` `If-None-Match` now parses the RFC 9110 list form + `*` (an aggregating proxy no longer silently defeats the 304); route test covers the list form and uses the production variant `?include=hidden`.
  - `[low]` `[patch]` Later catalog pages no longer pay a count query for values only page 0's response feeds (`total`/`snapshotTotal` are placeholders there, documented).
  - `[low]` `[patch]` Client hygiene: `etagCache.clear()` on sign-out (no previous account's bodies retained); defensive dedupe-by-productId on the page flatten (a mid-scroll refresh could overlap pages before the generation re-key lands).
  - `[low]` `[patch]` Ledger truthing: scores.ts worst-case reconciled with psplus.ts (38 + 11 ≈ 49 of 50); stale `services/sync.ts` comment fixed with a future-sync-must-bump pointer; `requireAuth` comment no longer overstates revocation immediacy (≤5-min cookieCache bound); misnamed "no-op write" test renamed to what it pins.
  - Rejected (2): cursor-semantics transition across the deploy (one in-flight SPA session, self-heals on reload/generation change); `callApi` throwing on a 304 it didn't solicit (only our cache sends the header today).

## Design Notes

Two-component ETag because `game`-table facts are shared: a PS+ flag write must invalidate every user's shelf, not just the actor's — a single global component does that without per-user fan-out writes (AD-32: one row written per sweep instead of N). Catalog SQL-ordering ruling: the old in-memory `compareTitle` sort exists only to beat SQL collation on accented titles across ~490 rows; making `title_normalized COLLATE NOCASE` authoritative trades imperceptible ordering differences for SQL paging.

## Verification

**Commands:**
- `npx vitest run test/integration` -- expected: green incl. the new hazard suites.
- `npx tsc -b` / `npx biome check src web` -- expected: clean.
- `npx playwright test playwright/e2e/epic1-shelf.spec.ts playwright/e2e/epic2-detail.spec.ts playwright/e2e/epic7-catalog.spec.ts` -- expected: green (UI parity).

## Auto Run Result

Status: done

**Implemented:** the AD-33 read-budget fixes (minus the dropped diff-upserts). `GET /games/:id` is a single-row read (~1,500 → ~10 rows/hit, shared `librarySelection` guarantees DTO parity); settings counts are SQL `COUNT(*)`; the catalog route pages in SQL (`LIMIT/OFFSET`, SQL order authoritative) with page-scoped marker joins replacing the per-request whole-library + whole-links scans (page 0 keeps one full filtered read for the DW-11 collapsed total); `GET /shelf` carries a per-user version ETag (`Cache-Control: private`, RFC 9110 list-form `If-None-Match`) answering 304 on unchanged refetches, with the version rotated by every library writer — shared-`game`-fact writers rotate every user's row in one UPDATE; better-auth `session.cookieCache` (300s). The SPA's `callApi` sends `If-None-Match` and serves retained bodies on 304; `etagCache` clears on sign-out.

**Files changed:** `src/repositories/games.ts` (single-row read, counts, marker joins), `settings.ts` (bump-all), `psplus-catalog.ts` (LIMIT/OFFSET); `src/services/library-version.ts` (new), `shelf.ts`, `stragglers.ts`, `tracking.ts`, `genres.ts`, `games.ts`, `seed-import.ts`, `psplus.ts`, `psplus-leaving.ts`, `scores.ts` (writer bumps + honest subrequest ledgers), `psplus-browse.ts` (paged + page-scoped markers), `auth.ts` (cookieCache); `src/routes/shelf.ts` (ETag/304), `routes/auth.ts` (comment truthing); `web/shelf/api.ts`, `web/App.tsx`, `web/catalog/Catalog.tsx`; `test/integration/read-budget.test.ts` (new, 11 tests), `playwright/COVERAGE.md`.

**Review:** 2 lenses, 24 raw findings → 13 patched (2 high: `resolveStraggler`/`addGame` rewrote shared game facts with only an actor bump — the exact stale-304 class; both now bump-all, driven through the real seams in the bypass suite), 0 deferred, 2 rejected, 0 intent gaps/bad-spec. Four intent-contract deviations recorded in the Spec Change Log (single-component ETag forced by the `setting` FK; concept-clear exempt; page-0 full read for DW-11 parity; 3-read first request). `followup_review_recommended: true` (2 highs + breadth across 20 files).

**Verification:** `vitest run test/integration` → 295 passed (incl. the 11-test hazard suite: by-id parity/miss, count truth, per-writer version rotation incl. the real shared seams, route 304/list-form/`?include=hidden`, SQL paging union/order/filter, non-zero-page markers); `vitest run web` → 348 passed; `tsc -b` + `biome check` clean; Playwright `epic1-shelf` + `epic2-detail` + `epic7-catalog` + `auth-journey` → 32 passed (UI parity + cookieCache live).

**Budget restated (AD-32 honesty):** active session ≈ shelf 200 (~1,500) + details now ~10 each + version read 1/request; unchanged refetches ≈ 3 rows (session cache + version read) instead of ~1,500 → the research's ~2,500-rows/session (~2,000 DAU) target holds, with page-0 catalog visits still O(snapshot) by design (DW-11). Cron ledgers updated: membership 38/50, leaving 44/50, scores 11/50, worst combined ≈49/50 — zero-headroom; the next addition to that invocation must re-budget.

**Residual risks:** write-then-bump is two statements (no D1 interactive tx) — a 500 exactly between them leaves a stale 304 until the next write; documented, accepted (same ponytail ceiling as `resolveStraggler`'s sequential writes). A future PSN library sync writer must bump (pointer left at the old sync comment). One earlier full-suite run showed a single non-reproducing failure (two clean re-runs since); CI is the arbiter.
