---
title: 'Story 6.3: Chores — CSV export & settings'
type: 'feature'
created: '2026-07-11'
status: 'in-review'
baseline_revision: '0b544b9'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Two chores are missing: the library has no user-held second copy (the games-DB backups are the only copy — FR-49), and Settings can't fit the app to Luca's hand (FAB handedness) or sign out / show About-Help (FR-47, UX-DR10).

**Approach:** Add an "Export CSV" item to the existing FAB drawer that downloads the whole library as a CSV streamed from D1; add a FAB-handedness toggle (persisted like the other `setting` keys, moving the FAB between bottom-right/left), a Sign out button, and an About/Help section to the existing Settings panel.

## Boundaries & Constraints

**Always:**
- Layering: routes → services → core (I/O-free) / repositories. CSV serialization is a pure `core/` function (mirrors `parseCsv`); the export route reads through `services/shelf.loadLibrary` (the one user-scoped whole-library read), never a raw repo query.
- CSV covers the FULL library — title, statuses (effective + raw play status), milestones (completed/platinum), lifecycle dates (started/bought/wishlisted/release), genres, and ownership (owned, type, acquisition source, PS+). One row per game, header row first, RFC-4180 quoting (embedded `,"`newlines), `text/csv` + `Content-Disposition: attachment`.
- Handedness persists in the per-user `setting` table (new `fab_handedness` key, values `left`|`right`, absent = `right`) via the same get/set pattern as timezone; it rides the `/api/settings` GET payload and a dedicated PUT. The FAB reads it off the settings query and toggles a position modifier class.
- Sign out reuses the existing `onSignOut` (better-auth) already held by AppShell — thread it into the panel; do not re-implement auth.
- Legal: no "PlayStation"/Sony marks in About/Help chrome — descriptive text only.
- Auth + scope: the export and handedness endpoints are `requireAuth`, user-scoped (AD-13). Export contains only the signed-in user's tracked games.
- Every UI-flow AC gets a Playwright test here; the pure serializer gets a Vitest round-trip test.

**Block If:** the FAB drawer shell or the Settings panel is missing/shaped differently than the Code Map states (planning drift) — or the Playwright foundation is broken.

**Never:** Out of scope (do NOT touch): DW-3 (401 re-auth redirect) and DW-4 (ARIA row regrouping) — already shipped. No Sync / Check-PS+ drawer work (other epics). No CSV *import* (that's the seed script). No new npm dependency (no CSV library — the pure serializer is ~10 lines). No streaming machinery — the library is small; build the whole string.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Export full library | GET /api/export.csv (authed) | 200 `text/csv`, attachment; header row + one row per tracked game; genres joined in one cell | none |
| Export empty library | authed, no tracked games | 200 CSV with just the header row | none |
| Fields needing quotes | title/genre with `,` `"` newline | RFC-4180 quoted, embedded `"` doubled | none |
| Set handedness | PUT /api/settings/fab-handedness {handedness:'left'} | stored; GET reports `fabHandedness:'left'`; FAB renders bottom-left | invalid value → 400 |
| Handedness default | no setting stored | GET reports `fabHandedness:'right'`; FAB bottom-right | none |
| Sign out | click Sign out in Settings | `onSignOut()` runs (better-auth), returns to login | none |
| Unauthenticated | export / handedness endpoints | 401 | `requireAuth` |

</intent-contract>

## Code Map

- `src/core/csv.ts` -- has `parseCsv`; ADD pure `toCsv(rows: readonly (readonly string[])[]): string` (RFC-4180, CRLF, quote `,"`+newlines, double embedded `"`)
- `src/services/shelf.ts` -- `loadLibrary(db,userId): Promise<ShelfGame[]>` — the whole-library read the export maps to CSV rows
- `src/routes/index.ts` + NEW `src/routes/export.ts` -- `GET /api/export.csv` (`requireAuth`, `c.body(csv, 200, {content-type, content-disposition})`)
- `src/services/settings.ts` -- setting-key consts (`TIMEZONE_SETTING_KEY` etc); ADD `FAB_HANDEDNESS_SETTING_KEY='fab_handedness'` + a `readFabHandedness(db,userId)` (`'left'|'right'`, default `'right'`)
- `src/routes/settings.ts` -- add `fabHandedness` to the GET payload; ADD `PUT /settings/fab-handedness` (Zod enum left|right, copy the timezone PUT)
- `web/settings/api.ts` -- `settingsSchema` (+`fabHandedness` default `'right'`); ADD `saveFabHandedness(handedness)`
- `web/shell/Fab.tsx` + `web/shell/fab.css` -- add Export CSV item (native `<a href="/api/export.csv" download>` styled `.fab__item`, no mutation); `.fab--left` modifier + template the root className from a new `handedness` prop
- `web/shell/AppShell.tsx` -- pass `handedness={settings?.fabHandedness}` to `<Fab>` and `onSignOut` to `<SettingsPanel>`
- `web/settings/SettingsPanel.tsx` + css -- add handedness toggle (right/left), a Sign out button (calls `onSignOut`), and an About/Help section
- Tests: `src/core/csv.test.ts`, `test/integration/{export,settings}.test.ts`, `web/shell/Fab.test.tsx`, `web/settings/SettingsPanel.test.tsx`, `playwright/e2e/epic6.spec.ts` + `playwright/COVERAGE.md`

## Tasks & Acceptance

**Execution:**
- [x] `src/core/csv.ts` -- add pure `toCsv` (RFC-4180 serialize; round-trips with `parseCsv`) -- CSV write path
- [x] `src/routes/export.ts` (new) + `src/routes/index.ts` -- `GET /api/export.csv`: `loadLibrary` → fixed column set (title, statuses, milestones, lifecycle dates, ownership, genres joined) → `toCsv` → attachment response; `requireAuth` -- export endpoint
- [x] `src/services/settings.ts` + `src/routes/settings.ts` + `web/settings/api.ts` -- `fab_handedness` key + `readFabHandedness`, GET payload field, `PUT /settings/fab-handedness` (enum), client `saveFabHandedness` -- handedness persistence
- [x] `web/shell/Fab.tsx` + `fab.css` -- Export CSV drawer item (native download link) + `.fab--left` modifier driven by a `handedness` prop -- drawer item + placement
- [x] `web/shell/AppShell.tsx` -- pass `handedness` to Fab and `onSignOut` to SettingsPanel -- wiring
- [x] `web/settings/SettingsPanel.tsx` + css -- handedness right/left control (PUT + invalidate `['settings']`), Sign out button, About/Help section (no Sony marks) -- settings additions
- [x] `src/core/csv.test.ts` -- `toCsv` cases: quoting (comma/quote/newline), embedded-quote doubling, empty, `parseCsv(toCsv(x))` round-trip -- serializer check
- [x] `test/integration/export.test.ts` (new) -- export returns `text/csv` + attachment header, a header row + one row per tracked game (genres/ownership present), 401 unauth; `settings.test.ts` -- handedness PUT persists + GET reports it, 400 on bad value -- endpoint coverage
- [x] `web/shell/Fab.test.tsx` + `web/settings/SettingsPanel.test.tsx` -- Export item present with the right href/download; `.fab--left` when handedness left; handedness toggle fires PUT; Sign out calls `onSignOut`; About/Help renders -- component behavior
- [x] `playwright/e2e/epic6.spec.ts` + `playwright/COVERAGE.md` -- e2e: Export item triggers a download (`waitForEvent('download')`); handedness toggle moves the FAB and persists across reload; Sign out returns to login; About/Help visible; COVERAGE rows map 6.3 ACs -- TR-3
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- story 6-3 status per convention

**Acceptance Criteria:**
- Given the FAB drawer, when I tap "Export CSV", then the full library (games, statuses, milestones, lifecycle dates, genres, ownership) downloads as a CSV file streamed from D1 (FR-49, AR-25)
- Given the Settings surface, when I change FAB handedness, then the FAB moves between bottom-right and bottom-left and the choice persists across reloads (UX-DR10)
- Given Settings, when it opens, then I can sign out and view About/Help (FR-47)

## Design Notes

- Export is a native `<a href download>` (cookie carried on same-origin navigation), not a fetch/blob — the laziest correct download; the endpoint is `requireAuth` so an expired session lands on the JSON 401 (acceptable, rare).
- `toCsv` is pure `core/` and the inverse of `parseCsv` — the round-trip test pins both together; no CSV dependency (~10 lines).
- Handedness is one more `setting` key beside timezone/psn_cookie — no new table, same GET-payload + PUT pattern; the FAB just templates a modifier class off the settings query.

## Verification

**Commands:**
- `bun run typecheck` -- expected: clean
- `bun run lint` -- expected: clean
- `bun run test` -- expected: all vitest projects green incl. new `toCsv` + `export.test.ts` + handedness cases
- `bun run test:e2e` -- expected: epic6 spec green (download, handedness persist, sign-out, About/Help), no regressions
