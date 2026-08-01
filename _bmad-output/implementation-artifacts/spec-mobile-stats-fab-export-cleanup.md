---
title: 'Mobile stats order and FAB removal'
type: 'feature'
created: '2026-08-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: '2d54fb4fe146d84f313a8e2772da1f6c4bd1aaea'
context:
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On phones, the year selector interrupts the Stats page before its all-time recap, while the global FAB obscures content despite containing only CSV export. Catalog already hides the FAB, leaving inconsistent chrome and an export action disconnected from Settings.

**Approach:** Put the phone Stats recap before the year selector, preserve the compact desktop placement, remove the FAB everywhere, and move the status-aware CSV download into Settings. Remove obsolete handedness UI/API wiring without migrating or deleting harmless legacy setting rows.

## Boundaries & Constraints

**Always:** Phone reading and focus order must be title → all-time recap → native year `<select>` → selected-year content. Desktop keeps the year selector beside the title and recap below. Export remains authenticated, downloads only a successful CSV response as `press-start-library.csv`, shows progress, and surfaces failure without saving an error body. Settings remains a focus-trapped dialog; Export uses a native button pattern. Update UI tests, Playwright coverage, and UX documentation with the change.

**Ask First:** Any proposal to remove CSV export, change CSV contents/API, delete persisted `fab_handedness` rows, or alter Stats aggregation.

**Never:** Duplicate the year selector, use CSS visual order that disagrees with phone DOM/focus order, retain an empty/hidden FAB shell, add a dependency, or reintroduce external calls on render.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Phone Stats | viewport ≤600px, populated library | recap cards precede CURRENT ROUND; round log follows selector | no horizontal overflow |
| Desktop Stats | viewport >600px | selector remains beside title; recap spans below | responsive CSS only |
| Export success | Settings open, `/api/export.csv` returns 200 | one click downloads `press-start-library.csv`; pending state is announced | close dialog only by existing controls |
| Export failure | non-200/network failure | no file is saved | toast says export failed; button becomes usable again |
| Legacy setting | user has `fab_handedness` row | app ignores row; no FAB/control/payload field | no migration or data loss |

## Signed-off Placement Mock

```text
PHONE STATS
PLAYER RECORD / ALL TIME
CABINET SCORE
[ TRACKED ] [ OWNED ]
[ COMPLETE] [ PLATINUM ]
CURRENT ROUND
[ year selector          ]
[ ROUND LOG + year totals ]
[ monthly / genres panels ]

PHONE SETTINGS
[ PlayStation region       ]
[ PlayStation Plus         ]
----------------------------
DATA BACKUP
Keep your own copy
Download your complete library as CSV,
including statuses, dates, genres, and ownership.
[ Export CSV               ]
----------------------------
[ About & Help             ]
```

Export section direction A approved from
`_bmad-output/design-demos/export-settings/A-standard-section.html`: a normal
peer section after PlayStation Plus and before About & Help. Pending button
label is `Exporting…`; failure uses the existing export-error toast.

</frozen-after-approval>

## Code Map

- `web/stats/StatsPage.tsx`, `web/stats/stats.css` -- responsive overview structure; phone DOM order and desktop grid placement.
- `web/settings/SettingsPanel.tsx`, `web/settings/api.ts`, `web/settings/settings-panel.css` -- CSV export action; remove handedness control/client contract.
- `web/shell/AppShell.tsx` -- remove shared FAB mounting and stale chrome documentation.
- `web/shell/Fab.tsx`, `web/shell/fab.css`, `web/shell/Fab.test.tsx` -- delete obsolete one-action component and suite.
- `src/routes/settings.ts`, `src/services/settings.ts` -- remove handedness response field, PUT endpoint, reader, and constants.
- `web/stats/StatsPage.test.tsx`, `web/settings/SettingsPanel.test.tsx`, `test/integration/settings.test.ts`, `playwright/e2e/{stats,epic4-settings,epic6}.spec.ts` -- pin order, export success/failure, FAB absence, and dead API removal.
- `playwright/COVERAGE.md` and Stats/FAB UX references -- record replacement flows and retired handedness behavior.

## Tasks & Acceptance

**Execution:**
- [x] Rebuild Stats overview DOM/CSS so phone order matches mock while desktop selector placement remains compact.
- [x] Move tested fetch/blob CSV download into Settings with pending and failure feedback.
- [x] Delete FAB component/styles/tests and remove AppShell mounting.
- [x] Remove handedness from client/server contracts and replace obsolete integration/UI assertions.
- [x] Update Playwright flows, coverage map, and relevant UX documentation.

**Acceptance Criteria:**
- Given a 390px Stats viewport, when the page loads, then all-time recap cards are above CURRENT ROUND, selected-year content is below it, and the page has no FAB or horizontal overflow.
- Given Shelf, Catalog, or Stats, when authenticated chrome renders, then no Chores FAB exists.
- Given Settings, when Export CSV succeeds, then a real CSV downloads with the expected filename; when it fails, then no file downloads and a retryable error toast appears.
- Given Settings/API responses, when inspected after the change, then FAB placement controls, `fabHandedness`, and `/api/settings/fab-handedness` no longer exist.

## Spec Change Log

## Design Notes

Place hero, recap, and selector in phone-correct DOM order inside one overview grid. At desktop width, assign the selector to row 1 / column 2 and let recap span row 2; at phone width, reset all grid placement to source order. This preserves semantics without duplicate controls.

Settings uses approved direction A: standard section rhythm, `DATA BACKUP`
eyebrow, `Keep your own copy` heading, explanatory copy, and a full-width
outlined cyan action. Do not promote export into a card or compress it into an
action row.

## Verification

**Commands:**
- `bun run lint` -- expected: clean.
- `bun run typecheck` -- expected: clean.
- `bun run test` -- expected: all Vitest projects green.
- `bun run test:e2e -- playwright/e2e/stats.spec.ts playwright/e2e/epic4-settings.spec.ts playwright/e2e/epic6.spec.ts` -- expected: affected UI flows green.

## Suggested Review Order

**Responsive Stats order**

- Entry point uses phone-correct source order without duplicate controls.
  [`StatsPage.tsx:93`](../../web/stats/StatsPage.tsx#L93)

- Desktop grid repositions selector; phone media query restores source flow.
  [`stats.css:15`](../../web/stats/stats.css#L15)

**Settings export**

- Export validates CSV, preserves 401 routing, cancels on close, and delays cleanup.
  [`SettingsPanel.tsx:45`](../../web/settings/SettingsPanel.tsx#L45)

- Approved direction A renders as normal Settings section.
  [`SettingsPanel.tsx:199`](../../web/settings/SettingsPanel.tsx#L199)

- Section styling follows existing Settings rhythm and cyan outlined action.
  [`settings-panel.css:60`](../../web/settings/settings-panel.css#L60)

**FAB retirement**

- Shared shell no longer mounts destination-obscuring chrome.
  [`AppShell.tsx:100`](../../web/shell/AppShell.tsx#L100)

- Settings response and endpoint no longer expose handedness.
  [`settings.ts:35`](../../src/routes/settings.ts#L35)

**Verification and contracts**

- Unit tests pin success, network/MIME failure, progress, cleanup, and cancellation.
  [`SettingsPanel.test.tsx:234`](../../web/settings/SettingsPanel.test.tsx#L234)

- Integration test preserves legacy row while pinning dead endpoint.
  [`settings.test.ts:262`](../../test/integration/settings.test.ts#L262)

- Browser geometry pins desktop and phone layouts.
  [`stats.spec.ts:36`](../../playwright/e2e/stats.spec.ts#L36)

- Browser flow verifies authenticated CSV and Settings-triggered download.
  [`epic6.spec.ts:532`](../../playwright/e2e/epic6.spec.ts#L532)

**UX record**

- Current design spine records no FAB, Settings backup, and responsive Stats semantics.
  [`DESIGN.md:135`](../planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/DESIGN.md#L135)
