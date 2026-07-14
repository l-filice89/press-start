---
title: 'One-off backfill — recover the platinum dates PSN knows'
type: 'feature'
created: '2026-07-13'
status: 'done'
baseline_revision: '3e7250515558d126cd31f227da85f91d7304cc86'
review_loop_iteration: 0
followup_review_recommended: true # HIGH findings auto-forced it; the independent pass RAN in this story
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Story 9.2 persisted how *many* trophies were earned, but not *when*. Every game platinumed before this app existed has a blank `platinum_on` — and PSN has the date on record. The milestone history is empty for exactly the games the user is proudest of.

**Approach:** A one-off, re-runnable backfill: for each tracked game that PSN says has an earned platinum and whose `platinum_on` is still NULL, fetch that title's trophy detail, read the platinum's `earnedDateTime`, and fill `platinum_on` (and, only if it is also NULL, `completed_on` — a documented backfill-only heuristic). It fills NULLs and nothing else, so it is idempotent by construction. It runs in CHUNKS, because the fan-out is one call per platinum title and the probed account has 53 of them — above the free tier's 50-subrequest ceiling for a single invocation.

## Boundaries & Constraints

**Always:** Write-once holds — a game that already carries `platinum_on` (or `completed_on`) is left untouched; the first value stands (FR-6, FR-45, AR-11). Every write is a NULL-fill through `repositories/`, user-scoped, via the existing conditional-UPDATE idiom. All PSN I/O behind `PsnProvider` (AR-5). The run reports what it changed (FR-37 posture). One attempt on an auth failure, then the existing `psn_auth: 'expired'` path — no silent retry (NFR-4, AR-14).

**Block If:** the probed trophy-detail shape (`tmp/probe-trophy-dates.ts`, run live 2026-07-13) turns out not to carry the platinum's `earnedDateTime`.

**Never:** This is the ONLY place in the app where a sync writes a milestone — do not generalize it. The trophy sync (9.2) must keep writing trophy columns and nothing else. Never overwrite an existing date. Never let one title's failure (a 404 on its `npCommunicationId`, a missing date) abort the run or block the chunk loop forever. Never issue an unbounded per-title fan-out inside a single request. Do not stamp `started_on` or any other lifecycle date.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Trophy sync says platinum earned; `platinum_on` NULL | `platinum_on` = the platinum's earned date, in the user's timezone | No error expected |
| Completion heuristic | Same row, `completed_on` also NULL | `completed_on` = the same date — a BACKFILL-ONLY heuristic, recorded as such | — |
| Write-once | `platinum_on` already set (any value) | Row is NOT a candidate; nothing is written, even if PSN's date differs | — |
| Half-filled | `platinum_on` set, `completed_on` NULL | Not a candidate — the first value stands and the heuristic never back-writes onto a game the user already touched | — |
| Idempotent re-run | Backfill run twice | Second run finds no candidates and reports 0 filled | — |
| Chunking | 53 platinum titles, 50-subrequest ceiling | Each request processes a bounded chunk and returns a cursor; the client loops until done | A chunk never exceeds the budget |
| Title 404 | `npCommunicationId` PSN no longer resolves (probed: 404 `{"error":{"message":"Resource not found"}}`) | That title is SKIPPED and reported; the run continues and the cursor still advances | Never aborts the run, never loops forever |
| No platinum date | Detail carries no earned platinum entry | Skipped, reported; cursor advances | — |
| Expired NPSSO | Any call denied | `PsnAuthError` → `psn_auth: 'expired'`, banner, run stops with nothing partially presented as complete | One attempt, no retry |
| No trophy data yet | Trophy sync never ran | Zero candidates; the UI says so rather than implying the backfill failed | — |

</intent-contract>

## Code Map

- `tmp/probe-trophy-dates.ts` -- **the live capture (2026-07-13), source of truth.** The trophy LIST carries no earned date, so dates come from `GET https://m.np.playstation.com/api/trophy/v1/users/me/npCommunicationIds/{npCommId}/trophyGroups/all/trophies?npServiceName=trophy2` → `{ trophies: [{ trophyId, trophyType, earned, earnedDateTime, ... }], totalItemCount }`. The platinum is the entry with `trophyType: 'platinum'`; its `earnedDateTime` is a UTC instant (`"2026-07-06T18:30:27Z"`). A bogus `npCommunicationId` answers **404** `{"error":{"message":"Resource not found"}}` — a per-title skip, NOT an auth failure. **53 of the probed account's 137 titles have an earned platinum — that is the fan-out, and it is above the 50-subrequest ceiling.**
- `src/providers/psn.ts` -- add `fetchTrophyEarnedDates(npCommunicationId, npServiceName): Promise<{ platinumEarnedAt: string | null }>` (or the trophy list for that title). Reuses the existing bearer and the one-attempt `PsnAuthError` discipline. A 404 is NOT an error the caller should die on — return a "not found" signal, do not throw `PsnAuthError`.
- `src/schema/catalog.ts` -- 9.2 already persists `trophy_np_comm_id` and `trophy_earned_platinum` on `game_tracking`; the candidate query needs `np_service_name` too if the detail call requires it (the probe sends `trophy2`, which every probed entry carried) — add the column only if the captured data says it varies. Otherwise no schema change.
- `src/repositories/tracking.ts` -- a candidate query (`trophy_earned_platinum > 0 AND platinum_on IS NULL`, user-scoped, ordered by `game_id`, cursor + limit) and a NULL-FILL write that uses the existing COALESCE write-once idiom (`updateTrackingMilestone` already does exactly this — reuse it rather than adding a second milestone write path).
- `src/services/backfill.ts` -- **NEW.** `runPlatinumBackfill(db, userId, env, cursor)`: read one bounded chunk of candidates → one provider call per candidate → NULL-fill `platinum_on` (+ `completed_on` only when NULL) → return `{ filled: [{title, date}], skipped: [{title, reason}], nextCursor: string | null }`. `PsnAuthError` is caught as in `runSync` and returns the auth outcome without writing.
- `src/services/settings.ts` -- reuse `todayForUser`'s timezone handling to convert PSN's UTC `earnedDateTime` to the user's local `YYYY-MM-DD` (a platinum earned at 23:30 local must not be stamped as the next day).
- `src/routes/sync.ts` (or a new `src/routes/backfill.ts`) -- `POST /api/backfill/platinum-dates` taking an optional cursor, returning the chunk result: 401 on auth, 502 otherwise, 200 with the result.
- `web/settings/SettingsPanel.tsx` (+ `web/settings/api.ts`) -- the trigger lives in Settings (a one-off chore, not a shelf action — the CSV export is the precedent). It LOOPS the endpoint on the cursor until `nextCursor` is null, shows progress while it runs, and ends in a summary (filled / skipped / nothing to do).
- `src/services/trophies.ts` -- the 9.2 sync stays as it is: it must keep writing trophy columns ONLY. Do not fold the backfill into it.
- `test/integration/backfill.test.ts` -- **NEW.** The write-once, idempotence, cursor-advances-past-a-404, and auth-failure rows.
- `playwright/e2e/epic9-trophies.spec.ts` + `playwright/COVERAGE.md` -- the Settings trigger's UI flow (button present, disabled/absent when there are no candidates, summary rendered) — PSN itself is unstubbable in e2e, so the fetch half stays a COVERAGE row.

## Tasks & Acceptance

**Execution:**
- [x] `src/providers/psn.ts` (+ `psn.test.ts`) -- `fetchTrophyEarnedDates` built from the CAPTURED detail payload: the platinum's `earnedDateTime`, a 404 mapped to a per-title "not found" (never `PsnAuthError`), 401 still one-attempt auth -- so a delisted title cannot kill the run.
- [x] `src/repositories/tracking.ts` -- the cursor-paged candidate query + reuse of the COALESCE write-once milestone write -- the backfill can only ever fill NULLs.
- [x] `src/services/backfill.ts` (+ `test/integration/backfill.test.ts`) -- `runPlatinumBackfill`: bounded chunk, one call per candidate, NULL-fill both dates, skip-and-advance on 404/no-date, auth failure before any write -- the one-off reconciliation, idempotent by construction.
- [x] `src/routes/*` -- `POST /api/backfill/platinum-dates` with the cursor contract (401 / 502 / 200) -- never a blocking unbounded request.
- [x] `web/settings/SettingsPanel.tsx` + `web/settings/api.ts` (+ tests) -- the Settings chore button that loops the cursor to completion, reports progress, and ends in a summary naming what was filled and what was skipped -- FR-37: every long op ends in a visible summary.
- [x] `playwright/e2e/epic9-trophies.spec.ts` + `playwright/COVERAGE.md` -- e2e for the Settings trigger and its summary; a COVERAGE row for the unstubbable PSN half -- every UI-facing AC ships with a test or a named reason.

**Acceptance Criteria:**
- Given a game PSN says has an earned platinum and whose `platinum_on` is NULL, when the backfill runs, then `platinum_on` is set from the platinum's earned date, converted to the user's timezone.
- Given that game also has a NULL `completed_on`, when the backfill runs, then `completed_on` is set to the same date — and the code says in one place that this is a backfill-only heuristic, explicitly not the rule for games synced going forward.
- Given a game that already carries `platinum_on` or `completed_on`, when the backfill runs, then it is untouched — write-once holds, even if PSN's date differs from the stored one.
- Given the backfill is run twice, when the second run executes, then it finds no candidates and reports 0 filled — idempotent by construction (it only ever fills NULLs).
- Given ~53 platinum titles and a 50-subrequest ceiling, when the backfill runs, then each request processes a bounded chunk and the client loops on a cursor — no single invocation issues an unbounded fan-out, and a title that 404s advances the cursor rather than stalling the loop.
- Given the trophy sync (9.2), when this story ships, then that sync still writes trophy columns only — the milestone write lives exclusively in the backfill.

## Spec Change Log

## Review Triage Log

### 2026-07-14 — Review pass (Blind Hunter + Edge Case Hunter, then a forced independent follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 16: (high 4, medium 7, low 5)
- defer: 2: (low 2)
- reject: 3
- addressed_findings:
  - `[high]` `[patch]` **The `npServiceName` was pinned to `trophy2` — and the LIVE PROBE proved that wrong for most of the account.** The trophy-detail call needs each title's own service name; a wrong one answers 404, which the backfill reported as "PlayStation no longer has trophy data for this title". A follow-up probe (`tmp/probe-service-name.ts`) measured the real distribution: **94 of 137 titles are `trophy` (PS3/PS4/Vita), only 43 are `trophy2` (PS5)** — and confirmed the wrong name 404s a title that the right name answers 200 with its platinum date. So the majority of a real user's platinums would have been silently skipped as "delisted" and permanently unrecoverable. This spec asserted the constant from a single PS5 sample; that assertion was the bug. Fixed properly: PSN's per-title `npServiceName` is now carried on the trophy title, persisted by the 9.2 sync (migration 0008), and passed through the candidate query to the detail call. Tested with the real PS4 and PS5 shapes.
  - `[high]` `[patch]` **One permanently-failing title stranded every candidate behind it, forever.** Any non-auth error aborted the whole chunk; candidates are ordered by `game_id` and filled rows drop out of the set, so every re-run marched into the same bad title and died there — nothing with a higher id could ever be backfilled. Non-auth failures are now a per-title skip that advances the cursor; only an auth failure stops the run.
  - `[high]` `[patch]` **A missing timezone silently stamped every date in UTC.** `platinum_on` is write-once, so an evening platinum misdated by a day was permanent. The run now REFUSES (409) when the user has no timezone captured, and the UI says so.
  - `[high]` `[patch]` **Mid-chunk failures reported rows already written as if nothing had happened.** A token that expired on candidate 11 of 20 left 10 dates written but dropped them from the report — and write-once means they could never be re-reported. The service now returns the partial result plus a resume cursor at the failed candidate, and the client shows what was recovered alongside the failure.
  - `[medium]` `[patch]` The detail call requests `limit=200` and never pages; a truncated trophy set with no platinum in the returned page reported "no date on record" — a lie. It now fails closed.
  - `[medium]` `[patch]` An all-skip run (PSN path change, wrong service name) read as a SUCCESSFUL backfill of a hopeless library. The summary now distinguishes it and names each skip with its reason.
  - `[medium]` `[patch]` The 401 path never invalidated the settings query, so the expired-token banner stayed dark while the UI told the user to paste a fresh token.
  - `[medium]` `[patch]` The client's chunk brake exited into the DONE phase, reporting a truncated run as complete. It now surfaces "stopped early — run it again".
  - `[medium]` `[patch]` The chunk budget (20 per request) did not count the auth middleware's own D1 reads. Lowered to 15 with the arithmetic restated honestly.
  - `[medium]` `[patch]` With no trophy data at all (the 9.2 sync never ran), the UI claimed "every platinum already carries its date". It now says to run the trophy sync first.
  - `[medium]` `[patch]` The summary hardcoded "PlayStation had no date" for every skip, which would misreport an error skip as an undateable title.
  - `[low]` `[patch]` The backfill does not clear `play_status` when it stamps a platinum (unlike the manual milestone write). Behaviour KEPT deliberately — a recovered historical date must not silently change what the user says they are playing now — but the divergence is now documented and the UI copy that claimed the game "hides" was corrected.
  - `[low]` `[patch]` The candidate query silently excluded discarded rows; documented as deliberate.
  - `[low]` `[patch]` The new route was spliced between the trophy sync's JSDoc and its handler, leaving the doc block on the wrong function.
  - `[low]` `[patch]` `key={item.title}` in the summary list — titles are not unique in this app. Keyed by game id.
  - `[low]` `[patch]` The chunking test proved the count was bounded but not that the cursor paged correctly; strengthened to pin the exact ids per chunk and assert no row is fetched twice.

## Design Notes

**Why a cursor and not "retry the same candidates".** Candidates are defined by `platinum_on IS NULL`, so a title that can never be filled (404, no platinum date on record) stays a candidate forever. A client loop that re-asked for "the next unfilled chunk" would spin on it. The endpoint therefore pages by a cursor over `game_id` and advances past skips — the loop terminates whether or not every row could be filled.

**The date needs a timezone, not just a slice.** PSN sends a UTC instant (`"2026-07-06T18:30:27Z"`). `platinum_on` is a local `YYYY-MM-DD`. Slicing the first 10 characters would misdate every platinum earned late in the evening in a positive-offset timezone. Use the same timezone setting `todayForUser` already relies on.

**The `completed_on = platinum_on` inference is a heuristic and must be labelled as one** in the code, not just in this spec: a platinum implies the game was completed, but the reverse is not the rule, and Story 9.2's sync deliberately never writes milestones. This backfill is the single, deliberate exception.

## Verification

**Commands:**
- `bun run lint` + `bun run typecheck` -- clean.
- `bun run test` -- green, including the write-once, idempotence, 404-skip-and-advance, and auth-failure rows.
- `bun run test:e2e` -- green. Known PRE-EXISTING flakes under full-suite load (`epic6.spec.ts` 6.4a, `epic2-tracking.spec.ts:227`) are logged in the deferred-work ledger — a failure there is not a regression.

**Manual checks (if no CLI):**
- `PSN_NPSSO=<token> bun tmp/probe-trophy-dates.ts` re-prints the live detail shape and the platinum fan-out size.

## Auto Run Result

Status: done (2026-07-14)

**Change.** A one-off, re-runnable backfill that recovers the platinum dates PSN has on record. Candidates are tracking rows PSN says carry an earned platinum whose `platinum_on` is still NULL; for each, the title's trophy detail is fetched, the platinum's `earnedDateTime` (a UTC instant) is converted to the user's local date, and `platinum_on` is NULL-filled — plus `completed_on`, only when it too is NULL, a heuristic labelled backfill-only in the code. It fills NULLs and nothing else, so it is idempotent by construction, and it runs in cursor-paged chunks of 15 because the fan-out is one call per platinum title (the probed account has 53, above the free tier's 50-subrequest ceiling). It refuses to run at all without a user timezone: these dates are write-once, and a UTC fallback would misdate every evening platinum permanently.

**The probe earned its keep twice.** The trophy LIST carries no earned date at all (`tmp/probe-trophy-dates.ts`), which is why the per-title detail endpoint exists in this story. And when review challenged the hardcoded `npServiceName`, a second live probe (`tmp/probe-service-name.ts`) proved the reviewer right: 94 of the account's 137 titles are `trophy` (PS3/PS4/Vita), not `trophy2` — and the wrong name 404s. Had it shipped, most of a real user's platinums would have been silently reported as delisted. PSN's per-title service name is now persisted (migration 0008) and passed through.

**Files changed.** New: `src/services/backfill.ts`, `test/integration/backfill.test.ts`, `migrations/0008_*`. Changed: `src/providers/psn.ts` (`fetchPlatinumEarnedAt`, per-title service name, truncated-set fail-closed), `src/schema/catalog.ts`, `src/repositories/tracking.ts` (candidate query + `hasAnyTrophyData`), `src/services/trophies.ts` (persists the service name), `src/services/settings.ts` (`getUserTimeZone`), `src/routes/sync.ts` (`POST /api/backfill/platinum-dates`, 200/401/409/502), `web/settings/{SettingsPanel,api}.*`, `web/shelf/api.ts`, plus tests and the Playwright coverage rows.

**Review findings.** 16 patched (4 high, 7 medium, 5 low), 2 deferred, 3 rejected. No intent gaps, no spec loopbacks. The HIGHs auto-forced an independent follow-up pass, which cleared write-once, cursor termination, the timezone conversion (real `Intl` zone formatting, not an ISO slice) and the subrequest budget — and found the two HIGHs above, both patched.

**Verification.** `bun run lint` and `bun run typecheck` clean; `bun run test` — 2029 tests passed; `bun run test:e2e` — 87 passed, 0 failed (a clean full-suite run; the previously-known flakes did not reproduce this time).

**Residual risks.** Rows synced by 9.2 BEFORE migration 0008 have no stored service name and fall back to `trophy2`; a PS4 title in that state 404s into a per-title skip whose copy tells the user to re-run the trophy sync (which now stores the name) and try again. Two concurrent backfill runs are not locked — harmless (the COALESCE write makes the duplicate a no-op) but both will report the same dates as filled.
