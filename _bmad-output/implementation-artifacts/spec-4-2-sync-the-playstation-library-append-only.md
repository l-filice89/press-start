---
title: 'Story 4.2: Sync the PlayStation library (append-only)'
type: 'feature'
created: '2026-07-11'
status: 'done'
baseline_revision: '9b4b774c4e3289a8e69275934f24dcc7c4245973'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** The library only fills via the one-off seed; new PS purchases never appear. Epic 4's core value — "the library fills itself" — needs a button-triggered, append-only sync plus the FAB drawer shell to hang it on.

**Approach:** A pure `core/` sync planner (mirror of `seed-reconcile`) turns the `PsnProvider` list plus a matching index into an explicit plan (creates / owned-flips / link-adds / fact-backfills / membership-skips / conflicts); a service executes it through the existing repository and ownership write paths; `POST /api/sync` runs it in-Worker; the new FAB drawer (first item: Sync, with spinner) triggers it. A `PsnAuthError` persists `psn_auth=expired` — lighting the Story 4.1 banner — and returns the refresh instructions.

## Boundaries & Constraints

**Always:**
- **Append-only (FR-33/AD-10, hazard):** sync may INSERT games/tracking/links and may flip `owned` false→true (via the existing `changeOwnership` service path so `bought_on` stamps write-once, type `digital`). It never deletes, never sets `owned` false, never touches `play_status`, milestones, dates, or genres. Existing `cover_url`/`store_url` are backfilled only when NULL — never overwritten.
- **Membership skip (FR-9/33, hazard):** entries with `membership !== 'NONE'` are skipped before matching — never created, never flipped; a claim matching a tracked game leaves that game byte-identical. The skip count is reported.
- **Matching order (FR-34/AD-9/18/20):** stored `external_link (PSN, titleId)` first, then `normalizeTitle` with the built-in PS4/PS5 collapse (group PSN entries by normalized title, prefer the PS5 entry's facts, keep ALL titleIds as links). A title match already carrying a DIFFERENT PSN external id is a conflict: flagged in the result, nothing merged, nothing created for that entry (hazard).
- New games: defaults `owned`/`digital`/`Not started`, `bought_on` = `todayForUser`, `unenriched = true` (AD-22b — no IGDB call in sync; cover/store URL come from PSN, FR-35).
- On `PsnAuthError`: `markPsnAuthExpired`, respond 401 with the refresh message, no retry (AD-14). Any other provider failure surfaces as 502 with its message.
- Sync is user-scoped (AD-13): tracking rows and the cookie belong to the calling user.
- The sync result reports `{ added, flipped, skippedMembership, needsAttention[] }` — Story 4.3 renders the summary modal from exactly this shape; 4.2's UI may show a minimal toast.
- FAB drawer (UX): fixed bottom-right, opens upward, `aria-expanded` menu with accessible names, icons-only ≤600px / icons+text desktop, Sync item shows a spinner while the mutation is pending (UX-DR10). Need-scoped: Sync is the only item.
- Playwright: every UI-flow AC gets a test or a COVERAGE.md row; the 4.1c "unreachable until 4.2" row converts (Sync with no cookie → banner, live 401-wiring path).

**Block If:** the PSN response lacks the fields needed to distinguish purchase from membership entries (contradicting `export_ps_catalog.py`'s `membership` field).

**Never:** no summary modal / attention-banner seeding of needs-attention items (4.3); no PS+ Extra check, region, or cron (Epic 5); no IGDB enrichment or straggler resolution (Epic 6); no settings/export/about drawer items (Epic 6); no FAB handedness setting; no schema migration (tables suffice).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New purchase | Purchase entry, no link, no title match | Game + PSN link + tracking (Owned/digital/Not started, `bought_on` today, unenriched, PS cover+store URL) created; `added`+1 | No error |
| Owned flip | Purchase entry matches un-owned tracked game (by link or title) | `owned` → true, `bought_on` stamped once, type digital; status/dates/genres untouched; `flipped`+1 | No error |
| Already owned | Purchase entry matches owned game | Nothing written (no dates re-stamped); missing link/cover/store backfilled only | No error |
| Membership claim | `membership: 'PS_PLUS'` entry, tracked or not | Skipped before matching; `skippedMembership`+1; matched game byte-identical | No error |
| PS4+PS5 pair | Two entries, same normalized title | One game (PS5 facts preferred), both titleIds linked | No error |
| Link conflict | Title match carries a different PSN external id | `needsAttention` entry (title + both ids); nothing created/merged | Reported, not thrown |
| Expired cookie | Provider throws `PsnAuthError` | `psn_auth=expired` persisted; 401 + refresh message; banner lights via settings query | No retry |
| Re-run (idempotence) | Same library synced twice | Second run: `added: 0, flipped: 0`, no duplicate links/games | No error |

</intent-contract>

## Code Map

- `src/providers/psn.ts` -- `PsnProvider`/`PsnGame`/`PsnAuthError` (4.1)
- `src/core/title-normalizer.ts` -- `normalizeTitle` (PS4/PS5 collapse built in)
- `src/core/seed-reconcile.ts` -- the plan-then-execute pattern to mirror (do not reuse its claim-is-owned semantics — FR-33 differs)
- `src/core/index.ts` -- barrel; add sync planner exports
- `src/repositories/games.ts` -- `insertGame`, `findGameByExternalLink`, `findGamesByNormalizedTitle`, `addExternalLink`, `listExternalLinks`
- `src/repositories/tracking.ts` -- `getTracking`, `upsertTracking`, `updateTrackingOwnership` (COALESCE `bought_on`)
- `src/services/tracking.ts` -- `changeOwnership` (the AD-10 flip path to reuse)
- `src/services/settings.ts` -- `getPsnCookie`, `markPsnAuthExpired`, `todayForUser`
- `src/services/seed-import.ts` -- service-executes-core-plan example
- `src/routes/index.ts`, `src/routes/tracking.ts` -- route mounting + `requireAuth` patterns
- `web/shell/AppShell.tsx` -- mounts the FAB; settings query already feeds the banner
- `web/components/Toast.tsx`, `web/shelf/useTrackingMutations.ts` -- toast + invalidation conventions (`['shelf']`, `['shelf-search']`, `['settings']`)
- `test/integration/` -- workers-pool tests; use `fetchMock` from `cloudflare:test` to stub the outbound PSN call
- `playwright/e2e/epic4-settings.spec.ts`, `playwright/COVERAGE.md` -- 4.1c skip row to convert; e2e patterns

## Tasks & Acceptance

**Execution:**
- [x] `src/core/sync-reconcile.ts` (+ test) -- pure `planSync(entries, index)`: membership skip → PS4/PS5 grouping → per-group match (byExternalId, then byNormalizedTitle) → plan `{creates, flips, linkAdds, backfills, skippedMembership, conflicts}`; unit tests pin every I/O-matrix row incl. the three hazards (append-only shape: plan contains only additive ops; membership skip; conflict-never-merge) -- AC2/AC3/AC4/AC5
- [x] `src/services/sync.ts` (+ integration coverage) -- build the index from repositories, run provider → planner, execute plan (creates via `insertGame`+`addExternalLink`+`upsertTracking`; flips via `changeOwnership`; NULL-only backfills), catch `PsnAuthError` → `markPsnAuthExpired`; return the result shape -- AC1–AC6
- [x] `src/routes/sync.ts` + `src/routes/index.ts` -- `POST /api/sync` (requireAuth): 200 result / 401 refresh-instructions / 502 other provider failure -- AC1/AC6
- [x] `test/integration/sync.test.ts` -- `fetchMock`-stubbed PSN: happy path (added/flipped/links), idempotent re-run, membership-skip hazard (tracked claim byte-identical), append-only hazard (status/milestones/dates/genres survive a sync that flips `owned`), conflict flag, 401 → `psn_auth=expired` persisted + 401 body (the live banner wiring 4.1 couldn't reach) -- AC2–AC6
- [x] `web/shell/Fab.tsx` (+ css + jsdom test) -- FAB drawer shell: bottom-right toggle (`aria-expanded`, Escape/outside-click close), upward item list, `Sync library` item with pending spinner (UX-DR10), icons-only phone delta; jsdom pins open/close, spinner-while-pending, result toast, invalidations (`['shelf']`, `['shelf-search']`, `['settings']`) -- AC1
- [x] `web/settings/api.ts` or `web/shelf/api.ts` -- `runSync()` POST via shared `callApi`; result parsed with zod -- AC1
- [x] `web/shell/AppShell.tsx` -- mount `<Fab />` -- AC1
- [x] `playwright/e2e/epic4-sync.spec.ts` + `playwright/COVERAGE.md` -- e2e: FAB opens, Sync with no cookie configured → expired-cookie banner appears (converts 4.1c's "unreachable until 4.2" row — live PsnAuthError→flag→banner path); Epic 4 section gains 4.2 rows (happy-path sync pinned by `fetchMock` integration tests — the e2e Worker cannot stub PSN; write the reason) -- AC1/AC6
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `4-2…: done` on completion -- bookkeeping

**Acceptance Criteria:**
- Given the FAB drawer, when I tap Sync, then an in-Worker sync runs with a spinner and resolves into visible feedback (AC1)
- Given purchase-sourced entries, when syncing, then new games are created with the FR-33 defaults and existing games may flip `owned` false→true (bought_on stamped once, digital) (AC2)
- Given any existing game, when syncing, then nothing is deleted, `owned` never turns false, and status/milestones/dates/genres are untouched (AC3)
- Given membership-sourced entries, when syncing, then they are skipped with a count and a claim matching a tracked game changes nothing (AC4)
- Given matching, when syncing, then stored PSN links win over normalized title, PS4/PS5 collapse to one game, and an external-id/title disagreement is flagged, never merged (AC5)
- Given each synced game, when captured, then PS cover art and store URL are persisted and nothing is fetched on render (AC6)

## Spec Change Log

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 3, medium 5, low 4)
- defer: 0
- reject: 7
- addressed_findings:
  - `[high]` `[patch]` FR-34's defining conflict (stored id resolves to a different game than the title match) was unimplemented — link silently won; planner now flags it, unit test added
  - `[high]` `[patch]` matched-but-untracked path used `upsertTracking` (onConflictDoUpdate) — a row racing in between read and write could have its status/dates overwritten; new `insertTrackingIfAbsent` (onConflictDoNothing) closes it for both create paths
  - `[high]` `[patch]` duplicate titleId across two differently-normalizing names planned two inserts of the unique `(source, external_id)` — planner-level seen-set claims each id once, unit test added
  - `[medium]` `[patch]` route `.catch` returned `error.message` verbatim (PSN bodies / DB internals) — now logs for `wrangler tail`, client gets a generic 502 message
  - `[medium]` `[patch]` mid-plan failure aborted the whole sync as 502 after partial writes — per-item try/catch now reports the failed title in `needsAttention` and continues (plan is additive + idempotent, re-run heals)
  - `[medium]` `[patch]` title-match ambiguity ignored claimed candidates (one claimed + one unclaimed silently merged) — merge now requires exactly ONE candidate with no PSN id, all else flags
  - `[medium]` `[patch]` per-match `getTracking` + unconditional `backfillGameFacts` on every re-sync — bulk `listTrackingForUser` read + backfill skipped when the stored facts already stand (steady-state re-sync issues zero writes)
  - `[medium]` `[patch]` `changeOwnership` outcome unchecked — `flipped` only counts persisted flips
  - `[low]` `[patch]` `membership: ''` (empty string) was treated as a purchase — only `null`/`'NONE'` pass now, unit test added
  - `[low]` `[patch]` Fab error toast ignored status — 401 gets the cookie-expired message + settings invalidation, other failures a plain retry message; success toast reports the needs-attention count
  - `[low]` `[patch]` a stray outside tap / Escape closed the drawer while sync was pending, hiding the spinner (UX-DR10) — dismissal stands down while pending; `aria-controls` only references the drawer while it exists
  - `[low]` `[patch]` e2e no-cookie test silently depended on `PSN_SESSION_COOKIE` being absent — pinned empty in `.dev.vars.e2e` with a comment

Rejected (with reason): PSN-401-vs-session-401 collision (the intent contract mandates 401; the session signal on a valid session is a harmless refetch), `SyncResult` duplicated client/server (the documented SPA/Worker boundary policy — both sides validate independently), Fab focus-trap (non-modal drawer; Escape + accessible names suffice), integration tests order-coupled / e2e preconditions (suite conventions, consistent with settings.test.ts), epic2 date-assertion three-clocks residual (runner/browser/setting share one machine and zone; residual window is milliseconds around midnight), `added` conflating new-vs-newly-tracked (both are "added to your library"; 4.3 shapes the summary), `buildIndex` full-catalog read (ponytail ceiling comment added — hobby scale).

## Design Notes

- Planner mirrors `seed-reconcile` (pure plan, service executes) but with sync semantics: claims skip (FR-33) where the seed imported them as owned — do not "reuse" the seed's reconcile.
- `unenriched=true` on sync-created games hands genre/release-date enrichment to Epic 6's straggler flow (AD-22b) instead of burning IGDB subrequests in-sync (AD-15).
- The 401 path needs no new UI: `markPsnAuthExpired` + invalidating `['settings']` lights 4.1's banner; the route's 401 body is for 4.3's summary/toast copy.
- Index for the planner: `byExternalId` from `external_link` PSN rows; `byNormalizedTitle` from `findGamesByNormalizedTitle` per group (few dozen lookups vs. one full-table read — either is fine; a single `listLibraryForUser`-style bulk read is acceptable if simpler).

## Verification

**Commands:**
- `bun run typecheck` / `bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. `sync-reconcile` unit + `sync.test.ts` integration hazards
- `bun run test:e2e` -- expected: green incl. `epic4-sync.spec.ts`

## Auto Run Result

**Summary:** Story 4.2 implemented — button-triggered, append-only PSN library sync. Pure `planSync` core planner (membership claims skipped before matching; stored-link-first matching with PS4/PS5 collapse; id-vs-title disagreements and title ambiguity flagged, never merged), a service executing the additive-only plan through the shared ownership guard (`bought_on` write-once, digital inferred), `POST /api/sync` (401 persists `psn_auth=expired` and lights the 4.1 banner; other failures log server-side and answer a generic 502), and the FAB drawer shell with Sync as its first item (spinner while pending, count toast, shelf invalidation).

**Files changed:**
- `src/core/sync-reconcile.ts` (+ 14-test suite) — pure sync planner with all FR-33/34 hazards pinned (additive-only plan shape, membership skip, conflict-never-merge, id dedupe)
- `src/core/index.ts` — export
- `src/services/sync.ts` — provider → planner → execute; bulk index + tracking reads; per-item failure collection into needsAttention; race-safe inserts
- `src/repositories/games.ts` — `listGamesWithPsnLinks` (matching index), `backfillGameFacts` (COALESCE NULL-only)
- `src/repositories/tracking.ts` — `insertTrackingIfAbsent` (onConflictDoNothing — sync can never overwrite user rows)
- `src/routes/sync.ts` + `src/routes/index.ts` — `POST /api/sync` (requireAuth, 200/401/502)
- `test/integration/sync.test.ts` — 7 tests over real workerd + D1 with the outbound PSN call stubbed: happy path, idempotent re-run, append-only hazard, membership-skip hazard, conflict flag, live 401 → flag persistence
- `web/shell/Fab.tsx` (+ css + 3 jsdom tests) — FAB drawer, Sync item, spinner, status-aware toasts, invalidations
- `web/shell/AppShell.tsx` — mounts the FAB
- `web/settings/api.ts` — `runSync()` + zod result schema
- `playwright/e2e/epic4-settings.spec.ts` + `playwright/COVERAGE.md` — e2e for the FAB → no-cookie sync → banner flow (converts 4.1c's "unreachable until 4.2" row); Epic 4 rows for all 4.2 ACs
- `playwright/e2e/epic2-tracking.spec.ts` — pre-existing test bug surfaced by the clock: started_on assertion compared against the UTC date instead of the browser-local day (fails 22:00–24:00 UTC+2); fixed
- `.dev.vars.e2e` — `PSN_SESSION_COOKIE` pinned empty (the no-cookie e2e flow depends on it)

**Review findings:** 12 patches applied (3 high, 5 medium, 4 low — see Review Triage Log), 0 deferred, 7 rejected.

**Verification:** `bun run typecheck` clean; `bun run lint` clean; `bun run test` 1014/1014 (45 files); `bun run test:e2e` 52/52 (one epic2-tracking flake under parallel load re-ran green — known-flaky suite per 3.5g).

**Residual risks:** sync execution stays untransacted (additive + idempotent, failures surface per-title and heal on re-run — a D1 batch refactor is available if that ever bites); a happy-path sync is not e2e-driven (the e2e Worker cannot stub PSN — covered at the integration tier); PSN 401 shares the status code with app-session 401 at the transport layer (mandated by the intent contract; the query client's session poke on a valid session is a no-op).
