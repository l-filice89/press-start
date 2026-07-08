---
title: 'Seed import (out-of-band)'
type: 'feature'
created: '2026-07-07'
status: 'in-review'
baseline_revision: 'f69c4650a30cea47511cad2a508c3cb633802776'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The catalog/tracking schema, repositories, pure domain core, and auth all exist (Stories 1.2–1.5), but the database is empty — there is no way to get Luca's real ~200-game library (the PlayStation export CSV + the Notion tracking CSV) into D1, enriched with IGDB covers/genres/release dates. Without this one-time seed, Story 1.7's shelf has nothing trustworthy to render.

**Approach:** Build a one-time, out-of-band Bun script (no UI surface, AR-20) that reads the two committed CSVs, reconciles them through the existing `core/` normalizer, enriches every game via a new `providers/igdb` adapter, and writes games/links/genres/tracking/stragglers to D1 through the existing `repositories/` seam — with the substantive parse/map/reconcile logic living as pure, unit-tested `core/` functions and the DB-apply path integration-tested against the workers-pool D1. Membership-sourced (PS+ claim) PS entries are excluded and counted; anything unplaceable becomes a straggler, never guessed.

## Boundaries & Constraints

**Always:**
- **Out-of-band only (AR-20/AD-15):** the importer runs as a Bun script writing D1 via the D1 HTTP API using the **shared Drizzle schema and the existing `repositories/` functions** — never a Worker route, never at startup, no UI. Bulk work exceeds the 50-subrequest budget, so it cannot be in-Worker.
- **Reuse, don't reinvent the domain:** title reconciliation uses `core/normalizeTitle` (the single match key, AD-9); Notion status mapping and CSV parsing are new **pure `core/`** functions (I/O-free — no fetch/D1/drizzle imports; the `core/` purity guard and Biome `noRestrictedImports` override must stay green). Genres come **exclusively from IGDB** (FR-23) — the Notion `Category` column is ignored; `Rating` and the Notion `Release date` column are not imported (FR-30).
- **Membership exclusion (FR-26, AR-10):** a PS row whose `membership` is a non-empty value other than `NONE` (i.e. `PS_PLUS`, a PS+ claim) is excluded — it creates no `game`, no `external_link`, and contributes no ownership. The skipped count is reported. (A game excluded here can still be created from Notion if Luca tracks it there — "never Owned" means the membership entry itself is not ownership evidence.)
- **PS4/PS5 collapse (FR-27, AD-20):** non-excluded PS rows sharing a normalized title collapse to **one** game (PS5 name canonical); each contributing row's `title_id` becomes a `PSN` `external_link` (many links per game). PS covers/store links come from the PS export (`image_url`/`store_url`) — **PlayStation Store image first, IGDB cover only as fallback** (cover-art source order).
- **Notion status mapping (FR-30):** `Completed`→`play_status = null` + `completed_on` (from `Date finished`); `Up next!`→`Up next`; `Not released`→`Not started`; `Not started`/`Playing`/`Paused` map 1:1; `Date started`→`started_on`; `Rating` not imported. `Owned: Yes`→`owned = true`, `ownership_type = 'physical'` (default); `Owned: No`→not owned (wishlist). **Only known dates are stamped** — never fabricate `bought_on`/`wishlisted_on` (FR-31/32/44-seed). Every written tracking row satisfies the completion invariant: `play_status = mappedStatus ?? (hasMilestone ? null : 'Not started')`.
- **Enrichment is exclusively IGDB** for genres/release-date, and genres auto-create via `upsertGenre` (idempotent). Cover = PS image if present, else IGDB cover.
- **Stragglers, never guesses (FR-28/30, AR-17):** a Notion row with an unknown `Status` value, or a **Notion-only** title IGDB cannot confidently resolve, is written to `import_straggler` (raw Notion row as JSON `notion_payload`) and **no game is fabricated**. A **PS-owned** game whose title IGDB cannot resolve is still created (we own it) but flagged `unenriched = true` with no genres.
- **User scoping (AD-13):** tracking rows are scoped to Luca's real `user.id`, resolved by email from the `user` table. If no matching user exists the script exits with an actionable message (sign in once to create the user, then re-run) — it must not invent a user row.
- **Re-run safety:** the apply path is idempotent enough that a second run does not double-insert — PS games resolve by `external_link` (skip create + link when the link already exists); genres/tracking use the existing idempotent upserts.

**Block If:** (none — resolved judgment calls: (1) write driver is **`drizzle-orm/sqlite-proxy` over the Cloudflare D1 HTTP API** (`POST /accounts/{id}/d1/database/{dbId}/query`, Bearer token), reusing the shared schema + repositories; the `repositories` `Db` type is widened to the shared async SQLite base so both the Worker's D1 driver and the script's proxy driver satisfy it. (2) IGDB auth is a Twitch app **client-id + pre-obtained access token** via env; the real fetch adapter is thin (AD-5) and hand-verified out-of-band — it and the D1 HTTP round-trip cannot run in CI (no creds / no remote D1), matching the existing `generate-icons.ts` out-of-band precedent. (3) display `title` = source title (PS5 > PS4 > Notion); IGDB never overrides the title, only cover/genres/release-date. (4) `ps_plus_extra` is left default — true per-region PS+ Extra membership is Epic 5.)

**Never:**
- Don't build any UI, Worker route, or Cron for the import; don't fetch IGDB/D1 on any render/read path (NFR-3). Don't add features to the legacy Python scripts.
- Don't import the Notion `Category`, `Rating`, or `Release date` columns; don't set `ps_plus_extra` from the membership column; don't create a game for a membership-excluded PS entry or an unresolvable Notion-only title.
- Don't fabricate dates, ratings, genres, or ownership. Don't recompute effective/derived state here — that's `core/` (1.2) consumed by the shelf (1.7).
- Don't put I/O (fetch, fs, D1) inside `core/`; don't make the seed script itself carry logic that belongs in tested `core/`/`services/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Membership excluded | PS row `membership=PS_PLUS`, title not in Notion | No `game`/`external_link` created; counted in `skippedMembership` | No error |
| PS4/PS5 dedupe | Two non-excluded PS rows (PS4 `CUSA…`, PS5 `PPSA…`) sharing a normalized title | One `game` (PS5 name), two `PSN` `external_link`s (both `title_id`s), owned digital | No error |
| Owned + Notion merge | Same title in PS (NONE) and Notion (`Playing`, Owned Yes) | One game; tracking `play_status='Playing'`, `owned=true`, `ownership_type='digital'` (PS digital wins) | No error |
| Notion `Completed` | Notion row `Status=Completed`, `Date finished="November 4, 2024"` | Tracking `play_status=null`, `completed_on='2024-11-04'` | No error |
| Notion status enum | `Up next!`→`Up next`; `Not released`→`Not started`; `Not started`/`Playing`/`Paused` 1:1; `Date started`→`started_on` | Mapped play_status + `started_on` stamped only when the date parses | Unparseable/empty date → that field `null` |
| Wishlist (Notion-only, Owned No), IGDB match | Title not in PS, `Owned=No`, IGDB resolves | Game created enriched (cover/genres/release from IGDB); tracking `owned=false` | No error |
| Notion-only, IGDB no match | Title not in PS, IGDB returns null/ambiguous | **No game**; `import_straggler` row with raw Notion JSON | No error (recorded, not thrown) |
| PS-owned, IGDB no match | PS NONE row, IGDB returns null | Game created `unenriched=true`, owned digital, `play_status='Not started'`, no genres; PS cover kept | No error |
| Unknown Notion status | Notion `Status` not in the known set | `import_straggler` with raw payload; no tracking written | No error (recorded) |
| Quoted/glyph titles | `"Warhammer 40,000: Boltgun"`, `HEAVY RAIN™` | CSV parsed as one field; matching strips glyphs via `normalizeTitle` | No error |
| Idempotent re-run | Seed run twice | No duplicate games/links/genres/tracking (resolve by external link + upserts) | No error |
| Missing seed user | No `user` row for `SEED_USER_EMAIL` | Script exits non-zero with actionable "sign in once, then re-run" message | Loud exit, no partial user invention |
| PS-plus-only game | Title only present as `PS_PLUS`, absent from Notion | Skipped entirely (counted), never created | No error |

</intent-contract>

## Code Map

- `src/core/csv.ts` -- NEW: pure RFC-4180 parser (`parseCsv(text) -> Record<string,string>[]`) — strips utf-8-sig BOM, handles quoted fields with embedded commas, escaped `""`, CRLF/LF. I/O-free.
- `src/core/notion-status.ts` -- NEW: pure `mapNotionStatus(status)` (enum → `{ playStatus, milestone } | { unknown: true }`) and `parseNotionDate("Month D, YYYY") -> 'YYYY-MM-DD' | null`.
- `src/core/seed-reconcile.ts` -- NEW: pure `buildSeedPlan({ psRows, notionRows }) -> { candidates: GameCandidate[]; stragglers: StragglerRow[]; skippedMembership: number }` — membership exclusion, PS4/PS5 grouping (PS5 canonical), Notion↔PS merge by normalized title, ownership/date/status assembly, unknown-status stragglers. Consumes `normalizeTitle`.
- `src/core/igdb-match.ts` -- NEW: pure `pickIgdbMatch(queryTitle, candidateNames) -> index | null` — normalized-exact selection so a non-match returns null ("never guessed"). Unit-tested.
- `src/core/index.ts` -- EDIT: re-export the new core modules.
- `src/providers/igdb.ts` -- NEW: `IgdbProvider` interface (`enrich(title) -> { coverUrl; releaseDate; genres } | null`) + real Twitch/IGDB fetch adapter (AD-5); uses `pickIgdbMatch` to reject low-confidence results. Thin, hand-verified out-of-band.
- `src/providers/index.ts` -- EDIT: export `igdb`.
- `src/repositories/db.ts` -- EDIT: widen the exported `Db` type to the shared async SQLite base (`BaseSQLiteDatabase<'async', …, typeof schema>`) so both `DrizzleD1Database` (Worker) and `SqliteRemoteDatabase` (seed proxy) satisfy it; keep `createDb(d1)` unchanged for the Worker.
- `src/repositories/users.ts` -- NEW: `findUserByEmail(db, email)` (the single-user resolution for tracking scope). Export from `repositories/index.ts`.
- `src/services/seed-import.ts` -- NEW: `runSeedImport({ db, igdb, psCsv, notionCsv, userEmail }) -> SeedSummary` — parse (core) → plan (core) → per-candidate enrich (igdb) + straggler/unenriched decision → apply via `repositories` (idempotent) → return counts. Driver-agnostic (any `Db`).
- `src/services/index.ts` -- EDIT: export `seed-import`.
- `scripts/seed-import.ts` -- NEW: thin Bun entrypoint (mirrors `scripts/generate-icons.ts`): read env + the two CSV files (fs), build the `sqlite-proxy` D1-HTTP `Db`, build the real `IgdbProvider`, call `runSeedImport`, print the summary. Not in `tsc -b` (out-of-band precedent).
- `test/integration/seed-import.test.ts` -- NEW: workers-pool D1 + a fake `IgdbProvider`; covers the apply-path matrix rows end-to-end (dedupe, merge, status mapping, membership skip, stragglers, unenriched, idempotent re-run, missing user).
- `src/core/csv.test.ts`, `src/core/notion-status.test.ts`, `src/core/seed-reconcile.test.ts`, `src/core/igdb-match.test.ts` -- NEW: node unit project; the pure edge cases.
- `.env.example` -- NEW: documents `IGDB_CLIENT_ID`, `IGDB_ACCESS_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, `CLOUDFLARE_API_TOKEN`, `SEED_USER_EMAIL` (gitignore already whitelists `.env.example`).
- `package.json` -- EDIT: add `"seed": "bun scripts/seed-import.ts"` script. No new runtime deps (sqlite-proxy ships in drizzle-orm).
- `README.md` -- EDIT: add a "One-time seed import" run section (env, command, expected summary).
- `ps_catalog.csv`, `Gaming list …_all.csv` -- reference only: the committed source data (read, never written).
- `src/repositories/games.ts` -- reference: `insertGame`/`findGameByExternalLink`/`addExternalLink` reused; `addExternalLink` must be guarded by a prior `findGameByExternalLink` for re-run safety (it throws on duplicate identity).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/csv.ts` (+ `csv.test.ts`) -- pure RFC-4180 parser with BOM/quote/CRLF handling -- both CSVs parse safely (quoted commas, glyphs) without a dependency
- [x] `src/core/notion-status.ts` (+ `notion-status.test.ts`) -- pure status→`{playStatus,milestone}` map + `parseNotionDate` -- FR-30 mapping is pure and exhaustively tested (incl. unknown status, unparseable date)
- [x] `src/core/seed-reconcile.ts` (+ `seed-reconcile.test.ts`) -- pure `buildSeedPlan` (membership exclusion, PS4/PS5 collapse, Notion↔PS merge, ownership/date assembly, unknown-status stragglers) -- the reconciliation contract, unit-tested against the matrix
- [x] `src/core/igdb-match.ts` (+ `igdb-match.test.ts`) -- pure normalized-exact match selection returning null on no/ambiguous match -- "never guessed" is a testable pure decision
- [x] `src/core/index.ts` -- re-export new core modules -- barrel stays complete
- [x] `src/providers/igdb.ts` + `providers/index.ts` -- `IgdbProvider` interface + thin real Twitch/IGDB adapter using `pickIgdbMatch` -- external-I/O seam (AD-5); genres/cover/release from IGDB
- [x] `src/repositories/db.ts` -- widen `Db` to the shared async SQLite base; keep `createDb` -- one repository surface serves both the Worker D1 driver and the seed's HTTP-proxy driver
- [x] `src/repositories/users.ts` + `repositories/index.ts` -- `findUserByEmail` -- resolves the tracking-scope `user_id` (AD-13)
- [x] `src/services/seed-import.ts` + `services/index.ts` -- `runSeedImport` orchestration: parse→plan→enrich→apply(idempotent)→summary; PS-link guard, unenriched/straggler decisions, invariant-safe `play_status`, missing-user loud exit -- the driver-agnostic, testable heart of the import
- [x] `scripts/seed-import.ts` -- thin Bun entrypoint: env + fs CSV read, `sqlite-proxy` D1-HTTP `Db`, real IGDB provider, run + print summary -- the out-of-band runner (AR-20), no UI
- [x] `test/integration/seed-import.test.ts` -- workers-pool D1 + fake `IgdbProvider`; cover every apply-path matrix row incl. idempotent re-run + missing user -- real regression coverage for the write path
- [x] `.env.example` + `README.md` + `package.json` -- document required env, the `bun run seed` command + expected summary, add the `seed` script -- runnable and reproducible

**Acceptance Criteria:**
- Given the two CSVs and IGDB, when `runSeedImport` runs, then it writes games/tracking/genres/`external_link`/stragglers to D1 through the repository seam with no UI/Worker/Cron surface, and returns a summary counting games created, tracked, genres linked, stragglers, and membership-skipped (FR-26, AR-20)
- Given the PS export, when importing, then `membership=PS_PLUS` entries create no game and no ownership and are counted as skipped, while `NONE` entries import as owned digital (FR-26, AR-10)
- Given titles across sources, when reconciling, then matching uses `core/normalizeTitle`, PS4/PS5 collapse to one PS5 game with both `title_id`s as `PSN` links, and genres are taken exclusively from IGDB (FR-27, FR-23, AR-9)
- Given Notion rows, when mapping status, then the FR-30 mapping holds exactly (`Completed`→null+`completed_on`, `Up next!`→`Up next`, `Not released`→`Not started`, 1:1 rest, `Date started`→`started_on`, `Rating`/`Category`/`Release date` columns not imported), and every written tracking row satisfies the completion invariant
- Given the `Owned` column, when importing, then `Owned: Yes`→owned physical, `Owned: No`→not owned, and only dates present in the CSV are stamped — no `bought_on`/`wishlisted_on` fabricated (FR-31/32/44-seed)
- Given an unknown status, a mapping-unplaceable row, or a Notion-only title IGDB cannot resolve, when importing, then it lands in `import_straggler` (raw payload) and no game is guessed; a PS-owned title IGDB cannot resolve is instead created `unenriched=true` (FR-28, FR-30, AR-17)
- Given no `user` row for the target email, when the script runs, then it exits non-zero with an actionable message and invents no user; given the user exists, all tracking is scoped to that `user_id` (AD-13)
- Given `bun run lint && bun run typecheck && bun run test`, when run, then all pass — including the new `core/` unit suites, the `core/` purity guard over the new pure modules, and the new workers-pool seed integration suite; the seed is idempotent on re-run

## Design Notes

- **Why pure-core + service split:** the real IGDB fetch and the D1 HTTP write can't run in CI (no creds, no remote D1). So all decision logic (parse, status/date map, membership exclusion, PS4/PS5 collapse, merge, straggler-vs-unenriched, match selection) lives in pure `core/` (node unit tests) and the `services/` apply path is exercised against the workers-pool D1 with a **fake `IgdbProvider`**. The `scripts/` entrypoint is thin enough that its untypechecked, out-of-band status (like `generate-icons.ts`) carries little risk.
- **Reconcile shape (pure):** `buildSeedPlan` returns candidates carrying `{ canonicalTitle, normalizedTitle, psLinks: string[], psCoverUrl, psStoreUrl, owned, ownershipType, tracking, source: 'ps'|'both'|'notion' }`. The service enriches each: PS/both keep the PS cover (IGDB fallback) and take genres+release from IGDB; a `notion`-only candidate with an IGDB null becomes a straggler, a `ps`/`both` candidate with an IGDB null becomes `unenriched`. Example invariant-safe status: `playStatus = tracking.playStatus ?? (tracking.completedOn || tracking.platinumOn ? null : 'Not started')`.
- **D1 HTTP driver (production only):** `drizzle-orm/sqlite-proxy`'s `drizzle(async (sql, params, method) => …)` callback POSTs to the D1 HTTP API and returns `{ rows }`; Drizzle's client-side `$defaultFn(crypto.randomUUID)` and `RETURNING` both work over it. This keeps the exact shared schema + repository functions. The Worker path is untouched (`createDb`).
- **Membership semantics:** `NONE` = purchased/owned; any other non-empty value (`PS_PLUS`) = obtained via a PlayStation Plus benefit → excluded. Exclusion is per-row before grouping, so a title whose only PS presence is a claim is dropped, but a title with a `NONE` row is owned regardless of a sibling claim row.

## Verification

**Commands:**
- `bun install` -- expected: deps resolve (no new runtime deps; `sqlite-proxy` ships with drizzle-orm)
- `bun run lint` -- expected: Biome clean, incl. the `src/core/**` restricted-import override over the new pure modules
- `bun run typecheck` -- expected: `tsc -b` clean across app/worker/node (the widened `Db` still accepts the Worker's D1 driver; `scripts/` is intentionally out of `tsc -b`, per precedent)
- `bun run test` -- expected: all pass — new `core/` unit suites (csv, notion-status, seed-reconcile, igdb-match) in the node project, the purity guard scanning the new core files, and `test/integration/seed-import.test.ts` in the workers pool (dedupe, merge, mapping, membership skip, stragglers, unenriched, idempotent re-run, missing user); Stories 1.1–1.5 suites remain green

**Manual checks (if no CLI):**
- The real seed is run out-of-band by hand: set `.env` (IGDB + Cloudflare D1 HTTP creds + `SEED_USER_EMAIL`), `bun run seed`; expect a printed summary (games created, tracked, genres linked, stragglers, membership-skipped) and rows visible via `wrangler d1 execute ps-game-catalog --remote --command "SELECT count(*) FROM game"`. This live path (IGDB fetch + D1 HTTP write) is not covered by an automated test.

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 1
- addressed_findings:
  - `[medium]` `[patch]` Re-run was not idempotent for **Notion-only** games and stragglers: the service resolved existing games only by PSN `external_link`, so a wishlist/Notion-only game (no PS link) was re-enriched and `insertGame`d on every run, duplicating the game + its tracking + genre links, and stragglers re-inserted — contradicting the intent-contract's "Idempotent re-run" I/O matrix row and the idempotency acceptance criterion (the existing test only exercised a PS-linked "both" game). Fixed in `src/services/seed-import.ts` by resolving Notion-only candidates through the normalized-title match key (AD-9) before creating, and deduping stragglers by source title; added `test/integration/seed-import.test.ts` coverage for a Notion-only game + straggler across two runs. (reject: the `.env.example` committed D1 database id / seed email is not a secret — the D1 id already lives in `wrangler.jsonc` and the email is the owner's own, so no leak.)

## Auto Run Result

Status: done

**Summary:** Resumed the in-progress Story 1.6 worktree (`20260707-210048-2b39`). The prior iteration had written the full implementation but stopped before verifying/marking tasks and never reviewed or committed. This run verified all tasks and acceptance criteria, ran the review pass, fixed one confirmed correctness finding (re-run idempotency for Notion-only games/stragglers), and committed.

**Files changed (since baseline `f69c465`):**
- `src/core/csv.ts` (+test) — pure RFC-4180 CSV parser (BOM/quotes/CRLF), I/O-free.
- `src/core/notion-status.ts` (+test) — pure Notion status→domain map + `parseNotionDate`.
- `src/core/seed-reconcile.ts` (+test) — pure `buildSeedPlan` (membership exclusion, PS4/PS5 collapse, Notion↔PS merge, stragglers).
- `src/core/igdb-match.ts` (+test) — pure normalized-exact IGDB match selection (null on no/ambiguous match).
- `src/core/index.ts` — re-export new core modules.
- `src/providers/igdb.ts` + `providers/index.ts` — `IgdbProvider` interface + thin Twitch/IGDB fetch adapter.
- `src/repositories/db.ts` — widen `Db` to the shared async SQLite base so both the Worker D1 driver and the seed's D1-HTTP proxy satisfy the repositories.
- `src/repositories/users.ts` + `repositories/index.ts` — `findUserByEmail` (tracking scope).
- `src/services/seed-import.ts` + `services/index.ts` — driver-agnostic `runSeedImport` orchestration (parse→plan→enrich→apply→summary), now idempotent for Notion-only games + stragglers.
- `scripts/seed-import.ts` — thin out-of-band Bun entrypoint (env + fs CSV read, `sqlite-proxy` D1-HTTP `Db`, real IGDB provider, run + print summary).
- `test/integration/seed-import.test.ts` — workers-pool D1 + fake IGDB; full apply-path matrix incl. the new Notion-only/straggler re-run idempotency case.
- `.env.example`, `README.md`, `package.json` — env docs, seed run section, `seed` script.

**Review findings breakdown:** 1 patch applied (medium — re-run idempotency), 0 deferred, 1 rejected (non-secret `.env.example` values).

**Verification performed:** `bun run lint` (Biome clean, 88 files), `bun run typecheck` (`tsc -b` clean), `bun run test` (18 files, 213 tests pass incl. new core unit suites, `core/` purity guard, and the 10-test workers-pool seed integration suite; Stories 1.1–1.5 remain green). The live path (real IGDB fetch + D1 HTTP write) is out-of-band by design and hand-verified, not in CI.

**Residual risks:** The `scripts/seed-import.ts` entrypoint and the real IGDB/D1-HTTP adapters are intentionally outside `tsc -b` and untested in CI (no creds / no remote D1), matching the `generate-icons.ts` precedent — their correctness rests on the tested `core/`/`services/` layers plus a hand-run of `bun run seed`. Notion rows with an unparseable `Date finished` on a `Completed` status become stragglers (never fabricated), as designed.
