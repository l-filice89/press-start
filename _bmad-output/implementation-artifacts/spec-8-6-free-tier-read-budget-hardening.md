---
title: 'Story 8.6: Free-tier read-budget hardening'
type: 'refactor'
created: '2026-07-17'
status: 'draft'
review_loop_iteration: 0
followup_review_recommended: false
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
- [ ] `src/repositories/games.ts` -- `findLibraryRowById` + `countUnenrichedForUser` + `countMembershipClaimsForUser` (drizzle `count()`), reusing `listLibraryForUser`'s join/filter semantics.
- [ ] `src/services/shelf.ts` + `src/services/stragglers.ts` + `src/services/tracking.ts` -- swap `getGameById` and the two counts onto the new reads; delete the stale ponytail flags.
- [ ] `src/repositories/psplus-catalog.ts` + `src/services/psplus-browse.ts` -- `LIMIT/OFFSET` in `listCatalogForBrowse` (NOCASE order), page-scoped marker lookups (`IN` over page keys), facets path stops re-reading the snapshot; update the header ponytail note to the new ruling.
- [ ] `src/services/library-version.ts` (new) + one bump per writer seam listed in the Code Map -- user-scoped writers bump user version; shared-fact writers bump shared version; `rematchGame` bumps both.
- [ ] `src/routes/shelf.ts` -- mint `W/"<user>-<shared>"`, answer 304 on match; lazily init versions.
- [ ] `src/services/auth.ts` -- `session.cookieCache` (300s).
- [ ] `web/shelf/api.ts` -- `If-None-Match` + per-URL retained body + 304 handling in `callApi`/`fetchShelf`.
- [ ] `test/integration/` -- (a) by-id parity vs old bake + 404; (b) counts equal full-scan truth incl. zero cases; (c) shelf 304 hazard suite: 304 on unchanged, then **200-after-write for EVERY writer category** (status, milestone, ownership, dates, discard, genre, add, cancel-membership, rematch, PS+ flag write, score write) — the bypass tests; (d) catalog paging: page N ∪ N+1 covers the filtered set in order, filters+counts intact.
- [ ] `playwright/COVERAGE.md` -- rows for the transport-level ACs (no UI flow: ETag/304, cookieCache, counts); existing shelf/detail/catalog specs re-run green as the UI-parity evidence.

**Acceptance Criteria:**
- Given a library of N games, when `GET /games/:id` runs, then D1 reads for it are O(1) rows (~10), not O(N), and the payload is unchanged.
- Given `GET /settings`, when counts are computed, then no whole-library rows are read for them.
- Given the catalog route, when a page is served, then rows read scale with the page (~60 + page-scoped marker keys), not the snapshot (~490) plus the whole library.
- Given an unchanged library, when the SPA refetches the shelf with `If-None-Match`, then the Worker answers 304 and the shelf renders identically from retained data.
- Given any write from any writer category, when the next conditional shelf GET runs, then it answers 200 with the change visible (no stale 304 — per-writer hazard tests).
- Given the full suite, when `vitest`, `tsc -b`, `biome check`, and the existing Playwright specs run, then all green.

## Spec Change Log

## Review Triage Log

## Design Notes

Two-component ETag because `game`-table facts are shared: a PS+ flag write must invalidate every user's shelf, not just the actor's — a single global component does that without per-user fan-out writes (AD-32: one row written per sweep instead of N). Catalog SQL-ordering ruling: the old in-memory `compareTitle` sort exists only to beat SQL collation on accented titles across ~490 rows; making `title_normalized COLLATE NOCASE` authoritative trades imperceptible ordering differences for SQL paging.

## Verification

**Commands:**
- `npx vitest run test/integration` -- expected: green incl. the new hazard suites.
- `npx tsc -b` / `npx biome check src web` -- expected: clean.
- `npx playwright test playwright/e2e/epic1-shelf.spec.ts playwright/e2e/epic2-detail.spec.ts playwright/e2e/epic7-catalog.spec.ts` -- expected: green (UI parity).
