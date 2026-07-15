---
title: 'PSN region setting in the Settings panel'
type: 'feature'
created: '2026-07-15'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'f7fab4cc6ecc18eeeaeb2807cb3671fa9d27cc06'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The PS+ catalog is region-scoped, but the only way to set the region is the `PSN_REGION` Wrangler var — there is no UI or API write path. The catalog's "NO REGION" empty state even tells the user to "Set your PlayStation region" in Settings, where no such control exists.

**Approach:** Expose the region in `GET /api/settings`, add `PUT /api/settings/psn-region`, and add a Settings-panel section with a small text input. Region feeds only the **anonymous** PS+ catalog calls (locale header, no credential), so this is untouched by the Epic 11 PSN-credential sanitization.

## Boundaries & Constraints

**Always:**
- Keep the existing precedence: saved `SETTING` wins, `PSN_REGION` var only seeds (`getPsnRegion` stays the single read path).
- Validate as a store locale: trim + lowercase, must match `/^[a-z]{2}(-[a-z]{2,4})?-[a-z]{2}$/` (e.g. `it-it`, `en-us`, `zh-hans-hk` — review 2026-07-15: Sony has 3-part locales); reject otherwise with 400.
- When a PUT actually changes the stored region, clear `psplus_refreshed_at` + `psplus_refresh_failed` server-side (review 2026-07-15, human-approved Ask-First): the old region's stamps describe a catalog the new region never had.
- On save, client invalidates the `settings` and catalog queries so the browse page falls into its existing "EMPTY CATALOG — run the check" state for the new region.
- Follow the existing route/panel patterns (`fab-handedness` PUT, NPSSO section markup and feedback conventions).

**Ask First:**
- Any change to catalog prune/refresh behavior beyond what already exists (region flip is already self-healing via `deleteCatalogOutsideRegion` on the next check).

**Never:**
- No region dropdown with a pinned locale list (Sony's set drifts; free text + format guard).
- No automatic PS+ check trigger on region save.
- No changes to credentialed PSN paths (Epic 11 territory).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save valid region | `PUT {"region":" IT-IT "}` | Normalized `it-it` persisted to `SETTING` key `psn_region`; responds `{region:"it-it"}` | N/A |
| Invalid format | `"italy"`, `""`, `"it_IT"`, missing body | Nothing written | 400 `{error:'invalid region'}` |
| GET, region set | `psn_region` stored (or `PSN_REGION` seed present) | `region:"it-it"` in settings payload (effective value, seed included) | N/A |
| GET, nothing set | No setting, no var | `region: null` | N/A |
| Region changed | Catalog snapshot exists for old region | `psplus_refreshed_at` + `psplus_refresh_failed` cleared; catalog page shows existing EMPTY CATALOG state; next check fetches new region and prunes old rows | N/A |
| Same region re-saved | PUT with the already-stored value | Refresh stamps untouched (no false "never refreshed") | N/A |

</frozen-after-approval>

## Code Map

- `src/services/settings.ts:74` -- `getPsnRegion` (setting-wins-over-seed read; reuse, no change needed)
- `src/routes/settings.ts` -- GET payload + PUT endpoints; `fab-handedness` PUT is the pattern to copy
- `web/settings/api.ts` -- client contract: `settingsSchema` + save functions
- `web/settings/SettingsPanel.tsx` -- panel sections; NPSSO section shows input+save+feedback pattern
- `web/components/EmptyState.tsx:34` -- `no-region` copy that promises this control exists
- `test/integration/settings.test.ts` -- route tests live here
- `web/settings/SettingsPanel.test.tsx` -- panel tests
- `playwright/e2e/epic4-settings.spec.ts` -- settings e2e journeys (standing rule 2.5.4: UI AC ships with a Playwright test)

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/settings.ts` -- add `getPsnRegion(db, userId, c.env)` to the GET `Promise.all` and `region: region ?? null` to the payload; add `PUT /settings/psn-region` with a zod schema (`z.string().transform(trim+lowercase).pipe(regex)`) writing `PSN_REGION_SETTING_KEY` -- server write path
- [x] `test/integration/settings.test.ts` -- cover the I/O matrix rows (valid save + normalization, 400 on invalid, GET echo, GET null) -- route contract
- [x] `web/settings/api.ts` -- add `region: z.string().nullable().default(null)` to `settingsSchema` (deploy-skew default, same as siblings) and `savePsnRegion(region)` -- client contract
- [x] `web/settings/SettingsPanel.tsx` -- new "PlayStation region" section: current-value status line, text input (placeholder `it-it`), save button, polite feedback; on success invalidate `['settings']` and the catalog query key used by `web/catalog` -- the UI control
- [x] `web/settings/SettingsPanel.test.tsx` -- section renders current region, saves, shows feedback -- UI contract
- [x] `playwright/e2e/epic4-settings.spec.ts` -- one journey: open Settings, save a region, feedback shown -- standing rule 2.5.4

**Acceptance Criteria:**
- Given no region configured, when the user opens Settings, then a PlayStation region section shows "No region set" and accepts a locale like `it-it`.
- Given a saved region, when Settings reopens, then the current region is displayed.
- Given a region was just saved, when the user visits the PS+ catalog page, then it no longer shows NO REGION (shows EMPTY CATALOG until a check runs for that region).

## Spec Change Log

- 2026-07-15 (review iteration 1, human-approved renegotiation — not a loopback):
  - **Finding:** the 2-part locale regex rejects real Sony store locales (`zh-hans-hk`); **amended** the frozen validation rule to `/^[a-z]{2}(-[a-z]{2,4})?-[a-z]{2}$/`. Avoids: users in 3-part-locale storefronts locked out of the catalog feature.
  - **Finding:** a region change left the old region's "PS+ CATALOG AS OF" stamp and refresh-failed flag standing; **amended** Always + I/O matrix to clear both on a real change (Ask-First gate approved). Avoids: header dating a catalog the displayed region never had.
  - **KEEP:** free-text input (no pinned locale dropdown), no auto PS+ check on save, `getPsnRegion` as the single read path, e2e saving the already-stored locale (parallel-worker safety).

## Verification

**Commands:**
- `bun run test` -- expected: unit + integration suites pass, new region tests included
- `bunx biome check .` -- expected: clean
- `bunx playwright test epic4-settings` -- expected: settings journeys pass

## Suggested Review Order

**Server write path (validation + stamp clearing)**

- Locale shape guard: trim+lowercase, 3-part Sony locales allowed, no pinned list.
  [`settings.ts:187`](../../src/routes/settings.ts#L187)

- The PUT: persist, then clear the old region's refresh stamps only on a REAL change.
  [`settings.ts:194`](../../src/routes/settings.ts#L194)

**Read path**

- `region` joins the GET fan-out via `getPsnRegion` (effective value, seed included).
  [`settings.ts:113`](../../src/routes/settings.ts#L113)

**Client contract**

- Deploy-skew-safe schema field + the save function.
  [`api.ts:42`](../../web/settings/api.ts#L42)

**UI**

- Mutation wiring: save invalidates settings + both catalog queries.
  [`SettingsPanel.tsx:126`](../../web/settings/SettingsPanel.tsx#L126)

- The panel section: status line, guarded input, mirrored client-side regex.
  [`SettingsPanel.tsx:343`](../../web/settings/SettingsPanel.tsx#L343)

**Tests**

- Route contract: normalization, 400s, stamp clearing, seed precedence, auth.
  [`settings.test.ts:112`](../../test/integration/settings.test.ts#L112)

- Panel contract: status line, guard hint, PUT body, refetch confirmation.
  [`SettingsPanel.test.tsx:197`](../../web/settings/SettingsPanel.test.tsx#L197)

- E2e journey: saves the already-stored locale on purpose (parallel-worker safety).
  [`epic4-settings.spec.ts:256`](../../playwright/e2e/epic4-settings.spec.ts#L256)
