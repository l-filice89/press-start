---
title: 'Playwright framework & auth smoke test (story 2.5.1 gap closure)'
type: 'feature'
created: '2026-07-10'
status: 'in-review'
baseline_revision: 'dae7d7fc54b4097443ba9fe587c6dd5c9971cd32'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** Commit `dae7d7f` landed the Playwright foundation (real Worker + local D1 via `vite dev`, console-captured magic link, CI e2e job) but three story-2.5.1 ACs remain open: no deterministic seeded baseline fixture resettable between runs (AC3), the CI e2e job is not a required merge gate (AC4), and no test drives the magic-link sign-in through the browser UI — sign-in is a setup-time API bootstrap (AC5).

**Approach:** Add a reset-and-seed step to global-setup so every run starts from a wiped, deterministically seeded e2e D1; add one UI-journey spec (open app → request link → follow console-captured link in the browser → shelf shows seeded games); make the e2e job a merge prerequisite in the workflow itself; document all of it in the playwright README.

## Boundaries & Constraints

**Always:** Keep `test:e2e` as the single documented command locally and in CI. No test path may ever send a real email (`RESEND_API_KEY` stays absent from `.dev.vars.e2e`). Seed via the shared Drizzle schema/migrations — never hand-written parallel DDL. E2e D1 stays local under `.wrangler`, never committed. Existing smoke specs keep passing.

**Block If:** GitHub branch-protection settings must be changed via repo admin UI/API and the change cannot be expressed in-repo (workflow-level gating insufficient) — HALT and name the manual step. The console magic-link emitter format changes and breaks capture with no in-repo fix.

**Never:** Do not replace the storage-state pre-auth pattern for ordinary specs (the UI journey is one dedicated spec, not the default path). Do not add new test frameworks or e2e dependencies beyond what's installed. Do not touch deploy jobs or Epic 1/2 app code beyond what the fixture/journey strictly needs. Backfill tests for Epic 1/2 flows are stories 2.5.2/2.5.3, not this one.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh clone run | `bun install` + `bun run test:e2e` | D1 reset, migrated, seeded; suite green | Setup fails loud with actionable message |
| Second consecutive run | e2e D1 already populated from prior run | Reset wipes prior state; identical seeded baseline; suite green | — |
| UI magic-link journey | Unauthenticated browser context | Sign-in page → link requested → captured URL visited in page → shelf renders seeded titles | Test fails if link not captured within timeout |
| Stale server/port from crashed run | Port 5175 occupied | Setup detects and fails with clear message (or reuses per existing pid handling) | No silent hang |

</intent-contract>

## Code Map

- `playwright/support/global-setup.ts` -- spawns vite dev, applies migrations, API-bootstraps auth, saves storage state; add DB reset + baseline seed here
- `playwright/support/helpers/d1.ts` -- `seedGame`/`deleteGame` D1 helpers; extend with reset/seed-baseline helpers
- `playwright/support/factories/game-factory.ts` -- game row factory; reuse for deterministic baseline rows
- `playwright/e2e/smoke.spec.ts` -- existing framework smoke (pre-authenticated); stays
- `playwright/e2e/` -- new `auth-journey.spec.ts` lives here, running WITHOUT pre-auth storage state
- `playwright.config.ts` -- storage-state default; may need a project/spec-level override for the unauthenticated journey spec
- `src/providers/email.ts` -- console provider emits `[auth] magic link for <to>: <url>`; capture source for the journey spec (server stdout)
- `playwright/support/server.ts` -- port/baseURL/pid constants
- `.github/workflows/ci.yml` -- e2e job runs parallel to quality-gate; wire gating so red e2e blocks merge/deploy
- `playwright/README.md` -- document reset/seed model + journey spec
- `wrangler.jsonc` -- e2e env D1 binding (database_id `00000000-e2e0-…`)

## Tasks & Acceptance

**Execution:**
- [x] `playwright/support/helpers/d1.ts` -- add `resetDb()` (wipe app + auth tables or delete the local sqlite file before migrate) and `seedBaseline()` inserting a small fixed set of games with stable titles -- deterministic, resettable fixture (AC3)
- [x] `playwright/support/global-setup.ts` -- call reset before migrations/seed so every run starts identical; keep auth bootstrap after seed -- run-to-run determinism (AC3)
- [x] `playwright/e2e/auth-journey.spec.ts` -- new spec with empty storage state: open app → assert login gate → request magic link → capture URL from server output → `page.goto(url)` → assert shelf renders baseline seeded game titles -- proves full user path in the browser (AC5)
- [x] `playwright.config.ts` -- ensure the journey spec runs unauthenticated (project split or per-spec `test.use({ storageState: ... })`) -- journey must start logged-out (done via `test.use` in the spec; config unchanged)
- [x] `.github/workflows/ci.yml` -- make e2e a prerequisite for merge-blocking success (e.g. deploy `needs: [quality-gate, e2e]` and/or a summary gate job); note branch-protection manual step if still required -- red e2e must block (AC4) (added `ci-ok` gate job; branch protection pointing at "CI OK" is a one-time manual repo-admin step)
- [x] `playwright/README.md` -- document baseline fixture, reset semantics, journey spec, CI gating -- fresh-clone contract (AC1)

**Acceptance Criteria:**
- Given a fresh clone, when `bun run test:e2e` runs, then the e2e D1 is reset, migrated, and seeded with the deterministic baseline before any spec executes, and the suite passes
- Given two consecutive local runs, when the second runs, then it sees the identical baseline state (no accumulation from run one)
- Given an unauthenticated browser, when the auth-journey spec runs, then it signs in by following the console-captured magic link inside the browser and the shelf shows baseline seeded games — with no real email sent
- Given a PR with a failing Playwright suite, when CI completes, then the pipeline's gating job fails so the PR cannot merge green
- Given the existing smoke specs, when the suite runs, then they still pass unchanged

## Spec Change Log

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 1, medium 4, low 3)
- defer: 1: (medium 1)
- reject: 6
- addressed_findings:
  - `[high]` `[patch]` Burn-in (--repeat-each 5, fullyParallel) would let concurrent auth-journey repeats consume each other's single-use magic links — added `--workers 1` to the burn-in command; verified 10/10 locally
  - `[medium]` `[patch]` `resetDb()` hardcoded the table list (future migrations silently escape the wipe) — now derives tables from `sqlite_master` with `PRAGMA defer_foreign_keys`
  - `[medium]` `[patch]` `d1Query` parsed from first `[` (breaks on wrangler log noise / missing JSON) — anchored on `[{` payload opener, throws with raw output when absent
  - `[medium]` `[patch]` `ci-ok` hand-maintained job loop could silently un-gate a job added to `needs` — loop now iterates all `needs` keys; skipped allowed only for e2e-burn-in
  - `[medium]` `[patch]` push+PR dual triggers produced two competing "CI OK" check runs on a PR head SHA (push run skips burn-in) — push trigger scoped to `main`
  - `[low]` `[patch]` residue hazard test was near-tautological (PK crash on games masks accumulation) — added user-count assertion (exactly 1)
  - `[low]` `[patch]` magic-link regex duplicated between setup and spec, and unanchored against stdout chunk truncation — shared `MAGIC_LINK_RE` in server.ts with trailing-newline guard
  - `[low]` `[patch]` poll result discarded then recomputed with `as string` cast — poll now captures the link
- deferred:
  - `[medium]` burn-in interpolates git-diff-derived spec filenames into a shell command (pre-existing from dae7d7f) — logged to deferred-work.md

## Design Notes

Hazard-test note (Epic 1 retro rule): AC3 names determinism/resettability and AC5 names the no-real-email invariant — the second-run determinism check and the journey spec's console-capture path are the hazard tests; both must exist as explicit assertions, not incidental passes. `.dev.vars.e2e` omitting `RESEND_API_KEY` is the email guard; keep an assertion or comment-pinned check that the provider selected is the console one (server log line presence doubles as this proof).

Reset strategy: simplest deterministic reset is deleting the e2e D1 sqlite state dir under `.wrangler` before applying migrations (README already documents this as the manual reset); prefer that over per-table DELETEs — fewer moving parts, immune to schema drift.

## Verification

**Commands:**
- `bun run test:e2e` -- expected: full suite green, including new auth-journey spec; run twice back-to-back to prove reset determinism
- `bun run lint && bun run typecheck` -- expected: clean (Biome + tsc, including tsconfig.e2e.json surface)
- `bun run test` -- expected: existing Vitest tiers unaffected

**Manual checks (if no CLI):**
- Inspect CI workflow graph: e2e failure must fail the merge-gating path; if branch protection is still needed, the run result documents the exact manual step for Luca

## Auto Run Result

**Summary:** Closed the three open story-2.5.1 ACs on top of the dae7d7f foundation: deterministic reset+seed of the e2e D1 every run (AC3), a browser-driven magic-link sign-in journey spec (AC5), and a single `CI OK` merge-gate job funnelling quality-gate + e2e + burn-in (AC4). Review pass hardened the reset (schema-derived table list), the wrangler JSON parsing, the CI gate loop, and serialized burn-in to prevent magic-link cross-consumption.

**Files changed:**
- `playwright/support/helpers/d1.ts` — `resetDb()` (sqlite_master-derived wipe), `d1Query()`, `BASELINE_GAMES` + `seedBaseline()`
- `playwright/support/global-setup.ts` — reset after migrations, stdout mirrored to `.server.log`, baseline seeded after auth bootstrap
- `playwright/support/server.ts` — `SERVER_LOG` + shared `MAGIC_LINK_RE`
- `playwright/e2e/auth-journey.spec.ts` — NEW: unauthenticated UI journey (login gate → request link → follow captured link → baseline shelf) + residue hazard test
- `.github/workflows/ci.yml` — `ci-ok` gate job (dynamic needs loop), push trigger scoped to main, burn-in `--workers 1`
- `playwright/README.md` — baseline fixture, journey exception, CI OK gating docs

**Review findings:** 8 patched (1 high, 4 medium, 3 low), 1 deferred (burn-in shell interpolation, pre-existing), 6 rejected. No intent gaps, no spec loopbacks.

**Verification:** `bun run test:e2e` green twice consecutively (determinism proof); burn-in simulation `--repeat-each 5 --retries 0 --workers 1` 10/10; `bun run test` 494 passed; Biome + tsc clean.

**Residual risks / manual step for Luca:** branch protection on `main` must be set once (repo admin → require the "CI OK" check) — workflow-level gating is in place but GitHub cannot express required checks in-repo. Burn-in filename interpolation logged in deferred-work.md.
