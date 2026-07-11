---
title: 'Story 5.3: "PS+ catalog as of {date}" timestamp'
type: 'feature'
created: '2026-07-11'
status: 'done'
baseline_revision: '4786f84'
final_revision: '3be8218fa536d92d545e60583afb1b4a7532bb01'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-2-scheduled-monthly-refresh-cron-trigger.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Nothing tells Luca how fresh the PS+ Extra flags are, so the Playable-now signal could be silently months stale after a missed refresh and he can't judge how much to trust it.

**Approach:** Every successful `runPsPlusCheck` (button OR cron) stamps a `psplus_refreshed_at` date in `SETTING` (in the user's zone, like every other date stamp). `GET /api/settings` exposes it and the header's already-provisioned readout slot renders "PS+ CATALOG AS OF {date}" — full on desktop, compact on phone (the CSS toggle already exists).

## Boundaries & Constraints

**Always:**
- The stamp is written ONLY on a successful check — the same ok-path in `runPsPlusCheck` that clears the failed-refresh flag (5.2). A failed/empty/no-region run leaves the previous timestamp untouched (a stale-but-real "as of" beats a wrong one).
- The date is `todayForUser(db, userId)` (YYYY-MM-DD in the user's captured zone, AR-18) — the SAME date source every tracking stamp uses. Persisted under `SETTING` key `psplus_refreshed_at`.
- `GET /api/settings` returns `psPlusRefreshedAt: string | null`; the web schema defaults it to `null` (deploy-skew tolerance, like `syncAttention`/`psPlusRefreshFailed`).
- The header readout renders the date in both slots: full `PS+ CATALOG AS OF {date}` (`.app-header__readout-full`) and compact `PS+ {date}` (`.app-header__readout-compact`) — the existing `@media (max-width:600px)` rule swaps them; do not add new breakpoints. Never refreshed → em-dash placeholder (`—`), the current default.
- Mono accent font already applies via `.app-header__readout`; reuse it, no new type styles.

**Block If:** the timestamp would need storage beyond a single `SETTING` row (e.g. per-region history).

**Never:** no time-of-day, relative "3 days ago", or locale reformatting (raw stored `YYYY-MM-DD`, matching the app's other date surfaces); no new cron/refresh logic (5.2 owns the write triggers); no change to flag semantics or the attention banner; no second breakpoint or header-layout redesign.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Successful check | `runPsPlusCheck` returns ok | `psplus_refreshed_at` = today (user zone); readout shows it | No error |
| Failed / empty / no-region | check returns `ok:false` | Timestamp unchanged (prior value stands) | No error |
| Never refreshed | no `psplus_refreshed_at` row | `psPlusRefreshedAt: null`; readout shows `—` | No error |
| Header render (desktop) | date present | `PS+ CATALOG AS OF {date}` full form | No error |
| Header render (phone) | date present | compact `PS+ {date}` (CSS swap) | No error |

</intent-contract>

## Code Map

- `src/services/settings.ts` -- `PSPLUS_REFRESHED_AT_SETTING_KEY` + `stampPsPlusRefreshedAt(db,userId)` (writes `todayForUser`) + `getPsPlusRefreshedAt(db,userId)`
- `src/services/psplus.ts` -- in `runPsPlusCheck` ok-path, `stampPsPlusRefreshedAt` beside the existing `clearPsPlusRefreshFailed`
- `src/routes/settings.ts` -- `GET /settings` adds `psPlusRefreshedAt`
- `web/settings/api.ts` -- settings schema adds `psPlusRefreshedAt: z.string().nullable().default(null)`
- `web/shell/AppShell.tsx` -- pass `psPlusRefreshedAt` into `<Header>`
- `web/shell/Header.tsx` -- render the date into the full/compact readout spans (replace the placeholder)
- `test/integration/psplus.test.ts` + `settings.test.ts` -- stamp-on-success + GET exposure
- `web/shell/Header.test.tsx` (NEW or existing) + `playwright/e2e/epic5-psplus.spec.ts` + COVERAGE.md -- readout render + seeded-date e2e

## Tasks & Acceptance

**Execution:**
- [x] `src/services/settings.ts` -- `PSPLUS_REFRESHED_AT_SETTING_KEY='psplus_refreshed_at'`; `stampPsPlusRefreshedAt` (set to `await todayForUser`); `getPsPlusRefreshedAt` (→ value or null) -- AC1
- [x] `src/services/psplus.ts` -- call `stampPsPlusRefreshedAt(db, userId)` in the ok-path next to `clearPsPlusRefreshFailed` (fires for button and cron alike) -- AC1
- [x] `src/routes/settings.ts` -- add `psPlusRefreshedAt` to the `Promise.all` + response body -- AC1
- [x] `web/settings/api.ts` -- settings zod schema gains `psPlusRefreshedAt: z.string().nullable().default(null)` -- AC1
- [x] `web/shell/AppShell.tsx` -- pass `psPlusRefreshedAt={settings?.psPlusRefreshedAt ?? null}` to `<Header>` -- AC1
- [x] `web/shell/Header.tsx` -- prop `psPlusRefreshedAt?: string | null`; full span `PS+ CATALOG AS OF {date ?? '—'}`, compact span `PS+ {date ?? '—'}` -- AC1/AC2
- [x] `test/integration/psplus.test.ts` -- a successful check stamps `psplus_refreshed_at` (today, user zone); a failed run leaves it unchanged -- AC1
- [x] `test/integration/settings.test.ts` -- `GET /settings` surfaces `psPlusRefreshedAt` (present + null) -- AC1
- [x] `web/shell/Header.test.tsx` -- readout shows `PS+ CATALOG AS OF {date}` when set, `—` when null (jsdom) -- AC1
- [x] `playwright/e2e/epic5-psplus.spec.ts` + `playwright/COVERAGE.md` -- seed `psplus_refreshed_at` → header readout shows the date (desktop full form); COVERAGE row -- AC1/AC2
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- mark 5.3 done; epic-5 done -- bookkeeping

**Acceptance Criteria:**
- Given a successful refresh, when it completes, then the timestamp is persisted in `SETTING` and shown in the header as "PS+ CATALOG AS OF {date}" (AC1)
- Given the header surface, when it renders, then the readout is full on desktop and compact on mobile via the existing breakpoint (AC2)

## Spec Change Log

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (medium 1, low 2)
- defer: 0
- reject: 3: (low 3)
- addressed_findings:
  - `[medium]` `[patch]` A post-flag-write bookkeeping failure (5.2 `clearPsPlusRefreshFailed` + 5.3 `stampPsPlusRefreshedAt`) would reject `runPsPlusCheck` → 502 + cron lights the failed banner, despite the flags having genuinely refreshed (both reviewers). Wrapped both non-critical writes in a swallowing try/catch (logs), matching `sync.ts`'s attention-persist posture — a real success is never reported as failed.
  - `[low]` `[patch]` `Header` used `?? '—'`, so an empty/blank stored date would render "PS+ CATALOG AS OF " — switched to `|| '—'` (falls back on empty string too).
  - `[low]` `[patch]` Header em-dash test asserted only the full span + COVERAGE 5.3b overstated the e2e "drives the desktop full form" — added the compact-span assertion and softened the coverage note (the viewport visibility toggle is CSS-only, unasserted).
- rejected: pre-fetch loading flicker (settings undefined → em-dash then flips — cosmetic one-render, distinguishing loading adds state for no real gain); "redundant `?? null`" in `getPsPlusRefreshedAt` (invalid — `getSetting` returns `string | undefined`, so the coalesce is needed for the `string | null` contract); zod date-shape validation (server is the sole writer of a `todayForUser` value).

## Design Notes

- The readout slot, its mono styling, and the full/compact `@media` swap already exist in `Header.tsx`/`header.css` (pre-provisioned in Epic 1) — this story only feeds real data into it and drops the `— · — OWNED` placeholder, which was a stale earlier idea, not the PS+ readout.
- Stamp lives in `runPsPlusCheck`'s success path so BOTH trigger paths (button, cron) record it with no duplication — the same seam that clears the 5.2 failed flag.

## Verification

**Commands:**
- `bun run typecheck` / `bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. stamp-on-success integration + Header jsdom test
- `bun run test:e2e epic5-psplus` -- expected: green incl. the seeded-timestamp readout

## Auto Run Result

Status: **done**

### Summary
Every successful `runPsPlusCheck` (button or cron) now stamps `psplus_refreshed_at` = `todayForUser` (YYYY-MM-DD, user zone) in `SETTING`; `GET /api/settings` exposes it and the header's pre-provisioned readout renders "PS+ CATALOG AS OF {date}" full on desktop / "PS+ {date}" compact on phone (existing CSS `@media` swap), em-dash until the first refresh. A failed/empty/no-region run leaves the prior stamp untouched. The stale `— · — OWNED` compact placeholder is retired.

### Files changed
- `src/services/settings.ts` — `psplus_refreshed_at` key + `stampPsPlusRefreshedAt`/`getPsPlusRefreshedAt`.
- `src/services/psplus.ts` — stamp in the success path (button + cron); the post-flag bookkeeping writes (5.2 clear + 5.3 stamp) wrapped so a write failure can't flip a real success to failed.
- `src/routes/settings.ts` — `GET /settings` returns `psPlusRefreshedAt`.
- `web/settings/api.ts` — schema gains `psPlusRefreshedAt` (nullable, defaulted).
- `web/shell/AppShell.tsx` — passes it to `Header`.
- `web/shell/Header.tsx` — renders the date into both readout spans (`|| '—'` fallback).
- Tests: `test/integration/psplus.test.ts` (stamp-on-success, unchanged-on-failure), `test/integration/settings.test.ts` (GET exposure), `web/shell/Header.test.tsx` (NEW, readout render), `playwright/e2e/epic5-psplus.spec.ts` + `playwright/COVERAGE.md`.

### Review findings
- Patches applied (3): non-critical bookkeeping writes no longer flip a genuine success to failed (house pattern from `sync.ts`); `Header` `|| '—'` catches empty strings; Header test + COVERAGE note tightened.
- Rejected (3): pre-fetch loading flicker (cosmetic); "redundant `?? null`" (invalid — `getSetting` returns `undefined`); zod date-shape validation (server sole writer).
- No new deferrals.

### Verification
- `bun run typecheck` / `bun run lint` — clean.
- `bun run test` — 1184 passed (50 files).
- `bun run test:e2e epic5-psplus` — 3 passed.

### Residual risks
- No backfill: existing deployments show the em-dash until each user's next successful refresh (intended null-until-first-refresh design).
- Desktop-full / mobile-compact visibility is CSS-only and not asserted by an e2e viewport test (both spans are populated; the swap is a pure `@media` rule).

