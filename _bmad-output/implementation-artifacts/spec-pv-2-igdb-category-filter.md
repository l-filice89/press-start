---
title: 'PV-2: Filter IGDB search to actual games (drop DLC/bundle/season noise)'
type: 'bugfix'
created: '2026-07-13'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '824407a'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The IGDB games query (`igdb.ts` `fetchGames`) has no `category` filter, so DLC, bundles, seasons, packs, updates, mods, and episodes rank into search results — burying real games (Persona 3 Reload lost under many "Persona" entries) and polluting the add-by-name candidate list.

**Approach:** Add a server-side `where category = (0,4,8,9,10,11)` clause to the shared IGDB query so only full games (main_game, standalone_expansion, remake, remaster, expanded_game, port) are returned. Single insertion point in `fetchGames`; all three callers (`enrich`, `searchCandidate`, `searchCandidates`) inherit it. Does NOT fix wrong same-name matches (PV-1/PV-4 — tie-ins are legit main games).

## Boundaries & Constraints

**Always:** Keep the filter as a single `where` clause in the shared query string. Category whitelist is exactly `(0,4,8,9,10,11)` = main_game(0), standalone_expansion(4), remake(8), remaster(9), expanded_game(10), port(11). Preserve existing `search`, `fields`, `limit 50`, the 401-retry, and the DEGENERATE-RESPONSE guard untouched.

**Ask First:** Changing the whitelist membership (adding/removing a category).

**Never:** Do not add client-side post-filtering (waste — IGDB filters server-side). Do not request `category` in `fields` (not needed for a `where` filter). Do not touch `pickIgdbMatch`, the candidate-cap logic (PV-3), or any relevance tie-break (PV-1).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Query built | any non-empty sanitized title | Request body contains `where category = (0,4,8,9,10,11);` alongside existing `search`/`fields`/`limit` | N/A |
| Existing behavior preserved | 200 game array | enrich/searchCandidate/searchCandidates map results exactly as before | unchanged (401 retry, non-array guard, timeout still apply) |

</frozen-after-approval>

## Code Map

- `src/providers/igdb.ts` -- `fetchGames` (~line 185) builds the query `body`; the single edit point. Shared by `searchGames` → `enrich` / `searchCandidate` / `searchCandidates`.
- `src/providers/igdb.test.ts` -- wire-level adapter tests over mocked fetch; add a body-assertion test here.

## Tasks & Acceptance

**Execution:**
- [x] `src/providers/igdb.ts` -- in `fetchGames`, append `where category = (0,4,8,9,10,11);` to the query `body` string (after `fields ...;`, before or after `limit 50;` — IGDB clause order is free). Keep the existing explanatory comment; add a one-line note on the whitelist.
- [x] `src/providers/igdb.test.ts` -- add a test capturing the IGDB request `init.body` and asserting it contains `where category = (0,4,8,9,10,11)`. Existing tests must still pass unchanged.

**Acceptance Criteria:**
- Given any add-by-name or enrich call, when the IGDB games request is issued, then its body includes `where category = (0,4,8,9,10,11);`.
- Given the existing test suite, when it runs after the change, then all prior `enrich`/`searchCandidate` assertions still pass (behavior on returned arrays is unchanged).

## Verification

**Commands:**
- `bun run test src/providers/igdb.test.ts` -- expected: all pass incl. new body-assertion test
- `bun run lint` (Biome) -- expected: clean

## Suggested Review Order

- The fix: one `where` clause added to the shared IGDB query `body`; all three callers inherit it.
  [`igdb.ts:190`](../../src/providers/igdb.ts#L190)

- Why the whitelist is what it is — the category→type mapping rationale.
  [`igdb.ts:186`](../../src/providers/igdb.ts#L186)

- The runnable check: asserts the request body carries the clause.
  [`igdb.test.ts:141`](../../src/providers/igdb.test.ts#L141)

## Amendment 2026-07-13 (post-ship)

Two corrections to the shipped filter, both live-verified:

1. **`category` → `game_type`.** IGDB retired `category`; filtering on it matched zero rows and emptied every search. The clause is `where game_type = (...)` (same enum values).
2. **Whitelist widened to `(0,2,4,6,8,9,10,11)`** — expansion(2) and episode(6) readmitted alongside main_game(0), standalone_expansion(4), remake(8), remaster(9), expanded_game(10), port(11). The original whitelist dropped titles people genuinely own and track (Witcher 3: Blood and Wine; Life is Strange episodes). Season(7), bundle(3), DLC(1), pack/update/mod stay excluded — that noise is what the filter is for. Closes the deferred-work whitelist watch.

Read every reference to `category = (0,4,8,9,10,11)` above as `game_type = (0,2,4,6,8,9,10,11)`.
