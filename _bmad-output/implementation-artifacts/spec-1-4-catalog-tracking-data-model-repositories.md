---
title: 'Catalog & tracking data model + repositories'
type: 'feature'
created: '2026-07-07'
status: 'done'
baseline_revision: 'f60bdc2a037be73d419dd635b181af4c020aa8b8'
final_revision: '89e0a1ba1c7ae8b83b553eda20b9b62c919a1cbc'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The database has only the `meta` placeholder and better-auth's tables. Story 1.6 (seed import) has nowhere to write games/genres/links/tracking, and Story 1.7 (shelf) has nothing to read — the domain data model and the `repositories/` access seam (AD-4) don't exist yet.

**Approach:** Define the six Epic-1 domain tables in Drizzle (`GAME`, `GAME_TRACKING`, `GENRE`, `GAME_GENRE`, `EXTERNAL_LINK`, `IMPORT_STRAGGLER`) exactly as the architecture Structural Seed specifies, generate their migration via `drizzle-kit generate`, and expose a small functional repository layer as the single D1 access path future seed/shelf/sync jobs consume — every tracking read/write scoped by `user_id` (AD-13).

## Boundaries & Constraints

**Always:**
- Attribute ownership is fixed (AD-19): `GAME` holds shared catalog facts (`title`, `title_normalized`, `release_date`, `cover_url`, `store_url`, `ps_plus_extra`, `unenriched`) written by ingest; `GAME_TRACKING` holds per-user mutable state (`play_status`, milestone/lifecycle dates, `owned`, `ownership_type`). `owned` lives on `GAME_TRACKING`, never `GAME`.
- `GAME_TRACKING`'s primary key is composite `(user_id, game_id)` — one row per user per game (AD-17); `user_id` references the better-auth `user` table. Every tracking repository function filters/keys by `user_id` (AD-13).
- `title_normalized` carries **no** uniqueness constraint or unique index (AD-18); game identity is `EXTERNAL_LINK (source, external_id)`. `EXTERNAL_LINK` allows **many** rows per `(game_id, source)` (PS4 + PS5 → one `GAME`, AD-20), but `(source, external_id)` is globally unique (one external id resolves to exactly one game).
- All DB access goes through Drizzle in `repositories/` (AD-4) — no raw D1 (`env.DB.prepare`, `.exec`) anywhere in `src/` except better-auth's own adapter. Repository functions take a `Db` (from `createDb`) as their first argument, matching the existing functional-seam style.
- Dates are stored as ISO `YYYY-MM-DD` `text` columns (matches the `core/` string-comparison contract, AD-8/spine Dates convention); enum-like columns (`play_status`, `ownership_type`, `source`) use Drizzle `text({ enum })`; booleans use `integer({ mode: 'boolean' })`. `play_status` vocabulary is imported from `core/` (single source, AD-3), not re-declared.
- Migrations are generated with `drizzle-kit generate` (`bun run db:generate`) and applied via `wrangler d1 migrations apply` / the test harness's `applyD1Migrations` — never at Worker startup (AD-16). Add the new schema module to the `src/schema/index.ts` barrel so drizzle-kit and `createDb`'s relational client pick it up.

**Block If:** (none — the one ambiguity, `ps_plus_extra` "per region", is resolved unattended to the Structural Seed's literal single `bool ps_plus_extra` column; true per-region storage needs `SETTING`, which is an Epic-5 table explicitly out of scope here.)

**Never:**
- Don't create `SETTING` or any later-epic table (entity-as-needed); don't add a `wishlisted`/`released`/`playable_now` column — those are computed in `core/`, never persisted (AD-8).
- Don't add speculative query shapes (filtered/sorted shelf queries, sync-conflict resolution, add-by-name dedupe logic) — those belong to Stories 1.6/1.7 and Epics 4/6. Build only the create/read primitives seed + shelf need.
- Don't enforce the completion invariant, milestone-write side-effects, or append-only sync rules here (AD-10/11/12/21) — this story is schema + persistence primitives; those guards land at their edit/ingest boundaries in later epics.
- Don't issue a raw D1 query outside `repositories/`; don't let a repository import `providers/` or global `fetch` (nothing external on a data path, AD-6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Insert a game | `insertGame({ title, titleNormalized })`, optional facts omitted | Row persisted with a generated `id`; `ps_plus_extra`/`unenriched`/`owned`-n/a default `false`; returns the created row | No error expected |
| Two games share a normalized title | insert two games both `titleNormalized: 'x'` with different external ids | Both persist (no unique on `title_normalized`); `findGamesByNormalizedTitle('x')` returns both (AD-18) | No error expected |
| PS4 + PS5 links to one game | `addExternalLink({ gameId: g, source:'PSN', externalId:'ps4' })` then `{... 'ps5' }` | Both rows persist under `(g, 'PSN')`; `findGameByExternalLink('PSN','ps4')` and `('PSN','ps5')` both resolve to `g` (AD-20) | No error expected |
| Duplicate external identity | add `(source:'PSN', externalId:'ps4')` a second time (any game) | Rejected by the `(source, external_id)` unique constraint | Constraint error surfaces (caller decides) |
| Auto-create a genre twice | `upsertGenre('Action')` then `upsertGenre('Action')` | Exactly one `genre` row; both calls return the same `id` (idempotent by unique name) | No error expected |
| Link a game↔genre twice | `linkGameGenre(g, gen)` twice | Exactly one `game_genre` row (idempotent composite PK) | No error expected; conflict ignored |
| Same game tracked by two users | `upsertTracking(userA, g, {...})` and `upsertTracking(userB, g, {...})` | Two `game_tracking` rows (composite PK); `getTracking(userA, g)` returns only A's; `listTrackingForUser(userA)` excludes B (AD-13) | No error expected |
| Re-track same (user, game) | `upsertTracking(userA, g, { playStatus:'Playing' })` then `{ playStatus:'Paused' }` | One row, updated to `'Paused'` | No error expected |
| Record a straggler | `insertStraggler({ sourceTitle, notionPayload })` | Row persisted; `listStragglers()` returns it (AD-22a) | No error expected |
| Schema audit | after migrations apply | `game, game_tracking, genre, game_genre, external_link, import_straggler` all exist; `SETTING` does not; `title_normalized` has no unique index | No error expected |

</intent-contract>

## Code Map

- `src/schema/catalog.ts` -- NEW: the six domain tables (game/game_tracking/genre/game_genre/external_link/import_straggler), snake_case columns, composite PKs, enum text columns, `(source, external_id)` unique, supporting indexes
- `src/schema/index.ts` -- add `export * from './catalog'` so drizzle-kit + `createDb` see the tables (currently re-exports `auth` + `meta`)
- `src/schema/meta.ts` -- existing placeholder; its comment says real entities land in Story 1.4 — leave the table, it's harmless
- `src/core/types.ts` -- add a runtime `PLAY_STATUSES` tuple and derive `PlayStatus` from it, so `schema/catalog.ts` imports the enum vocabulary from its single owner (AD-3)
- `src/repositories/db.ts` -- existing `createDb`/`Db` seam; repositories build on it (no change)
- `src/repositories/games.ts` -- NEW: `insertGame`, `findGamesByNormalizedTitle`, `findGameByExternalLink`, `addExternalLink`, `listExternalLinks`
- `src/repositories/genres.ts` -- NEW: `upsertGenre`, `linkGameGenre`, `listGenresForGame`
- `src/repositories/tracking.ts` -- NEW: `getTracking`, `upsertTracking`, `listTrackingForUser` (all `user_id`-scoped)
- `src/repositories/stragglers.ts` -- NEW: `insertStraggler`, `listStragglers`
- `src/repositories/index.ts` -- barrel-export the new modules (currently only `./db`)
- `migrations/0002_*.sql` (+ `meta/` snapshot & journal) -- generated by `bun run db:generate`
- `test/integration/repositories.test.ts` -- NEW: exercise the I/O matrix against real workerd + in-test D1 (mirror `auth.test.ts` harness)
- `test/integration/auth.test.ts` -- its `sqlite_master` audit asserts an exact table set; extend the expected list with the six new tables
- `vitest.config.ts` / `wrangler.jsonc` -- reference only; the migration harness already reads `./migrations`, no change expected

## Tasks & Acceptance

**Execution:**
- [x] `src/core/types.ts` -- add `export const PLAY_STATUSES = [...] as const` and `export type PlayStatus = (typeof PLAY_STATUSES)[number]` -- give the schema a runtime enum source without duplicating the vocabulary (AD-3); keeps `purity.test.ts` passing (no new imports)
- [x] `src/schema/catalog.ts` -- define the six tables per the Structural Seed & AD-17/18/19/20/22: `game` (text `id` uuid default, `title`, `title_normalized` non-unique + plain index, nullable `release_date`/`cover_url`/`store_url`, boolean `ps_plus_extra`/`unenriched` default false); `game_tracking` (composite PK `(user_id→user.id, game_id→game.id)`, nullable `play_status` enum, `completed_on`/`platinum_on`/`started_on`/`bought_on`/`wishlisted_on` ISO-text, boolean `owned` default false, nullable `ownership_type` enum); `genre` (uuid `id`, unique `name`); `game_genre` (composite PK `(game_id, genre_id)`); `external_link` (uuid `id`, `game_id`, `source` enum, `external_id`, unique `(source, external_id)`, index on `game_id`); `import_straggler` (uuid `id`, `source_title`, nullable `notion_payload`) -- the AR-15/16/17/19/22 data model
- [x] `src/schema/index.ts` -- `export * from './catalog'` -- drizzle-kit + `createDb` schema registration
- [x] `migrations/*` -- run `bun run db:generate` and commit the generated SQL + `meta/` snapshot -- versioned migration applied from CI/CD (AD-16)
- [x] `src/repositories/games.ts` -- `insertGame`, `findGamesByNormalizedTitle` (returns array — non-unique key), `findGameByExternalLink`, `addExternalLink`, `listExternalLinks` -- the identity/match seam (AD-18/20)
- [x] `src/repositories/genres.ts` -- `upsertGenre` (idempotent by unique name, returns existing/created row), `linkGameGenre` (idempotent), `listGenresForGame` -- IGDB vocabulary auto-create (FR-23)
- [x] `src/repositories/tracking.ts` -- `getTracking(db, userId, gameId)`, `upsertTracking(db, userId, gameId, patch)`, `listTrackingForUser(db, userId)` -- every function keyed/filtered by `user_id` (AD-13)
- [x] `src/repositories/stragglers.ts` -- `insertStraggler`, `listStragglers` -- unmatched-import staging rows (AD-22a)
- [x] `src/repositories/index.ts` -- re-export `games`/`genres`/`tracking`/`stragglers` -- one import surface for the seam
- [x] `test/integration/repositories.test.ts` -- cover every I/O & Edge-Case Matrix row against in-test D1 (apply migrations in `beforeAll`, seed a `user` row for FK-valid tracking) -- regression net
- [x] `test/integration/auth.test.ts` -- extend the exact-table-set assertion to include `external_link`, `game`, `game_genre`, `game_tracking`, `genre`, `import_straggler` (alphabetical) -- keep the audit green after the new migration

**Acceptance Criteria:**
- Given the Drizzle schema, when migrations are generated and applied, then `game`, `game_tracking`, `genre`, `game_genre`, `external_link`, and `import_straggler` all exist with the AD-19 attribute ownership (`owned` on `game_tracking`, catalog facts on `game`) (AR-15, AR-16, AR-17, AR-19, AR-22)
- Given the applied schema, when it is inspected, then `title_normalized` has no unique constraint/index and `game_tracking`'s primary key is `(user_id, game_id)` (AR-18, AD-17)
- Given any data access in this story, when a repository reads or writes, then it does so only through Drizzle under `repositories/`, and no raw D1 query exists in `src/` outside better-auth's adapter (AR-4)
- Given entity-as-needed scope, when the migration is applied, then `SETTING` and other later-epic tables are absent
- Given `bun run lint && bun run typecheck && bun run test`, when run, then all pass — including the new `repositories.test.ts`, the updated auth table audit, and the untouched `src/core/**` unit + `purity.test.ts` guards

## Spec Change Log

## Review Triage Log

### 2026-07-07 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 11
- addressed_findings:
  - `low` `patch` `upsertTracking`'s empty-patch guard measured `Object.keys(patch).length`, so an all-`undefined` patch (e.g. `{ playStatus: undefined }`) slipped through to the `onConflictDoUpdate` path, where Drizzle strips the undefined value and leaves a degenerate empty `SET` clause — a runtime SQL error on the update branch. Now filters to *defined* fields before choosing the insert-if-absent vs. update branch; added a regression test proving an all-undefined patch leaves the row untouched.
  - `low` `patch` The per-user scoping test's `forA.every((row) => row.userId === userA)` is vacuously true on an empty array, so a regression returning `[]` could pass. Added an explicit `expect(forA.some((row) => row.userId === userB)).toBe(false)` that actively proves user B's row is excluded.
  - `low` `patch` The narrow-SET partial-merge — the property that justifies `upsertTracking`'s shape (a later patch touching one column must not clobber others) — had no test (both existing upsert tests set `playStatus` twice). Added a merge-preservation test: set `playStatus`, then patch only `owned`/`ownershipType`, and assert `playStatus` survives.
  - `reject` (11, deduped across both reviewers): enum columns lack a DB `CHECK` — spec-sanctioned; TS + Zod-at-boundary is the project's enforcement convention (auth tables carry no CHECKs either). `addExternalLink` throwing on a duplicate `(source, external_id)` — intentional per the I/O matrix and AD-20 ("never silently merged"); idempotency would mask a different-game conflict. `insertGame` has no dedupe / no `updateGame` primitive — find-then-insert ordering is the caller's (seed's) job and the enrichment-update primitive is an entity-as-needed Epic-6 addition. Case/whitespace-variant genres — genres are IGDB-canonical only (FR-23 drops user free-text), so casing is stable. `linkGameGenre`/tracking FK errors unguarded and FK enforcement untested — correct-usage callers always reference existing rows; testing D1's default FK pragma isn't this story's burden. Contradictory `owned`/`ownership_type` and unvalidated `notion_payload` JSON — by-design deferrals (no invariant enforcement this epic; the straggler payload is opaque staging text). Fallback returning `undefined` on a concurrent delete — impossible under single-writer D1. Return-type looseness on the empty-patch branch — the `undefined` is unreachable in practice.

## Design Notes

- **`ps_plus_extra` "per region":** the Structural Seed models this as a single `bool ps_plus_extra` column on `GAME`, and PS+ Extra membership isn't wired until Epic 5 (epic context). True per-region storage depends on the account region living in `SETTING` (AD-23), an Epic-5 table explicitly excluded here. So Epic 1 builds the literal single boolean column; the per-region refinement is an Epic-5 schema evolution, not this story's.
- **Ids:** `text('id').primaryKey().$defaultFn(() => crypto.randomUUID())` on `game`/`genre`/`external_link`/`import_straggler` — `crypto.randomUUID` is a workerd + Node global, so repositories don't hand-generate ids and `.returning()` yields the row. `game_tracking` and `game_genre` have no surrogate id (their composite PKs are identity).
- **`(source, external_id)` uniqueness:** AD-20 allows many links per `(game_id, source)` (the PS4/PS5 collapse) but requires that a given external id resolve to exactly one game — enforced by `UNIQUE(source, external_id)`, which is also what makes `findGameByExternalLink` a single-row lookup. This is deliberately distinct from *not* uniquing `(game_id, source)`.
- **Straggler kinds:** `IMPORT_STRAGGLER` models AD-22 kind (a) only — import-staging rows that never became a `GAME` (carry the raw Notion payload as a JSON `text`). Kind (b), name-only add-by-name entries, are real `GAME` rows flagged `unenriched` (a column on `game`), not rows here. It intentionally carries no `user_id` — the Structural Seed shows `IMPORT_STRAGGLER` unconnected to `USER`, and a staging row is not user tracking data (AD-13 binds tracking rows).
- **Repository style — golden shape** (functional, `Db`-first, one seam):
  ```ts
  export async function findGamesByNormalizedTitle(db: Db, titleNormalized: string) {
    return db.select().from(game).where(eq(game.titleNormalized, titleNormalized));
  }
  export async function upsertGenre(db: Db, name: string) {
    const [row] = await db.insert(genre).values({ name })
      .onConflictDoUpdate({ target: genre.name, set: { name } }).returning();
    return row; // idempotent by unique name
  }
  ```

## Verification

**Commands:**
- `bun run db:generate` -- expected: emits `migrations/0002_*.sql` + updated `meta/` on first run; a second run reports "No schema changes" (schema and migration in sync)
- `bun run lint` -- expected: Biome passes, including the untouched `src/core/**` restricted-import override
- `bun run typecheck` -- expected: `tsc -b` clean
- `bun run test` -- expected: all pass — `test/integration/repositories.test.ts` covers every I/O-matrix row (insert/defaults, non-unique title, PS4/PS5 multi-link + identity lookup, duplicate-identity rejection, idempotent genre + link, per-user tracking isolation, tracking re-upsert, straggler, and the `sqlite_master` audit); the updated `auth.test.ts` audit lists the six new tables; `src/core/**` and `purity.test.ts` unchanged and green
- `bun run build` -- expected: SPA + Worker build clean

**Manual checks (if no CLI):**
- Inspect `migrations/0002_*.sql`: six `CREATE TABLE` statements, `game_tracking` PK `(user_id, game_id)`, a `UNIQUE` on `external_link (source, external_id)`, and no `UNIQUE` touching `title_normalized`.

## Auto Run Result

Status: done

**Summary:** Story 1.4 lands the Epic-1 domain data model and the `repositories/` persistence seam (AD-4). Six Drizzle tables now exist — `game` (shared catalog facts), `game_tracking` (per-user state, composite PK `(user_id, game_id)`), `genre`, `game_genre`, `external_link` (many links per game+source, `(source, external_id)` unique), and `import_straggler` — generated into migration `0002_icy_deathstrike.sql`. A functional, `Db`-first repository layer (games/genres/tracking/stragglers) is the single data path future seed (1.6) and shelf (1.7) work will consume, with every tracking function user-scoped (AD-13). Attribute ownership, the non-unique `title_normalized` (AD-18), and entity-as-needed scope (no `SETTING`, no derived columns, no invariant enforcement) all match the architecture Structural Seed. A two-reviewer pass (adversarial + edge-case) produced 3 low-severity patches, all applied.

**Files changed:**
- `src/core/types.ts` — added the `PLAY_STATUSES` runtime tuple and derived `PlayStatus` from it, so the schema keys its `play_status` enum off `core/`'s single vocabulary (AD-3).
- `src/schema/catalog.ts` (new) — the six domain tables per AD-17/18/19/20/22; snake_case columns, composite PKs, enum text columns, `(source, external_id)` unique index, non-unique `title_normalized` index.
- `src/schema/index.ts` — re-export `./catalog` so drizzle-kit + `createDb` register the tables.
- `migrations/0002_icy_deathstrike.sql` (+ `meta/` snapshot & journal) — generated migration (AD-16).
- `src/repositories/games.ts` / `genres.ts` / `tracking.ts` / `stragglers.ts` (new) + `index.ts` — the repository seam: game/link identity + match lookups, idempotent genre auto-create + tagging, user-scoped tracking upsert/read, straggler staging.
- `test/integration/repositories.test.ts` (new) — 14 integration cases against real workerd + in-test D1 covering every I/O-matrix row plus the review-added merge-preservation and all-undefined-patch cases.
- `test/integration/auth.test.ts` — extended the `sqlite_master` table audit to include the six new tables.

**Review findings breakdown:** 3 patch (low), 0 defer, 11 reject, 0 bad_spec, 0 intent_gap. Patches: (1) hardened `upsertTracking`'s guard to filter `undefined` values so an all-undefined patch can't build a degenerate empty `SET` clause; (2) strengthened the per-user scoping test to actively assert user B's row is excluded (the prior `.every` was vacuous on an empty array); (3) added a merge-preservation test proving a narrow-SET patch doesn't clobber untouched columns. The 11 rejects were spec-sanctioned choices (DB-CHECK vs. TS+Zod enforcement; `addExternalLink` surfacing duplicate-identity per AD-20), entity-as-needed deferrals (no `updateGame`, no invariant enforcement, opaque straggler payload), IGDB-canonical genre casing, or architecturally impossible under single-writer D1.

**Verification performed:**
- `bun run lint` (Biome, 49 files, clean), `bun run typecheck` (`tsc -b`, clean), `bun run test` (8 files, **116 tests pass** incl. 14 new repository tests + updated auth audit + untouched `src/core/**` and `purity.test.ts`), `bun run build` (SPA + Worker clean) — re-run green after the review patches.
- `bun run db:generate` re-run reports "No schema changes" — schema and migration are in sync.
- Inspected the generated SQL by hand: six tables, `game_tracking` PK `(user_id, game_id)`, `UNIQUE(source, external_id)` on `external_link`, only a non-unique index on `title_normalized`, no `setting` table.

**Residual risks:**
- Enum columns (`play_status`, `source`, `ownership_type`) are enforced by TypeScript + the planned Zod-at-boundary validation, not a DB `CHECK` (the project's chosen convention). A raw/casted non-TS write could persist an out-of-vocabulary value; seed/sync must map through typed paths (they do — `source` is provider-hardcoded and Notion status maps through a `core/` function in Story 1.6).
- `insertGame` is an unconditional insert; the find-then-insert dedupe ordering is the caller's responsibility (seed calls `findGameByExternalLink` first). No `updateGame`/enrichment-update primitive yet — deferred to when Epic 6's name-only add-by-name needs it (entity-as-needed).
- Foreign-key cascade behavior relies on D1's default `PRAGMA foreign_keys=ON`; not asserted by a test (consistent with the existing auth tables).
