---
title: 'Story 10.4: Leaving PS+ soon — per-game departure dates (VR-6 rework, endTime pivot)'
type: 'feature'
created: '2026-07-16'
status: 'done'
review_loop_iteration: 0
baseline_revision: 'b2bdc7f'
baseline_commit: '24b0aec'
followup_review_recommended: false
route: 'quick-dev'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/psn-leaving-endtime-probe-2026-07-16.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** 10.2's LEFT PS+ stamp warns AFTER a game is gone; the planned "Last Chance" category proved anonymously undiscoverable (probe artifact) — and gave no date anyway.

**Approach (Luca-approved pivot, 2026-07-16):** the anonymous store API publishes the exact departure instant per product — `metGetProductById` → conceptId, `metGetPricingDataByConceptId` → PS_PLUS offer `endTime` (epoch ms; null = staying — distribution probed over 6 games, see artifact). A chunked LEAVING SWEEP over the ~39 flagged tracked games rides the existing cron rotation, persists `ps_plus_leaving_on` (date) per game, and the card warns "LEAVING {date}" while the game is still in the catalog. The LEFT PS+ pill dies; `ps_plus_left_on` stays a quiet internal fact.

## EXTERNAL-RISK-FLAG (mandatory, Epic 11 rule)

Anonymous surface, no account identity: two additional persisted queries on the SAME public endpoint the catalog sync uses, both documented in the public wrapper the catalog id came from. No credential, nothing account-attributed. Luca signed off the endTime-sweep design live (2026-07-16, this session).

## Boundaries & Constraints

**Always:**
- The date derives ONLY from the PS_PLUS-branded offer's `endTime`; null (or no PS_PLUS offer) is "staying" and CLEARS the stored date — both directions every sweep.
- Sweep target = tracked games with `ps_plus_extra` set (AD-27: owned included; FR-38 gates display on `!owned`); product id joined via `ps_plus_catalog` on the stored title key — no fuzzy matching, no per-render calls (NFR-3).
- Sweep is cron-only, chunked, third in the rotation (genre sweep pending → genre; else leaving pending → leaving; else membership pass), state keyed to the catalog generation like the genre sweep; a leaving-sweep failure never lights the FR-40 banner (membership snapshot is valid either way — AD-28 sibling), a failed game keeps its stale date and the chunk retries next fire.
- Per-game fail-closed: a rejected/malformed pricing reply keeps the stored date; only a well-formed reply (offers present, endTime readable or null) writes.
- conceptId cached on `game` once resolved (steady state 1 call/game/window); the ledger enumerates the chunk arithmetic honestly and cron cadence widens to `0 9,21 15-21 * *` (14 fires/window) so membership + 5 genre chunks + ~3 leaving chunks + retries all fit.
- `setPsPlusExtraFlags` clear(false) also NULLs `ps_plus_leaving_on` atomically (a departed game must not keep a future-dated warning); set(true) leaves it — the sweep owns it.
- Pill: warn-amber `LEAVING {short date}` with sr-only full text, gated `psPlusLeavingOn && !owned`, shown ALONGSIDE the PS+ pill (still in catalog is the point); visually distinct from `--ps-extra`.
- LEFT PS+ pill, its DTO field, tests and coverage rows removed/replaced; `ps_plus_left_on` column and stamp/clear logic untouched.

**Block If:** the sweep's real subrequest arithmetic cannot fit a chunk under 50 with honest counting → HALT for a decision, never a silent cap.

**Never:** credentialed calls; per-render or button-path fan-out (button budget has no room); the last-chance category (superseded); predictive heuristics beyond Sony's own `endTime`; dropping `ps_plus_left_on`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Leaving game | flagged, PS_PLUS offer `endTime` set | date persisted (UTC date); card shows LEAVING pill beside PS+ pill | none |
| Staying game | offer `endTime: null` | stored date cleared (reprieve covered) | none |
| Owned leaving game | owned + date set | fact stored, NO pill (FR-38) | none |
| Departure | flag pass clears `ps_plus_extra` | `ps_plus_leaving_on` NULLed in the same statement (left_on stamps as shipped) | none |
| Pricing fetch fails / malformed | mid-chunk error | that game keeps stale date; chunk retries next fire; no banner | log only |
| No PS_PLUS offer node | well-formed reply, no PS_PLUS branding | treated as staying → clear | none |
| Unflagged/unmatched game | not in catalog join | never queried; date stays NULL | none |

</intent-contract>

## Code Map

- `scripts/probe-psn-leaving.ts` -- re-runnable distribution probe + verbatim fixture capture (product + pricing payloads, leaving AND staying) → `test/fixtures/psn/`
- `src/providers/psn.ts` -- `fetchPsPlusOfferEnd(region, productId, conceptId?)`: resolves concept if uncached, walks pricing offers for PS_PLUS `endTime`; returns `{conceptId, leavingOn: string|null}`; same guards/rejection error
- `src/schema/catalog.ts` + `migrations/0015_*.sql` -- `ps_plus_leaving_on` TEXT null, `psn_concept_id` TEXT null on `game`
- `src/repositories/games.ts` -- leaving/concept columns in `LibraryRow` + selects; `setPsPlusLeaving` chunked writer; `setPsPlusExtraFlags` clear also NULLs leaving
- `src/services/settings.ts` -- leaving-sweep state (mirror `PsPlusSweepState`, generation-keyed)
- `src/services/psplus.ts` -- `runLeavingSweep` (flagged∩catalog join, chunk ≤15, per-game fail-closed, cursor); rotation slot in `runScheduledPsPlusCheck`; ledger update
- `wrangler.jsonc` -- cron `0 9,21 15-21 * *`
- DTO chain (`shelf.ts`, `routes/shelf.ts`, `web/shelf/api.ts`) -- `psPlusLeavingOn` in, `psPlusLeftOn` out
- `web/shelf/Card.tsx` + `card.css` -- `card__flag--leaving` "LEAVING {date}" replaces `--ps-left`
- tests: provider fixtures (endTime→date, null, no-PS_PLUS-offer, rejection), integration sweep (persist/clear both directions, chunk cursor, per-game failure keeps stale, departure NULLs atomically, owned stored-not-shown), Card jsdom gating, `playwright/e2e/epic10-leaving-soon.spec.ts` replaces `epic10-left-psplus.spec.ts`, COVERAGE.md rows (10.2's "ships as left" honesty note inverted)
- `deferred-work.md` -- resolve 10.2's "warning never expires" entry (pill deleted; leaving date self-expires with the flag)

## Tasks & Acceptance

**Execution:**
- [x] `scripts/probe-psn-leaving.ts` -- formalize probe; capture fixtures verbatim
- [x] `migrations/0015_*.sql` + schema -- two nullable columns
- [x] `src/providers/psn.ts` -- `fetchPsPlusOfferEnd` (2 persisted ops, shared guards)
- [x] `src/repositories/games.ts` + `src/services/settings.ts` -- writers + sweep state
- [x] `src/services/psplus.ts` + `wrangler.jsonc` -- sweep, rotation, cadence, ledger
- [x] DTO chain -- `psPlusLeavingOn` in, `psPlusLeftOn` out
- [x] `web/shelf/Card.tsx` + `card.css` -- LEAVING pill replaces LEFT PS+
- [x] tests + COVERAGE.md + `deferred-work.md` entry

**Acceptance Criteria:**
- Given a flagged tracked game whose PS_PLUS offer carries `endTime`, when the sweep chunk covers it, then its card warns LEAVING with the date while the game is still in the catalog — no credential, budget ledger honest.
- Given a staying or reprieved game (endTime null), when swept, then no warning (stored date cleared).
- Given an owned game, when it is leaving, then no warning renders while the fact persists (FR-38).
- Given the shipped `ps_plus_left_on`, when this lands, then it persists exactly as before but renders nowhere.

## Spec Change Log

- **2026-07-16 — approach pivot (Luca decision, quick-dev session).** Original spec (git b2bdc7f) HALTed blocked: "Last Chance to Play" category id not anonymously discoverable. Luca supplied a leaving-game anchor (Risk of Rain 2, 21 Jul); probing its product surface found the PS_PLUS offer `endTime` — an exact per-game departure date on the anonymous endpoint (distribution verified over 6 games, artifact `psn-leaving-endtime-probe-2026-07-16.md`). Spec re-derived on the endTime sweep; category approach superseded. KEEP: FR-38 display gate, both-directions writes, left_on-stays-internal disposition, honest ledger discipline — all carried from the blocked draft.

## Review Triage Log

### 2026-07-16 — Review pass (quick-dev, dual hunters)
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 3, medium 5, low 4)
- defer: 1: (high 0, medium 1, low 0)
- reject: 12
- addressed_findings:
  - `[high]` `[patch]` A PS+-EXCLUSIVE DISCOUNT is also PS_PLUS-branded — branding-only matching would write the promo end as a LEAVING date on a game merely on sale. Provider now requires the catalog-INCLUSION offer shape (`isFree && isTiedToSubscription`), takes the EARLIEST validated date (never walk-order), test-pinned with a mixed discount+inclusion payload
  - `[high]` `[patch]` Rotation livelock: a poison chunk (stale cached conceptId answering errors[] forever) starved the membership pass permanently. Whole-chunk failure now retries ONCE (`attempts` in state) then steps past; failed cached concept ids are dropped (`clearPsnConceptIds`) so retries re-resolve. Integration-pinned (twice-failed chunk steps past; rotation test)
  - `[high]` `[patch]` Budget bust: the score refresh rode the SAME invocation as a leaving chunk (≈43 + ≈10 > 50). `runScheduledPsPlusCheck` now reports `spentFanOut`; worker/index.ts skips the score refresh on any sweep invocation (stale-gate fires it on a later fire — 14/window)
  - `[medium]` `[patch]` DEGENERATE-RESPONSE GUARD: a hollow-but-200 pricing reply (null conceptRetrieve / zero offer nodes) parsed as "staying" and would CLEAR a real date — now throws; "staying" requires offers present. Test-pinned both hollow shapes
  - `[medium]` `[patch]` Join-key mismatch: sweep joined on stored `title_normalized`, flag pass on recomputed `normalizeTitle(title)` — a normalizer change would flag-but-never-sweep silently. Sweep now recomputes, same as the flag pass
  - `[medium]` `[patch]` Stale past-date pill: a game departing in the cron's blind window (22nd–14th) kept "LEAVING <past date>" up to ~3.5 weeks — Card suppresses past dates (ISO lexicographic vs today), jsdom-pinned
  - `[medium]` `[patch]` Ledger arithmetic recounted honestly: leaving chunk 43 (was 41 — rotation's second state read + stale-concept clear), membership cron 37 (was 35 — rotation reads), button 36
  - `[medium]` `[patch]` Rotation failure discipline untested — added integration pins: failed chunk ends the invocation (no membership stacks), twice-failed steps past
  - `[low]` `[patch]` endTime plausibility bounds (2015–2100): an epoch-SECONDS regression wrote 1970-01-21 — now fails closed, test-pinned
  - `[low]` `[patch]` Empty-chunk fall-through widened: a chunk of all-unmatched titles (zero external cost) no longer burns a cron fire
  - `[low]` `[patch]` Duplicate catalog title keys resolved deterministically (sorted before the Map — observed live: God of War Ragnarök twice); formatLeavingDate day-range guard ("LEAVING NaN JUL"); pill test dates future-proofed (2099) + past-suppression pin
  - `[low]` `[patch]` AddGameDialog inner badge render now gated on `hasCandidateScores` like the column (drift hazard); spec/artifact bookkeeping (tasks ticked, 11-game distribution, this log)

## Verification

**Commands:**
- `bun run typecheck && bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. sweep hazard tests
- `bunx playwright test epic10` -- expected: green (replacement spec)
- `bun scripts/probe-psn-leaving.ts` -- expected: distribution table + fixtures written


## Auto Run Result

- **Outcome:** done — endTime-sweep pivot implemented, dual adversarial review triaged (12 patched incl. 3 high / 1 deferred / 12 rejected), all patches verified green.
- **Summary:** per-game PS+ departure dates from the anonymous store pricing surface (`metGetProductById` → `metGetPricingDataByConceptId` → PS_PLUS INCLUSION offer `endTime`); chunked, budget-isolated cron sweep (third rotation slot, livelock-capped, per-game fail-closed, concept-id cache with stale invalidation); `LEAVING {date}` pill (past-suppressed, FR-38-gated) replaces the LEFT PS+ pill; `ps_plus_left_on` persists unrendered; cron doubled to `0 9,21 15-21 * *`; scores refresh never stacks on a sweep invocation.
- **Verification:** tsc clean; biome clean; vitest 1926/1926 (78 files; new: 26-test provider surface incl. discount/hollow/seconds-scale hazards, 8-test integration sweep incl. livelock + rotation-budget pins); Playwright epic10+epic6 33/33.
- **Deferred:** the 15th–21st observation window can miss a departure announced after the 21st effective before the next 15th (no warning at all) — cadence/product decision, ledgered.
- **Rejected (sample):** TOCTOU between fence and write (project-wide accepted lock pattern, TTL >> write time); state `generation` field unchecked (informational — every membership pass re-arms cursor+generation atomically and the sweep reads the live catalog map); missing-cursor-field corrupt state (degrades to done→empty-completion→membership re-arm, self-healing); mid-sweep flagged-below-cursor (self-heals on next re-arm, ~12h); region-local vs UTC day nuance (documented convention, capture matched); e2e left_on stamp coverage (integration owns the write path).
- **Residual risks:** the leaving date's accuracy is bounded by the store's own announcements; the pill trusts client clock for past-suppression (worst case: a wrong clock shows/hides a warning a day off).

## Suggested Review Order

**Wire contract — the departure date's source of truth**

- Entry point: the inclusion-offer predicate (isFree+tied, NOT branding alone) and earliest-wins date pick
  [`psn.ts:443`](../../src/providers/psn.ts#L443)
- Structural offer walk + the discount-vs-inclusion rationale
  [`psn.ts:240`](../../src/providers/psn.ts#L240)
- Captured fixtures the tests pin against (RoR2 leaving / Returnal staying)
  [`index.ts:1`](../../test/fixtures/psn/index.ts#L1)

**The chunked leaving sweep**

- Header ledger + design (why re-arm every pass, per-game fail-closed, livelock cap)
  [`psplus-leaving.ts:1`](../../src/services/psplus-leaving.ts#L1)
- The twice-failed-chunk step-past — the livelock guard
  [`psplus-leaving.ts:158`](../../src/services/psplus-leaving.ts#L158)
- Rotation slot + spentFanOut discipline (membership vs sweep vs scores)
  [`psplus.ts:387`](../../src/services/psplus.ts#L387)
- The score refresh skipped on sweep invocations (the budget-bust fix)
  [`index.ts:62`](../../worker/index.ts#L62)

**Persistence + atomic clears**

- New columns (`ps_plus_leaving_on`, cached `psn_concept_id`)
  [`0015_game_ps_plus_leaving.sql:1`](../../migrations/0015_game_ps_plus_leaving.sql#L1)
- Departure NULLs the leaving date in the SAME flag statement (chunk 99→96 for the bind cap)
  [`games.ts:210`](../../src/repositories/games.ts#L210)
- Leaving-sweep state (attempts field = the livelock counter)
  [`settings.ts:252`](../../src/services/settings.ts#L252)

**UI — the pill**

- LEAVING pill: past-date suppression + FR-38 gate, beside the PS+ pill
  [`Card.tsx:196`](../../web/shelf/Card.tsx#L196)
- Add-modal scores moved under the cover (`.add-game__media` column)
  [`AddGameDialog.tsx:259`](../../web/shelf/AddGameDialog.tsx#L259)

**Peripherals**

- Provider hazard tests (discount, hollow-200, epoch-seconds, cached-concept single call)
  [`psn.test.ts:321`](../../src/providers/psn.test.ts#L321)
- Integration sweep suite (both directions, livelock, rotation budget)
  [`psplus-leaving.test.ts:1`](../../test/integration/psplus-leaving.test.ts#L1)
- Replacement e2e spec + COVERAGE rows
  [`epic10-leaving-soon.spec.ts:1`](../../playwright/e2e/epic10-leaving-soon.spec.ts#L1)
- Re-runnable probe + artifact
  [`probe-psn-leaving.ts:1`](../../scripts/probe-psn-leaving.ts#L1)
