---
title: 'Filter IGDB matches by selected PlayStation platforms'
type: 'feature'
created: '2026-08-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: '252db2a11e43f0eebc2b894f6e99fb4615b38594'
context:
  - '_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** IGDB title searches can return games never released on PlayStation, producing noisy or wrong add, rematch, and straggler candidates.

**Approach:** Persist a per-user PlayStation platform selection in Settings and apply its IGDB platform IDs to every interactive title search. Default to PS1–PS5 selected, with PSP, PS Vita, PSVR 1, and PSVR 2 available but unchecked.

## Boundaries & Constraints

**Always:** Store platform names (`PS1`…`PS5`, `PSP`, `PSVita`, `PSVR`, `PSVR2`), not provider IDs; map them server-side to IGDB IDs `7,8,9,48,167,38,46,165,390`, verified by authenticated `/v4/platforms` probe on 2026-08-15. Require at least one unique selection. Apply filtering only to title searches; saved games' score/TTB refresh by IGDB ID stays unfiltered. Treat IGDB `platforms` as released-on, not backward compatibility: PS5-only excludes PS4 releases playable on PS5. Invalidate cached `add-preview` and `igdb-search` queries after save. Native checkboxes use `<fieldset>/<legend>`, keyboard focus, text labels, 44px targets, and existing Settings typography, spacing, borders, buttons, and feedback styling.

**Ask First:** Change default away from PS1–PS5 only; add another platform; interpret PS5 as backward-compatible PS4; enforce selection against candidate payloads submitted directly rather than filtering discovery results.

**Never:** Add a schema migration, dependency, client-side result filtering, second IGDB request, or platform constraint to scheduled score/TTB refreshes. Do not filter out existing library rows.

### UI placement mock — approval required

```text
SETTINGS
  PlayStation region
    [ locale input ] [Save region]
  IGDB platforms
    Limit new IGDB matches to releases on:
    [x] PS1  [x] PS2  [x] PS3  [x] PS4  [x] PS5
    [ ] PSP  [ ] PS Vita  [ ] PSVR 1  [ ] PSVR 2
    [Save platforms]  status/error
  PlayStation Plus
  DATA BACKUP
  About & Help
                                      [Close]
```

| State / class | Phone | Desktop |
|---|---|---|
| Loaded/default | Same stacked section; controls wrap within modal; PS1–PS5 checked and four optional platforms unchecked when unset | Same hierarchy; controls wrap within existing 28rem modal |
| Edited | Save enabled when one or more selected | Same |
| None selected | Save disabled; inline text says one is required | Same |
| Saving/success/failure | Pending label; polite status; selection preserved on failure | Same |
| Regression | Existing Settings typography, spacing, borders, buttons, feedback, modal width, scroll, focus trap, region, PS+, export, About, and Close unchanged | Same; no breakpoint added or changed |

### External IGDB risk flag — approval required

- **Terms:** documented `/v4/games` platform filtering only; current non-commercial use remains governed by Twitch Developer Service Agreement.
- **Credential/account exposure:** existing Twitch app client ID/secret remain Worker-only; UI and API responses expose neither; no personal PlayStation account identifier is sent.
- **Legal:** no scraping, reverse engineering, or Sony branding change; PlayStation names are descriptive. Approval accepts continued reliance on IGDB/Twitch terms and data licensing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unset preference | No setting row | GET returns PS1–PS5; optional platforms render unchecked; searches use `(7,8,9,48,167)` | N/A |
| Saved subset | `PS4`,`PS5` | Stored atomically; later preview/picker query adds `platforms = (48,167)` | N/A |
| Invalid write | Empty, duplicate, unknown, malformed body | Nothing written | 400 `invalid platforms` |
| Corrupt stored value | Invalid JSON or unsupported value | Fall back to all five | No search outage |
| Provider failure | IGDB rejects/fails | Existing name-only/empty fallback remains | Existing surfaced fallback |

</frozen-after-approval>

## Code Map

- `src/services/settings.ts` -- add setting key, nine-option ID map, strict parse with PS1–PS5 fallback.
- `src/routes/settings.ts` -- GET selection and authenticated validated PUT; reuse generic `setSetting`.
- `src/providers/igdb.ts:237,342` -- optional search platform IDs and single combined `game_type & platforms` clause; shared by `enrich`, `searchCandidate`, `searchCandidates`.
- `src/routes/games.ts:29,142,168` -- read current user's setting before preview and multi-result provider creation; cron/by-ID paths remain unchanged.
- `web/settings/api.ts` -- deploy-skew-safe settings schema and save mutation.
- `web/settings/SettingsPanel.tsx` / `settings-panel.css` -- approved section, native checkbox group, feedback, and search-cache invalidation.
- `src/providers/igdb.test.ts` -- query-body hazard tests, including absence from by-ID refresh.
- `test/integration/settings.test.ts` -- default, round-trip, validation, corrupt fallback, auth, and user isolation.
- `web/settings/SettingsPanel.test.tsx` -- headings, selection states, request body, feedback, cache invalidation.
- `playwright/e2e/epic4-settings.spec.ts` / `playwright/COVERAGE.md` -- rendered save/reopen flow and AC ledger.

## Tasks & Acceptance

**Execution:**
- [x] `src/services/settings.ts`, `src/routes/settings.ts`, `test/integration/settings.test.ts` -- implement and pin per-user validated persistence without migration.
- [x] `src/providers/igdb.ts`, `src/routes/games.ts`, `src/providers/igdb.test.ts` -- add one server-side platform clause to interactive searches only.
- [x] `web/settings/api.ts`, `web/settings/SettingsPanel.tsx`, `web/settings/settings-panel.css`, `web/settings/SettingsPanel.test.tsx` -- implement approved accessible section and clear stale search caches after save.
- [x] `playwright/e2e/epic4-settings.spec.ts`, `playwright/COVERAGE.md` -- prove save/reopen UI behavior and map remaining provider-only behavior.

**Acceptance Criteria:**
- Given no preference, when Settings opens and preview or candidate search runs, then PS1–PS5 are selected, PSP/PS Vita/PSVR 1/PSVR 2 are unchecked, and IGDB receives only the five default IDs.
- Given an optional platform is selected, when the user saves and searches, then its verified IGDB ID joins the same platform clause.
- Given a user saves a subset, when they next use add preview, rematch, or straggler matching, then only that user's selected platform IDs constrain results.
- Given platform settings change, when prior preview/search data is cached, then it is removed so the next action refetches.
- Given scheduled score or TTB refresh, when its by-ID request runs, then no platform clause is present.
- Given phone or desktop Settings, when selection is saved and the modal reopens, then checked states persist without regressions to existing sections or modal behavior.

## Spec Change Log

## Verification

**Commands:**
- `bun run test -- src/providers/igdb.test.ts test/integration/settings.test.ts web/settings/SettingsPanel.test.tsx` -- expected: targeted contracts pass.
- `bun run test:e2e -- playwright/e2e/epic4-settings.spec.ts` -- expected: settings journey passes.
- `bun run lint && bun run typecheck && bun run build` -- expected: clean production checks.

## Suggested Review Order

**Server-side selection and filtering**

- Canonical names, verified IDs, defaults, and corrupt-value fallback define preference semantics.
  [`settings.ts:21`](../../src/services/settings.ts#L21)

- Both interactive routes compose each user's saved selection before provider creation.
  [`games.ts:50`](../../src/routes/games.ts#L50)

- One combined IGDB clause filters every interactive title-search method server-side.
  [`igdb.ts:350`](../../src/providers/igdb.ts#L350)

- Authenticated validation persists one non-empty, duplicate-free selection atomically.
  [`settings.ts:88`](../../src/routes/settings.ts#L88)

**Settings experience**

- Guarded hydration preserves edits while save state and cache invalidation remain coherent.
  [`SettingsPanel.tsx:60`](../../web/settings/SettingsPanel.tsx#L60)

- Native grouped checkboxes reuse existing Settings controls and responsive styling.
  [`SettingsPanel.tsx:227`](../../web/settings/SettingsPanel.tsx#L227)

**Verification**

- Integration coverage pins defaults, validation, persistence, isolation, and corrupt fallback.
  [`settings.test.ts:110`](../../test/integration/settings.test.ts#L110)

- Source guard prevents either interactive route from dropping per-user composition.
  [`games-platforms.test.ts:6`](../../src/routes/games-platforms.test.ts#L6)

- Component tests cover hydration, dirty refetches, pending state, failure, retry, and caches.
  [`SettingsPanel.test.tsx:69`](../../web/settings/SettingsPanel.test.tsx#L69)

- Browser journeys prove desktop persistence and 320px overflow-safe phone behavior.
  [`epic4-settings.spec.ts:42`](../../playwright/e2e/epic4-settings.spec.ts#L42)
