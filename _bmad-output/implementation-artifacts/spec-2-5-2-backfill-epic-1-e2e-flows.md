---
title: 'Backfill Epic 1 e2e flows (story 2.5.2)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: '2720ff310e7873330036621d8cd2ba582b746597'
final_revision: 'cf24957baf74d8aecedbe13157769dc2bb17799e'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** Epic 1's UI behaviors (shelf render, visible-set + ordering, infinite scroll, whole-library search, skeleton/empty states, keyboard grid traversal, focus outline, responsive deltas, hit areas) are pinned only by jsdom tests, which cannot exercise real layout — the exact blind-spot class the Epic 2 retro named.

**Approach:** One Playwright test per Epic 1 AC with a UI user flow, riding the 2.5.1 auth/fixture foundation; ACs without a UI flow (or unreachable until later epics) get listed with a one-line reason in a coverage note. At least one phone + desktop viewport pair exercises responsive deltas and hit areas.

## Boundaries & Constraints

**Always:** Tests must not mutate or delete `BASELINE_GAMES`; anything else a test seeds it deletes in `finally`. Selectors role/accessible-name first, `getByTestId` where names don't reach, never CSS classes as selectors. Real stack — the only permitted network interception is for states unreachable with the shared fixture (empty library) or timing races (skeleton), each justified in a comment. Suite stays green under `fullyParallel` and burn-in (`--workers 1`, `--repeat-each 5`). Every AC row in the coverage note maps to a spec/test name or a skip reason — none silently dropped.

**Block If:** An Epic 1 UI AC turns out untestable even with interception and cannot honestly be listed as skipped (contradiction between AC and coverage-note rule).

**Never:** No new dependencies, no visual-snapshot testing, no re-testing pure-domain/schema/CI ACs through the browser, no Epic 2 dialog flows (that's 2.5.3), no reordering/re-filtering logic client-side to make assertions easier.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default shelf | Baseline (3 live games) + seeded Paused/wishlisted/Completed/Dropped extras | Only live-status games visible; order Playing → Paused → Up next → Not started, owned before wishlisted, alpha within | — |
| Infinite scroll | ≥49 default-visible games | First page ≤48 cards; sentinel scroll reveals more | — |
| Whole-library search | Query matching a Completed (hidden) game | Result listed in combobox listbox — search ignores hidden states | — |
| Search no match | Gibberish query | `NO MATCH` shown after settle | — |
| Empty library | `/api/shelf` intercepted to `[]` (fixture is never empty) | `INSERT GAMES` headline + subtext, no dead CTA buttons | — |
| Skeleton | `/api/shelf` response delayed via interception | `skeleton-grid` visible while pending, replaced by cards | — |
| Keyboard traversal | Focus card, arrows | Right/Left ±1 in reading order; Down/Up by real (multi-column) count; roving tabindex | — |
| Phone vs desktop | 375×667 vs default desktop viewport | Genres hidden on phone, visible on desktop; owned-toggle hit area ≥44×44 in both | — |

</intent-contract>

## Code Map

- `playwright/e2e/auth-journey.spec.ts` -- already covers 1.3a (login gate: no shelf when signed out) and 1.3b (link → session → shelf); coverage note references it, no duplication
- `playwright/e2e/smoke.spec.ts` -- covers shell wordmark render (1.5b) and seeded-card visibility
- `playwright/support/helpers/d1.ts` -- seedGame/deleteGame/BASELINE_GAMES; add batched `seedGames()` (49 sequential shell-outs would cost ~90s)
- `playwright/support/factories/game-factory.ts` -- createGame/createWishlistedGame overrides for status/owned tiers
- `playwright/support/merged-fixtures.ts` -- `interceptNetworkCall` for empty/skeleton states; networkErrorMonitor auto-fails 4xx/5xx
- `web/shelf/Shelf.tsx` -- grid `data-testid="shelf-grid"` role=grid, cards `shelf-card` role=gridcell, sentinel `.shelf__sentinel`, PAGE_SIZE=48, arrow-key handler
- `web/shelf/SearchBox.tsx` -- combobox `aria-label="Search your library"`, listbox options, `NO MATCH`
- `web/components/Skeleton.tsx` / `web/components/EmptyState.tsx` -- `skeleton-grid`, `empty-state` testids, `INSERT GAMES`
- `web/shelf/Card.tsx` -- title, `.card__genres` (hidden <600px), `card-owned-toggle` with tap-target, aria-labels
- `src/core/shelf.ts` -- ordering source of truth: SHELF_STATE_ORDER, owned-tier, locale alpha
- `playwright/COVERAGE.md` -- NEW: Epic 1 AC → test/skip map (2.5.3 will extend it)

## Tasks & Acceptance

**Execution:**
- [x] `playwright/support/helpers/d1.ts` -- add `seedGames(games: SeedGame[])` batching all INSERTs into one `wrangler d1 execute` call, and use it from `seedBaseline()` -- infinite-scroll test needs ~50 rows without ~90s of shell-outs (also: d1Execute switched from `--command` to `--file` — 49-row batches overflow the Windows ~8K command line; added `deleteGames` batch delete)
- [x] `playwright/e2e/epic1-shelf.spec.ts` -- NEW: tests for shelf render/card content (cover-or-fallback, title, state pill, OWNED chip), default visible set + full ordering tiers (seed Paused + wishlisted + Completed + Dropped extras, delete in finally), infinite scroll (seed 49+, assert card count grows after sentinel scroll), whole-library search incl. hidden-game match and NO MATCH, empty library via `/api/shelf` intercept, skeleton via delayed intercept, keyboard grid traversal (Right/Left/Down with real columns, roving tabindex), focus outline (computed outline-style ≠ none on focused card)
- [x] `playwright/e2e/epic1-responsive.spec.ts` -- NEW: phone (375×667) + desktop viewport pair: genres hidden vs visible on card, owned-toggle hit area ≥44×44 in both viewports (asserted functionally via elementFromPoint probes — the tap-expander ::before is invisible to boundingBox), phone grid resolves 2 columns -- pins the retro's breakpoint/hit-area blind spots. **Found+fixed a real 1.5g violation:** `.card__cover` overflow clipping shrank the toggle's effective hit area to ~41px; `web/shelf/card.css` toggle offset moved 8px→11px so the 44px overlay fits unclipped
- [x] `playwright/COVERAGE.md` -- NEW: table of every Epic 1 AC (stories 1.1–1.7) → covering spec/test name, or `skipped` + one-line reason (no-UI-flow / unreachable-until-later-epic) -- AC2's coverage-note contract
- [x] `playwright/README.md` -- link COVERAGE.md from the Practices section -- discoverability

**Acceptance Criteria:**
- Given the Epic 1 AC list, when the backfill lands, then every UI-flow AC has a named Playwright test (login gate, shelf render/card content, default visible set + ordering, infinite scroll, whole-library search, skeleton + empty states, keyboard grid traversal, focus outline) — directly or by reference to an existing 2.5.1 spec
- Given ACs with no UI flow or unreachable today, when COVERAGE.md is read, then each appears with a one-line skip reason
- Given the phone + desktop viewport pair, when the responsive spec runs, then genre visibility deltas and ≥44×44 hit areas are asserted in a real layout engine
- Given the full suite (`bun run test:e2e`), when it runs twice consecutively, then all specs pass both times (fixture discipline holds)
- Given burn-in (`--repeat-each 5 --retries 0 --workers 1`) on the new specs, when it runs, then 100% pass

## Spec Change Log

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 18: (high 2, medium 9, low 7)
- defer: 1: (low 1)
- reject: 5
- addressed_findings:
  - `[high]` `[patch]` ArrowDown assertion (`> 1`) couldn't distinguish row-jump from ArrowRight — now asserts `focusedIndex === 1 + measured column count`
  - `[high]` `[patch]` SQLITE_BUSY under parallel workers unretried (reproduced live in d1Query during verification) — shared `runWrangler` with backoff retry + stderr surfacing for d1Execute and d1Query
  - `[medium]` `[patch]` alpha-within-tier ordering unpinned — two owned Not-started games seeded in reverse alpha order added to the expected sequence
  - `[medium]` `[patch]` loadAllPages: 2s growth window + swallow-all catch — now terminates on sentinel removal (hasMore-gated), 10s poll, no blanket catch
  - `[medium]` `[patch]` focus-outline test relied on programmatic focus matching `:focus-visible` — asserts after a keyboard arrow press (guaranteed modality); renamed + COVERAGE caveat
  - `[medium]` `[patch]` seedGameWithGenre: raw string interpolation bypassing sq(), seeds outside try, genre cleanup skipped if deleteGames threw — inlined with sq(), seeded inside try, nested finally
  - `[medium]` `[patch]` COVERAGE 1.7f claim false (monitor doesn't catch successful third-party fetches) — reworded to honest "unverified"
  - `[medium]` `[patch]` 1.7a assertions under-delivered (no positive fallback assert, no flags) — fallback mark + PS+ Extra flag on an unowned seeded game now asserted; release/milestone flags noted as jsdom-pinned
  - `[medium]` `[patch]` search absence check could pass vacuously while shelf still loading — first-card-visible guard added
  - `[medium]` `[patch]` seeds moved inside try blocks in all specs (partial-batch residue under burn-in)
  - `[medium]` `[patch]` hit-area probes at ±21 proved only 43px — probes at ±21.9
  - `[low]` `[patch]` infinite-scroll initial count raced page-1 render — settles on exactly PAGE_SIZE (48) before scrolling; test renamed to match what it proves
  - `[low]` `[patch]` RegExp built from title — replaced with locator filter hasText
  - `[low]` `[patch]` card.css magic 11px — `calc((var(--hit-target) - 22px) / 2)`
  - `[low]` `[patch]` empty-state dead-CTA check misses links — link count asserted too
  - `[low]` `[patch]` misleading "login-free shell" test name — renamed
  - `[low]` `[patch]` COVERAGE 1.5b/1.5c/1.7c/1.7d rows overclaimed — reworded (tagline, PWA scope, one-growth-event, search-select known deviation)
  - `[low]` `[patch]` residue hazard test's d1Query now retries (same runWrangler path)
- deferred:
  - `[low]` owned-toggle 44px overlay diagonally clipped by cover border-radius at the extreme corner — ponytail ceiling comment in card.css + deferred-work.md entry
- rejected: temp-dir residue on SIGKILL, `user LIMIT 1` multi-row concern, wrangler --file atomicity, PWA manifest checks (scope), point-in-time absence style elsewhere

## Design Notes

Ordering assertion trick: `BASELINE_GAMES` already pin Playing → Up next → Not started (Alpha/Beta/Gamma). Seed one Paused (owned), one wishlisted Not-started, one Completed, one Dropped with distinctive titles; assert relative DOM index: Alpha < seeded-Paused < Beta < Gamma < wishlisted; Completed/Dropped absent. Locale-alpha within a tier is covered by baseline names if seeded titles are chosen to interleave predictably.

Interception justification (the two permitted stubs): the shared per-run fixture means the library is never empty and loads too fast to observe the skeleton; both states are pure client renders of a response shape the Vitest tier already pins, so stubbing `/api/shelf` for exactly those two tests keeps the real-layout value without destroying shared state. Hazard-note (Epic 1 retro rule): the ordering AC and search-ignores-hidden AC name explicit invariants — their tests seed adversarial rows (hidden games, wishlisted tier) rather than asserting on the happy fixture alone.

Infinite-scroll cleanup: 49 seeded games must be deleted in `finally` via one batched DELETE (`DELETE FROM game WHERE id LIKE 'scroll-%'`) to keep runs deterministic.

## Verification

**Commands:**
- `bun run test:e2e` -- expected: green, run twice back-to-back
- `bunx playwright test playwright/e2e/epic1-shelf.spec.ts playwright/e2e/epic1-responsive.spec.ts --repeat-each 5 --retries 0 --workers 1` -- expected: 100% pass (burn-in proof)
- `bun run lint && bun run typecheck && bun run test` -- expected: clean

## Auto Run Result

**Summary:** Backfilled Epic 1 e2e coverage: 11 new Playwright tests across two specs pin the shelf's real-layout behavior (card content + PS+ flag, full ordering tiers incl. alpha-within-tier, infinite scroll at PAGE_SIZE, whole-library search over hidden games, empty/skeleton states via justified interception, keyboard grid traversal with true column counts, keyboard focus outline, genre responsive delta, functional 44px hit-area probes, phone 2-up grid). `COVERAGE.md` maps every Epic 1 AC to its test or an honest skip reason. **Two real product/infra bugs found and fixed:** (1) the owned-toggle's effective hit area was ~41px — clipped by the cover's `overflow: hidden` (violating 1.5g); offset now token-derived so the 44px overlay fits; (2) SQLITE_BUSY under parallel workers crashed seeding/queries — wrangler calls now retry with backoff.

**Files changed:**
- `playwright/e2e/epic1-shelf.spec.ts` — NEW: 8 shelf-behavior tests
- `playwright/e2e/epic1-responsive.spec.ts` — NEW: 3 viewport-pair tests
- `playwright/COVERAGE.md` — NEW: Epic 1 AC → test/skip map
- `playwright/support/helpers/d1.ts` — `--file` execution (Windows 8K cmdline), `runWrangler` retry, `seedGames`/`deleteGames` batching, `sq` exported
- `web/shelf/card.css` — owned-toggle offset 8px → `calc((var(--hit-target) - 22px)/2)` (hit-area fix); ponytail ceiling comment re corner clip
- `playwright/README.md` — coverage-note pointer

**Review findings:** 18 patched (2 high, 9 medium, 7 low), 1 deferred (corner-diagonal clip), 5 rejected. No intent gaps, no spec loopbacks.

**Verification:** three consecutive full `bun run test:e2e` runs 16/16; burn-in `--repeat-each 5 --retries 0 --workers 1` 55/55; Vitest 494/494; Biome + tsc clean.

**Residual risks:** parallel-worker SQLite contention is retried, not eliminated — if CI shows residual flakes, serialize seeding or move to a dev-only seed endpoint (ponytail note in d1.ts). Corner-diagonal hit-area clip deferred with upgrade path.
