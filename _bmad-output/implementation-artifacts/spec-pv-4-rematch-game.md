---
title: 'PV-4: Rematch an already-added game from the detail panel'
type: 'feature'
created: '2026-07-13'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '77e579a'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a game got the wrong IGDB match (PV-1: "Spider-Man 2" wins the 2004 tie-in's cover), there is no correction path from the UI — the wrong cover/genres are stuck. The stragglers flow only reaches name-only (`unenriched`) games, not already-enriched ones. This also blocks PV-5 data cleanup (no way to fix already-wrong covers).

**Approach:** Add a "Wrong match?" entry point on the detail panel that opens the existing IGDB search/pick UI. Picking a candidate calls a new `POST /api/games/:id/rematch`: replace the game's IGDB link (drop old → anchor new), overwrite enrichment (cover/release/title), and REPLACE its genres with the picked match's. Reuses `searchCandidates` (the same seam the stragglers picker uses) and the `enrichGame`/`anchorIgdb` machinery. Also lift the candidate-list cap 10→50 to match the query's own `limit 50` fetch ceiling — one number, not two (folds PV-3: prolific-franchise games buried past position 10 in the same picker).

## Boundaries & Constraints

**Always:**
- User-scope every write (AD-13): rematch only a game the caller tracks (`getTracking`), else 404.
- Duplicate identity is permanent (AD-20): a rematch that would point at an IGDB id already linked to a DIFFERENT game is a `conflict` (409) — never silently attach or create a second row.
- IGDB reached only on the user's explicit pick; a search failure/absent creds degrades to an empty list (NFR-4), same as the stragglers picker.
- Rematch edits the EXISTING game row in place — never inserts a game.

**Ask First:**
- None — genre replacement (below) is the chosen behavior, not a gate.

**Never:**
- No confirm gate — rematch is reversible (rematch again). No `bought_on`/tracking changes; only catalog facts (cover, release, title, genres, IGDB link).
- No "see more" pagination UI for PV-3 — the cap bump is the whole fix.
- Do not touch the stragglers flow or extract a shared picker component (two callers ≠ three).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rematch to a better candidate | tracked game; picked igdbId unlinked, or already this game's | old IGDB link(s) dropped, new one anchored; cover/release/title overwritten; `unenriched` cleared; genres replaced with the pick's | N/A |
| Picked game already in library | picked igdbId links to a DIFFERENT game row | no writes; service returns `conflict` → 409 | UI toast "already in your library" |
| Game not tracked by caller | unknown/foreign gameId | no writes; `not-found` → 404 | UI toast + refetch shelf |
| Bad body | non-https cover, impossible date, empty igdbId | 400 | Zod rejects (mirror add/resolve schema) |
| Search with no IGDB creds | e2e/dev env | picker shows "no match" notice; nothing changes | degrade (NFR-4) |

</frozen-after-approval>

## Code Map

- `src/repositories/games.ts` -- `enrichGame`, `addExternalLink`, `findGameByExternalLink`, `listExternalLinks` already here; ADD `removeExternalLinksBySource`.
- `src/repositories/genres.ts` -- `linkGameGenre`, `findGenreByNameInsensitive`, `upsertGenre` here; ADD `clearGameGenres` (bulk delete a game's genre links).
- `src/services/games.ts` -- `addGame` shows the genre-link + anchor idiom to mirror; ADD `rematchGame`.
- `src/routes/games.ts` -- `igdbFromEnv`, add/preview/search routes + Zod schemas to mirror; ADD `POST /games/:id/rematch`.
- `src/providers/igdb.ts:271` -- `searchCandidates(title, limit = 10)` default → 50, matching the query's `limit 50` (PV-3).
- `web/shelf/api.ts` -- `searchIgdb`, `resolveStraggler`, `IgdbCandidate` here; ADD `rematchGame` client fn.
- `web/shelf/StragglersDialog.tsx` -- `ResolveView` is the search/pick UI to mirror (do NOT share).
- `web/shelf/DetailPanel.tsx` -- add the "Wrong match?" button + dialog open state.
- `web/shelf/RematchDialog.tsx` -- NEW: self-contained search + candidate list + pick, reusing `searchIgdb`.
- `test/integration/games.test.ts` -- add rematch write-path tests (mirror `stragglers.test.ts` style).
- `playwright/e2e/epic6.spec.ts` -- add detail-panel rematch entry-point + degraded-search test (standing rule spec-2-5-4).

## Tasks & Acceptance

**Execution:**
- [x] `src/repositories/games.ts` -- add `removeExternalLinksBySource(db, gameId, source)` -- drop the stale IGDB link before anchoring the new one.
- [x] `src/repositories/genres.ts` -- add `clearGameGenres(db, gameId)` -- wipe the wrong match's genres before applying the pick's.
- [x] `src/services/games.ts` -- add `rematchGame(db, userId, gameId, input)` returning `{kind:'rematched',gameId} | 'not-found' | 'conflict'` -- tracking check → conflict check → drop old link → anchor new → `enrichGame` overwrite → clear+relink genres.
- [x] `src/routes/games.ts` -- add `POST /games/:id/rematch` (requireAuth, Zod body = resolve's minus `id`/`kind`); map `not-found`→404, `conflict`→409, else `{gameId}` 200.
- [x] `src/providers/igdb.ts` -- `searchCandidates` default `limit` 10→50 (match the query's `limit 50`, PV-3); update the line comment.
- [x] `web/shelf/api.ts` -- add `rematchGame(gameId, payload)` (POST; throws on non-OK incl. 409 via `callApi`).
- [x] `web/shelf/RematchDialog.tsx` -- new component: title-seeded search form, candidate list (cover + name + year + "Use this match"), reuses `searchIgdb`; ponytail comment noting the intentional near-dupe of `ResolveView`.
- [x] `web/shelf/DetailPanel.tsx` -- add a "Wrong match?" button opening `RematchDialog`; on success invalidate `['shelf']`+`['genres']`, toast, and `onClose` the panel (facts changed).
- [x] `test/integration/games.test.ts` -- rematch happy path (link swapped, genres replaced, `unenriched` cleared), conflict (409, no writes), not-found (foreign game, 404).
- [x] `playwright/e2e/epic6.spec.ts` -- open a card → detail → "Wrong match?" → search degrades to the no-creds notice (write pinned in integration).

**Acceptance Criteria:**
- Given a tracked game with a wrong cover, when the user opens its detail panel and picks a new candidate via "Wrong match?", then its cover, release date, title, and genres reflect the new match and the old IGDB link is gone.
- Given a picked candidate whose IGDB id already belongs to another library game, when rematch runs, then no writes occur and the UI shows an "already in your library" message.
- Given a game the caller does not track, when a rematch is POSTed for it, then the server answers 404 and nothing changes.
- Given a franchise search returning >10 full games, when the picker lists candidates, then up to 50 are shown (the buried right game is reachable).

## Design Notes

Genre handling is REPLACE, not union: the previous match was wrong, so its IGDB genres are wrong too — `clearGameGenres` then relink from the pick. This also drops any manual genres the user added to that game; acceptable because rematch is a deliberate correction and re-addable, and unioning would leave the wrong match's genres behind (defeating the fix). ponytail: single-user, reversible.

Conflict check mirrors `anchorIgdb`'s guard but promotes the silent no-op to a surfaced `conflict` — on the detail panel the target game is fixed, so pointing it at an id another game owns is a real duplicate the user must see, not swallow.

`rematchGame`'s writes are sequential (not one D1 tx), same accepted ceiling as `resolveStraggler` — single-user, retryable.

## Verification

**Commands:**
- `bun run typecheck` -- expected: clean (both tsconfig programs).
- `bun run lint` -- expected: biome clean.
- `bun run test` -- expected: new `games.test.ts` rematch cases green; existing green.
- `bun run test:e2e -- epic6 -g rematch` -- expected: detail-panel rematch entry-point test green. Run on CI (Linux); the local Windows miniflare dev server was fixed (stale-cache clear) but CI is the authoritative e2e gate.

## Spec Change Log

- **2026-07-13 — adversarial code review (Blind Hunter / Edge Case Hunter / Acceptance Auditor):** Acceptance Auditor full pass. One robustness fix applied — the link swap now anchors the new IGDB id BEFORE pruning stale ones (`removeExternalLinksBySource(..., exceptExternalId)`), so a failed write mid-swap can never leave the game with no IGDB identity (the delete-before-add order could). Added an integration test for the genre-less rematch (documents the intended REPLACE wipe). **Known limitation (accepted):** rematch to an IGDB entry lacking a cover/date nulls the existing cover/date (REPLACE semantics) — for a correction feature, blanking a likely-wrong cover beats keeping it; recoverable by re-rematching.
- **2026-07-13 — IGDB `game_type` fix (bundled):** the PV-2 `where category = (...)` filter (baseline commit 77e579a) matched zero rows live — IGDB retired the `category` field for `game_type` (same enum values). Renamed in `igdb.ts`; without this every search returned empty. Verified live against the API.
