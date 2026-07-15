---
title: 'Epic 7 follow-up — the genre sweep''s "do it now" client loop'
type: 'bugfix'
created: '2026-07-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a34c19dfeedc0bb1620eb8b8299c63c540874356'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ps_plus_catalog_genre` fills only when the monthly cron converges the chunked sweep (7 fires a month, ~5 chunks), so after a fresh "Check PS+ Extra" the genre filter offers nothing for days — and in local dev, forever. Story 7.1 designed the chunk endpoint for exactly this ("the HTTP endpoint stays for 7.2's client loop and for 'do it now'"), but 7.2 shipped only the read endpoints; the loop was never built.

**Approach:** A client-side loop in the SPA: after a successful PS+ check, re-POST `/api/ps-plus-catalog/genres` with the check's `generation`, then each chunk's `nextCursor` + `lockToken`, until the cursor comes back null — then refetch the genre vocabulary. Fire-and-forget from both check call-sites (FAB and the catalog's EMPTY CATALOG button). The cron remains the convergence backstop.

## Boundaries & Constraints

**Always:**
- Follow the chunk endpoint's documented contract exactly: first chunk carries only `generation` (the lock is claimed server-side); every continuation presents the previous chunk's `cursor` AND `lockToken` (the token is the capability — dropping it lets the loop steamroll a running refresh).
- The sweep must not block or fail the check's own UX: the check readout/modal shows immediately; the sweep runs in the background and invalidates `catalog-genres` + `catalog` queries when it lands.
- A sweep failure is NOT a check failure (AD-28 posture): log it and stop — the server persisted the cursor per chunk, so the cron re-drives the remainder.
- Bound the loop with a hard iteration cap far above the ~5 chunks a 20-key region needs — a server bug must never turn the client into an infinite poster.
- Anonymous-surface only: the sweep endpoint is part of the PS+ catalog surface that survives Epic 11 (sprint-change-proposal-2026-07-15) — no credentialed coupling may be added.
- Zod-parse the chunk response at the client boundary (AR-26).

**Ask First:**
- Any change to the server endpoint's contract or lock protocol.

**Never:**
- No stale-generation restart logic in v1 — on any 409 the loop stops and the cron converges it.
- No progress UI for the sweep — the chips appearing (with counts) IS the signal.
- No server-side "run the sweep inside the check" — the 50-subrequest budget forbids it (Epic 7 review, H3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Check succeeds with `generation`; 20-key region | Loop walks ~5 chunks, carrying cursor+token; on null cursor, genre queries refetch and chips appear with counts | N/A |
| Check succeeds, no `generation` in response | Older/edge server reply | Loop still runs (generation param omitted); server validates against its own state | N/A |
| Refresh lands mid-loop | Server answers 409 `stale-generation` | Loop stops; console warning; cron converges later | Logged, never toasted |
| Another PSN op holds the lock | First chunk answers 409 busy | Same: stop + log; cron converges | Logged |
| Server never terminates the cursor | `nextCursor` always non-null | Loop gives up at the iteration cap with an error | Logged via the same catch |
| Check fails | `onError` path | No sweep is started at all | Existing check error toast |

</frozen-after-approval>

## Code Map

- `web/catalog/api.ts` -- client contract for the catalog; gains `sweepCatalogGenres` (the loop) + `startGenreSweep` (fire-and-forget wrapper that invalidates on completion). `callApi` from `web/shelf/api.ts` already carries status+body on errors.
- `web/catalog/Catalog.tsx` -- the EMPTY CATALOG state's own check button (`check` mutation `onSuccess`) — start the sweep there.
- `web/shell/Fab.tsx` -- the FAB's "Check PS+ Extra" (`check` mutation `onSuccess`) — same, plus invalidate `catalog` (it didn't before, though the check rewrites the snapshot).
- `src/routes/psplus.ts` -- the chunk endpoint (`POST /ps-plus-catalog/genres`): cursor/generation/lockToken query params, token rides back only while the loop continues. READ-ONLY reference — contract unchanged.
- `web/settings/api.ts` -- `psPlusCheckResultSchema` already carries the optional `generation` the loop presents back. No change expected.
- `vitest.config.ts` -- the `web` project's include is `web/**/*.test.tsx` only; plain `.ts` tests under `web/` (the new loop test AND the pre-existing `web/shelf/filters.test.ts`) silently never run. Widen to `{ts,tsx}`.

## Tasks & Acceptance

**Execution:**
- [x] `web/catalog/api.ts` -- Add the Zod-parsed chunk schema (`nextCursor`, optional `lockToken`), `sweepCatalogGenres(generation?)` (the bounded loop), and `startGenreSweep(queryClient, generation?)` (void wrapper: invalidate `catalog-genres` + `catalog` on success, `console.warn` on failure). -- The loop 7.1 designed for and 7.2 owed.
- [x] `web/catalog/Catalog.tsx` -- In `check.onSuccess`, call `startGenreSweep(queryClient, result.generation)`. -- The EMPTY CATALOG way-out must also produce genres.
- [x] `web/shell/Fab.tsx` -- Same wiring in its `check.onSuccess`; also invalidate `['catalog']` there. -- Both check surfaces behave identically.
- [x] `web/catalog/api.test.ts` -- Unit tests: the loop walks the cursor chain carrying generation + the previous chunk's token (first chunk token-less), stops on null, and gives up at the cap instead of looping forever. -- HAZARD-TEST RULE: the token hand-off is the lock protocol.
- [x] `vitest.config.ts` -- `include: ['web/**/*.test.{ts,tsx}']` for the `web` project. -- Without it the new test (and `filters.test.ts`) never run — a silent coverage hole.
- [x] `playwright/COVERAGE.md` -- Row stating the live sweep loop is not e2e-able (live PS-store fan-out) and where the unit coverage lives. -- Honest coverage ledger.

**Acceptance Criteria:**
- Given a fresh PS+ check from either the FAB or the catalog's empty state, when the check succeeds, then the sweep loop runs to completion in the background and the genre chips (with counts) appear without a reload.
- Given the sweep fails on any chunk (409 busy, stale-generation, 5xx), when the loop stops, then the check's own result UX is unaffected and nothing is toasted — the cursor persisted server-side lets the cron converge.
- Given `web/shelf/filters.test.ts`, when `vitest run` executes the `web` project, then it actually runs.

## Spec Change Log

## Review Triage Log

### 2026-07-15 - Review pass 1 (Blind Hunter + Edge Case Hunter, parallel, no shared context)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (medium 2, low 2)
- defer: 0
- reject: 8 (spec-sanctioned postures: no stale-generation restart, silent 409-busy, log-not-toast failures; plus noise)
- addressed_findings:
  - [medium] [patch] #1 ABANDONED LOCK (both reviewers): a client-side failure mid-loop (network, parse, the 25-chunk cap) threw while holding a live `lockToken` — every other PSN op then 409'd for the whole 2-minute TTL. The loop now releases the token (`?release=1`) in its catch before rethrowing; a server-side failure already released, so the extra release is a no-op. Pinned by two tests (mid-sweep death + the cap).
  - [medium] [patch] #2 FAB/CATALOG DRIFT: the FAB's check success invalidated `['catalog']` but not `['catalog-genres']`, so a check whose SWEEP then failed left stale genre chips only on the FAB path (the check's prune cascades genre rows). Both call sites now invalidate both keys immediately, sweep outcome regardless.
  - [low] [patch] #3 FENCE HARDENING: when the check response carried no `generation`, every chunk posted without one and the server's torn-sweep fence never armed. The loop now adopts the generation from the first chunk's response (the chunk schema requires it). Pinned.
  - [low] [patch] #4 TEST GAPS: the suite never asserted POST (a GET regression would hit the facet-vocabulary READ on the same path), and `startGenreSweep` (invalidate-on-success, swallow-on-failure) had zero tests. Both pinned now.

## Design Notes

Head-start: an unreviewed working-tree implementation of exactly this already exists (kept by user decision). Step-03 starts from it and hardens rather than rewriting. The loop lives in the SPA (not the Worker) because the 50-subrequest budget caps a single invocation at roughly one chunk (H3) — N sequential browser requests sidestep that entirely, and the endpoint was built for precisely this caller.

## Verification

**Commands:**
- `bun run lint` -- Biome clean.
- `bun run typecheck` -- `tsc -b` clean.
- `bun run test` -- green, including `web/catalog/api.test.ts` AND `web/shelf/filters.test.ts` now actually executing.

## Suggested Review Order

**The loop — the lock protocol on the client**

- Entry point: the bounded chunk loop; generation → cursor+token hand-off is the whole contract.
  [`api.ts:103`](../../web/catalog/api.ts#L103)

- Review #1: an abandoned loop hands its token back or every PSN op 409s for the TTL.
  [`api.ts:136`](../../web/catalog/api.ts#L136)

- Review #3: fence self-arms — generation adopted from the first chunk when the check had none.
  [`api.ts:124`](../../web/catalog/api.ts#L124)

- Fire-and-forget wrapper: sweep never blocks the check UX; invalidates on success, warns on failure.
  [`api.ts:153`](../../web/catalog/api.ts#L153)

**Wiring — both check surfaces**

- FAB check success: now invalidates both catalog keys immediately (review #2), then starts the sweep.
  [`Fab.tsx:98`](../../web/shell/Fab.tsx#L98)

- Catalog's EMPTY CATALOG check button: identical wiring.
  [`Catalog.tsx:98`](../../web/catalog/Catalog.tsx#L98)

**Peripherals**

- The protocol pinned: cursor chain, token hand-off, release-on-abort, cap, invalidate/swallow.
  [`api.test.ts:33`](../../web/catalog/api.test.ts#L33)

- The silent coverage hole: `.ts` tests under `web/` never ran in any project.
  [`vitest.config.ts:72`](../../vitest.config.ts#L72)

- Honest ledger: why the live sweep is not e2e-able and where the coverage lives.
  [`COVERAGE.md:313`](../../playwright/COVERAGE.md#L313)
