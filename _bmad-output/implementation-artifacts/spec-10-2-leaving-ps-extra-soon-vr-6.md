---
title: 'Story 10.2: "Leaving PS+ Extra soon" (VR-6)'
type: 'feature'
created: '2026-07-16'
status: 'done'
review_loop_iteration: 0
baseline_revision: '60af56bf86fcab40671ca414404e983a802ee101'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** A backlog game can silently vanish from the PS+ Extra catalog — the pill disappears and Playable-now drops, but nothing TELLS Luca a game he meant to play is gone.

**Approach:** Stamp a `ps_plus_left_on` date on the game the moment the existing flag pass clears its PS+ flag (that clear IS the observable departure), null it when the game re-enters, and render an amber "LEFT PS+" warning pill on tracked, non-owned games. Ships as *"left the catalog"* — Sony publishes no departure dates (probed: the store payload carries no end-date field), so a predictive "leaving soon" would be a guess and is out (per epic AC, this is the correct outcome).

## EXTERNAL-RISK-FLAG (mandatory, Epic 11 rule)

Anonymous surface, no account identity: this story only consumes the existing anonymous PS+ catalog snapshot (Epic 7) — no new external call, no credential, nothing on the wire that isn't already there. No new risk.

## Boundaries & Constraints

**Always:**
- The warning derives ONLY from the game-level flag transition (`toClear` in the flag pass) — never from `first_seen_at`, never from a hand-rolled game↔catalog join at read time.
- **DW-13 decision (carried AC):** `first_seen_at` keeps its "first seen since the last prune" meaning — nothing reads it today and the warning doesn't either; a pruned-then-readded game re-enters via `toFlag`, which NULLs `ps_plus_left_on`, so a returning game can never read as a new departure. Document this at the column and close DW-13.
- The "previous snapshot retained to diff" AC is satisfied by the `game.ps_plus_extra` flags themselves: present-before = flag set, absent-now = title missing from the freshly pruned table. No second snapshot generation is kept.
- The empty-catalog/short-walk wipe guard aborts BEFORE the flag pass — a degenerate response can never mass-stamp departures (existing guard; assert it covers the new column).
- Stamp/clear rides the same flag pass (includeDiscarded per DW-12); the fact is a shared `game` fact — owned and discarded games get the fact, the UI gates display on `!owned` (FR-38) exactly like the PS+ pill.
- Warning pill visually distinct from the steady-state PS+ pill (amber warn family, like SOON/TBA — not the accent glow).

**Block If:**
- The ingest turns out to expose a genuine departure-date field (would enable real "leaving soon" — a scope decision for Luca).

**Never:** predictive "leaving soon" heuristics; extra retained snapshot generations; touching per-user tracking; new cron or new external calls; renaming `first_seen_at` (nothing reads it; the doc comment is the fix).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Departure | flagged tracked game; next refresh's catalog lacks its title | Flag cleared AND `ps_plus_left_on` stamped (user-zone today); card shows LEFT PS+ | none |
| Return (DW-13 hazard) | departed game; a later refresh has its title again | Flag set, `ps_plus_left_on` NULLed — warning gone, no "new arrival" misread | none |
| Owned game departs | flagged owned game leaves catalog | Fact stamped, NO warning rendered (FR-38 gate) | none |
| Buying a departed game | LEFT-PS+ game gets owned | Warning disappears (display gate); fact remains until re-entry | none |
| Degenerate refresh | empty/short catalog response | Wipe guard aborts before flag pass — no clears, no stamps | existing banner path |
| Never-in-catalog game | plain wishlist game, refresh runs | Untouched — `toClear` only contains previously-flagged games | none |

</intent-contract>

## Code Map

- `src/services/psplus.ts:239-266` -- flag pass: `toClear` = departures (stamp), `toFlag` = entries (clear stamp)
- `src/repositories/games.ts` -- new `setPsPlusDeparted(db, ids, dateOrNull)` beside `setPsPlusExtraFlags` (:198, chunked batch pattern); column in `LibraryRow` + select
- `src/schema/catalog.ts` game table -- `ps_plus_left_on` nullable text date; `migrations/0013_*.sql`
- `src/repositories/psplus-catalog.ts:49-53` -- fix the `first_seen_at` doc comment (DW-13: "since the last prune", returning games re-stamp)
- `src/services/shelf.ts` + `src/routes/shelf.ts` + `web/shelf/api.ts` -- `psPlusLeftOn` through the DTO chain (zod default null for deploy skew)
- `web/shelf/Card.tsx:156-181` + `card.css` -- `card__flag--ps-left` amber pill, gated `psPlusLeftOn && !owned`
- `src/services/settings.ts` `todayForUser` -- the stamp's date source
- `test/integration/psplus.test.ts` conventions + `test/fixtures/psn/index.ts` `catalogPagePayload` -- two-run diff test
- `playwright/e2e/epic10-scores.spec.ts` sibling -- new `epic10-left-psplus` cases; `playwright/COVERAGE.md`; seed factory field
- `_bmad-output/implementation-artifacts/deferred-work.md` DW-13 -- close with resolution on story completion

## Tasks & Acceptance

**Execution:**
- [x] `migrations/0013_game_ps_plus_left_on.sql` + `src/schema/catalog.ts` -- nullable `ps_plus_left_on` text date on `game` (drizzle-kit generate)
- [x] `src/repositories/games.ts` -- `setPsPlusDeparted` chunked batch writer (date to stamp, null to clear); `psPlusLeftOn` in `LibraryRow` + library select
- [x] `src/services/psplus.ts` -- in the flag pass: stamp `toClear` ids with `todayForUser`, null `toFlag` ids; keep order after the wipe guard/lock fence
- [x] `src/repositories/psplus-catalog.ts` -- correct the `first_seen_at` comment (DW-13 semantics decision recorded)
- [x] DTO chain (`shelf.ts`, `routes/shelf.ts` schema, `web/shelf/api.ts` + defaults) -- `psPlusLeftOn`
- [x] `web/shelf/Card.tsx` + `card.css` -- amber `LEFT PS+` flag with sr-only text, `!owned` gate, distinct from `--ps-extra`
- [x] tests -- integration two-run diff (departure stamps + flag clears), return-run (DW-13 hazard: stamp NULLed, not new-arrival), owned-departure (fact yes/warning no is a UI test), degenerate-response leaves stamps untouched; jsdom Card gating (left+unowned shows, owned hides, null hides); Playwright: seeded departed game shows the warning, owned doesn't; COVERAGE.md rows for every AC
- [x] `deferred-work.md` -- close DW-13 with the recorded decision

**Acceptance Criteria:**
- Given a flagged, tracked, non-owned game, when a refresh finds its title absent, then its flag clears AND `ps_plus_left_on` is stamped, and the shelf card shows a LEFT PS+ warning visually distinct from the PS+ pill.
- Given a departed game, when a later refresh finds its title again, then the warning clears and the game is not misread as a new arrival (DW-13).
- Given an owned game, when the catalog changes either way, then no warning ever renders.
- Given the wipe guard fires (empty/short response), when the refresh aborts, then no departure is stamped and existing stamps survive.
- Given Sony publishes no departure date, when this ships, then the warning reads as "left", not a predictive "leaving soon".

## Spec Change Log

## Review Triage Log

### 2026-07-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 1, low 8)
- defer: 1: (high 0, medium 0, low 1)
- reject: 5
- addressed_findings:
  - `[medium]` `[patch]` Departure stamp was a SEPARATE db.batch after the flag write — a mid-run failure either lost a departure forever (clear applied, stamp lost) or stranded a stale stamp rendering two contradictory pills. Folded `ps_plus_left_on` into `setPsPlusExtraFlags` itself (one atomic statement per chunk; `setPsPlusDeparted` deleted; two subrequests saved) — both hunters converged on this fix
  - `[low]` `[patch]` Card rendered the warning without checking `psPlusExtra` — added the `!psPlusExtra` belt so membership wins over any skewed row; pinned by a new contradictory-row jsdom test
  - `[low]` `[patch]` sr-only copy claimed "left ON {date}" but the date is the DETECTION date — copy now says "as of"
  - `[low]` `[patch]` Amber border hardcoded the token's rgba — `color-mix` off `--color-warn-amber`
  - `[low]` `[patch]` Subrequest ledgers reverted to 29/34/36 (the fold removed the two extra batches); scores.ts twin kept in agreement
  - `[low]` `[patch]` No idempotency pin — third-run test asserts the original stamp date survives a repeat departure run
  - `[low]` `[patch]` Stamp date asserted as exactly the run's user-zone `todayForUser`, not any ISO string
  - `[low]` `[patch]` Boomerang test now VERIFIES the DW-13 premise (returning title's `first_seen_at` restamped) instead of narrating it
  - `[low]` `[patch]` COVERAGE 10.2c reworded honestly ("not test-pinned") and 10.2b cites the real exclusivity pin

## Verification

**Commands:**
- `bun run typecheck && bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. new two-run diff + DW-13 return hazard tests
- `bunx playwright test` -- expected: green incl. new warning-pill spec

## Auto Run Result

**Summary:** "LEFT PS+" departure warning: `ps_plus_left_on` (migration 0013) rides atomically inside the existing flag-pass write — a clear stamps the run's user-zone date, a set NULLs it (DW-13: a pruned-then-readded title can never misread as a new departure; ledger entry closed with the recorded semantics decision). Amber warning pill on the card, gated `!owned && !psPlusExtra`, visually distinct from the steady-state PS+ pill. Ships as observable "left", not predictive "leaving soon" (Sony publishes no departure dates). Zero new external surface (EXTERNAL-RISK-FLAG: anonymous snapshot only).

**Files changed (key):** `migrations/0013_game_ps_plus_left_on.sql` + schema; `src/repositories/games.ts` (`setPsPlusExtraFlags` now carries the stamp atomically); `src/services/psplus.ts` (flag pass + ledger); `src/repositories/psplus-catalog.ts` (DW-13 doc); DTO chain (`shelf.ts`, route schema, `web/shelf/api.ts`); `web/shelf/Card.tsx` + `card.css`; new `test/integration/psplus-departure.test.ts` (two-run diff, DW-13 return, idempotency, wipe-guard, owned-fact), Card jsdom pins incl. contradictory-row belt, `playwright/e2e/epic10-left-psplus.spec.ts`, COVERAGE.md rows; deferred-work.md (DW-13 closed, staleness deferral added).

**Review findings:** 9 patches (1 medium — the atomic fold, both reviewers' converging top finding; 8 low), 1 deferred (warning never expires — staleness policy), 5 rejected (deliberate design/convention items). No intent gaps, no spec repairs.

**Verification:** `tsc -b` clean; biome clean; vitest 1830/1830 (new: two-run departure diff, DW-13 return hazard with first_seen_at restamp verified, idempotent repeat run, exact user-zone date, degenerate-response guard, contradictory-row UI belt); Playwright epic10 suite 6/6.

**Residual risks:** the warning has no expiry (ledgered); the stamp is the detection date, up to ~a month after the actual removal (copy says "as of"; inherent to a monthly refresh).
