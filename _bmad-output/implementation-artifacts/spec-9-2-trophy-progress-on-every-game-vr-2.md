---
title: 'Trophy progress on every game'
type: 'feature'
created: '2026-07-13'
status: 'done'
baseline_revision: '45a9414f1e54b69a277ebcc81bfd420ed6564914'
review_loop_iteration: 0
followup_review_recommended: true # HIGH findings auto-forced it; the independent pass RAN in this story
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** A game's card says *whether* it was played, never *how far*. PSN knows — it holds earned/defined trophy counts per title — and Story 9.1b just gave the app the credential that can read them (the bearer; the cookie is 401'd by the trophy host).

**Approach:** A trophy sync (a FAB action beside the library sync) pulls the per-title trophy list through `PsnProvider`, matches each trophy title to a library game by normalized name, and PERSISTS the raw counts on `game_tracking`. Completion % and the letter grade are computed in the I/O-free core from those stored counts — never stored, never fetched on render. Card and detail show them; a game with no trophy data shows nothing.

## Boundaries & Constraints

**Always:** All PSN I/O through `PsnProvider` (AR-5); trophy counts persisted at sync time, nothing fetched on render (NFR-3). % and grade derived in `core/` from the stored counts, with the grade bands in exactly ONE place (AR-3, AR-8) — no derived column. Every write is user-scoped through `repositories/` (AR-6). One attempt on auth failure, then the existing `psn_auth: 'expired'` path — no silent retry (NFR-4, AR-14). A DEGENERATE response (200 carrying an error body, or an empty `trophyTitles` while `totalItemCount > 0`) fails closed: no writes, existing trophy data survives (DEGENERATE-RESPONSE GUARD).

**Block If:** the live trophy wire shape contradicts the captured probe (`tmp/probe-trophies.ts`, run 2026-07-13) in a way that changes the join key — i.e. matching by name turns out to be impossible.

**Never:** The trophy sync must NOT write play status, milestones, or any lifecycle date — trophy data is its own surface; the platinum-date backfill is Story 9.3 and a deliberate one-off (AR-10, AR-11). Never show a fake `0%` for a game with no trophy data. Never guess an ambiguous name match — surface it as needs-attention. Do not persist PSN's own weighted `progress` field (it would be a second source of truth for the %).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | 137 trophy titles, library match by name | Counts persisted per matched game; summary reports updated / unmatched | No error expected |
| Pagination | `totalItemCount` 137, `limit=100` | Two calls (offset 0, 100) via `nextOffset`; ~4 subrequests total incl. the token exchange — inside the 50 budget | Runaway brake like the library sync |
| PS4 name suffix | Trophy title `"Ultimate Chicken Horse Trophies"` | Matches library game `Ultimate Chicken Horse` — the trailing " Trophies" is stripped before normalizing | — |
| No match | Trophy title absent from the library (a demo, an unowned game) | Counted + listed as unmatched in the summary. NOT an error, NOT a needs-attention item | — |
| Ambiguous match | Two library games share the normalized title | No write for that title; one needs-attention item naming it | Never guessed |
| Zero-trophy game | Library game with no trophy title at all | Its trophy columns stay NULL; card and detail show NOTHING (never `0%`) | — |
| Played-but-none-earned | `definedTrophies` 59, `earnedTrophies` all 0 | Persisted; card shows `0% · D` — real data, distinct from no data | — |
| Expired NPSSO | Trophy host answers 401 `{"error":{"message":"Invalid token"}}` | `PsnAuthError` before ANY write → `psn_auth: 'expired'`, banner, run stops | One attempt, no retry |
| Degenerate 200 | 200 with an `error` body, or `trophyTitles: []` while `totalItemCount > 0` | Provider throws; ZERO writes; existing trophy counts survive | Fails closed, surfaced as a failure |

</intent-contract>

## Code Map

- `tmp/probe-trophies.ts` -- **the live capture (2026-07-13), the source of truth for the wire shape.** `GET https://m.np.playstation.com/api/trophy/v1/users/me/trophyTitles?limit=100&offset=N` → `{ trophyTitles[], nextOffset, totalItemCount }`. Each entry: `npCommunicationId` ("NPWR22372_00"), `trophyTitleName`, `trophyTitlePlatform`, `definedTrophies{bronze,silver,gold,platinum}`, `earnedTrophies{...}`, `progress`, `lastUpdatedDateTime`. **There is NO `titleId`/`conceptId` — the ONLY join back to the library is the name.** A bogus bearer answers a real `401 {"error":{"message":"Invalid token"}}` (unlike the GraphQL surface, which answers 200 + `errors[]`).
- `src/providers/psn.ts` -- add `fetchTrophyTitles(): Promise<PsnTrophyTitle[]>` to `PsnProvider`, reusing the existing bearer (`getBearer()`) and the one-attempt `PsnAuthError` discipline. New host constant; paginate on `nextOffset`/`totalItemCount` with a runaway brake.
- `src/core/trophy.ts` -- **NEW, I/O-free.** `trophyTitleToMatchKey(name)` (strip a trailing " Trophies", then `normalizeTitle`); `completionPercent(earned, defined): number | null` (null when nothing is defined — the no-data signal); `trophyGrade(percent): TrophyGrade`; `TROPHY_GRADE_BANDS` — the ONE place the bands live. Export from `src/core/index.ts`. `src/core/purity.test.ts` enforces the no-I/O rule.
- `src/core/title-normalizer.ts` -- `normalizeTitle` is REUSED, not modified (the " Trophies" strip is trophy-specific and must not leak into library matching).
- `src/schema/catalog.ts` + `migrations/0007_*` -- `game_tracking` gains: `trophy_np_comm_id` (text, the 9.3 join key), `trophy_earned_bronze|silver|gold|platinum`, `trophy_defined_bronze|silver|gold|platinum` (int), `trophy_synced_at` (ISO date text). All nullable — NULL means "no trophy data", which is what suppresses the UI. Generate with `bun run db:generate`.
- `src/repositories/tracking.ts` -- add `setTrophyCounts(db, userId, gameId, counts)` through the existing `updateTrackingWhere` conditional-UPDATE idiom; it writes ONLY trophy columns (a test asserts play status / milestones / dates are untouched).
- `src/repositories/games.ts` -- `LibraryRow` + `listLibraryForUser` carry the trophy columns so they reach the shelf DTO.
- `src/services/trophies.ts` -- **NEW.** `runTrophySync(db, userId, env): Promise<TrophySyncOutcome>` mirroring `src/services/sync.ts`: provider → match against `listLibraryForUser` bucketed by normalized title → write per match. Outcome `{ok:true, result:{updated, unmatched: string[], needsAttention: SyncAttentionItem[]}} | {ok:false, reason:'auth', message}`. Auth failure is caught BEFORE any write (copy `runSync` L106-113) and calls `markPsnAuthExpired`.
- `src/routes/sync.ts` -- add `POST /api/sync/trophies` alongside the library sync: 401 on `reason: 'auth'` (message passed through), 502 otherwise, 200 with the result.
- `src/services/shelf.ts` -- `ShelfGame` gains `trophy: { percent, grade, earned, defined } | null`; `bakeCard` computes it from the stored counts via `core/trophy.ts` (same shape as `computeEffectiveState`). NULL counts → `trophy: null`.
- `web/shelf/api.ts` -- mirror the field in `shelfGameSchema` (zod; drift surfaces as a parse error).
- `web/shelf/Card.tsx` (+ `card.css`) -- render `62% · B` in `card__meta` beside the status pill, using the established `aria-hidden` glyph + `.sr-only` label pattern. `trophy === null` renders NOTHING.
- `web/shelf/DetailPanel.tsx` (+ `detail-panel.css`) -- a "Trophies" section after Milestones: the %, the grade, and the earned/defined tier breakdown. Absent when `trophy === null`.
- `web/shell/Fab.tsx` -- a 4th action `fab-trophy-sync` (mirroring `fab-sync`/`fab-psplus-check`, spinner + 401 toast + invalidate `['shelf']`/`['settings']`).
- `web/shell/TrophySyncModal.tsx` (+ css) -- the readout (updated / unmatched / needs-attention), modelled on `web/shell/PsPlusCheckModal.tsx`; wired through `web/shell/AppShell.tsx` like `onPsPlusCheckComplete`.
- `playwright/support/helpers/d1.ts` + `playwright/support/factories/game-factory.ts` -- `SeedGame`/`seedSql` gain the trophy columns so e2e can seed a game WITH and WITHOUT trophy data.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/trophy.ts` (+ `trophy.test.ts`, + export in `src/core/index.ts`) -- the match key, the % , the grade bands in one place -- the derived values live in the pure core, never in a column.
- [x] `src/schema/catalog.ts` + `bun run db:generate` -> `migrations/0007_*` -- add the nullable trophy columns to `game_tracking` -- counts are per-user facts, so they belong on the tracking side.
- [x] `src/providers/psn.ts` (+ `psn.test.ts`) -- `fetchTrophyTitles()` on the existing bearer: paginate via `nextOffset`, runaway brake, 401 → `PsnAuthError` after ONE attempt, and the degenerate guards (200 with an `error` body; empty list while `totalItemCount > 0`) -- built from the CAPTURED payload, not from convention.
- [x] `src/repositories/tracking.ts` + `src/repositories/games.ts` -- `setTrophyCounts` (trophy columns only) and the trophy columns on `LibraryRow` -- the write path stays the conditional-UPDATE idiom, user-scoped.
- [x] `src/services/trophies.ts` (+ `test/integration/trophies.test.ts`) -- `runTrophySync`: match by normalized name, write only unambiguous matches, collect unmatched + ambiguous, catch `PsnAuthError` before any write -- the append-only, never-guess posture of the library sync.
- [x] `src/routes/sync.ts` -- `POST /api/sync/trophies` (401 / 502 / 200) -- same contract as the library sync route.
- [x] `src/services/shelf.ts` + `web/shelf/api.ts` -- carry `trophy: {...} | null` into the card DTO, computed in `bakeCard` -- nothing is fetched on render.
- [x] `web/shelf/Card.tsx`, `web/shelf/DetailPanel.tsx` (+ css, + their tests) -- show the % and grade on the card and a Trophies section in detail; render NOTHING when there is no trophy data -- never a fake 0%.
- [x] `web/shell/Fab.tsx`, `web/shell/TrophySyncModal.tsx`, `web/shell/AppShell.tsx` (+ tests) -- the trigger and the summary readout -- every user-triggered long op ends in a visible summary.
- [x] `playwright/e2e/epic9-trophies.spec.ts` + `playwright/support/**` + `playwright/COVERAGE.md` -- seed a game with trophy counts and one without; assert the card shows `% · grade` for the first and NOTHING for the second, the detail Trophies section, and the no-credential trophy sync → expired banner -- every UI-facing AC ships with an e2e test.

**Acceptance Criteria:**
- Given a synced PSN account, when the trophy sync runs, then per-game earned/defined counts by tier are fetched through `PsnProvider` and persisted, and no PSN call happens on any page render.
- Given persisted counts, when the card and detail render, then the completion % and letter grade are computed in `core/` from those counts (no derived column, bands defined once), and a game with no trophy data shows nothing rather than `0%`.
- Given a trophy sync run, when it completes, then no play status, milestone, or lifecycle date has changed for any game — asserted by a test that snapshots those columns across a run.
- Given an expired NPSSO or a degenerate 200, when the trophy sync runs, then it stops with the refresh instructions (or a surfaced failure), writes NOTHING, and leaves existing trophy counts intact.
- Given a ~175-game library, when the trophy sync runs, then it costs ~4 external subrequests (2 exchange + 2 trophy pages), well inside the 50-subrequest budget — a per-game fan-out is never issued.

## Spec Change Log

## Review Triage Log

### 2026-07-13 — Review pass (Blind Hunter + Edge Case Hunter, then a forced independent follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 3, medium 5, low 3)
- defer: 6: (medium 2, low 4)
- reject: 3
- addressed_findings:
  - `[high]` `[patch]` **PS4 + PS5 trophy sets silently overwrote each other.** PSN lists them as two entries ("Hades" and "Hades Trophies") that normalize to the same game, so the write loop kept whichever PSN returned LAST — an abandoned 3% PS4 run could replace a 100% PS5 platinum, with no attention item, and the game was listed twice in the summary. Both reviewers found it independently. Trophy titles are now collapsed by match key BEFORE any write (most earned wins, tiebreak most defined), tested in both PSN orders and against the real two-entry Hades shape.
  - `[high]` `[patch]` **The library side of the join stripped " Trophies" off LIBRARY titles** — the exact thing `core/trophy.ts` documents as forbidden. A game legitimately named "X Trophies" collided with "X", both became ambiguous, and neither got counts. The library side now keys on the stored `game.title_normalized` column the library sync already matches on, so the two syncs cannot drift.
  - `[high]` `[patch]` **The subrequest budget was measured against a mock that could not see the real cost.** The run issued one sequential D1 UPDATE per matched title (~137), and D1 binding calls count toward the Workers subrequest limit. Writes now go through `setTrophyCountsBatch` — chunks of 50 via `db.batch()` — and the budget claim in the provider comment and COVERAGE.md was corrected to state what is actually bounded (4 fetches + ceil(matched/50) D1 calls). Tested: 137 writes cost 3 batch calls, not 137.
  - `[medium]` `[patch]` A short/empty MIDDLE page silently truncated the run and the missing titles were never even reported as unmatched. The collected count is now reconciled against `totalItemCount` and a short result fails closed.
  - `[medium]` `[patch]` (found by the independent pass, after the fix above) The empty-page guard then fired on a page PSN's own `nextOffset` told us to fetch — an account whose title count is an exact multiple of the page size, or a title delisted mid-run, would have 502'd forever while the run already held every title. The guard is now scoped to the FIRST page; a genuinely truncated run is still caught by the reconciliation. Tested with a boundary account.
  - `[medium]` `[patch]` `completionPercent` clamped the floor but not the ceiling: `earned > defined` (PSN's counts skew across trophy-group changes) rendered `113% · S`. Clamped to 100.
  - `[medium]` `[patch]` A write that persisted nothing (the row vanished underneath us) was still counted as updated, so the modal reported counts that were never written. Only rows that actually returned are counted now.
  - `[medium]` `[patch]` The "has trophy data" sentinel was one arbitrary tier column, so a partial row would have been `?? 0`-filled into a wrong percent. It now gates on `trophy_synced_at`, the column that actually means "synced".
  - `[low]` `[patch]` A trophy entry with a blank name normalized to an empty key and rendered an empty bullet in the "no library match" list. Skipped instead.
  - `[low]` `[patch]` `_journal.json` had 0007 timestamped BEFORE 0006 (0006 was hand-authored with a fabricated `when`). Made monotonic; `wrangler d1 migrations apply` tracks by filename, so nothing already applied is disturbed.
  - `[low]` `[patch]` A stale CSS comment claiming the status popover was the sole child of `card__meta`.

## Design Notes

**The join key is the NAME, and PSN mangles it.** The captured payload carries no `titleId`/`conceptId` — only `npCommunicationId` (an NPWR id the library side has never seen). So matching is name-only, and the probe shows PS4-era entries are named `"Ultimate Chicken Horse Trophies"` / `"EA SPORTS FC™ 24 Trophies"` while PS5 entries are named plainly (`"Tales of Arise"`). Hence `trophyTitleToMatchKey`: strip a trailing " Trophies", then hand off to the shared `normalizeTitle` (which already handles ™, editions, and the PS4/PS5 collapse). The strip stays trophy-local — pushing it into the shared normalizer would corrupt library matching for any game legitimately ending in that word.

**Completion % is count-based, and deliberately differs from PSN's own number.** PSN sends a weighted `progress` (Tales of Arise: 6 of 59 trophies earned, PSN says `7`, count-based says `10`). We do not store `progress` — a persisted derived value would be the second source of truth the architecture forbids, and count-based % is what PSNProfiles shows. The stored counts are the fact; % and grade are functions of them.

**The grade bands are a chosen convention, not a captured requirement** — no planning doc defines them. They live in `TROPHY_GRADE_BANDS` in `src/core/trophy.ts` so retuning is a one-line change:

```ts
// The one place the bands live. S = a completed set (platinum-equivalent).
export const TROPHY_GRADE_BANDS = [
  { min: 100, grade: 'S' }, { min: 75, grade: 'A' }, { min: 50, grade: 'B' },
  { min: 25, grade: 'C' }, { min: 0, grade: 'D' },
] as const;
```

**Budget.** The trophy list is ONE paginated collection for the whole account (137 titles → 2 pages), not a per-game lookup. With the token exchange that is ~4 subrequests for the entire sync — the fan-out the epic warned about (~175 per-game calls) never happens.

## Verification

**Commands:**
- `bun run lint` + `bun run typecheck` -- clean.
- `bun run test` -- green, including: the captured-payload provider tests (401, degenerate 200, empty-list-with-nonzero-total), the core band/percent tests, and the integration test asserting a trophy sync leaves status/milestones/dates untouched.
- `bun run test:e2e` -- green, including the new `epic9-trophies.spec.ts` (trophy stat on a card with data, NOTHING on a card without, detail section, no-credential sync → banner). NOTE: Playwright 6.4a flakes under full-suite load on `main` already (logged in the deferred-work ledger) — a failure there is pre-existing, not a regression.

**Manual checks (if no CLI):**
- `PSN_NPSSO=<token> bun tmp/probe-trophies.ts` re-prints the live shape if the wire contract is ever in doubt.

## Auto Run Result

Status: done (2026-07-13)

**Change.** A trophy sync (FAB action beside the library sync) pulls the account's trophy list through `PsnProvider` and persists per-game earned/defined counts by tier on `game_tracking` (migration 0007, 10 nullable columns). Completion % and the letter grade are computed in the I/O-free core from those stored counts — no derived column, bands in one place (`TROPHY_GRADE_BANDS`) — and shown on the card (`62% · B`) and in a detail Trophies section. A game with no trophy data shows nothing, never a fake 0%.

**Evidence, not convention.** The wire shape was CAPTURED LIVE (`tmp/probe-trophies.ts`, 2026-07-13) before the spec was written, which is what surfaced the two facts that shaped the story: the trophy API carries NO titleId (the join to the library is name-only), and PS4-era trophy sets are named `"<Game> Trophies"` while PS5 ones are named plainly. It also captured the real 401 body — this host answers a genuine 401, unlike the GraphQL surface that answers 200 + `errors[]`.

**Files changed.** New: `src/core/trophy.ts` (+ test), `src/services/trophies.ts` (+ unit + `test/integration/trophies.test.ts`), `web/shell/TrophySyncModal.tsx` (+ test), `playwright/e2e/epic9-trophies.spec.ts`, `migrations/0007_*`, `src/repositories/tracking.test.ts`. Changed: `src/providers/psn.ts` (`fetchTrophyTitles`, paginated, fail-closed), `src/schema/catalog.ts`, `src/repositories/{tracking,games,db}.ts` (`setTrophyCountsBatch` via `db.batch()`), `src/services/shelf.ts`, `src/routes/{sync,shelf}.ts`, `web/shelf/{Card,DetailPanel,api}.*`, `web/shell/{Fab,AppShell}.tsx`, plus tests, css, and the Playwright support helpers.

**A bug the tests caught before review did:** `src/routes/shelf.ts` re-validates the DTO with its own zod schema, which strips undeclared keys — the computed `trophy` block was being silently dropped before it reached the SPA while every unit and integration test passed. Now declared, and pinned by an integration test asserting the ENDPOINT (not just the service) carries it.

**Review findings.** 11 patched (3 high, 5 medium, 3 low), 6 deferred, 3 rejected. No intent gaps, no spec loopbacks. The HIGHs auto-forced an independent follow-up pass, which confirmed the batch write path (user-scoped, trophy-columns-only, no row minted) and the migration/journal edit (safe on a deployed DB), mutation-checked the load-bearing tests as non-vacuous, and found one more real defect (the past-the-end page 502), patched above.

**Verification.** `bun run lint` and `bun run typecheck` clean; `bun run test` — 1991 tests passed; `bun run test:e2e` — 80 passed, 1 failed: the known PRE-EXISTING `epic6.spec.ts` 6.4a flake (proven pre-existing on the baseline commit during the 9.1b run, logged in the deferred-work ledger). All new trophy e2e tests pass.

**Residual risks.** The name-only join is inherently lossy: a library title PSN spells differently gets no counts and is reported as unmatched rather than guessed (deliberate — never guess). Trophy counts are never cleared once written (deferred): a game whose trophy title stops matching keeps its last-synced numbers, and the UI does not yet surface how old they are. The trophy fetch has run live only via the probe harness; the in-Worker path is exercised against captured payloads.
