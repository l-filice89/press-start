---
title: 'Story 6.6: One picker for every IGDB match (PV-6)'
type: 'refactor'
created: '2026-07-13'
status: 'done'
baseline_revision: 'd64f780'
final_revision: 'dfa13c3'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/post-v1-backlog.md'
  - '{project-root}/playwright/COVERAGE.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** `AddGameDialog` shows whatever IGDB auto-matched (exact-normalized name, else top hit) with no way to correct it — a wrong match (PV-1: "Spider-Man 2" hits the 2004 tie-in) becomes a row the user must go rematch afterwards. And the candidate picker is already near-duplicated twice (`RematchDialog`, `StragglersDialog`'s `ResolveView`); adding a third copy in the add modal is the drift the `RematchDialog` comment named as the trigger to extract.

**Approach:** Extract the candidate list/search UI into a shared presentational `<IgdbMatchPicker>`, migrate both existing consumers onto it (no bespoke picker survives), and mount it in `AddGameDialog` behind a "Not the right game?" affordance that overwrites the local draft. UI consolidation only — no endpoint, no schema, no server change.

## Boundaries & Constraints

**Always:**
- The picker is presentational: it owns the search term, the committed query, the `['igdb-search', query]` TanStack query, the notices, the candidate list, and the Back button. Every mutation (`rematchGame`, `resolveStraggler`) and all straggler-kind handling stay page-side in the consumer.
- Existing `RematchDialog.test.tsx` and `StragglersDialog.test.tsx` must pass **unchanged** — they drive the picker through its "Use this match" button and are the migration's safety net. Keep the `stragglers__*` class names and both cover `data-testid`s (`rematch-candidate-cover`, `straggler-candidate-cover`).
- Picking a candidate in the add modal overwrites the **whole** draft (title, cover, release date, genres) and sets `seeded.current = true`, and the picked candidate's `igdbId` is what Save sends — prior edits were edits to the wrong game.
- Escape while the add modal's picker is open closes the **picker only**; the add modal stays open (`useModalTrap`'s `enabled` stand-down, the dance `DetailPanel` already does for rematch and `SettingsPanel` for its confirm).
- Reuse the existing seam only: `searchIgdb` → `GET /api/games/search` → `searchGamesForResolve`.

**Block If:**
- The migration cannot keep both existing dialog suites green without editing them (would mean the shared component changed observable behavior — stop, do not rewrite the tests to fit).

**Never:**
- No new endpoint, route, service, repository, or migration. No change to `searchGamesForResolve`, `pickIgdbMatch`, or the add/rematch/resolve write paths.
- Do not touch the auto-match ranking itself (that is PV-1/PV-2, already shipped/closed).
- Do not leave a third picker: after this story, `searchIgdb` has exactly one UI consumer — the shared component.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Wrong auto-match corrected | Add preview `available: true` with candidate A; user opens the picker and picks candidate B | Draft fully overwritten with B (title, cover, release date, genres); picker closes; Save posts B's `igdbId` | No error expected |
| IGDB unavailable | Preview `available: false` (no creds / IGDB down) or preview fetch throws | The "Not the right game?" affordance is **not rendered** — never an always-empty picker; the existing name-only notice still shows and Save still works | Degrades, no error surface |
| Preview available, no auto-match | `available: true`, `candidate: null` | Affordance **is** rendered (search can still find the game) alongside the existing "No games-DB match" notice | No error expected |
| Escape with the picker open | Add modal + stacked picker | Picker closes, add modal stays open and keeps its draft | No error expected |
| Search returns nothing / errors | Committed query yields `[]` or the query throws | Shared picker shows the existing "No games-DB match found — it may be down, or try a different name." notice | Notice only; no toast, no state change |

</intent-contract>

## Code Map

- `web/shelf/RematchDialog.tsx` -- current picker source (backdrop + dialog + trap + search form + candidate list + `rematchGame` mutation). The extraction's origin; keeps its shell, trap and mutation.
- `web/shelf/StragglersDialog.tsx` -- `ResolveView` (bottom half of the file) is the near-duplicate picker; migrates onto the shared component, keeps `resolveStraggler` + kind handling.
- `web/shelf/AddGameDialog.tsx` -- add preview + editable draft + `seeded` ref + `useModalTrap`; gains the affordance, the stacked picker and the draft overwrite.
- `web/shelf/api.ts` -- `searchIgdb`, `IgdbCandidate`, `fetchAddPreview` / `AddPreview` (`available`, `candidate`). Unchanged.
- `web/components/useModalTrap.ts` -- `enabled` option is the stacked-Escape stand-down. Unchanged.
- `web/shelf/stragglers-dialog.css` -- the picker's classes (`stragglers__search`, `__candidates`, `__candidate`, `__use`, `__notice`, `__actions`). Reused as-is by the shared component; the add modal imports it.
- `web/shelf/RematchDialog.test.tsx`, `web/shelf/StragglersDialog.test.tsx` -- the migration's unchanged safety net.
- `playwright/e2e/epic6.spec.ts` -- Epic 6 e2e; the e2e env has **no IGDB creds**, so the add-correction path needs route-stubbed `/api/games/preview` + `/api/games/search` (the justified-interception pattern already used in `epic1-shelf.spec.ts`).
- `playwright/COVERAGE.md` -- Epic 6 table; add 6.6 rows (TR-3 standing rule).

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/IgdbMatchPicker.tsx` -- new shared presentational picker: props `{ initialTerm, onPick(candidate), onBack, backLabel?, pending?, coverTestId? }`; owns term/query state, the `['igdb-search', query]` query (`enabled` on non-empty, `staleTime: 60_000`, `retry: false`), the Searching…/no-match notices, the candidate `<ul>` and the Back button. Markup and classes lifted verbatim from `RematchDialog` so both suites stay green.
- [x] `web/shelf/RematchDialog.tsx` -- replace the inline search/list/Back block with `<IgdbMatchPicker>`; keep the portal, backdrop, trap, heading and the `rematchGame` mutation (incl. the 409 copy). Drop the stale "extract only if a third picker appears" ponytail comment.
- [x] `web/shelf/StragglersDialog.tsx` -- `ResolveView` renders `<IgdbMatchPicker>`; keeps `resolveStraggler`, straggler-kind handling and its `onCancel`/`onResolved`/`onError` callbacks.
- [x] `web/shelf/AddGameDialog.tsx` -- add `picking` state; render a "Not the right game?" button (hidden when the preview is unavailable/errored) under the notices; when picking, render a stacked portal dialog (`stragglers` shell + own `useModalTrap`) holding `<IgdbMatchPicker initialTerm={draftTitle}>`, and set the parent trap `enabled: !picking`. On pick: overwrite all draft fields, set `seeded.current = true`, store the picked candidate as the igdbId Save sends, close the picker.
- [x] `web/shelf/AddGameDialog.test.tsx` -- new jsdom suite: affordance hidden when `available: false`; visible with a candidate; picking a candidate overwrites the draft; Save posts the picked candidate's `igdbId`.
- [x] `playwright/e2e/epic6.spec.ts` -- e2e for the add-modal correction path with route-stubbed preview + search (justified interception, comment it): open Add → "Not the right game?" → pick the second candidate → the draft shows it → Escape closes the picker only → Save → D1 row carries the picked `igdb_id`.
- [x] `playwright/COVERAGE.md` -- Epic 6 rows for 6.6 (add-modal correction = the new e2e; the two migrated dialogs = existing e2e + jsdom suites).

**Acceptance Criteria:**
- Given the add modal with an IGDB-seeded preview, when the user opens the picker and picks a different candidate, then the whole draft is replaced by that candidate and Save persists its `igdbId`.
- Given the preview reports `available: false`, when the add modal renders, then no "Not the right game?" affordance appears.
- Given the add modal's picker is open, when Escape is pressed, then the picker closes and the add modal remains open.
- Given the migration lands, when the suite runs, then `RematchDialog.test.tsx` and `StragglersDialog.test.tsx` pass **unedited**, and `searchIgdb` has exactly one UI consumer (`IgdbMatchPicker`).

## Spec Change Log

## Review Triage Log

### 2026-07-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 1: (high 0, medium 1, low 0)
- reject: 12
- addressed_findings:
  - `[medium]` `[patch]` `StackedPicker`'s trap lacked `restoreFocus` — closing the picker dropped focus to `<body>`, where the add modal's Tab-cycle branch no-ops and focus walks out of the open `aria-modal` dialog. Added `restoreFocus: true` + a jsdom regression test.
  - `[medium]` `[patch]` The affordance stayed clickable while the add POST was in flight: correcting mid-flight rewrote the draft under an already-sent payload (row commits the OLD game, toast names the NEW one). Now `disabled={mutation.isPending}`.
  - `[low]` `[patch]` A blanked Title seeded the picker with an empty term (no search, no list, no notice — a dead end). Falls back to the typed name.
  - `[low]` `[patch]` The jsdom pick test selected the candidate by list index; switched to selection by name so a reordered list can't silently click the wrong row. Also softened the COVERAGE 6.6d row, which overclaimed the migration as behaviour-identical for the add consumer.

Rejected as pre-existing or non-issues: the `picked`-igdbId-survives-a-retyped-title rule (a documented Story 6.1 decision, unchanged here), the toast reading `draftTitle` at settle time (closed by the in-flight guard), the shared `isError`/`empty` notice copy and `stragglers-*` class reuse (lifted verbatim, deliberate), duplicate-`igdbId` React keys (ids are unique), and picker term resync (`ResolveView` unmounts between stragglers).

## Design Notes

The shared picker is deliberately dumb — it never mutates. The three consumers differ only in what a pick *means* (re-point an existing game / resolve a straggler / overwrite a local draft), so `onPick(candidate)` is the whole seam:

```tsx
<IgdbMatchPicker
  initialTerm={game.title}
  pending={mutation.isPending}
  coverTestId="rematch-candidate-cover"
  onPick={(c) => mutation.mutate(c)}
  onBack={onClose}
/>
```

`coverTestId` exists only because the two existing suites assert different ids; it is the cheapest way to keep them unedited (the constraint the story sets), not a design flourish.

The add modal is the only consumer that stacks the picker over another dialog, so the stacked shell + `enabled: !picking` trap stand-down lives there, not in the shared component.

## Verification

**Commands:**
- `npx vitest run web/shelf` -- expected: green, with `RematchDialog.test.tsx` and `StragglersDialog.test.tsx` unmodified.
- `npx tsc -b --noEmit` (or the repo's typecheck script) -- expected: clean.
- `npx biome check web playwright` -- expected: clean.
- `npx playwright test playwright/e2e/epic6.spec.ts` -- expected: green, incl. the new add-correction test.
- `grep -rn "searchIgdb" web` -- expected: `api.ts` (definition) + `IgdbMatchPicker.tsx` only.

## Auto Run Result

Status: done

**Implemented:** one shared `<IgdbMatchPicker>` for every IGDB match. `RematchDialog` and `StragglersDialog`'s `ResolveView` migrate onto it (their suites pass unedited — the migration's safety net), and `AddGameDialog` mounts it behind a "Not the right game?" affordance that overwrites the whole draft and sends the picked `igdbId` on Save. UI consolidation only: no endpoint, service, repository or schema change.

**Files changed:**
- `web/shelf/IgdbMatchPicker.tsx` — new: the only UI consumer of `searchIgdb`; owns term/query, the candidate list and the notices, nothing else.
- `web/shelf/RematchDialog.tsx` — keeps its shell/trap/`rematchGame` mutation, renders the shared picker.
- `web/shelf/StragglersDialog.tsx` — `ResolveView` renders the shared picker; `resolveStraggler` + straggler kinds stay page-side.
- `web/shelf/AddGameDialog.tsx` — affordance (hidden when the games DB is unavailable, disabled mid-POST), stacked picker dialog with its own trap + focus restore, whole-draft overwrite, picked `igdbId` threaded to Save.
- `web/shelf/add-game-dialog.css` — quiet text-link style for the affordance.
- `web/shelf/AddGameDialog.test.tsx` — new jsdom suite (draft overwrite + igdbId, Escape closes the picker only, focus restore, affordance hidden when unavailable / shown when the DB is up but auto-matched nothing).
- `playwright/e2e/epic6.spec.ts` — e2e for the correction path (preview + search route-stubbed; the e2e env has no IGDB creds); asserts D1's `external_link.external_id` is the PICKED id.
- `playwright/COVERAGE.md` — 6.6a–d rows.
- `_bmad-output/implementation-artifacts/epic-6-context.md` — recompiled to cover 6.6.

**Review:** 4 patches applied (2 medium: focus restore, in-flight correction guard; 2 low: blank-term fallback, index-based test selector + coverage wording). 1 deferred (stacked modals leave the layer below live to assistive tech — a project-wide `useModalTrap` fix, not 6.6's). 12 rejected as pre-existing or noise. No HIGH findings.

**Verification:** `npx vitest run web/shelf` → 160 passed (incl. both migrated suites, unedited). `npx playwright test playwright/e2e/epic6.spec.ts` → 21 passed. `tsc -b` clean, `biome check web playwright` clean. `grep -rn searchIgdb web` → the definition plus `IgdbMatchPicker.tsx` only: no bespoke picker survives.

**Residual risks:** the affordance keys off the *preview* endpoint's `available` flag while the picker searches a different endpoint, so a warm preview + freshly-expired IGDB creds can still open a picker that answers "may be down" — the notice covers it, and both endpoints share one provider seam. The local full Vitest run shows load-timeout flakes in files this story does not touch (ConfirmDialog, LiveRegion, FilterRow, StatusPopover — each file's first test); isolated runs are green, CI is the arbiter.
