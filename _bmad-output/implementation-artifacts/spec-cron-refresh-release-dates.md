---
title: 'Refresh release dates in the scheduled IGDB pass'
type: 'feature'
created: '2026-08-02'
status: 'done'
review_loop_iteration: 0
baseline_commit: '60f1c8b61d7ca014617693227c657d5cbd82883a'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-10-1-critic-user-scores-on-every-game-vr-5.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-release-date-display-edit.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** IGDB review scores refresh weekly, but stored release dates only change during add, enrichment, rematch, or manual editing. Upcoming games can therefore retain stale or missing dates after IGDB changes them.

**Approach:** Carry `first_release_date` through the existing batched `/games` score response and persist it in the same D1 batch. Keep the current daily trigger and seven-day stale gate; add no provider request or cron.

## Boundaries & Constraints

**Always:** Use stored IGDB IDs, never title matching. A returned IGDB game row is authoritative: a date becomes `YYYY-MM-DD`; missing `first_release_date` becomes explicit `null` and clears the stored date to TBA. An omitted `releaseDate` property at the injected provider seam preserves the stored value; an entirely absent game row also preserves all stored facts. Degenerate `200 []` for a non-empty ID list remains a provider failure and writes nothing. Any date-bearing shared `game` write rotates every user's library version. External risk remains LOW: official documented IGDB `/games`, existing Twitch app credentials, existing fields/request; no personal account identity, scraping, undocumented endpoint, or new legal/ToS exposure.

**Ask First:** Adding date provenance or making manual edits permanently override IGDB; any schema migration; changing cron cadence or failure-banner behavior.

**Never:** New cron trigger, external subrequest, fuzzy matching, per-user release dates, UI changes, or changes to PS+ catalog dates.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Updated date | Returned IGDB row has a new `first_release_date` | Same refresh writes scores/TTB/date; all shelf ETags rotate | N/A |
| Date withdrawn/TBA | Returned row omits `first_release_date` | Stored date becomes `null` | N/A |
| Seam omits date | Fake/alternate `IgdbScores` row has no `releaseDate` key | Existing date survives | N/A |
| Partial reply | Requested ID absent from otherwise non-empty reply | Existing date and other facts survive | N/A |
| Degenerate reply | Non-empty request receives `200 []` | No facts change; refresh fails and retries next daily trigger | Existing failure flag path |

</frozen-after-approval>

## Code Map

- `src/providers/igdb.ts` -- `/games` already requests `first_release_date`; scheduled mapper currently discards it.
- `src/services/scores.ts` -- merges returned score and TTB facts, performs one batched write, and bumps all library versions.
- `src/repositories/games.ts` -- `GameIgdbFacts` and `updateGameIgdbFacts` define partial batched shared-fact writes.
- `src/providers/igdb.test.ts` -- wire mapping and query-body coverage.
- `test/integration/scores.test.ts` -- real D1 scheduled-refresh and preservation hazards.
- `playwright/COVERAGE.md` -- AC ledger; change has no directly triggerable UI flow.

## Tasks & Acceptance

**Execution:**
- [x] `src/providers/igdb.ts` -- extend scheduled IGDB fact rows with optional `releaseDate`; real adapter always maps requested `first_release_date`, including explicit null.
- [x] `src/repositories/games.ts` and `src/services/scores.ts` -- permit date in partial IGDB facts and preserve when property is omitted; reuse existing batch and global version rotation.
- [x] `src/providers/igdb.test.ts` -- pin date/non-date mapping and `first_release_date` on the same by-ID request.
- [x] `test/integration/scores.test.ts` -- hazard-test update, explicit-null clear, omitted-property preserve, partial-row preserve, degenerate-reply preserve, and all-user version rotation.
- [x] `playwright/COVERAGE.md` -- add no-UI-flow coverage row referencing provider/integration pins.

**Acceptance Criteria:**
- Given an IGDB-linked game with an outdated release date, when the seven-day scheduled refresh becomes stale and succeeds, then its stored release date matches IGDB without another network request.
- Given IGDB returns a game row without a release date, when refresh succeeds, then stored date clears to TBA; given the whole row or optional seam property is absent, existing date survives.
- Given release date changes on a shared game, when any tracking user performs a conditional shelf read, then no user receives a stale 304.
- Given a degenerate or failed `/games` response, when refresh runs, then existing release dates survive and existing retry/banner behavior remains.

## Spec Change Log

## Design Notes

Manual release-date edits remain corrections without provenance. Successful cron refresh deliberately replaces them with current IGDB truth; preserving manual overrides would require a separate provenance decision and likely schema work.

Resource budget unchanged: provider already requests `first_release_date`; same `/games` response, same `db.batch`, same global version bump. Daily `03:00 UTC` trigger plus seven-day stale gate remains effective weekly cadence; failures retry next day.

## Verification

**Commands:**
- `bun run typecheck` -- expected: clean
- `bun run lint` -- expected: clean
- `bunx vitest run src/providers/igdb.test.ts test/integration/scores.test.ts` -- expected: focused provider and D1 hazards green
- `bun run test` -- expected: full Vitest suite green

## Suggested Review Order

**Refresh semantics**

- Presence-sensitive mapping distinguishes authoritative null from omitted preserve.
  [`scores.ts:50`](../../src/services/scores.ts#L50)

- Existing by-ID request now returns release date without another call.
  [`igdb.ts:420`](../../src/providers/igdb.ts#L420)

- Partial IGDB fact type feeds existing single-batch shared writer.
  [`games.ts:200`](../../src/repositories/games.ts#L200)

**Hazard coverage**

- Real D1 tests pin update, clear, preserve, and all-user rotation.
  [`scores.test.ts:181`](../../test/integration/scores.test.ts#L181)

- Scheduler tests pin stale dispatch, degenerate preservation, failure flag, and retry.
  [`scores.test.ts:260`](../../test/integration/scores.test.ts#L260)

- Provider test pins date mapping on same by-ID request.
  [`igdb.test.ts:203`](../../src/providers/igdb.test.ts#L203)

**Supporting records**

- Coverage ledger records why no UI-driven E2E exists.
  [`COVERAGE.md:469`](../../playwright/COVERAGE.md#L469)

- Review-discovered pre-existing architecture risks remain explicit.
  [`deferred-work.md:570`](deferred-work.md#L570)
