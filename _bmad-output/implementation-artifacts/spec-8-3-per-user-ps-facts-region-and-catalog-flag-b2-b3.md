---
title: 'Story 8.3: Per-user PS+ facts — region and catalog flag (B2 + B3)'
type: 'feature'
created: '2026-07-17'
status: 'done'
baseline_revision: 'bbc260c'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/publication-blockers.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** `game.ps_plus_extra`, `ps_plus_leaving_on`, `ps_plus_left_on`, `psn_concept_id` are region-scoped facts on the SHARED game row, written from ONE user's region — user B's check repaints user A's pills (B2), and region is one global default (B3).

**Approach:** AD-30 (signed off): the four columns leave `game`. **Membership becomes a per-user SQL derivation** — the library read LEFT-JOINs the user's region's `ps_plus_catalog` on the three identity keys (PSN_PRODUCT link → product_id; PSN link → np_title_id; title_normalized), so `psPlusExtra` is computed per request and a region change re-answers instantly with no re-derivation pass. **Departure facts move to a new region-keyed ledger `ps_plus_departure (region, product_id)`** that survives catalog prunes: the membership pass diffs catalog generations to write `left_on` (and clear `left_on` on re-entry, DW-13), the leaving sweep writes `leaving_on`/`psn_concept_id` there. `setPsPlusExtraFlags` and the whole flag pass die. Region is already a per-user SETTING with an editor (5.1) — env stays first-boot seed only (AD-23).

## Boundaries & Constraints

**Always:**
- **One derivation, in the repository query:** `listLibraryForUser`/`findLibraryRowById` gain the region parameter and derive `psPlusExtra` (any of the three key joins hits the region's catalog) and `psPlusLeavingOn` (+`psPlusLeftOn` if ever needed — currently no reader) from the ledger via the same keys — all indexed probes, never a catalog scan. `bakeCard`/`ShelfGame`/web components are UNCHANGED (same field names, now derived). Key precedence and guards mirror the browse marker rules: empty `title_normalized` joins nothing (M7); exact-link keys are authoritative over title.
- **Two-region coexistence** (the epic's third AC): with users in regions X and Y and both snapshots present, each user's shelf answers from their own region — proven by an integration test with two users, two regions, two catalog fixtures. (Until 8.4 lands, only regions a check has run for have snapshots; a region with no snapshot derives `false`/no dates — honest absence, not an error.)
- **Departure ledger semantics (PRESERVE-VS-CLEAR ruled per field):** on a completed membership pass for region R: products PRUNED this generation → upsert ledger `{left_on: today, leaving_on: null}` (a departed game's leaving date is moot); products PRESENT in the new generation with a stamped `left_on` → **`left_on` cleared, row kept** (DW-13: re-entry clears departure history; a fresh departure restamps — the row survives because it may carry a live `leaving_on`/concept cache the sweep owns, and deleting it would blank a LEAVING pill until the next sweep chunk). `leaving_on`/`psn_concept_id` are written ONLY by the leaving sweep (absent in a sweep reply for a queried product = write the null — Sony removing the date IS legitimate absence, today's rule; a failed query preserves, also today's rule). The empty-catalog wipe guard (AD-27) still aborts BEFORE any prune, so a degenerate response can never mass-stamp departures — hazard test with the captured empty-catalog fixture.
- **The membership pass** keeps producing the button's summary (`flagged`/`cleared` title lists) — now computed for the ACTING user by diffing their derived membership across the refresh (or equivalently the catalog diff ∩ their library keys). The genre sweep is untouched.
- **Migration 0016** (one migration, `INSERT…SELECT` precedent from 0003): create the ledger; backfill `leaving_on`/`psn_concept_id` from game columns joined to the current region's catalog on `title_normalized` (region = the existing `psn_region` SETTING value, fallback `'it-it'`); then DROP the four game columns. Losslessness (AR-16): the flag needs no carrying — it derives from the same catalog rows that produced it; region is already per-user. **Legacy `ps_plus_left_on` values are dropped by ruling**: the column has zero readers (write-only since 10.2's rework; the departure warning derives from the flag transition, which is now the ledger's own diff) and departed games have no catalog row to key a backfill on. The deploy-window blip (old Worker selecting dropped columns for seconds between migrate and deploy) is accepted per the 0011 precedent note.
- **Budget honesty (AD-32):** the derivation adds ~2–3 indexed probes per library row on a full 200 (~350-game library ≈ +~700–1,000 rows scanned; most refetches are 304s post-8.6). State the arithmetic in the ledgers/Auto Run Result. The cron LOSES the flag-pass writes (~2 chunked statements) and gains ledger upserts scaled by monthly departures (~5–40 rows), not library size.
- Seed import stops writing `psPlusExtra` (column gone); membership-sourced detection (`owned_via`) is untouched.
- CSV export, filters, cards, detail, catalog markers keep identical rendered behavior for the single-user case — existing integration/web/playwright suites are the parity evidence; fixtures migrate from setting the column to seeding catalog/ledger rows.
- External surface: unchanged — the anonymous public catalog endpoint only (no new calls).

**Block If:**
- The three-key derivation cannot be expressed in the library query without a per-request catalog table scan (index unusable).
- Any consumer requires the dropped columns at rest (found mid-implementation) with no derivation equivalent.

**Never:**
- No per-user copies of catalog rows; no per-user flag cache columns (the write-cliff shape AD-30 kills). No cron fan-out changes (8.4). No UI changes (pills/editor exist). No touching the genre sweep or auth.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two regions, same game | Users X/Y, game in X's catalog only | X sees PS+ pill, Y doesn't — same game row | No error |
| Region change | User edits region in settings | Next shelf read derives from the new region's snapshot; no pass runs | No error |
| Region without snapshot | New region, cron hasn't run | Membership false, no dates — honest absence | No error |
| Departure | Product pruned from new generation | Ledger `left_on` stamped; membership derives false; leaving date nulled | No error |
| Re-entry (DW-13) | Departed product back in catalog | `left_on` cleared (row + concept cache kept); membership true | No error |
| Degenerate catalog | Empty/truncated 200 (captured fixture) | Hard abort before prune — no departures stamped, ledger untouched | Fail closed |
| Sweep: date removed | Queried product, offer has no endTime | `leaving_on` set null (legitimate absence — today's rule) | No error |
| Sweep: query fails | Provider error for a product | Ledger row preserved (fail closed per game — today's rule) | Logged, stepped past |
| Untracked catalog game | In catalog, not in library | No ledger interaction from the library side; browse marker reads ledger directly | No error |
| Migration on live data | Existing user, flags + dates set | Post-migrate shelf renders identically (derived); leaving dates carried via title join | No error |

</intent-contract>

## Code Map

- `src/schema/catalog.ts` -- drop 4 columns from `game`; add `psPlusDeparture` table `(region, tier, product_id)` PK, `np_title_id`, `title_normalized`, `left_on`, `leaving_on`, `psn_concept_id`; index on `title_normalized` and `np_title_id`.
- `migrations/0016_*.sql` -- create + backfill (`INSERT…SELECT` per 0003 precedent; region from `setting.psn_region` fallback `'it-it'`) + drop columns (0011 deploy-window note).
- `src/repositories/games.ts` -- `librarySelection`/`listLibraryForUser`/`findLibraryRowById` gain `region: string | null` and derive `psPlusExtra`/`psPlusLeavingOn` via LEFT JOINs (catalog + ledger on the three keys); `setPsPlusExtraFlags`, `setPsPlusLeaving`, `clearPsnConceptIds` DELETED; marker helpers (`listLibraryRowsByNormalizedTitles`, `listUserGamesByExternalIds`) lose their `psPlusLeavingOn` selection (browse reads the ledger instead).
- `src/repositories/psplus-catalog.ts` (or new `psplus-departure.ts`) -- ledger CRUD: `upsertDepartures`, `deleteDeparturesForProducts`, `setLeavingOnLedger`, `clearLedgerConceptIds`, `listDeparturesForProducts(region, productIds)`.
- `src/services/shelf.ts` + every `loadLibrary`/`getShelf`/`getGameById` caller -- resolve region once (`getPsnRegion`) and thread it; `bakeCard` unchanged.
- `src/services/psplus.ts` -- flag pass replaced by the generation diff → ledger writes; summary lists derived for the acting user; ledgers/comments updated.
- `src/services/psplus-leaving.ts` -- target list = derived members of the user's region (SQL join, not `.filter(psPlusExtra)`); writes go to the ledger keyed `(region, product_id)`.
- `src/services/psplus-browse.ts` -- `CatalogGame.leavingOn` reads the ledger by `(region, productId)` directly (simpler than today's library-carried date); library marker merge drops its `leavingOn` leg.
- `src/services/seed-import.ts` + `src/core/seed-reconcile.ts` -- stop emitting `psPlusExtra`.
- `src/routes/export.ts`, `src/routes/shelf.ts`, web -- unchanged shapes.
- Tests: `psplus.test.ts`, `psplus-departure.test.ts` (rewrite to ledger semantics), `psplus-leaving.test.ts`, `psplus-browse.test.ts`, `shelf.test.ts`, `read-budget.test.ts`, `export.test.ts`, `seed-import.test.ts`, new two-region test; web fixture updates only if types force them; playwright `support/helpers/d1.ts` + `game-factory.ts` seed catalog/ledger rows instead of columns; `epic5-psplus`/`epic10-leaving-soon`/`epic6` specs re-run green.

## Tasks & Acceptance

**Execution:**
- [x] `src/schema/catalog.ts` + `migrations/0016` -- ledger table, backfill, column drops.
- [x] `src/repositories/` -- derivation joins in the library reads (region param); ledger CRUD; delete the three dead writers.
- [x] `src/services/shelf.ts` + callers -- thread region (one `getPsnRegion` read per request; counts in the AD-32 arithmetic).
- [x] `src/services/psplus.ts` -- generation-diff departure writes (prune → `left_on`; presence → delete row) inside the guarded pass; acting-user summary preserved; `bumpAllLibraryVersions` retained on catalog change (8.6 ETag).
- [x] `src/services/psplus-leaving.ts` -- derived target list + ledger writes; per-field preserve-vs-clear rules unchanged and re-tested against the ledger.
- [x] `src/services/psplus-browse.ts` -- ledger-direct `leavingOn`.
- [x] `src/services/seed-import.ts` + core -- drop the flag emission.
- [x] Tests -- two-region coexistence; migration-parity (seed old-shape fixtures → migrate → identical `ShelfGame`s — via seeding catalog+ledger equivalents); degenerate-catalog no-stamp hazard (captured fixture); DW-13 re-entry; sweep preserve-vs-clear against the ledger; derived summary; export/filters parity.
- [x] `playwright/` -- d1 helpers + factories reseeded; `epic5-psplus`, `epic10-leaving-soon`, `epic6`, `epic1-shelf` green; COVERAGE.md rows.

**Acceptance Criteria:**
- Given two users in different regions tracking the same game, when both regions have snapshots, then each sees membership per THEIR region (integration-proven) — and no write path can repaint the other's answer, because there is no per-user flag write at all.
- Given the existing user's data, when 0016 runs, then the rendered shelf (pills, leaving dates, playable-now, CSV) is identical before/after — flag derived, dates carried.
- Given a region change in settings, when the shelf next loads, then the answer follows the new region with no pass, no cron, no write.
- Given the full suites (`vitest` integration+web, `tsc`, `biome`, the four playwright specs), when the story lands, then all green.

## Spec Change Log

### 2026-07-17 — Pre-implementation correction (self-caught)
The drafted re-entry rule deleted the ledger row on catalog presence — which would also delete the `leaving_on` the sweep wrote for every in-catalog product on every membership pass, blanking live LEAVING pills until the next sweep chunk. Corrected to: presence clears `left_on` only; the row and its sweep-owned fields survive. KEEP this asymmetry: the pass owns `left_on`, the sweep owns `leaving_on`/`psn_concept_id`.

## Review Triage Log

### 2026-07-17 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 1, medium 6, low 4)
- defer: 0
- reject: 6
- addressed_findings:
  - `[high]` `[patch]` **`deleteCatalogOutsideRegion` structurally defeated the two-region AC**: one user's check wiped every other region's snapshot — under the derivation model that blanks every other user's shelf, invisibly to their ETags. The call and the repo fn are DELETED; regions coexist; pruning idle regions (snapshot + ledger) is 8.4's region-state ledger job. The old "drops the previous region" test is INVERTED to pin coexistence on the real write path.
  - `[medium]` `[patch]` **COALESCE broke exact-key-authoritative**: a product-keyed reprieve (`leaving_on` NULL) fell through to a title-colliding product's stale date. Rewritten as CASE-over-row-existence; title legs gain deterministic `ORDER BY product_id`.
  - `[medium]` `[patch]` **Sweep wrote `npTitleId: null`** — the np-key derivation leg could never match an in-catalog dated product; membership and leaving disagreed on identical link evidence. The catalog's np id now threads through `listCatalogTitleProducts` → updates; both ledger upserts refresh join keys on conflict (stale-key probes).
  - `[medium]` `[patch]` Migration backfill gains the `title_normalized != ''` guard (M7); collision/renormalization losses recorded as accepted (single-user, sweep self-heals in days).
  - `[medium]` `[patch]` **Second lock fence before the ledger writes** — a run losing its lock mid-write-phase must not fabricate durable departure history (the snapshot self-heals; ledger stamps persist).
  - `[medium]` `[patch]` Budget honesty: the check's summary read paid six derivation probes per row for columns the title-key diff never reads — now `region: null`; tier scoping added to all six probes (a future non-extra tier row would have false-positived the Extra pill); `stampDepartures` batches chunked.
  - `[low]` `[patch]` `scripts/probe-psn-leaving.ts` still queried the dropped column (rewritten to a catalog join); e2e seed helper treats a leaving date as implying membership; migration breakpoint placement fixed.
  - Rejected (6): title-keyed summary + first-check flood + tracked-mid-cycle summary misses (all PARITY with the old title-only flag pass — not regressions); departure-stamp timezone provenance (pre-existing semantics, 8.4's per-region model revisits); CSV all-"no" for region-less users (the ruled honest-absence behavior); shelf-GET region read on the 304 path (the tag needs the region by design; one indexed setting read).

## Design Notes

Derivation-in-SQL beats a per-user flag cache on every axis that matters here: zero writer fan-out (the write cliff AD-30 exists to kill), region changes answered by the next read, and the "two answers coexist" AC satisfied structurally rather than by synchronized passes. The cost — ~2–3 indexed probes per library row on non-304 reads — is the read budget AD-32 already prices. `ps_plus_left_on`'s legacy values die with the column: zero readers, and the ledger's own diff produces fresh departure facts from the next pass onward.

## Verification

**Commands:**
- `bunx vitest run test/integration` / `bunx vitest run web` -- green.
- `bunx tsc -b` / `bunx biome check src web test worker` -- clean.
- `bunx playwright test playwright/e2e/epic1-shelf.spec.ts playwright/e2e/epic5-psplus.spec.ts playwright/e2e/epic6.spec.ts playwright/e2e/epic10-leaving-soon.spec.ts` -- green.
- `wrangler d1 migrations apply <db> --local` (via the test pool's migration application) -- 0016 applies cleanly on a seeded old-shape DB.

## Auto Run Result

Status: done

**Implemented:** AD-30 in full. The four PS+ columns are gone from `game` (migration 0016 with guarded backfill). Membership is a per-request SQL derivation in `librarySelection(region)` — three tier-scoped EXISTS probes (product link, np link, non-empty title) against the region's catalog; the leaving date derives from the new `ps_plus_departure` ledger via CASE-over-row-existence in exact-key-first precedence. The flag pass is replaced by generation-diff ledger writes (prune → stamp `left_on` + null `leaving_on`; presence → clear `left_on`, row kept) behind a second lock fence; the leaving sweep targets derived members and writes the ledger (np ids threaded); browse reads the ledger by product id. Region (already per-user with an editor) threads through shelf/by-id/export; the shelf ETag embeds it so a region change misses the validator. **`deleteCatalogOutsideRegion` is deleted** — regions coexist (the story's core AC, now pinned on both the read path and the real write path).

**Files changed:** `src/schema/catalog.ts` (+`psPlusDeparture`, −4 columns), `migrations/0016`, `src/repositories/games.ts` (derivation), `psplus-departure.ts` (new), `psplus-catalog.ts` (prune identity, dead fn deleted), `src/services/psplus.ts`/`psplus-leaving.ts`/`psplus-browse.ts`/`shelf.ts`/`seed-import.ts`, `src/routes/shelf.ts`/`games.ts`/`export.ts`, `scripts/probe-psn-leaving.ts`, `playwright/support/helpers/d1.ts` (+factory contract honored via derivation sources), ~12 test files migrated + `two-region.test.ts` (new).

**Review:** 2 lenses, 30 raw findings → 11 patched (1 high: the region wipe; 6 medium), 6 rejected as old-behavior parity or ruled semantics, 0 deferred, 0 intent gaps/bad-spec. `followup_review_recommended: true` (a HIGH + a schema migration + breadth).

**Verification:** integration 294 (incl. two-region coexistence read+write paths, ledger departure/DW-13/degenerate hazards, sweep both-directions on the ledger), web 348, Playwright epic1/5/6/7/10 all green, `tsc -b` + `biome` clean. Migration applies via the test pool on every run.

**Budget (AD-32 honesty, corrected in review):** the derivation is six correlated indexed probes per library row — a full 200 on ~350 games ≈ ~2,000 probe executions (~+1,500–2,000 rows scanned vs the old column read), paid only on non-304 reads (8.6's ETag covers refetches); the check's summary read pays zero probes. The cron loses the flag-pass writes and gains departure upserts scaled by monthly departures.

**Residual risks:** old-region ledger+snapshot rows persist until 8.4's idle-region prune (bounded: one region per past user region). Ledger `left_on` dates carry the acting user's timezone (±1 day skew) until 8.4's per-region model. The button summary stays title-keyed (parity) — link-only matches change pills without a summary mention; acceptable until someone notices.
