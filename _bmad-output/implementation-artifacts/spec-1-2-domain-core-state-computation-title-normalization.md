---
title: 'Domain core — state computation & title normalization'
type: 'feature'
created: '2026-07-06'
status: 'done'
baseline_revision: '96ea482d7a5978a210a78d8a210e4105b643b91a'
final_revision: '40f1764e41393fde4457d563afee8fe8282ab2a5'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md', '{project-root}/.bmad-loop/policy.toml']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Every later surface (shelf ordering, card labels, filters, seed import, sync) needs to compute a game's effective state, its derived flags, and a stable cross-source title key identically — but no such logic exists yet, only the `src/core/` placeholder from Story 1.1.

**Approach:** Implement four pure, I/O-free `core/` functions — effective-state (AD-7), derived-state (AD-8), title normalization (AD-9), and the completion-invariant predicate (AD-12/FR-3) — each the single implementation every future consumer calls, unit-tested with no network or database (AR-3).

## Boundaries & Constraints

**Always:**
- All new code lives under `src/core/` and stays I/O-free: no `drizzle-orm`, `repositories/`, `providers/` imports, no global `fetch`, no D1 binding — enforced by the existing `purity.test.ts` guard, which must keep passing unmodified.
- Effective state, derived states, and the title normalizer are each exactly one function; no other module recomputes this logic (AD-7/8/9).
- Types (`PlayStatus`, etc.) needed by these functions are defined in `core/` itself, not imported from a not-yet-existing schema (Story 1.4 builds `GAME`/`GAME_TRACKING`).
- Derived-state release comparisons use ISO (`YYYY-MM-DD`) date strings compared lexicographically, not `Date` arithmetic, to stay timezone-safe and pure.
- Every function and edge case in the I/O & Edge-Case Matrix below has a Vitest unit test.

**Block If:** (none — this story is self-contained pure functions with no external dependency or credential needs)

**Never:**
- Don't wire the completion invariant's *enforcement* into any API/route boundary — that's Epic 2 (AD-12 says enforcement lands at the edit boundary later; this story only builds the pure predicate).
- Don't build `GAME`/`GAME_TRACKING`/`GENRE`/`EXTERNAL_LINK` schema or repositories — that's Story 1.4.
- Don't fetch or hardcode PS+ Extra membership data — `inPsPlusExtraCatalog` is just a boolean input parameter here; real membership data arrives in Epic 5.
- Don't attempt an exhaustive real-world title dictionary — the normalizer's edition-suffix list is a curated, documented, extensible set; stragglers needing manual overrides are expected and out of scope here (per project-context.md).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Effective state — play status set | `playStatus: 'Playing'`, milestones null | `'Playing'` | No error expected |
| Effective state — platinum over completed | `playStatus: null`, `platinumOn: '2026-01-01'`, `completedOn: '2025-01-01'` | `'Platinum achieved'` | No error expected |
| Effective state — completed only | `playStatus: null`, `platinumOn: null`, `completedOn: '2025-01-01'` | `'Story completed'` | No error expected |
| Effective state — no status, no milestone (invariant-violating input) | all three null | `'Not started'` (defensive default; enforcement is Epic 2's job, not this function's) | No error expected |
| Derived — released today | `releaseDate` = today's ISO date | `released: true` | No error expected |
| Derived — released in future | `releaseDate` = tomorrow's ISO date | `released: false` | No error expected |
| Derived — TBA/missing release date | `releaseDate: null` | `released: false` | No error expected |
| Derived — wishlisted | `owned: false` | `wishlisted: true` | No error expected |
| Derived — playable now via ownership | `owned: true`, `inPsPlusExtraCatalog: false`, released | `playableNow: true` | No error expected |
| Derived — playable now via PS+ Extra only | `owned: false`, `inPsPlusExtraCatalog: true`, released | `playableNow: true` | No error expected |
| Derived — not playable, unreleased | `owned: true`, released: false | `playableNow: false` | No error expected |
| Normalize — trademark glyphs | `'HEAVY RAIN™'` | `'heavy rain'` | No error expected |
| Normalize — registered mark mid-title | `'Gran Turismo® 7'` | `'gran turismo 7'` | No error expected |
| Normalize — leading article | `'The Last of Us Part II'` | `'last of us part ii'` | No error expected |
| Normalize — edition suffix | `"Marvel's Spider-Man: Game of the Year Edition"` | `"marvel's spider-man"` | No error expected |
| Normalize — PS4/PS5 collapse | `'Ghost of Tsushima (PS4)'` and `'Ghost of Tsushima (PS5)'` | both → `'ghost of tsushima'` | No error expected |
| Normalize — whitespace fold | `'  Bloodborne   '` | `'bloodborne'` | No error expected |
| Completion invariant — violation | `playStatus: null, completedOn: null, platinumOn: null` | `true` (would violate) | No error expected |
| Completion invariant — safe (status set) | `playStatus: 'Dropped'`, milestones null | `false` | No error expected |
| Completion invariant — safe (milestone set) | `playStatus: null`, `completedOn: '2025-01-01'` | `false` | No error expected |

</intent-contract>

## Code Map

- `src/core/types.ts` -- shared domain types (`PlayStatus`, `EffectiveState`) used across the new core modules; no DB/schema import
- `src/core/effective-state.ts` + `.test.ts` -- AD-7: `computeEffectiveState`
- `src/core/derived-state.ts` + `.test.ts` -- AD-8: `computeDerivedStates` (released, wishlisted, playableNow)
- `src/core/title-normalizer.ts` + `.test.ts` -- AD-9: `normalizeTitle`
- `src/core/completion-invariant.ts` + `.test.ts` -- AD-12/FR-3: `wouldViolateCompletionInvariant`
- `src/core/index.ts` -- update barrel export to include the four new modules
- `src/core/status.ts`, `src/core/status.test.ts` -- Story 1.1's own placeholder ("this placeholder exists only to prove the core is unit-tested... Real domain logic lands in Story 1.2+"); remove now that real domain logic exists, since it's dead demo code with no other caller (confirmed: only its own test imports it)

## Tasks & Acceptance

**Execution:**
- [x] `src/core/types.ts` -- define `PlayStatus` union and `EffectiveState` type -- shared vocabulary for the functions below, kept in `core/` per AD-3
- [x] `src/core/effective-state.ts` -- `computeEffectiveState({ playStatus, completedOn, platinumOn })` -- single AD-7 implementation
- [x] `src/core/effective-state.test.ts` -- cover the four effective-state matrix rows
- [x] `src/core/derived-state.ts` -- `computeDerivedStates({ owned, releaseDate, inPsPlusExtraCatalog }, referenceDate?)` returning `{ released, wishlisted, playableNow }` -- single AD-8 implementation, ISO-string date comparison
- [x] `src/core/derived-state.test.ts` -- cover the seven derived-state matrix rows
- [x] `src/core/title-normalizer.ts` -- `normalizeTitle(rawTitle)` -- single AD-9 implementation (strip `™`/`®`/`©`, strip a curated edition-suffix list, strip PS4/PS5 platform tags, drop one leading article, case/whitespace-fold)
- [x] `src/core/title-normalizer.test.ts` -- cover the six normalization matrix rows, plus the PS4/PS5 pair producing an identical key
- [x] `src/core/completion-invariant.ts` -- `wouldViolateCompletionInvariant({ playStatus, completedOn, platinumOn })` -- single AD-12/FR-3 pure predicate, unenforced here (enforcement is Epic 2)
- [x] `src/core/completion-invariant.test.ts` -- cover the three invariant matrix rows
- [x] `src/core/index.ts` -- export the four new modules; drop the `./status` re-export once it's removed
- [x] Remove `src/core/status.ts` and `src/core/status.test.ts` -- superseded placeholder, no other caller

**Acceptance Criteria:**
- Given a game's play status and milestone dates, when effective state is computed, then a single function returns play status if set, else "Platinum achieved" if `platinum_on`, else "Story completed" if `completed_on` (FR-8, AR-7)
- Given ownership, release date, and PS+ Extra membership, when derived states are computed, then Released (real date ≤ today; TBA/missing = false), Wishlisted (= not owned), and Playable-now (= (owned OR in PS+ Extra) AND released) are returned and never persisted (FR-12, FR-13, FR-14, AR-8)
- Given raw titles with trademark glyphs, leading articles, edition suffixes, or case/whitespace variance, when normalized, then a single normalizer yields the shared match key and collapses PS4/PS5 to one PS5 key (FR-27, AR-9)
- Given a candidate status/milestone edit, when the invariant is checked, then a pure predicate reports whether it would leave neither a play status nor a milestone, with enforcement wired in Epic 2 (FR-3 predicate, AR-12)
- Given all core functions, when tests run, then they execute with no network or database and cover the rules above (AR-3), and the existing `src/core/purity.test.ts` guard still passes unmodified

## Spec Change Log

## Review Triage Log

### 2026-07-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10 (high 0, medium 2, low 8)
- defer: 0
- reject: 11
- addressed_findings:
  - `medium` `patch` Cross-source titles disagree on straight vs. curly/typographic apostrophes (e.g. Notion export vs. IGDB), so "Marvel's" and "Marvel's" (curly) would fail to normalize to the same key, defeating AD-9's whole purpose. Added apostrophe-variant folding (`'`/`'`/`ʼ`/`´`/`` ` ``  → `'`) early in `normalizeTitle`'s pipeline, plus a regression test.
  - `medium` `patch` `PLATFORM_TAG_PATTERN` only matched a single bare tag (`(PS4)`), not combined bundle tags like `(PS4 & PS5)`/`(PS4/PS5)` — exactly the storefront/Notion format most likely to need the PS4/PS5 collapse AD-9 exists for. Broadened the pattern to match one-or-more platform tokens joined by `,`/`&`/`/`/`and` inside one parenthetical, plus a regression test.
  - `low` `patch` `computeDerivedStates` compared `releaseDate !== null` (strict) while `computeEffectiveState`/`wouldViolateCompletionInvariant` use truthiness elsewhere in this story's code — an empty-string `releaseDate` would sort before any real date and be silently treated as released. Changed to a truthy check for consistency, plus a regression test.
  - `low` `patch` No test exercised `playStatus` set together with a milestone to confirm the play-status-wins precedence the AC's wording already mandates. Added a test to `effective-state.test.ts`.
  - `low` `patch` `completion-invariant.test.ts` proved "safe" for `playStatus`-set and `completedOn`-set individually but never `platinumOn` alone — one of the three fields the predicate is named after was unverified in isolation. Added a test.
  - `low` `patch` `playableNow`'s test coverage had no case for "not owned, not in PS+ Extra, released" (expect false) or "in PS+ Extra, not yet released" (expect false), leaving the formula's `&&`/`||` boundaries partially unverified. Added both tests to `derived-state.test.ts`.
  - `low` `patch` No `normalizeTitle` test combined more than one transformation at once, despite that being the realistic shape of messy multi-source input the function exists to handle; the five sequential regex passes were only ever tested in isolation. Added a combined-transformation test.
  - `low` `patch` `types.ts`'s doc comment claimed to be "shared vocabulary for the effective- and derived-state functions," but `derived-state.ts` doesn't import anything from it — it declares its own unrelated local interfaces. Corrected the comment to name only the two modules that actually use `PlayStatus`.
  - `low` `patch` The five new/renamed `src/core/` files were created with the executable bit set (`100755`), inconsistent with every other tracked file in the directory. `chmod 644`'d them (note: `core.fileMode=false` in this repo means git never actually recorded the bit either way, so this was a filesystem-only cleanup, not a committed-state fix).
  - `low` `patch` `computeDerivedStates`'s default `referenceDate = new Date()` path (the one a caller who omits the second argument actually hits) was completely untested — every existing test supplied an explicit reference date. Added a deterministic test (TBA release date, so the assertion doesn't depend on the real current date) exercising the default-argument branch.
  - `low` `reject` Non-`YYYY-MM-DD`-format `releaseDate` (e.g. a full timestamp) could misjudge same-day comparisons — out of scope: the function's documented contract is an ISO date-only string, matching the DB's future `DATE` column type; a caller violating that contract is a bug in that caller, not this pure function.
  - `low` `reject` An invalid `referenceDate` (`new Date(NaN)`) would throw inside `toISOString()` — not a real call path; the only production caller is the default `new Date()`, and any override is test-authored.
  - `low` `reject` `toIsoDate` uses UTC, which can diverge from a caller's local calendar day by a few hours near midnight — real but negligible for a single-user personal catalog where "released" being off by a few hours on release day has no practical consequence; no spec text pins "today" to a specific timezone to correct against.
  - `low` `reject` Stacked edition suffixes (e.g. "Foo: Game of the Year Edition - Deluxe Edition") only have the trailing phrase stripped — matches this story's own explicit "Never" scope: the suffix list is curated and non-exhaustive, and stragglers are expected to need manual overrides.
  - `low` `reject` `normalizeTitle` would throw a `TypeError` if handed `null`/`undefined` despite its `string` type — out of scope: Zod validation at the API/provider boundary (per architecture) guarantees a string reaches `core/` functions; trusting an already-validated internal contract.
  - `low` `reject` A title that is only a leading article plus an edition suffix (e.g. "A Definitive Edition") collapses to a near-empty key — contrived, matches the same explicit curated-list/stragglers "Never" scope as the stacked-suffix finding.
  - `low` `reject` An empty/whitespace-only `rawTitle` normalizes to `""`, colliding with other blank titles — can't happen given the domain invariant that every catalog game has a non-empty title.
  - `low` `reject` The curated edition-suffix list strips "remastered"/"remaster" but not "remake," with no stated rationale — non-issue: the list is explicitly documented as a curated, non-exhaustive set, not a policy requiring symmetric treatment of every reissue category.
  - `low` `reject` Stripping "remastered"/"remaster" risks merging two genuinely distinct games (e.g. a PS2 original vs. its PS4 remaster) into one `title_normalized` key — false alarm: AD-18 makes `title_normalized` an explicitly non-unique candidate key ("a normalized-title clash with a different external id is two games, not one"); `EXTERNAL_LINK` is the true identity, so this collision is by design, not a defect.
  - `low` `reject` `wishlisted = !owned` was questioned as an oversimplified definition — it is exactly AD-8's and this story's own AC's literal, explicit definition of Wishlisted, not an implementer choice.
  - `low` `reject` `computeEffectiveState`/`wouldViolateCompletionInvariant` use truthiness (`!playStatus`, etc.) rather than strict `=== null` checks, which would treat an empty string as equivalent to null — this is already the safe, conservative direction (treating unexpected empty-string input as "absent"), not a defect; superseded by the `derived-state.ts` consistency patch above, which brought the one genuinely inconsistent function in line with this same convention.

## Design Notes

- Effective-state's "no status, no milestone" input is an invariant violation this pure function can still receive (AD-12's enforcement is Epic 2's job, not this one's) — it falls back to `'Not started'`, matching the epic context's stated default rather than throwing, since `core/` has no business rejecting data it didn't validate.
- Title normalizer edition-suffix and platform-tag lists are illustrative, not exhaustive — e.g. strip phrases like "game of the year edition", "definitive edition", "director's cut", "remastered" (case-insensitive, typically after a `:`/`-` separator or at the end), and platform tags like `(PS4)`/`(PS5)`/`(PlayStation 4)`/`(PlayStation 5)`. Real stragglers get manual overrides later (project-context.md), so favor a small, clearly-documented list over guessing every real game title's suffix.
- `computeDerivedStates` takes an optional `referenceDate` (defaulting to `new Date()`) purely so tests can pin "today" deterministically; comparing `releaseDate <= referenceDateISO` as `YYYY-MM-DD` strings avoids timezone/DST bugs entirely.

## Verification

**Commands:**
- `bun run lint` -- expected: Biome passes, including the unmodified `src/core/**` `noRestrictedImports` override
- `bun run typecheck` -- expected: `tsc -b` passes
- `bun run test` -- expected: Vitest passes, including all new unit tests, the updated `src/core/purity.test.ts` guard (still finds only I/O-free files), and the full I/O & Edge-Case Matrix above

## Auto Run Result

Status: done

**Summary:** Story 1.2 implements four pure, I/O-free `core/` functions — `computeEffectiveState` (AD-7), `computeDerivedStates` (AD-8), `normalizeTitle` (AD-9), and `wouldViolateCompletionInvariant` (AD-12/FR-3) — each the single implementation every future surface (shelf ordering, filters, seed import, sync) will call. Story 1.1's `status.ts` placeholder, explicitly self-documented as superseded once real domain logic landed, was removed. A review pass (Blind Hunter + Edge Case Hunter) then found several real gaps in the title normalizer and test coverage, all fixed in this pass.

**Files changed with one-line descriptions:**
- `src/core/types.ts` — shared `PlayStatus`/`EffectiveState` types, used by `effective-state.ts` and `completion-invariant.ts`.
- `src/core/effective-state.ts` + `.test.ts` — `computeEffectiveState`: play status if set, else Platinum achieved, else Story completed, else `'Not started'` fallback for invariant-violating input.
- `src/core/derived-state.ts` + `.test.ts` — `computeDerivedStates`: released/wishlisted/playableNow via ISO-string date comparison; review pass changed the release-date null check to a truthy check for empty-string safety and consistency with the other two functions.
- `src/core/title-normalizer.ts` + `.test.ts` — `normalizeTitle`: strips trademark glyphs, a curated edition-suffix list, PS4/PS5 platform tags, and a leading article, then case/whitespace-folds; review pass added apostrophe-variant folding (curly vs. straight quotes) and broadened the platform-tag pattern to catch combined bundle tags like `(PS4 & PS5)`.
- `src/core/completion-invariant.ts` + `.test.ts` — `wouldViolateCompletionInvariant`: pure predicate, unenforced here (enforcement is Epic 2).
- `src/core/index.ts` — barrel-exports the four new modules; dropped the `./status` re-export.
- `src/core/status.ts`, `src/core/status.test.ts` — removed (Story 1.1's own placeholder, superseded, no other caller).

**Review findings breakdown:** 10 patch (severity: medium 2, low 8), 0 defer, 11 reject, 0 bad_spec, 0 intent_gap. Full detail in the Review Triage Log above. Headline fixes: cross-source titles using curly vs. straight apostrophes (e.g. Notion export vs. IGDB) would have failed to normalize to the same key, defeating AD-9's purpose — fixed with apostrophe-variant folding; and the platform-tag pattern only matched a single bare `(PS4)` tag, not the combined `(PS4 & PS5)` bundle format storefronts commonly use — broadened to match both. The remaining 8 patches were test-coverage, doc-accuracy, and a file-mode cleanup. The 11 rejected findings were either explicitly out of this story's scope (matching its own "Never" clauses on curated, non-exhaustive suffix/platform lists), architecturally unfounded (AD-18 already permits `title_normalized` candidate-key collisions since `EXTERNAL_LINK` is the true identity), or already-correct behavior mischaracterized as a defect.

**Verification performed:**
- `bun run lint` (Biome, 35 files, 0 errors), `bun run typecheck` (`tsc -b`, clean), `bun run test` (6 files, 92 tests passed) — all independently re-run after every patch.
- Manually traced the title-normalizer pipeline by hand against every I/O-matrix and review-added test case (trademark glyphs, apostrophe variants, single and combined platform tags, edition suffixes, leading articles, whitespace) to confirm the fixes compose correctly.
- Confirmed via `git config core.fileMode` (`false`) that the reviewer-flagged executable-bit-on-new-files finding was already inert at the git level; `chmod`'d the files anyway as a harmless filesystem cleanup.

**Residual risks:**
- The title-normalizer's edition-suffix and platform-tag lists remain a curated, non-exhaustive set by design (per the spec's own "Never" clause) — real-world stragglers among Luca's ~344 games will need manual overrides during seed import (Story 1.6), as already anticipated by project-context.md.
- `computeDerivedStates`'s "today" is computed via UTC (`toISOString`), which can diverge from a caller's local calendar day by a few hours near midnight — negligible for this single-user app and not pinned to a specific timezone anywhere in the spec/architecture, so not corrected here.
- The completion invariant predicate is intentionally unenforced in this story (AD-12's edit-boundary enforcement is Epic 2's job); it can currently be called with contradictory input (e.g. both `playStatus` and a milestone set) without complaint, which is expected until Epic 2 wires enforcement and AD-21's milestone-write reconciliation function.

Follow-up review recommended: `false` — the review pass's fixes were two medium-severity, localized correctness improvements to a single pure function (title normalization) plus eight low-severity test-coverage/doc/tooling patches, none touching behavior outside `src/core/`, with no API, security, or data-model impact. Bounded scope and low implementation complexity.
