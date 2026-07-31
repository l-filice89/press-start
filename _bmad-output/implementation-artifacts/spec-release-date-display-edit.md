---
title: 'Release date: visible + editable in detail, date pill instead of SOON'
type: 'bugfix'
created: '2026-07-31'
status: 'done'
review_loop_iteration: 0
baseline_commit: '7f2764d0dc4cdd5c8d9dcb22b128a7a9952c1246'
context: ['{project-root}/_bmad-output/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The game detail panel never shows the release date and offers no way to edit it; the shelf card shows a bare "SOON" pill for any unreleased game with a date — even one releasing a year out — hiding the information the user actually wants.

**Approach:** Add an editable "Release date" row to the detail panel's Dates section backed by a new `PATCH /api/games/:id/release-date` endpoint (release date is a shared `game` fact, so the write rotates EVERY user's library version). On the shelf card, replace the "SOON" label with the formatted release date; keep "TBA" when no date exists.

## Boundaries & Constraints

**Always:**
- `release_date` stays on the shared `game` table — the edit is a shared-fact write, so the service MUST call `bumpAllLibraryVersions` (AD-33 §4), never only the acting user's bump. Hazard test required (stale-read-validator rule).
- Explicit `null` clears the date (game becomes TBA/unreleased); the endpoint takes a single required `releaseDate` key, so absence is unrepresentable (preserve-vs-clear ruling).
- Validate with the same `YYYY-MM-DD` regex + calendar-validity refine already used by the add-game body.
- Date pill formatting parses ISO by string slicing (like `formatLeavingDate`) — never `new Date(iso)` (day-shift hazard).
- `released`/`playableNow` stay server-derived (AD-8) — no client re-derivation; the client refetches after the edit.

**Ask First:** Any schema migration (none expected); any change to the tracking `dates` PATCH (it stays hard-scoped to lifecycle dates).

**Never:** Per-user release-date overrides; touching `enrichGame`/rematch (rematch re-pulling facts and overwriting a manual release date is accepted behavior); changes to `CatalogCard` (no release flag there today).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Edit date | `PATCH {releaseDate:'2027-03-11'}` | 200, `game.release_date` updated, ALL users' library versions rotated | N/A |
| Clear date | `PATCH {releaseDate:null}` | 200, column null → card shows TBA | N/A |
| Bad format | `{releaseDate:'11/03/2027'}` | no write | 400 |
| Bad calendar date | `{releaseDate:'2027-02-30'}` | no write | 400 |
| Unknown game | valid body, missing id | no write | 404 |
| Pill: future date, current year | unreleased, `2026-11-05` | pill `5 NOV` | N/A |
| Pill: future date, later year | unreleased, `2027-03-11` | pill `11 MAR 2027` | N/A |
| Pill: no date | unreleased, null | pill `TBA` (unchanged) | N/A |
| Pill: released | past date | no release pill (unchanged) | N/A |

### Placement mock (UI-MOCK-GATE)

```
Shelf card (flag cluster, unchanged position):   Detail panel — Dates section:
┌──────────────┐                                 Dates
│  cover art   │                                   Release date  [2027-03-11]   ← NEW, first row
│ [21 JUL]     │ ← leaving pill (unchanged)        Wishlisted    [__________]
│ [11 MAR 2027]│ ← was [SOON]; [TBA] unchanged     Bought        [__________]
└──────────────┘                                   ... (existing rows unchanged)
```

</frozen-after-approval>

## Code Map

- `src/routes/games.ts` -- add-game body has the date regex+refine to reuse; new PATCH route lives here (game facts, not tracking)
- `src/services/games.ts` -- new `editReleaseDate` service
- `src/services/library-version.ts` -- `bumpAllLibraryVersions` (shared-fact writer bump)
- `src/repositories/games.ts` -- add release-date update; `GameFacts`/`LibraryRow` already carry it
- `web/shelf/api.ts` -- client fetchers; DTO already has `releaseDate` (:66)
- `web/shelf/useTrackingMutations.ts` -- mutation pattern (`saveDates` :392-419) to mirror
- `web/shelf/DetailPanel.tsx` -- `DateRow` (:39-67) blur-commit pattern; Dates section :429-463
- `web/shelf/Card.tsx` -- release flag condition :80-85, render :189-194
- `web/shelf/leaving.ts` -- `formatLeavingDate` slicing pattern to mirror for the release pill

## Tasks & Acceptance

**Execution:**
- [x] `src/repositories/games.ts` -- add `updateReleaseDate(db, gameId, releaseDate)` returning whether the row existed -- repository owns all D1 (AD-4) *(existence is checked via `getTracking` in the service — AD-13 scope — so the repo update is a plain write)*
- [x] `src/services/games.ts` -- `editReleaseDate`: 404 if missing, write, then `bumpAllLibraryVersions` -- shared-fact write invalidates every user's shelf cache
- [x] `src/routes/games.ts` -- `PATCH /:id/release-date` with `{releaseDate: iso|null}` Zod body reusing the calendar refine -- 400/404 per matrix *(refine extracted to a shared `isoCalendarDate`, also de-duplicating add + rematch bodies)*
- [x] `test/integration/` -- route integration test covering the matrix rows AND the hazard test: two users, user B holds a shelf ETag, user A edits a release date, B's conditional GET must NOT 304 -- stale-read-validator per writer category *(hazard pinned per the suite's existing convention: `read-budget.test.ts` drives `editReleaseDate` through the real seam and asserts BOTH users' versions rotate; the version⇒ETag/304 chain is pinned by the existing 8.6c route test)*
- [x] `web/shelf/api.ts` + `web/shelf/useTrackingMutations.ts` -- `editReleaseDate` fetcher + `saveReleaseDate` mutation mirroring `saveDates` (race guard, toast, invalidate) -- existing seam
- [x] `web/shelf/DetailPanel.tsx` -- "Release date" row first in Dates section reusing the `DateRow` markup/blur-commit (generalize minimally) -- native `<input type="date">`, no new widget (WCAG: plain label+input, no ARIA pattern needed) *(`DateRow` field prop generalized to an `onCommit(next)` callback)*
- [x] `web/shelf/Card.tsx` -- replace `SOON` label with formatted date: `D MMM` same-year, `D MMM YYYY` otherwise (string-sliced helper beside/like `formatLeavingDate`); `TBA` branch unchanged; keep sr-only description carrying full ISO date *(`formatReleaseDate` lives in `leaving.ts` beside its sibling, reusing the month table)*
- [x] `web/shelf/Card.test.tsx` + `web/shelf/DetailPanel.test.tsx` -- pill date/TBA/released cases; release-date row renders, blur-commits, clears -- pin the new UI logic
- [x] `playwright/e2e/` + `playwright/COVERAGE.md` -- one e2e: open detail, edit release date to a future date, assert card pill shows the formatted date; update the release-flag coverage row -- e2e-coverage rule (UI flow AC ships with e2e in same story) *(new `release-date.spec.ts` + a spec section in COVERAGE.md)*

**Acceptance Criteria:**
- Given an unreleased game with a release date, when the shelf renders, then its card shows the formatted date pill (never the word SOON) and a dateless game still shows TBA.
- Given the detail panel open, when the user sets/edits/clears the release date and blurs, then the value persists (visible after reload) and derived state (pill, Playable-now) updates on refetch.
- Given user A edits a game's release date, when user B re-requests their shelf with their prior ETag, then B receives fresh data, not a 304.

## Verification

**Commands:**
- `bun run lint && bun run typecheck` -- expected: clean
- `bun run test` -- expected: all vitest projects green incl. new unit+integration tests
- `bun run test:e2e` -- expected: green incl. new spec

External surface: none — no third-party service touched (anonymous internal CRUD only; no risk flag needed).

## Suggested Review Order

**Shared-fact write path (the design decision)**

- Service: tracking-scoped 404, then write, then bump-ALL — the stale-read rule made concrete
  [`services/games.ts:554`](../../src/services/games.ts#L554)
- New PATCH route: single required key, shared `isoCalendarDate` refine, 400/404 per matrix
  [`routes/games.ts:241`](../../src/routes/games.ts#L241)
- Repo: plain shared-`game` update — existence/scope live in the service
  [`repositories/games.ts:230`](../../src/repositories/games.ts#L230)

**Card pill**

- SOON replaced by the formatted date; TBA branch untouched
  [`Card.tsx:83`](../../web/shelf/Card.tsx#L83)
- Formatter delegates to `formatLeavingDate`, appends the year only when ≠ current UTC year
  [`leaving.ts:44`](../../web/shelf/leaving.ts#L44)

**Detail panel edit**

- Release date row first in Dates; `DateRow` generalized to `onCommit(next)`
  [`DetailPanel.tsx:442`](../../web/shelf/DetailPanel.tsx#L442)
- Review patch: `validity.badInput` guard — a half-typed date must not commit null
  [`DetailPanel.tsx:58`](../../web/shelf/DetailPanel.tsx#L58)
- Mutation mirrors `saveDates` (race guard, toast, invalidate)
  [`useTrackingMutations.ts:435`](../../web/shelf/useTrackingMutations.ts#L435)
- Client fetcher for the new endpoint
  [`api.ts:260`](../../web/shelf/api.ts#L260)

**Tests (hazards first)**

- Stale-read hazard: editReleaseDate driven through the real seam, BOTH users' versions rotate
  [`read-budget.test.ts:288`](../../test/integration/read-budget.test.ts#L288)
- Route matrix: set / null-clears / 400s / 404s (unknown + untracked)
  [`games.test.ts:1148`](../../test/integration/games.test.ts#L1148)
- E2E: date pill (never SOON) → detail edit → pill re-bakes → survives reload
  [`release-date.spec.ts:12`](../../playwright/e2e/release-date.spec.ts#L12)
- Unit: pill branches, formatter fallback, blur-commit/null-clear wiring
  [`Card.test.tsx:256`](../../web/shelf/Card.test.tsx#L256), [`leaving.test.ts:4`](../../web/shelf/leaving.test.ts#L4), [`DetailPanel.test.tsx:938`](../../web/shelf/DetailPanel.test.tsx#L938)
- Coverage ledger section for the spec
  [`COVERAGE.md:443`](../../playwright/COVERAGE.md#L443)
