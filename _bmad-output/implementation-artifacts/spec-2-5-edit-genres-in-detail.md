---
title: 'Story 2.5: Edit genres in detail'
type: 'feature'
created: '2026-07-09'
status: 'done'
baseline_revision: 'c52aa3be5470373003e889648067eb68e5c9dc98'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/project-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** A bad genre auto-fill from import sticks forever — the detail panel renders genres read-only and no write path exists for `GAME_GENRE` (FR-25), though the vocabulary and join repositories already exist.

**Approach:** Add/remove endpoints for a game's genre set (many-to-many) plus a vocabulary listing, surfaced in the detail panel as removable chips and an add input with vocabulary suggestions. Adding a name not yet in the vocabulary auto-creates the genre row (FR-24); a case-insensitive match reuses the existing row so Epic 3's filter pills don't fill with duplicates.

## Boundaries & Constraints

**Always:**
- Genres are shared catalog facts on `GAME`/`GAME_GENRE` (not user-scoped rows), but writes are gated by "this user tracks the game": no tracking row → 404, mirroring every other detail-panel write. `requireAuth`, Zod in and out, `routes/ → services/ → repositories/` (AD-13).
- Genre names are trimmed and inner whitespace collapsed before use; empty after trim → 400. **Named hazard (FR-24): adding a name not in the vocabulary auto-creates the genre row exactly once — a case-insensitive match reuses the existing row instead of creating a near-duplicate. Red-then-green.**
- Add and remove are idempotent: re-adding a linked genre and removing an unlinked/unknown one both answer 200 with the (unchanged) current list. Both writes answer the game's updated genre list.
- Removing a link never deletes the genre row — the vocabulary persists (no garbage collection).
- Detail panel: each genre becomes a chip with an accessibly named remove button (`Remove <name> — ≥44×44 via tap-target`); an add input offers the vocabulary via native `<datalist>` (no picker/autocomplete dependency) and submits on Enter or an Add button. Every write invalidates `['shelf']` (AD-7) and toasts plainly (reversal is a trivial re-add — no UNDO). Focus trap already covers the new controls via the shared `FOCUSABLE_SELECTOR`.
- Nothing external on render or edit: vocabulary and genre writes touch D1 only, never IGDB.

**Block If:**
- The genre rules cannot be expressed without a schema change (they can: `genre.name` is unique, `game_genre` has the composite PK).

**Never:**
- No merge/rename tool, no genre-row delete or edit (FR-25 v1 scope) — the UI offers only add and remove. No sync/import changes. No third-party call. No new `core/` module for what is a trim-and-collapse one-liner in the service.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add a brand-new genre | `{name: "Roguelite"}`, not in vocabulary | Genre row auto-created, linked; 200 updated list | No error expected |
| Add an existing vocabulary genre | `{name: "Action"}` in vocabulary, not linked | Linked, **no new row**; 200 updated list | No error expected |
| Add a case-variant | `{name: "action"}`, vocabulary has `Action` | Existing `Action` row reused and linked; no near-duplicate row | No error expected |
| Re-add an already-linked genre | `{name: "Action"}` already linked | 200, list unchanged, no duplicate join row | No error expected |
| Whitespace-mangled name | `{name: "  Open   world "}` | Stored/matched as `Open world` | No error expected |
| Empty name | `{name: "   "}` | — | `400`, nothing written |
| Remove a linked genre | DELETE `Action` linked | Unlinked; 200 updated list; row stays in vocabulary | No error expected |
| Remove an unlinked/unknown genre | DELETE `Zzz` | 200, list unchanged | No error expected |
| Vocabulary listing | GET, vocabulary non-empty | 200 sorted name list | No error expected |
| Unauthenticated / untracked game | as previous stories | — | 401 / 404, nothing written |

</intent-contract>

## Code Map

- `src/repositories/genres.ts` -- add `unlinkGameGenre`, `findGenreByNameInsensitive` (`lower(name)` match), `listAllGenres`; `upsertGenre`/`linkGameGenre`/`listGenresForGame` exist and are idempotent — reuse.
- `src/services/genres.ts` -- **new**: `addGenreToGame`, `removeGenreFromGame` (tracking-row gate via `getTracking`, trim/collapse, case-insensitive reuse, return updated list), `listGenreVocabulary`.
- `src/routes/genres.ts` -- **new**: `GET /genres`, `POST /games/:gameId/genres`, `DELETE /games/:gameId/genres/:name` (URL-encoded name), Zod bodies/responses; register in `src/routes/index.ts`.
- `src/repositories/tracking.ts` -- `getTracking` reused as the scope gate.
- `test/integration/genres.test.ts` -- **new**: every matrix row through the route with a real session.
- `web/shelf/api.ts` -- `addGenre`, `removeGenre`, `fetchGenreVocabulary` client fns, Zod-parsed.
- `web/shelf/useTrackingMutations.ts` -- `addGenre`/`removeGenre` mutations on the shared seam (invalidate `['shelf']` + `['genres']`, plain toasts, same in-flight guard).
- `web/shelf/DetailPanel.tsx` + `detail-panel.css` -- genres section becomes chip list + add form (`<input list>` + `<datalist>` from a `['genres']` query, Enter/Add submits, input clears on success).
- `web/shelf/DetailPanel.test.tsx` -- UI coverage.

## Tasks & Acceptance

**Execution:**
- [x] `src/repositories/genres.ts` -- `unlinkGameGenre(db, gameId, genreId)`; `findGenreByNameInsensitive(db, name)` using `lower(genre.name) = lower(?)`; `listAllGenres(db)` sorted by name.
- [x] `src/services/genres.ts` -- `addGenreToGame(db, userId, gameId, rawName)`: no tracking row → `null`; trim+collapse, empty → `'invalid'`; case-insensitive vocabulary lookup → reuse or `upsertGenre`; `linkGameGenre`; return `listGenresForGame` names. `removeGenreFromGame`: same gate; unknown name or unlinked → current list unchanged. `listGenreVocabulary`. **Hazard test red-then-green: auto-create-once + case-insensitive reuse.**
- [x] `src/routes/genres.ts` + `src/routes/index.ts` -- the three endpoints behind `requireAuth`; body `{ name: z.string() }`; map `'invalid'` → 400, `null` → 404; 200 `{ genres: string[] }` (GET: `{ genres }` of the vocabulary).
- [x] `test/integration/genres.test.ts` -- all matrix rows: auto-create row count asserted (exactly one row across add + case-variant re-add), reuse, idempotent re-add/remove, whitespace collapse, 400 empty, vocabulary listing sorted, 401/404, row-stays-in-vocabulary after unlink.
- [x] `web/shelf/api.ts` -- `addGenre(gameId, name)`, `removeGenre(gameId, name)`, `fetchGenreVocabulary()`.
- [x] `web/shelf/useTrackingMutations.ts` -- genre add/remove mutations: success toast (`<title> — <genre> added/removed`), error toast, invalidate `['shelf']` and `['genres']`.
- [x] `web/shelf/DetailPanel.tsx` + `detail-panel.css` -- chips with `Remove <name>` buttons (tap-target), add form with datalist suggestions, submit on Enter/Add, clear input on success; no merge/rename control anywhere.
- [x] `web/shelf/DetailPanel.test.tsx` -- add via input (POSTs, input clears), remove via chip (DELETEs), datalist populated from the vocabulary query, empty input does not POST, genres section offers only add/remove controls.

**Acceptance Criteria:**
- Given the detail panel, when the user adds or removes genres, then the game's genre set updates many-to-many and the shelf card reflects it after invalidation (FR-25).
- Given a genre name not yet in the vocabulary, when it is saved, then the genre row is auto-created exactly once, and a case-insensitive duplicate is never created (FR-24).
- Given the detail view, when it renders, then no merge/rename tool is offered (FR-25 v1 scope).
- Given the panel's new controls, when the user Tabs through, then the shared focus trap includes them (no per-dialog drift).

## Spec Change Log

## Review Triage Log

### 2026-07-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 1, low 5)
- defer: 1 (high 0, medium 0, low 1)
- reject: 11
- addressed_findings:
  - `medium` `patch` No length bound on the API's only free-text write — `z.string().max(64)` on the genre body, integration test added.
  - `low` `patch` `listGenresForGame`/`listGenresForGames` were unordered (chips could reorder between mutation response and shelf refetch) — both now `ORDER BY name COLLATE NOCASE`.
  - `low` `patch` Vocabulary sort was BINARY collation (`Zelda` before `action`) and the test asserted consistency with the bug — NOCASE ordering, test now checks case-insensitive order.
  - `low` `patch` Vocabulary integration test depended on data seeded by an earlier test — now self-seeds.
  - `low` `patch` Long unbroken genre names could blow a chip past the panel width — `max-width` + `overflow-wrap: anywhere`.
  - `low` `patch` Dangling empty comment line left in the `DetailPanel` docblock — removed.

## Verification

**Commands:**
- `bun run lint` -- expected: Biome reports no errors.
- `bun run typecheck` -- expected: `tsc -b` exits 0.
- `bun run test` -- expected: all suites pass, incl. new `genres` integration suite and extended panel tests; 2.1–2.4 hazard tests untouched and green.

## Auto Run Result

**Summary:** Story 2.5 implemented and reviewed. Genre editing from the detail panel: `POST /games/:gameId/genres` (trim/collapse, FR-24 auto-create with case-insensitive reuse), `DELETE /games/:gameId/genres/:name` (idempotent, vocabulary row survives), and `GET /genres` (NOCASE-sorted vocabulary), surfaced as removable chips plus an add input with native `<datalist>` suggestions. No merge/rename tool (FR-25 v1 scope).

**Files changed:**
- `src/repositories/genres.ts` — `findGenreByNameInsensitive`, `unlinkGameGenre`, `listAllGenres`; per-game and shelf genre listings now ordered `COLLATE NOCASE`.
- `src/services/genres.ts` — new: `addGenreToGame` / `removeGenreFromGame` (tracking-row gate → 404, trim/collapse, `'invalid'` → 400) and `listGenreVocabulary`.
- `src/routes/genres.ts` + `src/routes/index.ts` — the three endpoints behind `requireAuth`, name bounded to 64 chars, Zod in/out.
- `src/services/index.ts` — barrel export.
- `test/integration/genres.test.ts` — new: 12 route-level cases incl. the FR-24 hazard (row-count assertions, verified red-then-green), whitespace collapse, idempotency, length cap, 401/404.
- `web/shelf/api.ts` — `addGenre`, `removeGenre`, `fetchGenreVocabulary` client fns.
- `web/shelf/useTrackingMutations.ts` — genre mutation on the shared seam (plain toasts, in-flight guard, invalidates `['shelf']` + `['genres']`).
- `web/shelf/DetailPanel.tsx` + `detail-panel.css` — chips with `Remove <name>` buttons, add form with datalist from a `['genres']` query, input clears on success.
- `web/shelf/DetailPanel.test.tsx` — 6 new genre tests; fetch mock now routes the vocabulary GET apart from tracking writes (`writes()` helper keeps existing count assertions honest).

**Review findings:** 6 patched (1 medium: unbounded free-text name, now capped at 64; 5 low: deterministic NOCASE ordering for chips and vocabulary, self-seeding vocabulary test, chip overflow CSS, docblock cleanup), 1 deferred (case-variant TOCTOU needs a NOCASE unique index migration), 11 rejected as noise/by-design.

**Verification:** `bun run lint` clean, `bun run typecheck` clean, `bun run test` 486/486 across 35 files after review patches. FR-24 hazard test verified red (case-insensitive reuse disabled → fails) then green.

**Residual risks:** concurrent case-variant adds can still create a near-duplicate genre row until the NOCASE unique index lands (deferred, single-user exposure); Unicode normalization variants are out of scope.
