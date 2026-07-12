---
title: 'Story 6.5: Free-text shelf search'
type: 'feature'
created: '2026-07-12'
status: 'done'
baseline_revision: '92a3d9a'
final_revision: 'PENDING_COMMIT'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** The persistent search bar drives only Story 6.1's suggestion combobox (server `/api/shelf/search` → jump-to-detail / add) — the *visible shelf grid* never sees the input, so a tracked game can't be found by narrowing what's on screen; you must scroll.

**Approach:** Lift the live search term from `SearchBox` to `Shelf` via a window event (the same decoupled signalling `OPEN_DETAIL_EVENT`/`SEED_SEARCH_EVENT` already use) and filter the visible shelf with a pure normalized-substring predicate (case/diacritic-insensitive), applied on top of the existing `applyShelfFilter` pipeline. A no-shelf-match renders the existing `no-match` empty state, extended to still offer Story 6.1's `＋ Add "<name>"` path; clearing the input restores the full shelf.

## Boundaries & Constraints

**Always:** The shelf-grid filter is a NEW client predicate over the already-loaded `['shelf']` payload — distinct from the 6.1 combobox suggestions (server search), which stays as-is. Matching is normalized substring: fold case + diacritics (NFD, strip combining marks) + collapse whitespace, then `contains`. An empty term filters nothing (full visible shelf). Search narrows the *visible* (default-filtered) shelf only — hidden states (completed/dropped) remain reachable via the combobox, not surfaced by shelf search. Clearing the input restores the shelf.

**Block If:** none.

**Never:** Do not import the heavy `core/title-normalizer` (`normalizeTitle`) for the needle — it strips articles/edition-suffixes/numerals and is a match-KEY canonicalizer, wrong for substring (a lightweight web-local fold is correct). Do not re-sort the shelf (AD-7 order is server-owned). Do not add a new server endpoint or route the shelf filter through the network. Do not fold the search term into `ShelfFilter`/`FilterRow` (it is header-driven, separate from the filter chips).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Type a substring | visible shelf loaded, term "blood" | grid narrows live to titles containing "blood" (normalized) | n/a |
| Diacritic/case fold | term "pokemon" | matches "Pokémon", "POKÉMON" | n/a |
| No shelf match | term matches no visible game | `no-match` empty state incl. `＋ Add "<term>"` action | n/a |
| Clear input | term → "" | full visible shelf restores | n/a |
| Term + active filter | state/genre filter on, term typed | both apply (AND); empty state offers Add + Clear filters | n/a |
| Hidden-state game | term matches a completed game | not shown on shelf (hidden); combobox still finds it | n/a |

</intent-contract>

## Code Map

- `web/shelf/filters.ts` -- ADD pure `foldForSearch(s): string` (NFD → strip `̀-ͯ` → lowercase → collapse ws → trim) and `matchesTitleQuery(title, query): boolean` (empty query → `true`, else `foldForSearch(title).includes(foldForSearch(query))`)
- `web/shelf/filters.test.ts` -- unit cases for the two helpers (see hazard test)
- `web/shelf/SearchBox.tsx` -- EXPORT `SHELF_SEARCH_EVENT = 'shelf:search-term'`; `useEffect` dispatching `new CustomEvent(SHELF_SEARCH_EVENT, { detail: debounced })` on `debounced` change (reuses the existing trimmed/debounced value; popup/6.1 behavior untouched)
- `web/shelf/Shelf.tsx` -- `FilteredShelf`: listen for `SHELF_SEARCH_EVENT` → `searchTerm` state; `visible = applyShelfFilter(games, filter).filter((g) => matchesTitleQuery(g.title, searchTerm))`; empty-state branch when `visible.length===0`: if `searchTerm` non-empty → `EmptyState variant="no-match"` with an `＋ Add "<term>"` action (+ `Clear filters` when `isFilterActive(filter)`) that opens `AddGameDialog`; render `AddGameDialog` off an `addingTitle` state; announce result count on term change
- `web/shelf/AddGameDialog.tsx` -- reused as-is (self-contained given a `title`); no change
- `web/shelf/Shelf.test.tsx` -- component tests: live narrowing, clear restores, no-match offers Add (opens dialog)
- `playwright/e2e/epic6.spec.ts` + `playwright/COVERAGE.md` -- e2e per AC + COVERAGE rows for the three 6.5 ACs

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/filters.ts` -- add `foldForSearch` + `matchesTitleQuery` pure helpers -- normalized substring core
- [x] `web/shelf/SearchBox.tsx` -- export `SHELF_SEARCH_EVENT`, dispatch the debounced term on change -- lift term to the shelf
- [x] `web/shelf/Shelf.tsx` -- subscribe to the term, apply `matchesTitleQuery` after `applyShelfFilter`, search-aware empty state with the `＋ Add "<term>"` action + `AddGameDialog`, announce results -- live filter + empty state + clear-restore
- [x] `web/shelf/filters.test.ts` -- **hazard test**: `matchesTitleQuery` is case-insensitive, diacritic-insensitive ("pokemon"↔"Pokémon"), substring-in-middle, whitespace-folded, and empty-query matches all -- HAZARD-TEST rule (named normalized/diacritic invariant)
- [x] `web/shelf/Shelf.test.tsx` -- shelf narrows live on term; clearing restores the full visible set; no-match renders the Add action and opens `AddGameDialog` -- component behavior
- [x] `playwright/e2e/epic6.spec.ts` + `playwright/COVERAGE.md` -- e2e per AC below; COVERAGE rows for all three 6.5 ACs -- PLAYWRIGHT-COVERAGE rule
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- story 6-5 status per convention

**Acceptance Criteria:**
- Given the search bar and a tracked shelf, when I type free text, then the visible shelf filters live to games whose title substring-matches (normalized, case/diacritic-insensitive), distinct from the 6.1 add suggestions
- Given an active search matching no visible game, when results render, then the shelf shows an empty state and the `＋ Add "<name>"` row is still offered (routing to the 6.1 add flow)
- Given an active search, when I clear the input, then the full visible shelf restores

## Design Notes

- Window event, not lifted state: `SearchBox` and `Shelf` are siblings under `AppShell` that already communicate only through window events (`OPEN_DETAIL_EVENT`, `SEED_SEARCH_EVENT`). A `SHELF_SEARCH_EVENT` matches that seam and avoids threading a term prop through `AppShell`/`Header`. A fire-and-forget `CustomEvent` retains no last value, so a shelf mounting AFTER a dispatch (typed-during-load, or a remount after a refetch drop) would miss it — `SearchBox` mirrors the last broadcast term in a module-scope `lastBroadcastTerm` and `FilteredShelf` seeds `searchTerm` from `currentShelfSearchTerm()` on mount (same one-truth-across-instances pattern as `useTrackingMutations`' `IN_FLIGHT`).
- ponytail: web-local `foldForSearch` (lowercase + NFD diacritic strip + whitespace collapse, ~3 lines) instead of importing `core/normalizeTitle` — the canonicalizer strips articles/suffixes/numerals ("the" → "") which is wrong for a substring needle, and no web→core import exists today.
- `searchTerm` is FilteredShelf-local, applied AFTER `applyShelfFilter` — kept out of `ShelfFilter` so the filter chips, `isFilterActive`, and `Clear filters` semantics stay untouched; search and chips are independent AND-ed axes.
- The 6.1 combobox popup renders no "NO MATCH" text (options or the add row only); the sole "NO MATCH" is the shelf `EmptyState`. So the pre-existing `epic1-shelf.spec.ts` 1.7d ("… NO MATCH otherwise") — which types gibberish and asserts one "NO MATCH" — becomes reachable/green with this story (shelf-search-empty is what it was waiting on); verify it passes, no second "NO MATCH" is introduced.
- No external provider→write path (pure client filter over the loaded payload), so PROBE-BEFORE-YOU-MAP and DEGENERATE-RESPONSE rules don't bind. The add path reuses 6.1's `AddGameDialog` unchanged.

## Verification

**Commands:**
- `bun run typecheck` -- expected: clean
- `bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. `matchesTitleQuery` hazard cases + Shelf narrow/clear/no-match tests
- `bun run test:e2e` -- expected: epic6 spec green (live narrow, no-match+Add, clear restores); epic1-shelf 1.7d green; no regressions

## Review Triage Log

### 2026-07-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 3, low 2)
- defer: 2
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` Mount race: the shelf missed the term when the user typed during initial load (or on a refetch-driven remount) — a fire-and-forget `CustomEvent` retains no last value. Fixed: `SearchBox` mirrors the last term in module scope; `FilteredShelf` seeds from `currentShelfSearchTerm()` on mount. Added a SearchBox test pinning the mirror.
  - `[medium]` `[patch]` A11y: focus fell to `<body>` when the shelf's empty-state `AddGameDialog` closed (it doesn't auto-restore). Fixed: `onClose` returns focus to the search input (UX-DR19), mirroring `SearchBox`'s sibling call site.
  - `[medium]` `[patch]` A11y: the new shelf search-count announce duplicated (and conflicted with) the focused combobox's own result announce. Fixed: removed the shelf-side search announce (kept the chip-filter announce); the combobox owns search feedback.
  - `[low]` `[patch]` `CustomEvent` detail was cast, not validated — a non-string payload would throw in `foldForSearch`. Fixed: `typeof detail === 'string' ? detail : ''` guard.
  - `[low]` `[patch]` Fold doc claimed to "strip diacritics" but only folds combining marks — corrected the comment to name the precomposed-letter (ø/ł/ß) limitation.
  - Deferred: seed-search (Story 4.3 jump-to-problem) now narrows the visible shelf and can show a false NO MATCH+Add for an existing hidden game; duplicate `＋ Add "<term>"` affordance (combobox popup + shelf empty state) when both are visible. Both logged to `deferred-work.md`.
  - Rejected (noise/by-design): shelf search can't reach hidden-state games (explicit spec scope — combobox is the whole-library path; the 409-dup handler covers a mistaken Add); non-decomposing diacritics ø/ł (out of scope for a Latin-title library); unmemoized per-render fold (single-user, ~175 games); trim-boundary latent desync; un-collapsed-whitespace Add label (cosmetic); all-combining-mark degenerate title; seed-'' non-broadcast divergence; multiple-FilteredShelf (single shelf today).

## Auto Run Result

Status: done

**Change:** Typing in the header search bar now filters the visible shelf grid live by normalized (case/diacritic-insensitive) title substring — the term is lifted from `SearchBox` to `FilteredShelf` via a window event and a module-scope mirror, applied on top of `applyShelfFilter`. A no-shelf-match renders the `no-match` empty state with a `＋ Add "<term>"` action reusing 6.1's `AddGameDialog` (plus Clear filters when a chip filter is also active); clearing the input restores the full shelf. Also turns the previously-unreachable epic1 1.7d test green.

**Files changed:**
- `web/shelf/filters.ts` — pure `foldForSearch` + `matchesTitleQuery` (web-local fold, `̀-ͯ` combining-mark strip).
- `web/shelf/SearchBox.tsx` — `SHELF_SEARCH_EVENT`, broadcast effect, `lastBroadcastTerm`/`currentShelfSearchTerm()` mirror.
- `web/shelf/Shelf.tsx` — search-term subscribe (seeded on mount, typed-detail guard), `matchesTitleQuery` filter, search-miss empty state + `AddGameDialog` with focus-restore, no duplicate announce.
- Tests: `web/shelf/filters.test.ts` (hazard), `web/shelf/Shelf.test.tsx`, `web/shelf/SearchBox.test.tsx` (mirror), `playwright/e2e/epic6.spec.ts` (6.5a/b/c) + `playwright/COVERAGE.md`.

**Review:** 5 patches applied (3 medium: mount-race term-seed, focus-restore a11y, duplicate-announce a11y; 2 low), 2 deferred (seed-search shelf interaction, duplicate Add affordance), 8 rejected. See Review Triage Log.

**Verification:** `typecheck` clean · `lint` clean (216 files) · `test` 1324 passed (57 files) · `test:e2e` 24 passed incl. 6.5a/b/c and the now-green 1.7d (`epic6`+`epic1-shelf --workers=1`). Sole e2e failure is the pre-existing Windows `EPERM` on the 6.3 Export-CSV download-artifact read — unrelated to this diff.

**Residual risk:** the two deferred UX interactions above (both mitigated, low functional risk). No data or security surface — pure client filter.

**Follow-up review:** recommended — three medium a11y/correctness fixes landed across the SearchBox↔Shelf event wiring during review; an independent pass before the epic merge gate is prudent (FOLLOW-UP-REVIEW CONTRACT).
