---
title: 'Story 10.4: Leaving PS+ soon — the "Last Chance to Play" category (VR-6 rework)'
type: 'feature'
created: '2026-07-16'
status: 'blocked'
review_loop_iteration: 0
baseline_revision: 'b2c6baeb6123582d78dde09bf8c3e799ee2fceac'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
warnings: ['multiple-goals']
---

<intent-contract>

## Intent

**Problem:** 10.2's LEFT PS+ stamp warns AFTER a game is gone — Luca judged it low-value; he wants the warning while playing or buying is still possible.

**Approach:** Sony's store exposes a "Last Chance to Play" category on the SAME anonymous `categoryGridRetrieve` endpoint the catalog sync already calls (different category id). Probe the id for the configured region first (HALT if absent). Then the existing PS+ pass also fetches that grid and sets a `ps_plus_leaving_soon` flag on matching tracked games (title-key match, both directions set/clear). The LEAVING PS+ warning pill replaces the LEFT PS+ pill; `ps_plus_left_on` survives as a quiet internal fact (its stamp/clear logic is untouched — only the render dies).

## EXTERNAL-RISK-FLAG (mandatory, Epic 11 rule)

Anonymous surface, no account identity: same public, credential-free `categoryGridRetrieve` endpoint the catalog sync already uses, different category id. Nothing new on the wire. Posture unchanged (per epic AC).

## Boundaries & Constraints

**Always:**
- FIRST task: live probe discovers the "Last Chance to Play" category id for the configured region (`getPsnRegion`), verifies it answers a plausible grid, records artifact `psn-last-chance-probe-2026-07-16.md` + a captured fixture page (PROBE-BEFORE-YOU-MAP; hazard fixtures are captured, never hand-written).
- The leaving flag derives ONLY from title-key membership in the last-chance grid (`normalizeTitle`, same join as the PS+ flag pass) — set AND clear each pass, no fuzzy matching, no read-time joins.
- Flag stored for ALL tracked games (AD-27 pattern, includeDiscarded); display gated `!owned` (FR-38) exactly like the PS+ pill.
- The fetch rides `runPsPlusCheck`'s membership pass (cron + "Check PS+ Extra" button — the button is the manual retry path); budget ledger at `src/services/psplus.ts:87-110` updated with honest arithmetic (grid ≈1 page + chunked flag write).
- Degenerate rules: a `PsnStoreRejectionError` or fetch failure on the last-chance grid fails closed — leaving flags untouched, `psplus_refresh_failed` set (one banner, 10.3 precedent: already-written membership results stand). A structurally VALID grid with zero products is legitimate emptiness (nothing leaving) and clears flags — unlike the main catalog, empty is a plausible state here; the main catalog's wipe guard still aborts everything before any write.
- `ps_plus_left_on` stamping/clearing stays exactly as shipped (atomic in `setPsPlusExtraFlags`); only the pill, its client DTO field, and its tests/coverage rows are removed/replaced.
- Warning pill: warn-amber family (reuse `--ps-left` styling), visually distinct from the accent `--ps-extra` pill, number-free label + sr-only text; a leaving game legitimately shows BOTH the PS+ pill and the warning (it is still in the catalog — that is the point).

**Block If:**
- Probe finds no "Last Chance to Play" category for the configured region, or the grid is implausible (wrong category shape/size) → HALT `blocked` for Luca's decision (epic AC).

**Never:** a second cron or new external surface; credentialed calls; persisting the last-chance grid as a browsable table (flags on `game` only); predictive departure dates; dropping or renaming the `ps_plus_left_on` column.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Game enters last-chance | tracked, non-owned, title in grid | flag set; card shows LEAVING warning beside the PS+ pill | none |
| Reprieve / departure | flagged game absent from next grid | flag cleared (departure additionally stamps `ps_plus_left_on` via the untouched 10.2 pass — no pill) | none |
| Owned game in grid | owned, title in grid | flag stored, NO warning rendered (FR-38 display gate) | none |
| Empty last-chance grid | valid shape, 0 products | legitimate: all leaving flags cleared, run succeeds | none |
| Grid fetch fails/rejected | rejection error or HTTP failure mid-pass | flags untouched, refresh marked failed; membership results already written stand | FR-40 banner |
| Main catalog degenerate | wipe guard fires | aborts BEFORE any write incl. leaving pass — flags survive | existing banner |

</intent-contract>

## Code Map

- `scripts/probe-psn-last-chance.ts` -- FIRST task: discover/verify the category id for the configured region, write artifact + captured fixture
- `src/providers/psn.ts` -- new `PS_PLUS_LAST_CHANCE_CATEGORY` constant; thread a category param through `catalogPageUrl`/`walkCatalog`; new `fetchPsPlusLastChanceCatalog(region)` on `PsnProvider` (same guards/rejection error)
- `src/schema/catalog.ts` + `migrations/0015_*.sql` -- `ps_plus_leaving_soon` integer boolean on `game`, default 0
- `src/repositories/games.ts` -- `setPsPlusLeavingSoon(db, setIds, clearIds)` chunked batch beside `setPsPlusExtraFlags` (:218); column in `LibraryRow` + selects
- `src/services/psplus.ts` -- leaving pass inside `runPsPlusCheck` after the flag pass (fetch grid → title-key set → set/clear); fail-closed wrap; ledger comment update
- DTO chain (`src/services/shelf.ts`, `src/routes/shelf.ts`, `web/shelf/api.ts`) -- add `psPlusLeavingSoon` (client default false for deploy skew); REMOVE `psPlusLeftOn` (nothing renders it)
- `web/shelf/Card.tsx` + `card.css` -- replace `card__flag--ps-left` with `card__flag--leaving` ("LEAVING PS+"), gated `psPlusLeavingSoon && !owned`
- tests: `src/providers/psn.test.ts` (captured fixture + query-body category id), `test/integration/psplus-leaving.test.ts` (set/clear both directions, empty-grid clears, rejection keeps flags, owned stored-not-shown), rework `psplus-departure.test.ts` expectations (stamp logic unchanged, DTO gone), Card jsdom gating, `playwright/e2e/epic10-leaving-soon.spec.ts` replacing `epic10-left-psplus.spec.ts`, `playwright/COVERAGE.md` row updates (10.2's "ships as left" note is inverted by this story)
- `_bmad-output/implementation-artifacts/deferred-work.md` -- resolve 10.2's "warning never expires" entry (pill deleted; internal fact only)

## Tasks & Acceptance

**Execution:**
- [x] `scripts/probe-psn-last-chance.ts` -- live probe: category id, plausible grid for configured region; write artifact + `test/fixtures/psn/` captured page; apply Block-If gate -- **GATE FAILED, run HALTed here**
- [ ] `migrations/0015_*.sql` + `src/schema/catalog.ts` -- `ps_plus_leaving_soon` boolean
- [ ] `src/providers/psn.ts` -- category param + `fetchPsPlusLastChanceCatalog` (shared walk/guards/rejection)
- [ ] `src/repositories/games.ts` -- `setPsPlusLeavingSoon` + row plumbing
- [ ] `src/services/psplus.ts` -- leaving pass (fail-closed, empty-grid-legit), ledger arithmetic
- [ ] DTO chain -- `psPlusLeavingSoon` in, `psPlusLeftOn` out
- [ ] `web/shelf/Card.tsx` + `card.css` -- LEAVING PS+ pill replaces LEFT PS+
- [ ] tests -- provider fixture/query-body; integration set/clear + empty-grid + rejection + owned hazards; departure-suite rework; jsdom gating; Playwright replacement spec; COVERAGE.md rows
- [ ] `deferred-work.md` -- resolve the 10.2 staleness entry

**Acceptance Criteria:**
- Given the probe has run, when the story proceeds, then the category id + grid plausibility for the configured region are recorded in the artifact (or the run HALTed blocked).
- Given the monthly pass (or the Check PS+ Extra button), when it runs, then tracked games in the last-chance grid are flagged and the warning shows while the game is STILL in the catalog, with the budget ledger updated honestly.
- Given the shipped `ps_plus_left_on` stamp, when this story lands, then it persists/clears exactly as before but renders nowhere — the LEFT PS+ pill is gone, replaced by the leaving-soon warning.
- Given an owned game in the last-chance grid, when it renders, then no warning appears (FR-38) while the stored fact remains.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `bun run typecheck && bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. new leaving-pass hazard tests
- `bunx playwright test epic10` -- expected: green (replacement spec included)
- `bun scripts/probe-psn-last-chance.ts` -- expected: artifact + fixture written, gate PASS

## Auto Run Result

- **Outcome:** blocked at the FIRST task's gate (probe). No product code written; the probe script + artifact are the whole diff.
- **Blocking condition:** "Last Chance to Play" category id is not discoverable on the anonymous web surface for any region — the store's subscriptions hub (signed out) carries no PS+ catalog collections at all, no public API wrapper enumerates the category, no blog/tracker/search result links it, and the one op that could enumerate console-hub strands rides the credentialed mobile API (off-limits, Epic 11 posture). Full evidence + decision options (supply the uuid from console/PS App Share-link → `--id` verification path; or drop the story): `psn-last-chance-probe-2026-07-16.md`.
- **Note:** the grid ENDPOINT answers anonymously for any category id — the fetch design in this spec stays valid the moment Luca supplies the id.
