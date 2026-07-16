---
title: 'Story 10.1: Critic & user scores on every game (VR-5)'
type: 'feature'
created: '2026-07-16'
status: 'in-review'
review_loop_iteration: 0
baseline_revision: 'f84e54d6510759878b73bbb21f77342aa748fe02'
followup_review_recommended: true # 13 review patches incl. 2 medium behavior fixes at the write-path trust boundary — breadth + volume warrant an independent pass before the epic merge
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/igdb-failure-mode-probe-2026-07-11.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** The shelf remembers games but gives no signal of how they were received — Luca picks blind.

**Approach:** Request IGDB's four score fields (`aggregated_rating`/`_count`, `rating`/`_count`) on the same `/games` call the provider already makes, persist them as nullable catalog facts, render on card + detail from storage, and refresh via the existing cron with a new batched `where id = (...)` fetch. Coverage against the real library is measured first.

## EXTERNAL-RISK-FLAG (mandatory, Epic 11 rule)

Third-party surface: **IGDB via official documented API** (`api.igdb.com/v4`), authenticated with the project's own registered Twitch app client credentials (`IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`, Wrangler secret). (a) **ToS:** documented endpoints, free tier for non-commercial personal use, 4 req/s limit respected by the provider's 260ms throttle — no scraping, no undocumented endpoints, no client impersonation. (b) **Credential exposure:** service credential minted for exactly this purpose; no personal account identity of Luca's on the wire. (c) **Legal:** none identified beyond ToS. **Assessment: LOW. Sign-off recorded: Luca, invocation 2026-07-16** ("legit client and secret combination for IGDB … favor IGDB over HLTB"). OpenCritic fallback is NOT covered by this sign-off — a new provider needs its own flag.

## Boundaries & Constraints

**Always:**
- Scores render from D1 only; no external fetch in any query path (NFR-3).
- All four columns nullable; a missing value stays NULL — never 0, never fabricated (VR-5).
- Refresh writes only rows present in the IGDB response; a `200 []` for a non-empty id list is a provider failure (mark failed, keep existing scores) — DEGENERATE-RESPONSE guard.
- New provider method routes through the existing `searchGames` guard seam (throttle, 401 retry, array guard).
- Budget arithmetic written out at the dispatch site (BUDGET-COUNTS-EVERY-SUBREQUEST): token mint ≤1 + ceil(175/500)=1 IGDB fetch + D1: 1 id-list read + ceil(175/25) batched score UPDATEs via `db.batch` (1 subrequest) + settings reads/writes ≤4 ≈ **8 of 50** — single invocation, no cursor needed at this library size.
- One task per cron invocation (existing discipline): PS+ work pending → PS+; else scores stale (>25 days or never) → score refresh.

**Block If:**
- Coverage probe shows <60% of IGDB-linked titles carry at least one of critic/user score → HALT `blocked`: OpenCritic fallback needs Luca's decision + its own EXTERNAL-RISK-FLAG sign-off.
- Any need to call a non-documented IGDB/other endpoint.

**Never:** OpenCritic/RAWG/HLTB adapters in this story; fuzzy title matching (join is IGDB external_id); touching per-user tracking tables; a second cron.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy refresh | 175 IGDB-linked games, cron fires, scores stale | Batched fetch by ids, scores + counts persisted, `scores_refreshed_at` stamped, failure flag cleared | none |
| Game absent from response | id list sent, some ids missing in reply | Present rows updated; absent rows untouched (keep old scores) | none |
| Degenerate `200 []` | non-empty id list | No writes; `scores_refresh_failed` set | banner on next open |
| IGDB 429/timeout/4xx | refresh mid-flight | Fail closed: no partial-batch corruption of processed=OK rows already written is fine, flag set, retry next cron | banner |
| Unscored game renders | all four NULL | Score UI absent entirely — no zero, no placeholder | none |
| Critic only | `aggregated_rating` set, `rating` NULL | Critic shown, user slot absent | none |
| Enrichment paths | add-by-name / straggler / rematch / seed | Scores persisted from the same `/games` call at enrich time | existing degrade |

</intent-contract>

## Code Map

- `src/providers/igdb.ts` -- fields clause (:196), `IgdbGame` (:62), enrichment/candidate mapping (:13-33, :145), new `fetchGamesByIds` beside `searchGames` (:205)
- `src/schema/catalog.ts` -- `game` table (:50-72): add 4 nullable columns; `migrations/0012_*.sql`
- `src/repositories/games.ts` -- `LibraryRow`+select (:238-301), batched score writer (pattern: `setPsPlusExtraFlags` :186), `listExternalLinksBySource` (:106) is the id source
- `src/services/scores.ts` -- NEW: refresh service (fetch by ids, write, stamp/flag settings)
- `src/services/settings.ts` -- `scores_refreshed_at` + `scores_refresh_failed` helpers (mirror :88-138)
- `src/services/psplus.ts` / `worker/index.ts:37-42` -- cron dispatch: PS+ first, else scores
- `src/services/shelf.ts` (:32-100), `src/routes/shelf.ts` schema, `web/shelf/api.ts` -- DTO plumb
- `web/shelf/Card.tsx` (:189-219) + `card.css` -- score row in `.card__info` (uniform heights rule)
- `web/shelf/DetailPanel.tsx` -- new Scores section with counts
- `web/shell/AppShell.tsx` (:91-106) + `web/components/AttentionBanner.tsx` -- `score-refresh-failed` variant
- `scripts/` + `src/providers/igdb.test.ts`, `test/integration/`, `playwright/COVERAGE.md`

## Tasks & Acceptance

**Execution:**
- [x] `scripts/probe-igdb-score-coverage.ts` -- FIRST: pull IGDB external ids (local D1 via wrangler), batched live query, report N-with-critic / N-with-user / N-with-either over linked titles; write result to `_bmad-output/implementation-artifacts/igdb-score-coverage-2026-07-16.md`; apply Block-If gate
- [x] `migrations/0012_game_score_columns.sql` + `src/schema/catalog.ts` -- `aggregated_rating` REAL, `aggregated_rating_count` INT, `rating` REAL, `rating_count` INT, all nullable
- [x] `src/providers/igdb.ts` -- add fields to query + types + mapping; add `fetchGamesByIds(ids)` (chunks ≤500, `where id = (…)`, shared guard seam)
- [x] `src/repositories/games.ts` -- score columns in select/types; `updateGameScores` batched writer
- [x] enrichment paths (`services/games.ts`, `stragglers.ts`, `seed-import.ts`) -- persist scores wherever enrichment already writes facts
- [x] `src/services/scores.ts` + `settings.ts` -- refresh service, stamp + failure flag, degenerate guard
- [x] cron dispatch (`psplus.ts`/`worker/index.ts`) -- one-task-per-invocation branch, budget comment
- [x] DTO chain (`shelf.ts`, route schema, `web/shelf/api.ts`) -- 4 fields
- [x] `web/shelf/Card.tsx` + `DetailPanel.tsx` + css -- card row (critic/user, absent-safe), detail section with sample counts
- [x] banner (`AppShell.tsx`, `AttentionBanner.tsx`, settings DTO) -- failed-score-refresh variant, clears on success
- [x] tests -- provider query-body + mapping (captured fixture); integration: refresh happy + degenerate-`[]`-keeps-scores (HAZARD) + absent-id-untouched; migration 0012 test; web render (null-absent, counts); Playwright: scores visible on card+detail from seeded data; COVERAGE.md rows for every AC

**Acceptance Criteria:**
- Given the provider's `/games` call, when any enrichment or refresh runs, then all four score fields arrive on that same call — no second adapter, no new credentials.
- Given the probe has run, when the story proceeds, then the coverage result is recorded in the dated artifact (≥60% either-score gate passed).
- Given a game with scores, when card and detail render, then critic and user scores show from stored data with sample counts available in detail.
- Given a game with no IGDB score, when it renders, then the score area is absent (no zero/placeholder).
- Given a stale library, when the shared cron fires with no PS+ work pending, then scores refresh within the stated ≤8-subrequest budget.
- Given a failed refresh (429, timeout, degenerate `[]`), when the app next opens, then the attention banner shows and existing scores are unchanged.

## Spec Change Log

## Review Triage Log

### 2026-07-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 0, medium 2, low 11)
- defer: 1: (high 0, medium 0, low 1)
- reject: 2
- addressed_findings:
  - `[medium]` `[patch]` Client-fabricated scores on a name-only add persisted with no IGDB anchor (refresh could never correct them) — scores now anchor-gated on `igdbId` in `addGame`; bypass path pinned by a new integration test
  - `[medium]` `[patch]` A rematch/resolve payload OMITTING the score fields wiped stored scores (absent conflated with null) — services now distinguish "no score fields sent" (preserve) from explicit nulls (clear); pinned by a new rematch integration test
  - `[low]` `[patch]` Orphan count without its score could persist — count now coupled to its score at the provider mapping AND both service normalizers; pinned by integration test
  - `[low]` `[patch]` All-ids-non-numeric produced a permanent fake "provider failure" banner dead-end — refresh now pre-filters queryable ids, logs skipped ones, and treats zero-queryable as nothing-to-do
  - `[low]` `[patch]` A throw escaping `runScheduledPsPlusCheck` (pre-try user lookup) starved the score refresh — worker now isolates the two jobs; the failure-flag write in the scores catch also guarded against its own throw
  - `[low]` `[patch]` Budget-arithmetic comment undercounted the timezone read + failure-path write — ledger corrected
  - `[low]` `[patch]` Card sr-only copy didn't pluralize 1 review/rating (detail did) — pluralized
  - `[low]` `[patch]` `.card__scores` could clip mid-number ("★ 8" reading as 8) — ellipsized
  - `[low]` `[patch]` `updateGameScores` batch had no named statement-count ceiling — ponytail comment names the chunking upgrade path
  - `[low]` `[patch]` e2e `sqNum` interpolated NaN/Infinity into SQL — `Number.isFinite` guard
  - `[low]` `[patch]` Probe script: secret in URL query, unguarded JSON slice, div-by-zero on empty library, unfiltered ids — all four fixed
  - `[low]` `[patch]` scores.test.ts mid-test dynamic import — hoisted to the top-level import
  - `[low]` `[patch]` FR-40 banner render untested — two AppShell jsdom tests pin flag→banner (present and absent)

## Design Notes

- **Cron composition (deviation from the "else scores stale (>25 days)" branch shape):** the worker runs the score refresh SEQUENTIALLY after `runScheduledPsPlusCheck` in the same invocation, gated by a 7-day stale stamp, instead of an either/or dispatcher branch. Rationale: honest budget arithmetic (services/scores.ts) shows worst case PS+ membership 34 + scores ≈9 = 43 of 50 — the either/or discipline existed because sweep(25)+membership(34) overflowed; scores(9) do not overflow beside either. The 7-day gate (not 25) still fires at most once per 7-day cron window (stamp day ≥15 → next staleness lands past day 21) and lets a mid-window failure retry the next day instead of waiting a month.
- **Column names:** `critic_score`/`critic_score_count`/`user_score`/`user_score_count` (domain names, matching the DTO), not IGDB's raw `aggregated_rating`/`rating` — the spec's field list pinned the SOURCE fields, the storage names follow the codebase's domain-naming convention (coverUrl, releaseDate). Scores stored as REAL verbatim; rounding is render-side.
- **Migration 0012 test:** no dedicated test file — 0012 is purely additive (4 nullable ADD COLUMNs, drizzle-generated) and `test/integration/scores.test.ts` exercises every new column read+write against the migrated D1 in the workers pool; a PRAGMA-assert would duplicate that. (0010/0011 had dedicated tests because they were destructive.)
- **Enrichment-time scores ride the candidate echo** (client → zod-bounded body → service), the same trust path as coverUrl/releaseDate/genres; the scheduled refresh later overwrites with server-fetched truth.

## Verification

**Commands:**
- `bun run typecheck && bun run lint` -- expected: clean
- `bun test` -- expected: all four projects green, incl. new hazard tests
- `bunx playwright test` -- expected: green incl. new score spec
- `bun scripts/probe-igdb-score-coverage.ts` -- expected: coverage report artifact written

## Auto Run Result

**Summary:** IGDB critic + user scores (with sample counts) on every IGDB-linked game: four nullable columns on `game` (migration 0012), fetched on the SAME provider call every enrichment path already makes, batched by-id refresh riding the existing monthly cron (≈9 of 50 subrequests, arithmetic in `src/services/scores.ts`), rendered on card + detail from stored data only, FR-40 banner on refresh failure. Coverage probe first: 96.9% of the 65 IGDB-linked production titles carry a score — gate passed, OpenCritic never built (`igdb-score-coverage-2026-07-16.md`). EXTERNAL-RISK-FLAG: LOW (official documented API, own Twitch app credentials, no personal-account identity), sign-off recorded from Luca's 2026-07-16 invocation.

**Files changed (key):**
- `migrations/0012_game_score_columns.sql`, `src/schema/catalog.ts` — 4 nullable score columns
- `src/providers/igdb.ts` — score fields on the shared query, `fetchScoresByIds` (≤500 ids/subrequest), score/count coupling
- `src/repositories/games.ts` — columns in the library select, `updateGameScores` single-batch writer
- `src/services/scores.ts` (new) — refresh service: degenerate-guard, partial-reply-preserves, non-numeric-id dead-end handling, stale gate
- `src/services/settings.ts` — `scores_refreshed_at` / `scores_refresh_failed` helpers
- `worker/index.ts` — score refresh after the PS+ job, isolated, same cron
- `src/services/games.ts` / `stragglers.ts` / `seed-import.ts`, `src/routes/*` — anchor-gated candidate-score persistence through add/rematch/resolve/seed
- `web/shelf/Card.tsx` + `card.css`, `web/shelf/DetailPanel.tsx` + css — score row / Scores section, absent-safe
- `web/shell/AppShell.tsx`, `web/components/AttentionBanner.tsx`, `web/settings/api.ts` — failed-score-refresh banner
- `scripts/probe-igdb-score-coverage.ts` (new), `playwright/e2e/epic10-scores.spec.ts` (new), `test/integration/scores.test.ts` (new), COVERAGE.md rows, fixture updates across suites

**Review findings:** 13 patches applied (2 medium — anchor-gated client scores, absent-vs-null preserve semantics; 11 low), 1 deferred (no manual score-refresh retry; ledgered), 2 rejected (module-placement nit; impossible-by-construction zero-match case). No intent gaps, no spec repairs.

**Verification:** `tsc -b` clean; `biome check` clean; vitest 1815/1815 across all four projects (incl. new hazard tests: degenerate-[] keeps scores, partial reply preserves, anchor-gate bypass, rematch preserve-vs-clear); Playwright epic10-scores 4/4; full e2e suite green except `epic6 Export CSV`, which fails identically on the clean baseline (Windows EPERM reading the Chromium download temp file — environmental, pre-existing). Live probe run against production D1 + real IGDB.

**Residual risks:** score-refresh banner can persist up to ~3 weeks with no manual retry (ledgered); enrichment-time scores trust the client's candidate echo within zod bounds until the next cron overwrites with server-fetched truth; `updateGameScores` single batch is unbounded past a few-hundred-game library (ponytail comment names the chunking upgrade).
