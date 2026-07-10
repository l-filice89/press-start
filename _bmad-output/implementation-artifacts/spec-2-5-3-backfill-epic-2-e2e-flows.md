---
title: 'Backfill Epic 2 e2e flows (story 2.5.3)'
type: 'feature'
created: '2026-07-10'
status: 'in-review'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
baseline_revision: '568f7050baced73fc60f026b1d77bbf3ff08f8bb'
---

<intent-contract>

## Intent

**Problem:** Epic 2's tracking write paths and dialog surfaces (status popover incl. JS-computed viewport flip, milestone confirm modal, detail panel, UNDO toasts, focus traps, portal layering) are pinned only in jsdom — the exact dialog-regression class the Epic 2 retro named.

**Approach:** One Playwright test per Epic 2 AC with a UI user flow, riding the 2.5.1/2.5.2 foundation and conventions; each dialog surface gets focus-trap and Escape/focus-return assertions; ACs unreachable today (hidden-state re-inspection needing Epic 3 reveal pills) are listed with reasons in `playwright/COVERAGE.md`.

## Boundaries & Constraints

**Always:** Tests must not mutate `BASELINE_GAMES` — every write-path test seeds its own game and deletes it in `finally`. Mutations are refetch-driven (no optimistic updates): assert hidden-state removal with polls, never instant. Selectors role/accessible-name first. Suite green under `fullyParallel` and burn-in (`--workers 1 --repeat-each 5`). The 409-refusal test opts out of networkErrorMonitor via the documented annotation (deliberate error path). Genre-vocabulary rows a test auto-creates get cleaned up by name in `finally`. COVERAGE.md gains an Epic 2 section — every AC mapped or skipped with a reason.

**Block If:** A dialog behavior in the real browser contradicts the jsdom-pinned behavior in a way that is a product bug too risky to fix unattended (beyond localized CSS/markup).

**Never:** No new dependencies; no re-testing pure server invariants without a UI flow (write-once dates beyond the started_on observation); no Epic 3 features; no visual snapshots.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Instant status change | Pill → menu → "Up next" | No confirm; toast; pill/card label update | — |
| Dropped | Pill → "Dropped" | UNDO toast (~6s); card leaves shelf after refetch; Undo restores | — |
| First → Playing | Game without milestones | `started_on` stamped, visible in detail Started input | — |
| Milestone log | "Story completed" row | Confirm modal gates; Cancel = no write; Confirm = badge + inert dated row | — |
| Platinum | Confirm platinum in popover | Status auto-cleared; card hides after refetch | — |
| Already logged | Activate achieved row | "already logged" toast, no dialog, no write | — |
| Popover at viewport bottom | Card scrolled to bottom, then open | Menu gets `data-flip="up"` | — |
| Detail panel geometry | Desktop vs phone viewport | ~760px centered dialog vs full-screen | — |
| Invariant refusal | Clear the only milestone date in panel | 409 surfaced as explanatory toast, value restored | skipNetworkMonitoring annotation |
| Ownership | Un-own via card toggle | UNDO toast; pressed=false; Undo restores | — |
| Genre add/remove | Novel genre name | Chip appears (vocab auto-created); remove deletes; no merge/rename UI | — |
| Reduced motion | emulateMedia reduce | Panel enters with fade class, not flip | — |

</intent-contract>

## Code Map

- `web/shelf/StatusPopover.tsx` -- pill `status-pill-button`, menu `status-menu` role=menu, menuitemradio rows, milestone menuitems, JS flip `data-flip="up"`, Escape→pill focus
- `web/shelf/DetailPanel.tsx` -- `detail-panel` dialog, `detail-backdrop`, close "Close details", DateRow native date inputs (commit on blur), genres section (add input "Add genre to {title}", chip remove "Remove {name}"), ownership toggle + type fieldset, store link "View on PS Store", flip/fade entry classes
- `web/components/ConfirmDialog.tsx` -- portal, `confirm-backdrop`, focus lands on Cancel, Escape-anywhere cancel, Tab trap
- `web/components/Toast.tsx` -- plain 3s, undoable 6s, hover pauses timer
- `web/shelf/useTrackingMutations.ts` -- refetch-driven invalidation; HIDDEN_STATES; toast texts; 409 messages
- `playwright/e2e/epic2-tracking.spec.ts` -- NEW: popover/status/milestone/undo tests
- `playwright/e2e/epic2-detail.spec.ts` -- NEW: detail panel tests (geometry, trap, dates, ownership, genres, store link, refusal, reduced motion)
- `playwright/support/helpers/d1.ts` -- seedGames/deleteGames/d1Execute(sq) for cleanup incl. genre vocab rows
- `playwright/COVERAGE.md` -- Epic 2 section replaces "Pending story 2.5.3"

## Tasks & Acceptance

**Execution:**
- [x] `playwright/e2e/epic2-tracking.spec.ts` -- NEW: (1) pill→menu 5 radios, instant "Up next" apply + toast + pill/card update; (2) menu Escape → focus returns to pill; (3) viewport-bottom flip `data-flip="up"`; (4) Dropped → UNDO toast → card leaves after refetch → Undo restores; (5) first→Playing stamps Started date (observed in panel); (6) milestone confirm-gated: Cancel writes nothing, Confirm badges card + row inert with date + focus-trap/Escape assertions on the confirm dialog; (7) achieved row → "already logged" toast; (8) platinum via popover → status cleared, card hides
- [x] `playwright/e2e/epic2-detail.spec.ts` -- NEW: (9) opens from cover, focus on close, desktop dialog bounds / phone full-screen; (10) Tab trap + Escape close + focus returns to originating gridcell; (11) backdrop click dismisses without writing; (12) store link present for wishlisted, absent for owned; (13) date edit commits on blur and persists across reopen; (14) 409 refusal DROPPED — triggering state unreachable until Epic 3 (milestone-only games hidden; panel closes when a write hides its card); skipped with reason in COVERAGE.md per AC3; (15) ownership un-own UNDO + type switch physical/digital (post-write asserts card-level/reopen-based); (16) genre add novel name → chip (auto-created vocab), remove chip, no merge/rename controls, vocab row cleaned in finally; (17) reduced-motion → fade entry class
- [x] `playwright/COVERAGE.md` -- Epic 2 table: every 2.1–2.5 AC → test or skip reason (hidden-state re-inspection unreachable until Epic 3 reveal pills; write-once dates server-side) -- coverage-note contract
- [x] `playwright/README.md` -- skipNetworkMonitoring convention already documented (Practices section) — no change needed
- [x] `src/routes/e2e.ts` + `wrangler.jsonc` + `playwright/support/helpers/d1.ts` -- ADDED DURING IMPLEMENTATION: test-only `POST /api/e2e/sql` hook (gated by `E2E_TEST_HOOKS`, defined only in the local e2e env) replacing per-spec `wrangler d1 execute` shell-outs, which raced the running Worker for the SQLite file (SQLITE_BUSY → intermittent 500s under parallel workers); spec helpers became async, CLI transport retained for pre-server global-setup steps

**Acceptance Criteria:**
- Given Epic 2 stories 2.1–2.5, when the backfill lands, then every AC with a matching UI user flow has a named Playwright test (status popover incl. viewport flip, Dropped UNDO toast, milestone confirm + badge, card flip → detail panel, invariant refusal, ownership toggle + UNDO, lifecycle date edit, genre edit)
- Given the dialog regression class, when dialog tests run, then popover, confirm modal, and detail panel each have focus-trap and Escape/focus-return assertions
- Given unreachable ACs, when COVERAGE.md is read, then each is listed with a one-line reason
- Given the full suite twice consecutively and burn-in on the new specs, then 100% pass

## Spec Change Log

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 19: (high 1, medium 8, low 10)
- defer: 0
- reject: 9
- addressed_findings:
  - `[high]` `[patch]` /api/e2e/sql gated by a single env var (unauthenticated arbitrary SQL if ever set elsewhere) — added loopback-hostname second factor, safeParse→400, atomic `DB.batch` (mid-batch failure can no longer half-seed), refusal body mirrors the API catch-all 404
  - `[medium]` `[patch]` async helper migration removed loud-failure on missed awaits — playwright/ added to Biome (was entirely unlinted!) with `noFloatingPromises: error`
  - `[medium]` `[patch]` started_on test asserted only non-empty — now asserts today's ISO date
  - `[medium]` `[patch]` 2.1d ordering propagation unasserted — shelf tier reorder (Paused→Up next) now asserted against baseline anchors
  - `[medium]` `[patch]` ownership undo raced the 6s toast window with no timer pause — dispatched `mouseover` pauses the timer (hover() is blocked by the panel backdrop)
  - `[medium]` `[patch]` 2.2d badge persistence never exercised past the log — badge now asserted after a later live status change (across-hide still needs Epic 3)
  - `[medium]` `[patch]` merge/rename absence check could pass vacuously on an unmounted panel — moved to the reopened, chip-populated panel + text-level check
  - `[medium]` `[patch]` apiSql: no fetch-failure/non-JSON guards, no zero-statement no-op, no >200 chunking — all added
  - `[medium]` `[patch]` confirm-dialog Tab-trap only probed 2 tabs — 6-tab containment loop (mirrors panel test)
  - `[low]` `[patch]` Confirm clicks page-scoped + dialog close unasserted — scoped to the dialog, close asserted
  - `[low]` `[patch]` dialog-absence checks ran before the settled signal — reordered after the toast
  - `[low]` `[patch]` flip test depended on shelf being taller than the viewport — short viewport forced
  - `[low]` `[patch]` date test raced Escape against the in-flight blur PATCH — waits for the save toast
  - `[low]` `[patch]` genre finally leaked the vocab row if deleteGames threw — Promise.allSettled
  - `[low]` `[patch]` boundingBox null-guards added in geometry test
  - `[low]` `[patch]` resetDb `[0].results` unguarded — optional-chain + explicit error
  - `[low]` `[patch]` CLI busy/locked retry restored for cliExecute (stale-server contention at reset time)
  - `[low]` `[patch]` COVERAGE 1.5h row contradicted the footnote; 2.1d/2.2d rows updated to match strengthened asserts
  - `[low]` `[patch]` apiSql errors now carry the statement count
- rejected: env-var typegen cast (deliberate, commented), 404 fingerprinting (body already identical to catch-all), emulateMedia reset discipline (correct as written), force/dispatch tradeoffs (documented), animation-catch swallow (no infinite animations), resetDb two-pass race (no writer alive), user-table-empty seed guard (setup asserts /api/me first), global 10s expect timeout (accepted tradeoff), duplicated wrangler JSON parsing (functional)

## Design Notes

Refetch-driven removal: `expect.poll` on card count after Dropped/platinum — never instant-assert. The flip test must scroll the card into position BEFORE opening the popover (menu closes on outside scroll). UNDO toasts last 6s (not 3): click Undo promptly; hover pauses the timer if needed. The 409 test is the hazard test for the completion invariant named in 2.3d — it must assert the explanatory toast text, not just absence of change.

## Verification

**Commands:**
- `bun run test:e2e` -- expected: green, twice consecutively
- `bunx playwright test playwright/e2e/epic2-tracking.spec.ts playwright/e2e/epic2-detail.spec.ts --repeat-each 5 --retries 0 --workers 1` -- expected: 100% pass
- `bun run lint && bun run typecheck && bun run test` -- expected: clean

## Auto Run Result

**Summary:** Backfilled Epic 2 e2e coverage: 16 Playwright tests across two specs pin the status popover (five-status menu, instant apply + shelf-tier reordering, Escape/focus-return, JS-computed viewport flip), milestones (confirm gating with dialog focus-trap/Escape assertions, badge permanence across live status changes, already-logged refusal, platinum auto-clear + hide), and the detail panel (desktop-dialog/phone-fullscreen geometry, 25-tab focus trap, backdrop dismiss, store link, blur-committed date edits, ownership UNDO round trip, genre add/remove with auto-created vocabulary, reduced-motion fade entry — closing Epic 1's deferred 1.5h). COVERAGE.md maps all 21 Epic 2 ACs. **Infrastructure pivot mid-story:** per-spec `wrangler d1 execute` seeding raced the running Worker for the SQLite lock (intermittent 500s under parallel workers) — replaced with a doubly-gated test-only Worker endpoint (`POST /api/e2e/sql`: `E2E_TEST_HOOKS` env var set only in the local e2e env AND loopback-host check, atomic `DB.batch`), which also made the helpers async; `playwright/` is now Biome-linted with `noFloatingPromises` enforced.

**Files changed:**
- `playwright/e2e/epic2-tracking.spec.ts`, `playwright/e2e/epic2-detail.spec.ts` — NEW: 16 tests
- `src/routes/e2e.ts` — NEW: gated test-only SQL hook; `src/routes/index.ts`, `wrangler.jsonc` — wiring + e2e-env var
- `playwright/support/helpers/d1.ts` — async Worker-hook transport for specs, CLI transport (with busy retry) for pre-server reset
- `playwright.config.ts` — expect timeout 10s (refetch-driven mutations under parallel load)
- `playwright/COVERAGE.md` — Epic 2 section; 1.5h row closed
- `biome.json` — playwright/ included, noFloatingPromises
- mechanical await-migration in epic1/smoke/auth-journey specs

**Review findings:** 19 patched (1 high — hook hardening, 8 medium, 10 low), 0 deferred this pass (1 product finding — panel unmounts when a write's refetch re-chunks grid rows — was logged during implementation), 9 rejected.

**Verification:** three consecutive full `bun run test:e2e` runs 32/32; burn-in `--repeat-each 5 --retries 0 --workers 1` 80/80; Vitest 494/494; Biome (now incl. playwright/) + tsc clean.

**Residual risks:** the e2e SQL hook is production-adjacent code — gates are env-var + loopback (two independent factors), but it deserves a glance in the epic retro. 2.3d invariant-refusal flow and hidden-state re-inspection remain honestly skipped until Epic 3 reveal pills (COVERAGE.md).
