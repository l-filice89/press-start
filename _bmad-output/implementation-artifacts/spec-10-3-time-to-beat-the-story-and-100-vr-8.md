---
title: 'Story 10.3: Time to beat — the story, and 100% (VR-8)'
type: 'feature'
created: '2026-07-16'
status: 'done'
review_loop_iteration: 1
baseline_revision: '1a354cb50f7757e426ae63cf65034edd35bf42e5'
final_revision: '024b4eb2f1059b2459761ac11888e63c26a0a9b1'
followup_review_recommended: true
followup_review_reason: '11 review patches incl. 2 medium behavior fixes (a fail-mode inversion in the cron write path and an AC display miss) — same files as story 10.1''s flagged change, so one independent pass can cover both before the epic merge'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/igdb-score-coverage-2026-07-16.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Luca can't tell a 12-hour game from a 90-hour completionist grind before committing a weekend.

**Approach:** Fetch IGDB's `/game_time_to_beats` (`normally`, `completely`, `count`, keyed by `game_id` — seconds, stored verbatim) for every IGDB-linked game in the SAME scheduled pass as the 10.1 score refresh (one cron, one walk, +1 subrequest per 500 ids), persist as three nullable columns, render hours on card + detail next to the scores with story vs 100% unmistakably labelled. Coverage against the real library measured first, recorded next to 10.1's finding. Per the approved 2026-07-13 HLTB proposal and Luca's invocation directive: IGDB is the source; HLTB is fallback-only and stays unwritten unless the gate fails.

## EXTERNAL-RISK-FLAG (mandatory, Epic 11 rule)

Same surface as 10.1: **IGDB official documented API** (`/game_time_to_beats` is a documented v4 endpoint), same registered Twitch app credentials, same throttle. (a) ToS: documented, non-commercial personal use. (b) Credential exposure: service credential only, no personal account identity. (c) Legal: none beyond ToS. **Assessment: LOW — covered by the same recorded sign-off (Luca, invocation 2026-07-16: "favor IGDB over HLTB … legit client and secret"). HLTB is NOT covered**: an unofficial endpoint that would need its own flag and sign-off — Block-If, never a silent fallback.

## Boundaries & Constraints

**Always:**
- Hours render from D1 only (NFR-3); the ONLY fetch site is the shared scheduled refresh pass — no per-add, no per-render call.
- Join on the stored IGDB external id — no fuzzy title matching anywhere (VR-8).
- All three columns nullable; a missing value is ABSENT — never a zero, never an estimate, and the completionist figure never stands in for the story figure (VR-8/NFR-4).
- Seconds stored verbatim (IGDB's unit); hours are a render concern (rounded).
- Story vs 100% labelled unmistakably wherever both show; the submission `count` is persisted and shown in detail (4 submissions ≠ 400).
- One scheduled pass: the TTB fetch extends `runScoreRefresh` — same stale gate, same failure flag/banner (a TTB or score failure is ONE "refresh failed" signal), same degenerate/partial-response rules as 10.1 (a `200 []` for a non-empty id list fails closed; an id absent from the reply keeps its stored hours).
- Budget arithmetic updated honestly at the ledger (adds ceil(65/500)=1 external fetch).

**Block If:**
- Coverage probe shows <50% of IGDB-linked titles carry a `normally` value → HALT `blocked`: the HLTB fallback needs Luca's decision + its own EXTERNAL-RISK-FLAG sign-off (unofficial endpoint, title matching).

**Never:** HLTB/OpenCritic adapters in this story; a second cron or separate refresh job; per-user tracking writes; fabricated or averaged hours.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy refresh | linked games, shared pass runs | `normally`/`completely`/`count` persisted (seconds); hours show on card + detail | none |
| Only one value | `normally` set, `completely` absent (or vice versa) | The missing slot is ABSENT — never substituted | none |
| No TTB record | game absent from `/game_time_to_beats` reply | Stored hours untouched (or stay NULL) — same partial-reply rule as scores | none |
| Degenerate `200 []` | non-empty id list | No writes, refresh marked failed, existing hours survive | banner |
| TTB fetch fails, scores succeeded | mid-pass error | Fail closed for the pass (flag set, retry next cron); already-written score rows stand | banner |
| Unlinked game | no IGDB id | Never queried; hours absent | none |

</intent-contract>

## Code Map

- `scripts/probe-igdb-ttb-coverage.ts` -- FIRST task: live `/game_time_to_beats` coverage over the linked library; artifact `igdb-ttb-coverage-2026-07-16.md` beside the score finding
- `src/providers/igdb.ts` -- `IgdbTimeToBeat` type + `fetchTimeToBeatByIds` hitting `https://api.igdb.com/v4/game_time_to_beats` through the same `queryGames` guard seam (endpoint param), `where game_id = (…)`
- `src/schema/catalog.ts` + `migrations/0014_*.sql` -- `ttb_story_seconds` INT, `ttb_complete_seconds` INT, `ttb_count` INT, nullable
- `src/repositories/games.ts` -- columns in `LibraryRow`/select; extend the batched score writer (one update per game carries scores + TTB)
- `src/services/scores.ts` -- `runScoreRefresh` fetches scores AND TTB, merges per game, one batched write; budget comment
- DTO chain: `src/services/shelf.ts`, `src/routes/shelf.ts`, `web/shelf/api.ts` -- 3 fields (+ client defaults)
- `web/shelf/Card.tsx` + `card.css` -- hours in the scores row (`Nh story · Mh 100%`), absent-safe
- `web/shelf/DetailPanel.tsx` + css -- Time-to-beat lines in the Scores section with the submission count
- tests: `src/providers/igdb.test.ts` (captured fixture), `test/integration/scores.test.ts` (TTB rows in the same pass + hazards), Card/DetailPanel jsdom, `playwright/e2e/epic10-scores.spec.ts` additions, `playwright/COVERAGE.md`

## Tasks & Acceptance

**Execution:**
- [x] `scripts/probe-igdb-ttb-coverage.ts` -- live coverage probe over linked ids; write `igdb-ttb-coverage-2026-07-16.md`; apply the Block-If gate
- [x] `migrations/0014_*.sql` + schema -- three nullable INT columns
- [x] `src/providers/igdb.ts` -- `fetchTimeToBeatByIds` (chunks ≤500, shared guard/throttle/401/array seam; captured-fixture mapping)
- [x] `src/repositories/games.ts` -- select/types + writer extension
- [x] `src/services/scores.ts` -- TTB in the same pass: fetch, merge by game, single batched write, fail-closed rules unchanged
- [x] DTO chain -- 3 fields through server + client schemas
- [x] `web/shelf/Card.tsx`/`DetailPanel.tsx` + css -- labelled hours next to scores, counts in detail, absent-safe
- [x] tests -- provider fixture + query-body; integration same-pass persistence + degenerate-[]-keeps-hours + absent-id-untouched + one-value-only; jsdom render (labels, absent slots); Playwright scored+timed card/detail; COVERAGE.md rows
- [x] update `igdb-score-coverage-2026-07-16.md` cross-reference (10.3 finding recorded next to 10.1's)

**Acceptance Criteria:**
- Given IGDB-linked games, when the shared scheduled pass runs, then story/100% seconds + count persist from `/game_time_to_beats`, joined on the stored id — no new adapter, credentials, or cron.
- Given the probe has run, when the story proceeds, then coverage is recorded next to the 10.1 finding (≥50% `normally` gate passed).
- Given a game with TTB data, when card and detail render, then both hours show from stored data, story vs 100% unmistakable, count available in detail.
- Given a game with no/partial TTB data, when it renders, then the missing value is absent — never zero, never the completionist figure standing in for story.
- Given a failed refresh, when the app next opens, then the existing FR-40 banner surfaces it and stored hours are unchanged.

## Spec Change Log

## Review Triage Log

### 2026-07-16 — step-04 adversarial dual review (auto)

Two independent hunters over the full 10.3 diff. 16 findings → 11 patch / 0 intent_gap / 0 bad_spec / 0 defer / 5 reject.

**Patched (11):**
1. **[MEDIUM] TTB `200 []` wrongly treated as degenerate** — a library whose linked games all lack TTB records would light the FR-40 banner permanently, and no retry could ever clear it (absence is normal on `/game_time_to_beats`; only 62 of 65 linked games have records today). Fixed: empty TTB reply is a legitimate success; genuine breakage still fails closed via the provider's HTTP/non-array guards. `src/services/scores.ts`.
2. **[MEDIUM] DetailPanel dropped the submissions count when a game has 100% but no story figure** — AC says the count renders with whichever line exists. Fixed: 100% line carries `(N submissions)` when the story line is absent; jsdom test added.
3. Provider `positive()` guard: 0/negative seconds from IGDB → null, never rendered as `0h`; `ttbCount` nulled when both figures are null (count without a value is noise).
4. `updateGameScores` renamed `updateGameIgdbFacts` + empty-facts filter — the function now writes TTB too; a no-op facts object no longer burns a batch statement.
5. Scheduled-path hazard test: TTB throw persists the FR-40 flag (scores still land first).
6. Comment documenting the retry refire cost (score fetch re-spent when TTB fails — accepted ≤7-days-per-window cost).
7. `stubFetch`/`fakeFetch` test fixtures default the TTB route to `[]` so every pre-existing test exercises the new same-pass code path honestly.
8. Probe script: parse-shape guard on the wrangler JSON reply.
9. Probe script: sample-row print guarded by `rows.length > 0`.
10. Provider count-only TTB record (count, no figures) → whole-row nulls; test expectation updated.
11. Post-patch biome format pass (DetailPanel JSX).

**Rejected (5):** unconditional section heading (contradicts absent-not-zero AC); `_journal.json` trailing-newline nit (generated file); TTB multi-record pagination worry (population probed: 62 records for 62 games — 1:1, `limit 500` covers 7× today's library; SAMPLE-OF-ONE satisfied); coverage-artifact denominator annotation (artifact already states the 65-game denominator); duplicate of finding 1 phrased as a banner-copy change.

## Verification

**Commands:**
- `bun run typecheck && bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. new TTB hazard tests
- `bunx playwright test epic10` -- expected: green
- `bun scripts/probe-igdb-ttb-coverage.ts` -- expected: coverage artifact written

## Auto Run Result

- **Outcome:** done — all 9 tasks complete, dual review triaged (11 patched / 5 rejected), all patches verified green.
- **Baseline → final:** 1a354cb → 024b4eb.
- **Verification:** `bun run typecheck` clean; `bunx biome check .` clean; `bun run test` 1859/1859 (72 files); `bunx playwright test epic10` 8/8.
- **Live probe (production D1 + IGDB):** 61/65 story (93.8%), 55/65 complete (84.6%), 62/65 either (95.4%) — >=50% gate PASS. HLTB never built; no EXTERNAL-RISK-FLAG needed beyond the IGDB sign-off already recorded (user directive 2026-07-16).
- **Budget:** TTB adds ceil(links/500)=1 external call to the score pass — pass total ≈10 of 50, combined worst-case with PS+ ≈44 of 50 once per monthly window.
- **Follow-up:** followup_review_recommended: true (see frontmatter reason); shares the independent pass 10.1 already requires.
