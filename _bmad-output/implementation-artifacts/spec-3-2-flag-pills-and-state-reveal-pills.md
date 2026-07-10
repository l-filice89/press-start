---
title: 'Story 3.2: Flag pills and state-reveal pills'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: 'eac4b8650225369782f43ed97eb5c654a3cc457e'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Owned/wishlisted/released/playable subsets aren't filterable, and hidden states (Story completed / Platinum achieved / Dropped) are unreachable on the shelf — plus two deferred Epic 2 bugs (no UNDO when previous status was null; detail panel false-closes on milestone writes to already-hidden games) become daily paths once reveals exist.

**Approach:** Extend the filter row with four solid Flag pills (each its own AND group) and three dashed reveal pills (OR a hidden state into the visible set). `/api/shelf?include=hidden` returns the whole ordered library; the client filter derives the visible set. Fix the UNDO gate and the `onHidden` false-close in `useTrackingMutations`.

## Boundaries & Constraints

**Always:**
- Flags `Owned`/`Wishlisted`/`Released`/`Playable now`: each active pill is its own AND group (FR-20). Flag values come off the wire (`owned`, `wishlisted`, `released`, new `playableNow`) — never recomputed client-side (AD-7).
- `playableNow` added to the shelf payload from the existing `computeDerivedStates` result; both Zod mirrors (`src/routes/shelf.ts`, `web/shelf/api.ts`) updated in lockstep (AR-26).
- Reveal pills extend the state group: toggling one ORs that hidden state into whatever is visible (FR-4/20/21). Nothing selected + no reveals = default visible set (live statuses only).
- FR-18 amendment: every visible set (reveals included) orders state priority → owned → alpha. Hidden states get explicit ranks appended after `Not started` in `SHELF_STATE_ORDER`; `isDefaultShelfVisible` is decoupled from `SHELF_STATE_ORDER` membership (explicit live-state set) so extending the order cannot leak hidden states into the default shelf.
- `GET /api/shelf` without the param stays byte-identical in behavior (default visible set, ordered); `?include=hidden` returns the whole library ordered.
- Solid pill = narrows (AND), dashed pill = reveals (UX-DR9); active pills glow/highlight with machine-readable state (`aria-pressed`), never color alone (FR-22); ≥44×44 hit areas; announce via live region.
- UNDO on `Dropped` (or clear) restores the previous status **including `null`** through `changePlayStatus(id, null)` — the milestone-invariant write path; a 409 surfaces its existing toast (FR-2/FR-3).
- `onHidden` fires only on a visible→hidden transition (default-visibility terms): `!HIDDEN_STATES.includes(before) && HIDDEN_STATES.includes(after)` in BOTH status and milestone `onSuccess`.
- Search path untouched; filters never leak into it.

**Block If:**
- The invariant guard rejects a legal null-restore (server bug beyond this story's scope).
- Playwright foundation broken.

**Never:**
- No summary sentence, mobile sheet, or Clear-filters action (3.3); no focus hardening (3.4).
- No persistence of derived flags in the DB; no new dependencies; no URL state.
- Do not change `searchLibrary` or the seed importer.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reveal OR | reveals=[Dropped], states=[] | Live statuses + Dropped games visible, ordered per FR-18 | No error |
| Reveal + state | states=[Playing], reveals=[Platinum achieved] | Exactly Playing + Platinum achieved | No error |
| Flag AND | flags=[Owned, Playable now] | Games that are owned AND playable now | No error |
| Flag + state + genre | flags=[Wishlisted], states=[Not started], genres=[RPG] | All three groups AND together | No error |
| Empty filter | states/genres/reveals/flags all empty | Default visible set (live statuses only) from the include=hidden payload | No error |
| UNDO null restore | Milestone-only card (playStatus null) revealed → set Dropped → UNDO | `changePlayStatus(id, null)` succeeds; card returns to milestone-only state | 409 → existing "Can't clear" toast |
| Panel on hidden game | Detail open on Dropped game → log Story completed | Panel stays open (hidden before and after) | No error |
| Panel visible→hidden | Detail open on Playing game → log Platinum | Panel auto-closes (visibility changed) | No error |

</intent-contract>

## Code Map

- `src/core/shelf.ts` -- `SHELF_STATE_ORDER` (extend with hidden ranks), `isDefaultShelfVisible` (decouple to explicit live set), `orderShelf`/`compareShelf` (`shelfRank` fallback becomes unreachable), `src/core/shelf.test.ts`
- `src/services/shelf.ts` -- `getShelf(db, userId, includeHidden?)` branch; `bakeCard` gains `playableNow` from the already-computed `computeDerivedStates`
- `src/routes/shelf.ts` -- `?include=hidden` query param; `shelfGameSchema` + `playableNow`
- `web/shelf/api.ts` -- `fetchShelf` requests `?include=hidden`; schema mirror + `playableNow`
- `web/shelf/filters.ts` -- `ShelfFilter` gains `reveals: RevealState[]`, `flags: FlagKey[]`; `applyShelfFilter` derives allowed-state set (states or LIVE default, ∪ reveals) and ANDs each active flag; still order-preserving
- `web/shelf/FilterRow.tsx` + `filter-row.css` -- flag pills (solid toggles) + reveal pills (dashed) after the two dropdowns; `aria-pressed`, glow via existing `data-active` pattern
- `web/shelf/useTrackingMutations.ts` -- UNDO gate (`&& previous` drop) + `onHidden` transition check in both `onSuccess` handlers; `HIDDEN_STATES` is the client visibility mirror
- `web/shelf/Shelf.tsx` -- EMPTY_FILTER now yields the default set from the hidden-inclusive payload (filter always applies)
- `test/integration/shelf.test.ts` -- worker tests for `?include=hidden` + unchanged default
- `playwright/e2e/epic3-filter.spec.ts` / new `epic3-reveal.spec.ts` -- e2e; `playwright/COVERAGE.md` -- 3.2 rows
- `_bmad-output/implementation-artifacts/deferred-work.md:87-90,143-146` -- the two entries these ACs close (mark decision lines done)

## Tasks & Acceptance

**Execution:**
- [x] `src/core/shelf.ts` + `src/core/shelf.test.ts` -- extend `SHELF_STATE_ORDER` (append `Story completed`, `Platinum achieved`, `Dropped`), decouple `isDefaultShelfVisible`; hazard tests: default set unchanged, hidden states rank after live states
- [x] `src/services/shelf.ts` -- `includeHidden` branch in `getShelf`; `playableNow` in `bakeCard`
- [x] `src/routes/shelf.ts` + `test/integration/shelf.test.ts` -- query param + schema; tests: default response identical, `include=hidden` returns hidden games ordered
- [x] `web/shelf/api.ts` -- schema mirror + `fetchShelf('?include=hidden')`
- [x] `web/shelf/filters.ts` + `filters.test.ts` -- reveals/flags model + predicate per I/O matrix (incl. order preservation, empty-filter default-set hazard test)
- [x] `web/shelf/FilterRow.tsx` + `filter-row.css` + `FilterRow.test.tsx` -- flag + reveal pills, solid/dashed encoding, `aria-pressed`, glow
- [x] `web/shelf/useTrackingMutations.ts` + its tests -- UNDO null-restore + `onHidden` visible→hidden transition (both mutations); jsdom tests pinning both deferred bugs red→green
- [x] `playwright/e2e/epic3-reveal.spec.ts` -- e2e: reveal pill shows Dropped/milestone cards (dashed + glow asserted); flag pill ANDs; UNDO restores null status on revealed card; detail panel stays open on milestone write to hidden game
- [x] `playwright/COVERAGE.md` + `deferred-work.md` -- 3.2 AC rows; mark the two closed entries' decision lines

**Acceptance Criteria:**
- Given the Flags group, when the filter row renders, then `Owned`/`Wishlisted`/`Released`/`Playable now` are individual pills, each its own AND group (FR-20).
- Given a reveal pill (`Story completed`/`Platinum achieved`/`Dropped`), when I toggle it, then that state ORs into the visible set (FR-4/20/21).
- Given pill shape, when the row renders, then solid pills narrow and dashed pills reveal (UX-DR9).
- Given an active pill, when toggled on, then it glows/highlights with accessible pressed state (FR-22).
- Given a revealed card whose play status was auto-cleared (null), when I set it to `Dropped` and UNDO, then the null status is restored through the milestone-invariant write path (FR-2/FR-3).
- Given a detail panel open on an already-hidden game, when a milestone write completes without changing visibility, then the panel stays open; auto-close fires only on visible→hidden (FR-4/FR-17).
- Given reveals/flags active, when the shelf renders, then FR-18 ordering holds (state priority incl. revealed ranks → owned → alpha).

## Spec Change Log

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 3, low 3)
- defer: 1: (high 0, medium 1, low 0)
- reject: 7: (high 0, medium 0, low 7)
- addressed_findings:
  - `[medium]` `[patch]` all-hidden library with no active filter showed the "NO MATCH" filter empty-state — now shows INSERT GAMES (pre-3.2 behavior restored; jsdom test added)
  - `[medium]` `[patch]` live-region count announced the whole hidden-inclusive library as denominator — now announces the default visible count
  - `[medium]` `[patch]` reveal pills gained accessible names `Show <state> games` — reveal semantics machine-readable (was shape-only) and no longer name-collide with the milestone action buttons
  - `[low]` `[patch]` `HIDDEN_STATES` deduplicated — now aliases `REVEAL_STATES` from filters.ts (one client-side hidden-state list)
  - `[low]` `[patch]` flag tests strengthened: `released` covered; `playableNow` AND assertion now actually narrows (owned-but-unreleased fixture)
  - `[low]` `[patch]` `loadAllPages` extracted to `playwright/support/helpers/shelf.ts` (was triplicated) and hardened to wait for the shelf query before trusting a missing sentinel; AC-6 e2e aligned to the suite's reopen-based post-write assert convention (direct stays-open assert lands with 3.4)

## Design Notes

- Hidden-rank order after `Not started`: `Story completed` → `Platinum achieved` → `Dropped` (milestones grouped before dropped; epic context lists reveals in this order).
- The client's default-visibility mirror stays `HIDDEN_STATES` in `useTrackingMutations` / `LIVE_STATUSES` in `filters.ts` — the AR-26 boundary forbids importing `isDefaultShelfVisible`.
- With a reveal active, a card set to `Dropped` stays visible (refetch keeps it in the payload; the filter decides) — "leaves the shelf" is now filter-driven, which is the FR-21 semantics.

## Verification

**Commands:**
- `bun run lint && bun run typecheck` -- expected: clean
- `bun run test` -- expected: all Vitest projects green incl. new core/worker/web tests
- `bun run test:e2e` -- expected: Playwright green incl. epic3-reveal.spec.ts

## Auto Run Result

**Summary:** Story 3.2 implemented — four solid flag pills (Owned/Wishlisted/Released/Playable now, each its own AND group) and three dashed reveal pills that OR hidden states into the visible set. `/api/shelf?include=hidden` returns the whole ordered library (hidden ranks appended to `SHELF_STATE_ORDER`, visibility decoupled); `playableNow` added to the wire from the existing core computation. Two deferred Epic 2 bugs fixed: UNDO now restores a null (auto-cleared) status through `changePlayStatus(id, null)`, and `onHidden` fires only on a visible→hidden transition.

**Files changed:**
- `src/core/shelf.ts` + tests — hidden states ranked after live; `isDefaultShelfVisible` decoupled (hazard tests)
- `src/services/shelf.ts` — `getShelf(..., includeHidden)`; `playableNow` in `bakeCard`
- `src/routes/shelf.ts` + `test/integration/shelf.test.ts` — `?include=hidden` param, schema, worker tests
- `web/shelf/api.ts` — schema mirror + hidden-inclusive fetch
- `web/shelf/filters.ts` + tests — `reveals`/`flags` model; empty filter = default visible set
- `web/shelf/FilterRow.tsx` + `filter-row.css` + tests — flag/reveal pills, solid/dashed encoding, `Show <state> games` names
- `web/shelf/useTrackingMutations.ts` — UNDO null-restore; `becameHidden` transition check (jsdom-pinned in StatusPopover/DetailPanel tests)
- `web/shelf/Shelf.tsx` + tests — default-count announcements; all-hidden library → INSERT GAMES
- `playwright/e2e/epic3-reveal.spec.ts` (new), `epic1-shelf.spec.ts` (route-stub URL predicates), `playwright/support/helpers/shelf.ts` (shared loadAllPages), `playwright/COVERAGE.md`, `deferred-work.md`

**Review findings:** 6 patches applied (3 medium, 3 low), 1 deferred (search-payload staleness seam), 7 rejected (deliberate single-payload design, param validation noise, suite-convention items).

**Verification:** lint + typecheck clean; Vitest 530/530; Playwright 40/40 (one recurrence of the pre-existing ledgered epic2 parallel flake, green on re-run).

**Residual risks:** post-write panel-visibility e2e asserts remain reopen-based until Story 3.4 hoists panel state; search-payload staleness deferred.
