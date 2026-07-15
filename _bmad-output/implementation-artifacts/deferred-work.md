# Deferred Work

### DW-1: The I/O matrix's "SPA deep link" scenario has no automated test coverage

origin: migrated from legacy ledger (source_spec spec-1-1-deployable-project-scaffold-ci-cd.md), 2026-07-08
location: worker/index.ts (ASSETS.fetch fallback) / wrangler.jsonc test env
reason: `vitest-pool-workers` has no working `ASSETS` binding without a real assets directory wired into `wrangler.jsonc` — adding a request through `worker/index.ts`'s `ASSETS.fetch` fallback throws `TypeError: Cannot read properties of undefined (reading 'fetch')` in the test environment. Wiring a real directory in for tests risks disturbing the `@cloudflare/vite-plugin`'s own build-time assets config used by the already-verified production deploy. The scenario is confirmed working by hand (local `vite dev` + live production curl at `https://ps-game-catalog.l-filice-89.workers.dev`), just not by an automated regression test.
status: done 2026-07-08
resolution: resolved by sweep bundle dw-shelf-deep-link-test-coverage

### DW-2: GitHub Actions in ci.yml/deploy.yml are pinned to floating major-version tags rather than commit SHAs

origin: migrated from legacy ledger (source_spec spec-1-1-deployable-project-scaffold-ci-cd.md), 2026-07-08
location: .github/workflows/ci.yml, .github/workflows/deploy.yml
reason: Actions like `actions/checkout@v4` and `oven-sh/setup-bun@v2` use floating major-version tags. Standard supply-chain hardening practice for public/production repos — a compromised or buggy release of a major-tag-pinned action could silently affect CI/CD. Low urgency for a private, solo-maintained repo today; worth doing before the repo goes public.
status: done 2026-07-08
resolution: already resolved: Actions are now pinned to commit SHAs — .github/workflows/ci.yml:16 `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1` and :19 `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`; same in deploy.yml:33/:36. Fixed in commit bb1425c 'chore: pin CI actions to commit SHAs; triage epic 1 deferred work'.

### DW-3: A 401 from an expired session on the shelf shows a generic error rather than routing to sign-in

origin: migrated from legacy ledger (source_spec spec-1-7-the-read-only-shelf.md), 2026-07-08
location: web/shelf/api.ts, web/shelf/Shelf.tsx
reason: `web/shelf/api.ts` throws on any non-OK status and `Shelf.tsx` maps every error to the same "couldn't load" message; "Refresh" won't re-authenticate. This story stopped the pointless 3× retry (query client skips 4xx), but a proper re-auth redirect is an app-wide auth-UX concern (better-auth session lifecycle), out of scope for the read-only shelf. Should be handled once, centrally, when the authed-navigation shell is built out.
status: done 2026-07-09
resolution: resolved by sweep bundle dw-central-401-reauth-redirect
decision: 2026-07-08 Build central 401 re-auth — On a 401 from an authed query, clear/refetch the better-auth session so App.tsx's existing gate renders <Login/> (route to sign-in). Wire it once centrally (react-query global onError or a shared fetch wrapper in api.ts) rather than per-component, keeping the shelf's generic message only for genuine non-auth failures.

### DW-4: Shelf card grid is a single ARIA row while arrow-key nav moves in 2-D by column count

origin: migrated from legacy ledger (source_spec spec-1-7-the-read-only-shelf.md), 2026-07-08
location: web/shelf/Shelf.tsx
reason: The card grid is a single ARIA `role="row"` holding all gridcells, while arrow-key nav moves in 2-D by measured column count — so assistive tech announces a 1×N structure that doesn't match the visual/navigational rows. `Shelf.tsx` renders every card in one `.shelf__row`; Up/Down move by `columnCount()`. Reading-order (Left/Right) traversal — the stated a11y-floor invariant — is fully satisfied, so this is a refinement, not a floor break. A faithful fix needs DOM rows that track the responsive `auto-fill` column count (which changes with viewport), a non-trivial layout/ARIA problem better solved deliberately than patched inline.
status: done 2026-07-08
resolution: resolved by sweep bundle dw-shelf-grid-aria-row-regrouping

### DW-5: No Dependabot/Renovate config keeps the new SHA pins in ci.yml/deploy.yml current

origin: migrated from legacy ledger ("Deferred from: code review (2026-07-08)"), 2026-07-08
location: .github/dependabot.yml (does not exist)
reason: A pinned SHA plus its trailing version comment (`# v4.3.1`) can silently drift apart over time with no automated nudge to update either. Pinning `actions/checkout` and `oven-sh/setup-bun` to commit SHAs hardens supply-chain trust only if the pins get refreshed; without a bot, they rot unnoticed.
status: done 2026-07-08
resolution: resolved by sweep bundle dw-ci-dependabot-config

### DW-6: Two ACs added to Story 6.3 in epics.md have no thematic fit with that story's scope

origin: migrated from legacy ledger ("Deferred from: code review (2026-07-08)"), 2026-07-08
location: _bmad-output/planning-artifacts/epics.md (Story 6.3)
reason: The two ACs added to Story 6.3 ("Chores — CSV export & settings") — 401 re-auth redirect and shelf-grid ARIA row regrouping — were placed there only because it was a convenient existing "chores" bucket, not because of deliberate epic planning. Story 6.3 is about CSV export and app settings; a centralized session-auth redirect and a shelf-grid ARIA/DOM-structure rework are unrelated concerns bolted onto its AC list with no new story id or rationale.
status: done 2026-07-09
resolution: resolved by sweep bundle dw-decision-dw-6
decision: 2026-07-08 Relocate to a dedicated story — Remove the two ACs from Story 6.3 and create a dedicated home (a new story or an app-hardening story) for the centralized re-auth redirect (DW-3) and shelf-grid ARIA regrouping (DW-4), each carrying proper FR/AR/UX-DR requirement references and explicit cross-references to their deferred-work ids. Fixes DW-6, DW-7, and DW-8 together.
decision: 2026-07-08 Relocate to a dedicated story — Remove the two ACs from Story 6.3 and create a dedicated home (a new story or an app-hardening story) for the centralized re-auth redirect (DW-3) and shelf-grid ARIA regrouping (DW-4), each carrying proper FR/AR/UX-DR requirement references and explicit cross-references to their deferred-work ids. Fixes DW-6, DW-7, and DW-8 together.

### DW-7: The two new Story 6.3 ACs duplicate deferred-work.md entries verbatim with no cross-reference

origin: migrated from legacy ledger ("Deferred from: code review (2026-07-08)"), 2026-07-08
location: _bmad-output/planning-artifacts/epics.md, _bmad-output/implementation-artifacts/deferred-work.md
reason: The two new ACs (the "Given a 401 from an expired session..." and "Given the shelf card grid on any viewport..." ACs) duplicate the wording of two existing deferred-work.md entries (the Story 1.7 401-error item DW-3 and ARIA-grid item DW-4) almost verbatim, with no cross-reference between the two files — future edits to one won't propagate to the other.
status: done 2026-07-09
resolution: resolved by sweep bundle dw-decision-dw-6
decision: 2026-07-08 Add cross-references — When the two ACs are relocated or kept, add explicit bidirectional cross-references linking the epics.md ACs to deferred-work ids DW-3 and DW-4 so edits stay in sync. Executed as part of the DW-6 resolution.

### DW-8: The two new Story 6.3 ACs cite no FR/AR/UX-DR requirement id, breaking epics.md traceability

origin: migrated from legacy ledger ("Deferred from: code review (2026-07-08)"), 2026-07-08
location: _bmad-output/planning-artifacts/epics.md
reason: Every other AC in the file ends with a bracketed requirement reference (e.g. `FR-49, AR-25`, `UX-DR10`); the two new ACs cite only "deferred from Story 1.7" in prose, breaking the document's own traceability convention.
status: done 2026-07-09
resolution: resolved by sweep bundle dw-decision-dw-6
decision: 2026-07-08 Add requirement refs — Add bracketed FR/AR/UX-DR requirement references to the two ACs (or their relocated home) to restore epics.md traceability. Executed as part of the DW-6 resolution.

### DW-9: epic1-shelf 1.7c (infinite scroll) flaked once under heavy parallel load; one full-suite run also saw a broad 13-test wobble under machine contention

origin: spec-3-5-reveal-pill-exclusive-mode.md verification runs, 2026-07-10
location: playwright/e2e/epic1-shelf.spec.ts:135 (sentinel-reveal timing)
reason: During 3.5's verification, one full run failed 13 tests broadly (incl. auth-journey and epic1 basics — machine contention, all green on the next run), and a later run failed only 1.7c (green in isolation and in the two consecutive full runs after). Not the fold-position hazard 3.5 fixed (that pair is closed); this is sentinel/IntersectionObserver timing under load. Watch — if 1.7c fails again in a full run, give it the loadAllPages-style mitigation or a longer sentinel poll.
status: done 2026-07-13
resolution: discarded (watch closed) 2026-07-13 triage — 1.7c has not flaked again in any full-suite run across Epics 4, 5, 6 and 8.1, and the two named races were fixed meanwhile (3.5's loadAllPages mitigations; 3.6 replaced the openStatusMenu retry loop with a deterministic networkidle quiescence gate). Nothing to fix against a race that stopped reproducing — re-open on a fresh failure. (The summary/evidence/decision block below belongs to the shelf-resize focus item, which shipped in Story 3.4 — a legacy-migration artifact, left for provenance.)
  summary: Shelf resize that changes the auto-fill column count remounts the focused card (row `div`s keyed by index; a card moves to a different parent when re-chunked), dropping browser focus.
  evidence: React reconciles keyed children per parent — moving a `game.id`-keyed `Card` from one index-keyed `role="row"` div to another forces unmount+remount, so a card holding keyboard focus loses it and its `cardRefs` entry resets during a viewport resize crossing a column boundary. Roving-tabindex/reading-order invariants still hold, but active keyboard focus is lost mid-resize. Inherent to the mandated `display:contents` row grouping; not trivially fixable without restructuring the ARIA grouping.
  decision: 2026-07-10 Assigned to Story 3.4 (Focus & interaction hardening) — deferred-work triage sweep; Epic 3 filter churn promotes this from corner case to daily path. DONE 2026-07-10 (story 3.4): grid-level focus restoration effect (gridHadFocus + roving-index sync); pinned by Shelf.test.tsx + epic3-focus.spec.ts AC1.

- source_spec: `_bmad-output/implementation-artifacts/spec-dw-3-central-401-reauth-redirect.md`
  summary: An auth-state transition swaps the authenticated shell for `<Login />` with no focus management and no live-region announcement, so a keyboard or screen-reader user is silently dropped at the document start.
  evidence: `web/App.tsx`'s session gate re-renders a different subtree when `session` becomes `null` (on a 401 re-auth redirect, and equally on an explicit sign-out — so this predates the 401 work). React unmounts the focused element and focus falls back to `document.body`; nothing moves focus into the Login form or announces the change. Both entry points into `<Login />` share the gate, so a single focus/announcement fix at the gate covers them.
  decision: 2026-07-10 Assigned to Story 3.4 (Focus & interaction hardening) — deferred-work triage sweep.
  resolution: done (verified 2026-07-11, stamp backfilled) — fixed in `web/Login.tsx` (mount effect at :56 focuses the email input and announces the swap via the hoisted LiveRegionProvider), landing at the destination rather than the gate so a single fix covers both entry points (401 re-auth + explicit sign-out) and a cold load. Pinned by `web/Login.test.tsx` ("focuses the email input and announces the swap on mount").

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-change-play-status-from-the-shelf.md`
  summary: Marking a game `Dropped` unmounts its card on the shelf refetch, dropping keyboard focus to `document.body` — including focus needed to reach the toast's UNDO.
  evidence: `StatusPopover.select()` calls `close()`, which refocuses the pill; the mutation then invalidates `['shelf']`, the server filters the Dropped game out (FR-4), and React unmounts the card that owns the pill. Same defect class as DW-4 (shelf-grid focus on re-chunk) and the auth-gate focus item — a deliberate focus-restoration strategy for cards leaving the shelf, not an inline patch.
  decision: 2026-07-10 Assigned to Story 3.4 (Focus & interaction hardening) — deferred-work triage sweep. DONE 2026-07-10 (story 3.4): same restoration effect lands focus on the clamped-index neighbor; UNDO Tab-reachable. Pinned by Shelf.test.tsx + epic3-focus.spec.ts AC3.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-change-play-status-from-the-shelf.md`
  summary: The `Dropped` toast offers no UNDO when the game's previous play status was null (status cleared by a completion milestone).
  evidence: `StatusPopover.select()` gates the undo on `next === 'Dropped' && previous`, and `previous` is `game.playStatus`, which is null for any game whose status was auto-cleared by a milestone (FR-2). Restoring that state means writing `play_status = null`, which Story 2.1's route deliberately cannot express (it accepts only the five play statuses; clearing goes through the FR-3/AD-12 invariant guard in Story 2.2/2.3). Unreachable on the default shelf today — milestone games are hidden (FR-17) — but reachable as soon as Epic 3's state-reveal pills or Story 2.3's detail panel render those cards. Fix alongside the milestone write path.
  decision: 2026-07-10 Assigned to Story 3.2 as an AC (reveal pills make it reachable) — deferred-work triage sweep; cross-referenced in epics.md.
  resolution: done (verified 2026-07-11, stamp backfilled) — the undo now fires for `next === null` as well as `Dropped` (`web/shelf/useTrackingMutations.ts:203`); the restore mutates `previous` (nullable) back through the write path, which accepts null and satisfies the completion invariant via the milestone. Reachable via reveal pills as planned.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-change-play-status-from-the-shelf.md`
  summary: Lifecycle dates are stamped from the Worker's UTC clock, so an evening status change west of Greenwich records tomorrow's date, permanently.
  evidence: `src/routes/tracking.ts` computes `today` as `new Date().toISOString().slice(0, 10)`. `started_on` is write-once through automatic flows and explicitly unreconstructable (FR-44/FR-45, AD-11), so a wrong value never self-corrects. No PRD, architecture, or UX document picks a timezone policy, and the same choice binds `completed_on`/`platinum_on` (Story 2.2) and `bought_on` (Story 2.4) — an app-wide decision (store the user's zone in `SETTING`? stamp client-side?) rather than a per-route patch.
  decision: 2026-07-09 Policy decided by the Epic 2 retro — capture the browser timezone into `SETTING` at first login, user-editable in Settings; all four date-stamp sites compute "today" in that zone. Implement early Epic 3 (kept out of Epic 2.5, which is Playwright-only per 2026-07-09 scoping).
  resolution: done 2026-07-10 — `setting` table (migration 0003), browser zone captured via `PUT /api/settings/timezone` (`onlyIfUnset`) from `App.tsx` on login, all stamp sites route through `todayForUser` → `todayInZone` (core, unit-tested); endpoint supports plain-PUT edits, the Settings-page UI hooks in at Story 6.3.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-log-completion-milestones-confirm-gated.md`
  summary: Milestone dates (`completed_on`/`platinum_on`) are stamped from the Worker's UTC clock — same undecided timezone policy as the 2.1 deferral, but now the wrong date is user-visible (shown on the achieved milestone row) and immutable (FR-6).
  evidence: `src/routes/tracking.ts` computes `today` as `new Date().toISOString().slice(0, 10)` on the milestone POST, mirroring the play-status PATCH. The 2.1 deferral already names this an app-wide policy decision binding Stories 2.2 and 2.4; 2.2 raises its stakes because the achieved row displays the stamped date and write-once means it never self-corrects. Resolve once, app-wide (user timezone in `SETTING`, or client-supplied date), not per route.
  decision: 2026-07-09 Same policy as the 2.1 entry — browser timezone in `SETTING` at first login, editable in Settings, used at all stamp sites; implement early Epic 3.
  resolution: done 2026-07-10 — same fix as the 2.1 entry (the milestone POST stamps through `todayForUser`).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-flip-a-card-to-its-detail-view.md`
  summary: Three hand-rolled focus traps (ConfirmDialog, DetailPanel, and their shared technique) each duplicate ~20 lines and key off a `querySelectorAll('button…, a[href]')` selector that will silently miss the `<input>`/`<select>` controls Stories 2.4/2.5 add to the detail panel.
  evidence: `web/components/ConfirmDialog.tsx` and `web/shelf/DetailPanel.tsx` both implement first/last-focusable Tab cycling with near-identical code but already-drifted selectors (`button` vs `button:not([tabindex="-1"]), a[href]`). When date/ownership/genre editing lands in the panel (2.4/2.5), form controls become focusable but invisible to the trap boundary — Tab can escape the modal at the new controls. Consolidate into one trap helper (or adopt native `<dialog>.showModal()`) before 2.4 adds inputs.
  resolution: done 2026-07-10 (triage sweep) — the hazard was fixed in Story 2.4: both dialogs import the shared `FOCUSABLE_SELECTOR` from `web/components/focusable.ts`, which covers `input`/`select`, so Tab cannot escape at form controls and the selectors can no longer drift. The residual ~20-line trap-loop duplication is accepted as-is (YAGNI) — revisit only if a third dialog appears.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-edit-ownership-and-lifecycle-dates-in-detail.md`
  summary: Every tracking write is an untransacted read-decide-write (`getTracking` → core → `upsertTracking`), so concurrent PATCHes can interleave — double-stamping write-once `bought_on`, persisting a type on an un-owned row, or breaking the completion invariant via a status-clear racing a milestone-date-clear; the "deleted underneath us" comment on the post-upsert guard is also wrong (the upsert is insert-or-update and always returns a row — a concurrent delete is silently resurrected, not 404'd).
  evidence: `src/services/tracking.ts` (all four write functions, pattern established in 2.1) and `src/repositories/tracking.ts:30` (`onConflictDoUpdate` + `returning()`). D1 has no interactive transactions from Drizzle here; a fix is conditional UPDATEs (`WHERE bought_on IS NULL`, invariant re-checked in SQL) — a seam-wide change, not a per-route patch. Single-user app today, so exposure is one person's own racing tabs.
  decision: 2026-07-09 Fix now — promoted by the Epic 2 retro; Luca triages and schedules the fix post-retro (conditional UPDATEs enforcing write-once/invariants in SQL).
  resolution: done 2026-07-10 — all four write paths now go through guarded UPDATEs in `repositories/tracking.ts`: write-once dates via `COALESCE`/`CASE` in the SET, completion invariant and owned-only type switches re-checked in the WHERE; the update never inserts, so a row deleted underneath us answers 404 instead of being resurrected (misleading comment gone with the upsert calls).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-edit-ownership-and-lifecycle-dates-in-detail.md`
  summary: Toast UNDO callbacks (`Dropped` status since 2.1, un-own in 2.4) call the raw mutation directly, bypassing the in-flight pending guard every other entry point gets, so an UNDO can interleave with a pending write on the same game.
  evidence: `web/shelf/useTrackingMutations.ts` — `onUndo: () => mutate(previous)` and `onUndo: () => mutateOwnership(...)` skip the `isPending` check because the guard value is a stale render-scoped closure. Last-write-wins, no corruption; fix once with a ref-backed guard shared by all mutation entry points.
  decision: 2026-07-10 Assigned to Story 3.4 (Focus & interaction hardening) — deferred-work triage sweep. DONE 2026-07-10 (story 3.4): single ref-backed guardPending shared by every entry point incl. both UNDO closures. Pinned by StatusPopover.test.tsx.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-edit-ownership-and-lifecycle-dates-in-detail.md`
  summary: `bash.exe.stackdump` is a tracked crash-dump junk file that keeps riding into diffs as line-ending churn; delete it and gitignore `*.stackdump`.
  evidence: `git ls-files` lists it at the repo root; it re-appeared in this story's working tree as CRLF churn (reverted during review). Not this story's artifact — a one-commit cleanup.
  resolution: done 2026-07-10 (verified in triage sweep) — file no longer tracked (`git ls-files` empty) and `.gitignore:48` carries `*.stackdump`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-edit-genres-in-detail.md`
  summary: Case-insensitive genre dedup is check-then-insert in the service; the `genre.name` unique constraint is case-sensitive, so two concurrent adds of case-variants ("Action"/"action") can still mint the near-duplicate FR-24 forbids.
  evidence: `src/services/genres.ts` (`findGenreByNameInsensitive` → `upsertGenre`) with `src/schema/catalog.ts` `genre.name` `unique()` on BINARY collation. Fix is a `lower(name)` (or COLLATE NOCASE) unique index via a migration — same untransacted-write-seam family as the 2.4 deferral; single-user exposure only.
  decision: 2026-07-09 Fix now — promoted by the Epic 2 retro; Luca triages and schedules the fix post-retro (NOCASE unique index migration).
  resolution: done 2026-07-10 — migration 0003 merges any pre-existing case-variant genres (links repointed via INSERT OR IGNORE, losers deleted) then creates the `lower(name)` unique index; schema carries `genre_name_nocase_uidx`.

- source_spec: `_bmad-output/implementation-artifacts/spec-shelf-order-owned-tier.md`
  summary: Decide whether the FR-18 ownership tier also applies to Epic 3 filtered/reveal-pill shelf views (they flow through the same orderShelf), and document it in the Epic 3 spec.
  evidence: orderShelf is the single ordering seam (AD-7); any future filtered view silently inherits owned-first with no artifact stating whether that is intended.
  decision: 2026-07-09 Decided by the Epic 2 retro — the owned-before-wishlisted tier applies to ALL shelf views, filtered/reveal included. Document the FR-18 amendment in epics.md/PRD before Story 3.1 (kept out of Epic 2.5, which is Playwright-only).
  resolution: done 2026-07-09 — FR-18 amended in prd.md, epics.md, and EXPERIENCE.md (retro action item closed 2026-07-09; verified in the 2026-07-10 triage sweep).

- source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-07-09.md`
  summary: Local integration test runs email Luca a real magic link — `vitest-pool-workers` loads `.dev.vars` as bindings, so tests get a real `RESEND_API_KEY` and `providers/email.ts` selects the real Resend provider; the `vitest.config.ts` comment claiming secrets "don't exist in the test environment" is only true in CI.
  evidence: Epic 2 retro challenge #2 and action item 4. Fix: force `RESEND_API_KEY: ''` in the vitest miniflare bindings so the console provider always wins in tests, and correct the misleading comment. Success criterion: full local `bun test` run, zero emails received.
  decision: 2026-07-09 Fix scoped by the Epic 2 retro; kept out of Epic 2.5 (Playwright-only per 2026-07-09 scoping) — schedule as standalone fix or early Epic 3.
  resolution: done 2026-07-10 — `RESEND_API_KEY: ''` forced in the vitest miniflare bindings (console provider always wins), misleading comment corrected; full local `bun test` run passes with zero real emails.

- source_spec: `_bmad-output/implementation-artifacts/spec-platinum-only-auto-hide.md`
  summary: A detail panel opened from search on an already-hidden game (Dropped, or milestone-only) auto-closes on any milestone log because `onHidden` keys off the returned state being in `HIDDEN_STATES`, even when the write never changed the card's visibility.
  evidence: `web/shelf/useTrackingMutations.ts` milestone `onSuccess` — logging `completed` on a Dropped or platinum-first game returns `Dropped`/`Platinum achieved`, firing `onHidden` though the game was hidden before and after. Pre-existing (the old auto-clear path behaved the same); fix is comparing visibility before/after rather than testing the new state alone.
  decision: 2026-07-10 Assigned to Story 3.2 as an AC (reveal pills make detail-on-hidden a daily path) — deferred-work triage sweep; cross-referenced in epics.md. DONE 2026-07-10 (story 3.2): onHidden fires only on a visible→hidden transition in both status and milestone onSuccess. Pinned by DetailPanel.test.tsx + epic3-reveal.spec.ts.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-1-playwright-framework-auth-smoke-test.md`
  summary: CI burn-in job interpolates git-diff-derived spec filenames directly into a shell command (`bunx playwright test ${{ steps.changed.outputs.specs }}`).
  evidence: Pre-existing from dae7d7f but now merge-relevant via the ci-ok gate; a hostile filename under playwright/e2e/ would be shell-interpolated. Mitigated today by pull_request read-only fork tokens and a single-maintainer repo.
  resolution: done 2026-07-10 (triage sweep) — spec list now passed through an env var (`SPECS`) instead of `${{ }}` interpolation in the run script, matching the existing `BASE_REF` pattern in the same job.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-2-backfill-epic-1-e2e-flows.md`
  summary: Owned-toggle 44px hit-area overlay is diagonally clipped at the card cover's rounded corner (border-radius ~11px), so the extreme corner of the WCAG target square is not clickable.
  evidence: The overlay sits flush to the cover edge (offset = (44-22)/2) and .card__cover has overflow:hidden + border-radius; cardinal probes pass but a diagonal probe at the corner would fail. Upgrade path: move the toggle out of .card__cover (ponytail comment in web/shelf/card.css names it).
  decision: 2026-07-10 Discarded (accepted as-is) — triage sweep: only the extreme diagonal sliver of the 44px square is clipped, all cardinal probes pass, and the ponytail comment in card.css preserves the upgrade path. Revisit only on a real reported miss.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-3-backfill-epic-2-e2e-flows.md`
  summary: An open DetailPanel unmounts whenever a write's shelf refetch re-chunks the grid rows and remounts its Card (dialog open-state lives in Card).
  evidence: Reproduced under parallel e2e (other actors' rows shift positions); solo user only sees it when their own write reorders the card across a row boundary. Upgrade path is hoisting the open-panel game id to Shelf level. E2e tests assert post-write truths on the card or after reopen as a workaround (comment in epic2-detail.spec.ts).
  decision: 2026-07-10 Assigned to Story 3.4 (Focus & interaction hardening) — deferred-work triage sweep; includes converting the epic2-detail.spec.ts workaround assertions back to direct ones. DONE 2026-07-10 (story 3.4): openGameId hoisted to ShelfGrid, one panel looked up by id; epic2-detail + epic3-reveal asserts converted to direct stays-open. Pinned by Shelf.test.tsx + the converted e2e.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-4-standing-rule-every-ui-ac-ships-with-a-playwright-test.md`
  summary: The ORCHESTRATION CONSTRAINT fact ("NEVER delegate work to subagents") contradicts bmad-dev-auto's SKILL.md, which makes synchronous review subagents mandatory; sessions must reconcile the two ad hoc.
  evidence: Surfaced during Epic 2.5 runs — the constraint targets bmad-loop's background-detection gap (retired on Windows), but its wording forbids all subagents. Reword to forbid only background/detached delegation, keeping synchronous subagents legal.
  resolution: done 2026-07-10 (triage sweep) — fact reworded in `_bmad/custom/bmad-dev-auto.toml`: forbids only background/detached delegation and explicitly blesses same-turn synchronous subagents (TaskOutput block:true), matching SKILL.md's mandatory review subagents.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-filter-the-shelf-by-state-and-genre.md`
  summary: Epic 2 e2e specs flake under full-suite parallel load when their seeded card sits past the progressive fold (scrollIntoViewIfNeeded waits on an unrendered locator) or a popover-open races; observed on epic2-detail.spec.ts:127 (2.3c) and epic2-tracking.spec.ts:165 (2.1b), both green in isolation and on re-run.
  evidence: Full-suite run 2026-07-10 failed exactly these two while 34 passed; immediate isolated re-run and a second full-suite run passed 36/36. Failure snapshot shows the seeded 'Store Link' card absent from the rendered (unpaged) grid — same fold-position hazard epic1-shelf.spec.ts mitigates with loadAllPages/wishlist pads.
  decision: 2026-07-10 Assigned to Story 3.5 (reveal-pill exclusive mode) — epic 3 retro triage; mechanical fix (loadAllPages before the fold-sensitive assertions in epic2-detail.spec.ts:127 and epic2-tracking.spec.ts:165) bundled while the e2e suites are already being rewritten for the new reveal contract.
  resolution: done 2026-07-10 (story 3.5) — loadAllPages inserted before the post-backdrop aria-label assert (epic2-detail 2.3e) and the post-Undo reappearance asserts (epic2-tracking 2.1c).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-flag-pills-and-state-reveal-pills.md`
  summary: Tracking mutations invalidate only ['shelf'], never ['shelf-search'] — a detail panel opened from a search result renders from a payload that goes stale after any write (fields shown stale; becameHidden transition check reads a stale before-state in that path).
  evidence: web/shelf/useTrackingMutations.ts onSuccess handlers invalidate queryKey ['shelf'] only; SearchBox owns ['shelf-search', q]. Pre-existing seam (all Story 2.x writes had it), surfaced by the 3.2 review's look at becameHidden.
  decision: 2026-07-10 Assigned to Story 3.6 (write-path hardening, pre-sync) — epic 3 retro action item 2 — must land before Story 4.2 introduces sync as a new write source; invalidate ['shelf-search'] alongside ['shelf'] in every onSuccess.
  resolution: done 2026-07-10 (story 3.6) — one `invalidateShelfQueries()` helper replaces all six `['shelf']` invalidation sites (success + 409 paths) and adds the `['shelf-search']` prefix invalidation; pinned in StatusPopover.test.tsx.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-live-filter-summary-empty-state-responsive-filters.md`
  summary: The portal + backdrop-dismiss + document-capture-Escape + Tab-trap modal scaffold is now hand-copied in three components (ConfirmDialog, DetailPanel, FilterSheet) — extract one shared hook/component so the traps can't drift.
  evidence: web/components/ConfirmDialog.tsx, web/shelf/DetailPanel.tsx, and web/shelf/FilterRow.tsx FilterSheet each re-implement the same chrome nearly line for line; FilterSheet shipped with a trap hole ConfirmDialog had already solved, which is exactly the drift this duplication invites.
  decision: 2026-07-10 Assigned to Story 3.5 (epic 3 retro action item 4) — extract one shared trap hook/component for all three consumers while FilterSheet is already being touched for the exclusive reveal semantics.
  resolution: done 2026-07-10 (story 3.5) — `web/components/useModalTrap.ts` owns focus-on-open, document-capture Escape (with an `enabled` stand-down for DetailPanel's stacked confirm), and the Tab cycle incl. the container-self branch; all three consumers adopted it, existing trap tests unchanged and green.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-focus-interaction-hardening-deferred-work-sweep.md`
  summary: An OPEN status-popover menu still dies when its Card remounts on a refetch re-chunk (menu open-state is Card-local, unlike the hoisted detail panel); the openStatusMenu e2e retry loop in epic2-tracking.spec.ts papers over it.
  evidence: StatusPopover keeps `open` in component state inside Card; Story 3.4 hoisted the detail panel and restores focus, but a transient menu open at the exact refetch moment closes. Rare for a solo user (only their own writes refetch); visible under parallel e2e load. When fixed, ALSO remove the openStatusMenu retry loop in epic2-tracking.spec.ts (it papers over this and would outlive the fix unnoticed).
  decision: 2026-07-10 Assigned to Story 3.6 (write-path hardening, pre-sync) — Epic 4 sync makes refetch-while-interacting a real path (a sync completing while a menu is open kills it); hoist menu open-state like the 3.4 panel fix AND remove the openStatusMenu retry loop in the same change.
  resolution: done 2026-07-10 (story 3.6) — StatusPopover is controlled (`open`/`onOpenChange`); `openStatusGameId` lives in ShelfGrid (single-id invariant, the 3.4 panel pattern, plus stale-id cleanup); menu survives a re-chunk remount (pinned in Shelf.test.tsx). The openStatusMenu retry loop is gone; trace analysis showed the loop had ALSO absorbed a second race (click dispatched while an overlapping refetch commits under parallel DB churn) — replaced with a deterministic networkidle quiescence gate, NOT a retry: a masked product regression would still fail. Full parallel suite green 3× consecutively.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-focus-interaction-hardening-deferred-work-sweep.md`
  summary: AC3 boundary — dropping the LAST visible card unmounts ShelfGrid entirely (EmptyState renders), so the focus-restoration effect dies with it and focus falls to <body> with the toast UNDO not deliberately reachable.
  evidence: FilteredShelf swaps ShelfGrid for EmptyState at visible.length === 0; the restoration effect lives inside ShelfGrid. Needs a cross-component handoff (e.g. focus the empty state or its Clear-filters action) — deliberately out of 3.4's shipped scope.
  decision: 2026-07-10 Assigned to Story 3.5 — exclusive reveal views make zero-match shelves a daily path (a dotted pill with no matching games renders EmptyState), so the cross-component focus handoff (land on Clear filters / empty-state heading) belongs to the same story.
  resolution: done 2026-07-10 (story 3.5) — FilteredShelf-level handoff effect (fires only when the grid had rendered and focus fell to <body>) lands focus on the empty state's Clear-filters action, else the now-focusable headline; pinned in jsdom Shelf.test.tsx and e2e epic3-focus.spec.ts.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-focus-interaction-hardening-deferred-work-sweep.md`
  summary: A toast UNDO clicked AFTER a later write on the same game has settled silently overwrites the newer deliberate status with the stale `previous` — the in-flight guard only blocks concurrent writes, not stale intent.
  evidence: useTrackingMutations onUndo closures capture `previous` at toast time; a user who drops a game, immediately sets it to Playing, then clicks the still-visible drop-toast's Undo writes the pre-drop status over Playing. Needs a latest-write token or dismissing stale undo toasts on newer writes.
  decision: 2026-07-10 Assigned to Story 3.6 (write-path hardening, pre-sync) — epic 3 retro action item 3 — latest-write token (or dismiss stale undo toasts on newer writes) required before sync introduces automated writes that a stale UNDO could clobber.
  resolution: done 2026-07-10 (story 3.6) — module-level per-game WRITE_GEN bumped in beginWrite; both UNDO closures capture their own write's generation and expire (with an "Undo expired…" toast — NFR-4) when a newer write exists; in-flight case still answers "Still saving" (existing pin intact). Pinned in StatusPopover.test.tsx.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-reveal-pill-exclusive-mode.md`
  summary: The modal Escape handler (now centralized in useModalTrap) is document-capture and greedy — Escape pressed inside an inner popup within a modal (e.g. a future dropdown/datalist inside DetailPanel or FilterSheet) dismisses the whole modal instead of just the popup; only the `enabled` stand-down convention (used by the stacked ConfirmDialog) mitigates it.
  evidence: web/components/useModalTrap.ts Escape listener preventDefault+stopPropagation's every Escape while enabled — behavior inherited unchanged from the three hand-rolled copies (pre-existing), now uniform across all consumers. No current consumer has an inner popup that owns Escape besides the confirm stack (handled), so no user-visible bug today; becomes real the first time a modal gains an Escape-owning child without wiring `enabled`.
  resolution: discarded (accepted; the convention stands) 2026-07-13 triage — `enabled` IS the project's stacking contract and every stacking consumer now honours it (this sweep found StragglersDialog missing it and wired it in). A generic Escape-ownership stack would be machinery for a child that does not exist. The 2026-07-13 `inert` change also raises the cost of forgetting `enabled`: a covered dialog now visibly leaves the a11y tree, so the omission surfaces instead of hiding.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-sync-summary-needs-attention.md`
  summary: The amber needs-attention banner's only exit is a CLEAN sync — a user who resolves a flagged conflict manually (edits/adds the game in the library) carries the stale banner until they happen to re-sync, and nothing tells them re-syncing is the resolution path.
  evidence: AR-22 defines self-resolution as "the underlying condition self-resolves", but web/shell/AppShell.tsx renders the banner purely off the persisted `sync_attention` row and only src/services/sync.ts (a completed run) rewrites it; no library edit clears items. Epic 6's straggler-resolution UI is the natural owner (same needs-action channel) — either resolve items on the manual action or add re-sync guidance to the banner copy.
  resolution: done 2026-07-11 (Epic 6 merge assessment) — chose the banner-copy path. Epic 6 shipped a SEPARATE enrich/straggler channel (`countStragglers` → `enrich` banner), NOT the sync-conflict channel, so the "straggler UI owns it" option is moot. The `stragglers`-variant banner copy in web/shell/AppShell.tsx now names the exit — "review, fix it in your library, then re-sync to clear this" — closing the AR-22 gap (the user is no longer left guessing re-sync is the resolution). Banner stays persistent/non-dismissable; a clean sync still clears the `sync_attention` row, now signposted. Sibling `enrich` banner got the same treatment ("Resolve to search and link each one, which clears this").
- source_spec: `_bmad-output/implementation-artifacts/spec-psn-claims-count-as-owned.md`
  summary: Subscription-cancel flow — un-own exactly the `owned_via = 'membership'` tracking rows (claims) when the PS+ subscription lapses, leaving purchases untouched; no trigger/surface exists yet.
  evidence: FR-9 amendment (2026-07-11) counts claims as owned specifically because the `owned_via` flag makes a clean cancel-time rollback possible; the flag is written by seed and sync but nothing reads it yet. Natural home: a Settings action ("I cancelled PS+") or an Epic 5 region/subscription surface.
  decision: 2026-07-11 Stays deferred (Epic 4 retro action item #5) — Epic 5 shipped 3/3 (5.1 region/check button, 5.2 cron, 5.3 timestamp) without a subscription-cancel surface; none of its stories needed the un-own flow. No code change today; the `owned_via` escape-hatch flag is already persisted by seed and sync, so the deferral carries no data cost.
  decision: 2026-07-11 Scheduled into Story 6.4 (Ownership source — purchased vs claimed, and un-claim on cancel), epics.md. Story 6.4 bundles this un-own flow with the manual Purchased/Claimed confirm (the `owned_via` manual-set gap) into one "subscription ownership" surface. Ledger closes when 6.4 ships.
  resolution: done 2026-07-12 (stamp backfilled 2026-07-15, epic-7 retro sweep) — Story 6.4 shipped the cancel-PS+ Settings action: un-owns exactly the `owned_via = 'membership'` rows, purchases untouched. The entry's own closing condition fired; only the stamp was missing.
- source_spec: `_bmad-output/implementation-artifacts/epic-4-retro-2026-07-11.md`
  summary: web/shell/Fab.tsx re-hand-rolls the `['shelf']` + `['shelf-search']` invalidation pair that `invalidateShelfQueries` already encapsulates — if a third shelf query key is added, one site is likely missed and drifts.
  evidence: Epic 4 retro independent review (finding #3). The existing `invalidateShelfQueries` is a per-game `useCallback` bound inside `web/shelf/useTrackingMutations.ts:127` (not exported); Fab additionally invalidates `['settings']`. YAGNI extraction until a third invalidation site appears (same reasoning as the trap-dedup deferral) — extract a shared exported helper then. No user-visible bug today.
  resolution: discarded (accepted as-is) 2026-07-13 triage — still exactly two sites and no user-visible bug; the entry's own trigger (a THIRD site) has not fired. Extract then, not now.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-region-setting-ps-extra-check-button.md`
  summary: `game.ps_plus_extra` is a global column on the shared game row, but the PS+ check sets/clears it from ONE user's ownership (tracked, non-owned). In a multi-user deployment user B's flag write lands on user A's shared row.
  evidence: src/services/psplus.ts filters candidates by gameTracking.owned for the request's userId, then writes game.psPlusExtra (global) via setPsPlusExtraFlags. Latent only because AUTH_ALLOWED_EMAIL is a single address today; the "non-owned only" invariant is per-user while storage is global. Fix when a second user becomes possible (per-user flag table or user-scoped derived column).
  decision: 2026-07-11 Stays deferred as a MULTI-USER PUBLICATION BLOCKER (Epic 5 retro triage) — same class as the per-user-region blocker below; both are correct under single-user AUTH_ALLOWED_EMAIL and only wrong when a second user exists. No code change today; folded into [[publication-blockers]] as part of the per-user-data-scoping work (per-user flag table / user-scoped derived column) that must land before multi-user auth. Not a gate on the Epic 5 merge.
  decision: 2026-07-13 Homed in Story 8.3 (Per-user PS+ facts — B2), epics.md — the story's first AC IS this item. No code today; correct under one AUTH_ALLOWED_EMAIL. Ledger closes when 8.3 ships.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-region-setting-ps-extra-check-button.md`
  summary: PsPlusCheckModal (and SyncSummaryModal it was copied from) capture the focus-restore opener AFTER useModalTrap has already moved focus to the Close button, so on unmount focus falls to <body> instead of the FAB item that opened the modal.
  evidence: web/shell/PsPlusCheckModal.tsx calls useModalTrap (which focuses closeRef on mount) before the openerRef useEffect runs, so document.activeElement is already the in-modal button. Shared defect with web/shell/SyncSummaryModal.tsx — fix once at the pattern level (capture opener in a layout effect before the trap focuses, or fold opener-capture into useModalTrap).
  status: done 2026-07-11
  resolution: 2026-07-11 (Epic 5 retro triage) Folded opener-capture into useModalTrap — the trap now snapshots document.activeElement BEFORE it moves focus into the dialog and restores it on unmount, with an optional preventRestoreRef stand-down (SyncSummaryModal passes jumpedRef so a "Find in library" jump still hands focus to the search box). Both modals dropped their broken openerRef useEffect. Fixes the shared defect at the pattern level for every current and future consumer. web/components/useModalTrap.ts + web/shell/PsPlusCheckModal.tsx + web/shell/SyncSummaryModal.tsx.
- source_spec: `src/services/settings.ts` `getPsnRegion` (Luca 2026-07-11)
  summary: PSN region is a single global `env.PSN_REGION` (`it-it`) seeded into every user's `SETTING` on first check — there is no per-user region and no UI to change it. A second user in another region gets the wrong catalog.
  evidence: `getPsnRegion(db,userId,env)` reads `SETTING.psn_region` else falls back to the one wrangler var and persists it; no settings surface writes it (settings page wires only timezone at 6.3). Publication blocker for multi-user — tracked in [[publication-blockers]]. Fix: per-user region setting + editor, ideally derived/persisted from PSN on first sync (the original 5.1 architecture note). Latent under single-user auth today.
  decision: 2026-07-13 Homed in Story 8.3 (B3), epics.md — the story's second AC IS this item. Ledger closes when 8.3 ships.
- source_spec: `web/shelf/SearchBox.tsx` (feature request, Luca 2026-07-11)
  summary: Header search only supports type-then-pick-a-suggestion (combobox select); typing free text and hitting Enter (or a debounced live filter) does NOT filter the shelf to titles containing the substring.
  evidence: Search is a suggestion combobox; selecting an item is the only action (see [[press-start-epic2-test-findings]] "search select no-op"). Requested behavior: typing "ass" filters the visible shelf to case-insensitive title-substring matches, ideally live with a small debounce (~150–250ms) rather than requiring Enter. Not deferred debt from a shipped AC — a new capability; size as a story in a future epic (search/browse). No cross-story blocker.
  resolution: done — Story 6.5 (free-text shelf search) shipped exactly this: `web/shelf/SearchBox.tsx` debounces the term (200ms) and broadcasts it via `SHELF_SEARCH_EVENT`; `Shelf.tsx` FilteredShelf narrows the visible cards through `matchesTitleQuery` (normalized substring). The 2026-07-12 redesign (`daedc31`, `3afa67e`) then dropped the suggestion combobox entirely — the shelf grid is the one result surface.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-1-add-a-game-by-name.md`
  summary: addGame anchors tracking + a learned IGDB external link to `candidates[0]` when several catalog rows share a normalized title and none is tracked — an arbitrary physical row may get the link.
  evidence: src/services/games.ts — when input.igdbId has no existing external link and findGamesByNormalizedTitle returns >1 untracked row, the code falls through to `existing = candidates[0]`. Non-unique title_normalized (AD-18) makes collisions possible; rare in a single-user catalog with mostly-unique titles. Would need a disambiguation rule (prefer the row whose facts best match the IGDB candidate) if it ever bites.
  resolution: done 2026-07-12 (Epic 6 retro action item 3) — `pickTitleCandidate` in src/services/games.ts replaces `candidates[0]` for BOTH the anchor and the revive: it ranks same-normalized-title rows (tracked-non-discarded > tombstone > untracked, then release-date/exact-title facts match, DB order as final tiebreak) so add, revive, and the IGDB-link anchor all act on one deterministic row. Pinned by the "DISAMBIGUATION (retro item 3)" test in test/integration/games.test.ts.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-1-add-a-game-by-name.md`
  summary: Search-pick detail open assumes the `['shelf']` query holds the ENTIRE library — if the shelf payload ever becomes server-paginated/filtered, picking a valid search hit outside the loaded page silently opens nothing.
  evidence: web/shelf/Shelf.tsx FilteredShelf resolves searchGameId via games.find() over the shelf payload and a cleanup effect clears an id it can't find; /api/shelf/search is a separate whole-library endpoint. Correct today (shelf payload is the full set, client-paginated); becomes a silent no-op the day the shelf query gains server-side paging.
  resolution: discarded (accepted as-is) 2026-07-13 triage — no server-side paging appears in any backlog epic (7–10), and the whole-library search path this worried about was DELETED in the 2026-07-12 redesign (the shelf grid is the single result surface, so a hit outside the payload can no longer exist). Whoever introduces server paging owns this.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-2-name-only-fallback-straggler-resolution.md`
  summary: Resolving an `unenriched` straggler to an igdbId already linked to a DIFFERENT game enriches + de-flags the game but writes no IGDB link (anchorIgdb no-ops), leaving two catalog rows for one IGDB game — the duplicate FR-29 aims to prevent.
  evidence: src/services/stragglers.ts resolveStraggler unenriched branch fixes gameRow to input.id; anchorIgdb only links when the id is unlinked. Only reachable when the same IGDB game is already in the catalog under another row. Rare in the single-user catalog; needs a conflict outcome (merge or 409) surfaced to the resolve UI.
  resolution: done 2026-07-13 (triage) — the unenriched branch now looks the igdbId up BEFORE it writes: already linked to another row → `{kind:'conflict', gameId}` → the route answers 409 carrying the existing game's id (the add-by-name convention), and nothing is enriched or de-flagged, so the straggler stays put instead of becoming a second catalog row for one IGDB game. StragglersDialog reads the 409 and says what to do ("already in your library — pick a different match, or discard"), since retrying the same pick can never succeed. Merging the two rows was rejected: it needs a merge policy across tracking/genres/links for a case that has never occurred. Pinned by "refuses to resolve an unenriched game onto an IGDB id already linked to another game" in test/integration/stragglers.test.ts.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-3-chores-csv-export-settings.md`
  summary: A failed FAB-handedness PUT is swallowed — no toast/rollback; the toggle silently stays where the server left it and the user gets no signal their choice didn't persist.
  evidence: web/settings/SettingsPanel.tsx setHandedness mutation handles only onSuccess (invalidate). Not optimistic, so the UI never lies about the stored value — the failure is silent, not corrupting. Add an onError toast when settings writes grow beyond this one cosmetic flag.
  resolution: done 2026-07-13 (triage) — onError toast on the handedness PUT (NFR-4). The cancel-PS+ mutation had the same silent-failure shape (and left its confirm dialog open on error), so it got the same treatment. The cookie save did NOT: it already reports failure inline under the button, and a toast would have doubled the signal.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-3-chores-csv-export-settings.md`
  summary: Sign-out has two entry points (Header button + SettingsPanel) and the settings copy files it under the "About & Help" section heading — misgrouped for screen-reader landmarks and inconsistent with the "entry points move into the drawer" narrative.
  evidence: web/shell/Header.tsx still renders onSignOut; web/settings/SettingsPanel.tsx adds a second inside the About & Help <section>. Decide one home (own "Account" section in settings, drop the header button) in a UX pass; both work today.
  decision: 2026-07-13 One home — the HEADER (Luca's call). Sign-out stays one tap away; Settings holds settings.
  resolution: done 2026-07-13 — the Settings sign-out button is gone, taking the misgrouped About & Help placement with it, and the now-unused `onSignOut` prop is threaded out of SettingsPanel/AppShell. SettingsPanel.test.tsx asserts the panel offers About/Help and NO sign-out; epic6.spec.ts asserts the same plus the header's button.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-3-chores-csv-export-settings.md`
  summary: Handedness value is defaulted in three layers (zod .default('right'), AppShell ?? 'right', Fab prop default) and the PUT response body { fabHandedness } is unused (client invalidates the whole settings query instead of setQueryData).
  evidence: web/settings/api.ts:33, web/shell/AppShell.tsx:109, web/shell/Fab.tsx prop default; src/routes/settings.ts PUT return vs web/settings/api.ts saveFabHandedness(): Promise<void>. Harmless redundancy — collapse to the zod default and setQueryData if this surface is ever touched again.
  resolution: discarded (accepted as-is) 2026-07-13 triage — three defaults that all say 'right' and one unused response body: no behaviour rides on collapsing them, and each layer's default is locally correct (the zod one is the contract; the other two are render-time fallbacks while the query is pending). Churning three files to save nothing is the trade this ledger exists to refuse.
- source_spec: none
  summary: The `＋ Add "<name>"` row is suppressed whenever the typed name substring-matches ANY library game, so an exact base title buried among sequels (e.g. "Final Fantasy" amid FF VII/X/XVI) cannot be added by name.
  evidence: Split from the discard-with-readd-revive intent (Luca 2026-07-11) as a new bug needing deeper analysis. Add-by-name (Story 6.1) only offers the `＋ Add` row when the search finds NO library match; substring matching means a shorter exact title is always shadowed by longer matches that contain it. Needs a rule that offers the Add row when no EXACT (normalized) title match exists even if substrings match — verify against web/shelf SearchBox suggestion logic before designing.
  resolution: done — 2026-07-12 search redesign made the pinned `＋ Add "<term>"` bar render for ANY non-empty term, matches or not (`web/shelf/SearchBox.tsx:121-133`), so the base title is always addable even when sequels match; the old zero-matches-only gate is gone. Add is dedup-safe (AddGameDialog answers a 409 by opening the existing game), so an exact-vs-substring rule is unnecessary.
- source_spec: `_bmad-output/implementation-artifacts/spec-discard-with-readd-revive.md`
  summary: Re-adding a name that normalizes to a discarded game revives whichever same-normalized-title tracked candidate the DB returns first — an arbitrary row, now with an un-discard write side-effect.
  evidence: services/games.ts addGame candidate loop calls reviveIfDiscarded on the first tracked candidate and returns. title_normalized is non-unique (AD-18), so a user tracking two same-title games (one discarded) could revive the wrong one. Extends the pre-existing `candidates[0]` arbitrariness deferral with a write side-effect; rare in a single-user catalog with mostly-unique titles. Fix with the same disambiguation rule (prefer the row whose facts best match) as the existing collision entry.
  resolution: done 2026-07-12 (Epic 6 retro action item 3) — closed by the same `pickTitleCandidate` rule as the collision entry above: the revive now targets the ranked-best row (a tracked row beats an untracked one), so the un-discard write side-effect lands on the user's own tombstone rather than a DB-order arbitrary row. The renamed-then-discarded revive gap (title rewritten on enrichment) is NOT covered — it needs alias matching, still deferred (separate entry below).
- source_spec: `_bmad-output/implementation-artifacts/spec-discard-with-readd-revive.md`
  summary: A discarded game whose title was corrected during straggler resolution cannot be revived by re-typing its original (pre-correction) name — a new duplicate game is created and the tombstone is stranded.
  evidence: services/games.ts revive matches on normalizeTitle(input.title); enrichGame rewrites title/titleNormalized on resolution (e.g. "Caleste"→"Celeste"). If such a game is later discarded and the user re-types "Caleste", no candidate matches → a new unenriched game is created, leaving the discarded row hidden forever. Inherent to normalized-title matching; only bites renamed-then-discarded games (name-only mistakes, the primary case, keep their typed title). Accept, or match revive on external-link/alias as well as title.
  resolution: discarded (accepted) 2026-07-13 triage — the fix is an alias table (every pre-correction title ever typed, kept forever) serving a user who typos a name, resolves it, discards the game, then re-adds it by the ORIGINAL typo. Without it the outcome is a duplicate name-only row the user can discard — not data loss — and re-adding by the CORRECTED title revives correctly (pickTitleCandidate). Not worth a schema.

- source_spec: `spec-6-4-ownership-source-purchased-vs-claimed.md`
  summary: cancel-PS+ (per-user Settings action) writes the shared global `game.psPlusExtra` catalog flag via `setPsPlusExtraFlags`, so one user's cancel would mutate catalog pills for all users in a multi-user deployment.
  evidence: `src/repositories/games.ts` `setPsPlusExtraFlags` updates `game` by id only (no userId — `game` is the shared catalog, AD-19); `runPsPlusCheck` already writes it globally from one user's library, so this is a pre-existing single-tenant assumption, not new to 6.4. Belongs with the existing global-column multi-user publication blocker.
  decision: 2026-07-13 Homed in Story 8.3 (B2), epics.md — a new AC names all three writers of the flag (the check, the cron, and 6.4's cancel-PS+ un-claim, which re-flags what it un-owns) so the cancel path migrates with the others instead of being forgotten. Ledger closes when 8.3 ships.

- source_spec: `spec-6-5-free-text-shelf-search.md`
  summary: Story 4.3 seed-search (jump-to-problem) now also narrows the visible shelf via SHELF_SEARCH_EVENT; if the seeded game is hidden/filtered the grid shows a false "NO MATCH" + "＋ Add <title>" for a game that already exists.
  evidence: The 6.5 broadcast effect keys on `debounced`, which `onSeed` sets directly (web/shelf/SearchBox.tsx). Mitigated in practice (stragglers/problems are typically visible, not completed/dropped) and by the 409→open-existing-detail path in AddGameDialog. Fix needs a source flag distinguishing typed vs seeded, or scoping the broadcast to user input.
  resolution: done (mitigated, accepted) — 2026-07-12 redesign: a no-filter term now searches the WHOLE library (hidden states included, done shelf-side in Shelf.tsx), so a seeded hidden game matches instead of showing a false "NO MATCH". A residual miss (game hidden by an active filter) still lands on the pinned dedup-safe Add, which 409→opens the existing game — no duplicate created. A typed-vs-seeded source flag is unneeded given the whole-library search + 409 path.

- source_spec: `spec-6-5-free-text-shelf-search.md`
  summary: When a term matches nothing, both the combobox popup's `＋ Add "<term>"` row and the shelf empty-state's `＋ Add "<term>"` action are visible at once, each owning a separate AddGameDialog.
  evidence: SearchBox add row (showPopup && !hasMatches) and Shelf empty-state add (searchActive) both render for the same no-match term. AC2 requires the empty-state Add; 6.1 owns the popup Add. Consider suppressing one while the other is shown. Both open the same 409-safe add flow, so low functional risk.
  resolution: done — 2026-07-12 redesign collapsed both into one: the SearchBox popup is gone (pinned Add bar is the sole Add entry point) and the empty state no longer duplicates it (Shelf.tsx:244-246 — the empty state now only offers Clear filters). One Add surface, no double render.

- source_spec: `spec-6-5-free-text-shelf-search.md`
  summary: One search input drives two live result surfaces — the 6.1 combobox popup (whole-library server matches) and the 6.5 shelf-grid narrow (visible substring) — showing two different counts/answers at once.
  evidence: Follow-up review (2026-07-12) flagged Med; the shelf comment concedes the count conflict. Needs a product decision (unify the surfaces, or suppress one contextually), not a quick patch. Both open the same 409-safe add flow.
  resolution: done — product decision made and shipped 2026-07-12: unify on ONE surface. The suggestion combobox (whole-library server matches) was deleted (`3afa67e` "remove the dead whole-library search path"); the shelf grid is now the single live result surface, so there is no second count to conflict.

- source_spec: `spec-pv-2-igdb-category-filter.md`
  summary: PV-2 category whitelist (0,4,8,9,10,11) excludes episode(6), season(7), expansion(2), and bundle(3); episodic/expansion titles the user genuinely owns (Life is Strange, Hitman seasons, Witcher 3: Blood and Wine, remaster collections) now return null from enrich/searchCandidate/searchCandidates.
  evidence: Adversarial review (2026-07-13, both hunters) flagged the whitelist gaps. Season/bundle exclusion is the explicitly-decided PV-2 intent (backlog: "drop DLC/bundle/season noise"); episode/expansion are coherent tuning candidates. Deferred not fixed because widening the whitelist would contradict the human-gated decision; the PV-4 rematch feature + PV-5 enrichment re-run are the designed safety nets for any straggler dropped by the filter. Revisit whitelist membership if real owned games surface unenriched after PV-5.
  decision: 2026-07-13 STAYS OPEN as a watch, deliberately — the only honest trigger is real data: after the PV-5 enrichment re-run, if a game Luca actually owns sits unenriched because of category 6 (episode) or 2 (expansion), widen the whitelist by exactly that category. Tuning it now would be guessing against a decision that was human-gated on purpose. This is the only open item left in this ledger.
  resolution: done 2026-07-13 — watch closed early by Luca's call: expansion(2) and episode(6) readmitted now that the result set is wide enough to carry them (`where game_type = (0,2,4,6,8,9,10,11)` in `src/providers/igdb.ts` fetchGames; assertion updated in igdb.test.ts). Titles genuinely owned and tracked live in those two types (Witcher 3: Blood and Wine, Life is Strange episodes). Season(7), bundle(3), DLC(1), pack/update/mod stay out — that IS the noise PV-2 exists to drop, and dropping it was the human-gated decision. PV-2 spec carries the amendment.

- source_spec: `spec-pv-2-igdb-category-filter.md`
  summary: A legit IGDB game whose `category` field is unset/null is silently excluded by `where category = (...)`, so a title that matched before PV-2 can now return zero results with no signal (enrich fails closed silently; straggler resolution shows nothing).
  evidence: IGDB v4 `category` defaults to main_game(0), so near-all games carry a value — low probability, but incomplete entries exist. No unfiltered fallback in the shared query. Accepted tradeoff of server-side filtering (backlog framing); PV-4 rematch is the recovery path. Add a fallback (retry without the where-clause on empty results) only if this bites a real owned game in practice.
  resolution: discarded (accepted tradeoff) 2026-07-13 triage — the entry's own condition ("only if this bites a real owned game") has not fired, and a retry-without-the-filter fallback would re-admit exactly the DLC/bundle noise PV-2 exists to drop, for a field IGDB defaults to 0. If it ever bites, the recovery path (PV-4 rematch) already shipped.

- source_spec: `_bmad-output/implementation-artifacts/spec-6-6-one-picker-for-every-igdb-match-pv-6.md`
  summary: Stacked modals leave the dialog underneath live to assistive tech — the covered dialog keeps `role="dialog" aria-modal="true"` and is neither `inert` nor `aria-hidden`, so a screen-reader user can still reach its fields and buttons.
  evidence: Project-wide pattern, not introduced by 6.6 — `SettingsPanel` + `ConfirmDialog` (cancel-PS+), `StragglersDialog` + `ConfirmDialog` (ignore), and `DetailPanel` + `RematchDialog` all stack this way; `useModalTrap`'s `enabled` flag hands over Escape but nothing hides the layer below. One shared fix belongs in `useModalTrap` (mark the container `inert` while disabled), not in any single dialog.
  resolution: done 2026-07-13 (triage) — `useModalTrap` now sets `el.inert = !enabled` on its container, so a covered dialog leaves BOTH the tab order and the accessibility tree while another dialog stacks on it: one fix, every current and future consumer, exactly as the entry called for. It also surfaced a live bug next door — `StragglersDialog` stacked its ignore-ConfirmDialog WITHOUT passing `enabled`, so a single Escape dismissed both dialogs and the list underneath stayed reachable by AT; it now passes `enabled: !confirmingIgnore` like every other stacking consumer.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-1-sign-in-with-google-b1a.md`
  summary: A de-allowlisted session still passes `/api/auth/get-session`, so the SPA renders the authenticated shell while every data route 401s — and its `session` rows are never revoked.
  evidence: `requireAuth` re-checks the allowlist (Story 8.1) but `authRoute` hands `/auth/*` straight to better-auth, and the SPA gates on `authClient.useSession()`. Changing AUTH_ALLOWED_EMAIL therefore yields a broken shell rather than the login screen, and the stale cookie stays valid for any future route that forgets `requireAuth`. Fix: gate get-session, or revoke a user's sessions when the allowlist stops admitting them. Only reachable by the operator changing his own allowlist today; it becomes real with Story 8.2.
  decision: 2026-07-13 Homed in Story 8.2 (Real users can register), epics.md — carried as an AC: a de-allowlisted session lands on the login screen and its `session` rows are revoked. Fixing it today would harden a gate 8.2 replaces wholesale (`isAllowedEmail` stops BEING the gate), and the only person who can trigger it is the operator editing his own allowlist. Ledger closes when 8.2 ships.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-1-sign-in-with-google-b1a.md`
  summary: Starting a Google sign-in writes an OAuth state row to `verification` before any allowlist check can run, so a stranger can grow that table by repeatedly starting (never finishing) sign-ins.
  evidence: The magic-link path has a route-level pre-gate precisely to prevent this residue (`routes/auth.ts`), but the OAuth path cannot — the email is only known after the code exchange, which is why the gate lives in the create hook. The rows are short-lived and carry no user data. The fix belongs with whatever rate-limits the auth endpoints.
  decision: 2026-07-13 Homed in Story 8.2, epics.md — carried as an AC (rate-limit the auth endpoints). Nothing in the app is rate-limited today, so this is not a one-line patch; meanwhile the rows are short-lived, carry no user data, and cost a stranger a full OAuth round-trip each. Ledger closes when 8.2 ships.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-1-sign-in-with-google-b1a.md`
  summary: The OAuth allowlist gate covers user CREATION only — linking a Google account into an EXISTING user row never runs it.
  evidence: `account.accountLinking` is at better-auth defaults (enabled, google trusted), so `handleOAuthUserInfo` links by matching email without calling `user.create.before`. Safe today by construction (the allowlist is one exact email, so a non-allowlisted address has no row to link into) and noted in the code, but Story 8.2 — which widens the allowlist into real registration — must gate the link path too.
  decision: 2026-07-13 Homed in Story 8.2, epics.md — carried as an AC: the admission rule gates the LINK path, not just user creation. Safe by construction under one allowlisted email; unsafe the moment registration opens, which IS Story 8.2. Ledger closes when 8.2 ships.

### DW-10: Spike S-1 — endpoint x auth-path table: trophies REQUIRE NPSSO (gates Epic 9); wishlist endpoint identified, reachability pending one hash capture

origin: spec-9-1-spike-s-1-what-does-pdccws-p-authorize-vr-1.md, probed live 2026-07-13 via `tmp/probe-psn-auth.ts`
location: src/providers/psn.ts (auth is a PsnProvider internal, AR-5); tmp/probe-psn-auth.ts (the harness, re-runnable)
reason: Story 9.1 asked what the `pdccws_p` web session cookie authorizes vs an NPSSO bearer. Probed live against PSN, both auth paths, observed status + response shape. Two probe runs; the second run's cookie column was invalid (an expired/wrong cookie answered `getPurchasedGameList` with the 200+Access-denied shape — the Epic 4 degenerate response), so the cookie facts below are taken from the FIRST run where the cookie was valid:

| Endpoint | `pdccws_p` cookie | NPSSO bearer |
| --- | --- | --- |
| `getPurchasedGameList` (GraphQL persisted) | **200 — `data{purchasedTitlesRetrieve}`** | **200 — `data{purchasedTitlesRetrieve}`** |
| `trophyTitles` (trophy v1 REST, `m.np.playstation.com`) | **401 — `json{error}`** | **200 — `json{trophyTitles,nextOffset,totalItemCount}`** |
| wishlist `storeRetrieveWishlist` (persisted, real op) | **404 — persisted query id not in list** (our computed hash guess; real hash not yet captured) | same 404 |
| wishlist — raw freeform GraphQL | **400 — freeform not allowed; must send by persisted id** | same 400 |

Consequences, per the story's stated branches:

1. **Trophies REQUIRE NPSSO.** The session cookie is rejected outright (401) by the trophy host `m.np.playstation.com`; the bearer returns data. Story 9.1's third branch fires: the NPSSO auth swap is **promoted out of Deferred and gates Epic 9** — Story 9.2 cannot fetch trophies under the cookie.
2. **The bearer also serves `getPurchasedGameList`**, so NPSSO is a superset of the cookie's reach on everything probed. The swap is a replacement, not a second parallel credential — one credential covers library + trophies, and NPSSO lives ~60 days (with an offline refresh token) vs the cookie's hours-to-days.
3. **Story 9.4 (wishlist sync) — endpoint IDENTIFIED, not dropped.** PSN refuses freeform GraphQL by design; the real client fetches the wishlist as an Apollo persisted query named **`storeRetrieveWishlist`** (found in the wishlist JS bundle `pages/library/wishlist-*.js`; full document captured, returns `storeWishlistSecure` with PS Store product ids — exactly the FR-34 join key). What's missing is only the persisted-query hash: Apollo hashes the printed AST, so the two sha256 candidates computed from the document text both 404'd. The real hash is obtainable by capturing one client-side-nav request to the wishlist (filter Network for `storeRetrieveWishlist`, copy `sha256Hash`, re-run with `PSN_WISHLIST_HASH=`). Its auth path is still unknown — the 404 (unknown query id) resolves before auth, masking whether cookie or bearer is needed. **9.4 stays conditional but is no longer "unreachable"; it does NOT block 9.2/9.3.** Since the epic now runs on NPSSO anyway, 9.4 becomes a cheap follow-on once the hash is captured and tested under the bearer.
4. PRD open-q #2 (NPSSO swap) and the spine's Deferred NPSSO entry are **closed by this table**: the swap is not optional, it is required for trophies.

status: done 2026-07-13
resolution: spike complete; the table above IS the deliverable. Firm: NPSSO gates Epic 9 and is a prerequisite of Story 9.2 — it needs a home (new Story 9.0 or a widened 9.2) before trophy work proceeds. Open, non-blocking: Story 9.4's persisted-query hash capture + auth-path confirmation, deferred behind the NPSSO swap it will likely ride on.

- source_spec: `spec-9-1b-swap-psnprovider-cookie-to-npsso-bearer-vr-1.md`
  summary: Playwright 6.4a ("Claimed with PS+" writes owned_via=membership) flakes under full-suite load — the test asserts the D1 row right after the dialog closes, without waiting on the ownership PUT to land.
  evidence: PRE-EXISTING, not caused by 9.1b — reproduced on the baseline commit (7b2d979) with the story's changes stashed: 1 of 2 full `bun run test:e2e` runs failed the same test the same way. Passes in isolation and with --repeat-each 3. Fix is to await the write (response or a UI settle) before querying D1.
  decision: 2026-07-14 (Epic 9 retro) Homed in Story 9.5 — investigate and fix (Luca's call: fixed here, not carried), with the full suite green 3x consecutively as the bar. Gates the main merge.
  resolution: fixed 2026-07-14 (Story 9.5) — 6.4a now awaits the owned toast (the mutation's onSuccess, i.e. the write's completion signal) before reading D1, as its "Purchased" sibling already did. Holding the WHOLE suite green 3x forced two MORE pre-existing races out of hiding, both fixed at the root: epic6's "I cancelled PS+" bulk-un-owns every membership row of the shared e2e user and was wiping a claim epic4-settings seeded in a parallel worker (serial mode does not cross files — that test moved into epic6's serial group), and `openStatusMenu`'s pill click could land in a mid-commit DOM and be dropped (the helper re-clicks). Local Playwright workers capped at 4: the default put TEN chromium workers on one vite+workerd+D1. Suite: 88/88, three consecutive runs.

- source_spec: `spec-9-1b-swap-psnprovider-cookie-to-npsso-bearer-vr-1.md`
  summary: The NPSSO→bearer exchange stub is copy-pasted verbatim into `test/integration/sync.test.ts` and `test/integration/discard.test.ts`.
  evidence: Two places to update when the exchange shape moves; both would keep passing against a stale shape while production breaks. Extract one shared helper next time either is touched.
  decision: 2026-07-14 (Epic 9 retro) Homed in Story 9.5 — post-retro hardening sweep, carried as an AC. Gates the main merge.
  resolution: fixed 2026-07-14 (Story 9.5) — `test/integration/psn-stub.ts` is now the ONE exchange double; sync, discard, trophies and backfill (four suites, not two) consume it and their copies are gone.

- source_spec: `spec-9-1b-swap-psnprovider-cookie-to-npsso-bearer-vr-1.md`
  summary: The npsso charset guard in `src/routes/settings.ts` admits non-Latin1 codepoints, which the outbound Cookie header cannot carry.
  evidence: Such a value saves fine, then fails at `fetch` with a TypeError → a 502 at sync time instead of a 400 at save time. Fails closed (no injection, no bad write), so it is a diagnosability nit, not a security hole.
  decision: 2026-07-14 (Epic 9 retro) Homed in Story 9.5 — refuse it at save time with a 400. Gates the main merge.
  resolution: fixed 2026-07-14 (Story 9.5) — the guard is now RFC 6265's `cookie-octet` ALLOWLIST, refused at SAVE with a 400. Review caught that the first cut (a "nothing above U+00FF" bound) still admitted the C1 control block (U+0080–U+009F), which is Latin1-encodable; the allowlist drops every control, all non-ASCII, and `;` `,` `"` `\` in one expression.

- source_spec: `spec-9-2-trophy-progress-on-every-game-vr-2.md`
  summary: Trophy counts are never cleared or aged — a game whose trophy title stops matching PSN keeps its last-synced "62% · B" forever, and the UI never shows how old the numbers are (`trophy_synced_at` is stored but never read).
  evidence: Nothing writes NULL back to the trophy columns, and no view reads `trophy_synced_at`. Needs a product call (clear on vanish? show "synced 3 months ago"?) rather than a silent default, so it was not invented during the run.
  resolution: discarded (accepted permanently) 2026-07-14 — Epic 9 retro, Luca's product call: "It's historic data. Fine with it never clearing." Trophy counts are a record of what was earned, not a live gauge; staleness is acceptable and no aging UI is wanted. Recorded so it is not re-opened.
  superseded: 2026-07-15 (Epic 11 story 11.3) — the trophy display and every `trophy_*` column (including the never-read `trophy_synced_at`) are deleted outright; the question can no longer arise.

- source_spec: `spec-9-2-trophy-progress-on-every-game-vr-2.md`
  summary: `Db` now types a `batch` method, but the seed script's sqlite-proxy driver is built without a batch callback — any future repository function that batches and is reused by the seed path fails at RUNTIME, not compile time.
  evidence: `src/repositories/db.ts` widens the type; `scripts/seed-import.ts` calls `drizzle(callback, { schema })` with no batch callback. Harmless today (the seed path never calls `setTrophyCountsBatch`), a trap tomorrow.
  decision: 2026-07-14 (Epic 9 retro) Homed in Story 9.5 — supply the batch callback (or stop the type promising one) so the failure is at COMPILE time, never runtime. Gates the main merge.
  resolution: fixed 2026-07-14 (Story 9.5) — `createHttpDb` supplies drizzle's batch callback, and `scripts/` is now a `tsc` project (`tsconfig.scripts.json`, referenced from `tsconfig.json`), so the `Db` promise is checked at COMPILE time. ponytail ceiling recorded in the code: the callback runs the statements sequentially, so it satisfies the TYPE but not atomicity — a repository function that batches for all-or-nothing would half-apply from the seed path.

- source_spec: `spec-9-2-trophy-progress-on-every-game-vr-2.md`
  summary: No e2e test drives the FAB -> trophy sync -> shelf-repaint seam end to end, because PSN cannot be stubbed in the Playwright environment.
  evidence: `Fab.test.tsx` mocks fetch, `trophies.test.ts` mocks the provider, and the e2e seeds D1 directly — so query invalidation actually repainting a card with fresh counts is asserted nowhere. Same limitation `epic5-psplus.spec.ts` already records.
  resolution: discarded (accepted) 2026-07-14 — Epic 9 retro, Luca's call: "Fine not having e2e with external dependencies." PSN is unstubbable in the Playwright environment; the seam stays a COVERAGE.md row, as `epic5-psplus.spec.ts` already established. Standing project posture, not a per-story gap.

- source_spec: `spec-9-2-trophy-progress-on-every-game-vr-2.md`
  summary: A discarded game's trophy title is reported as "no library match" noise on every trophy sync, and two trophy syncs in flight for the same user are not locked (same posture as the library sync).
  evidence: `listLibraryForUser` excludes discarded rows, so their trophy titles fall into `unmatched`; the FAB disable is per-component only. Both are cosmetic / pre-existing-pattern, not data hazards.
  decision: 2026-07-14 (Epic 9 retro) BOTH halves homed in Story 9.5. Discarded-game noise: match discarded rows too and drop them SILENTLY — they are not unmatched, they matched a game the user threw away. Locking: folded into the single-flight guard AC, which covers all three PSN long-ops (library sync, trophy sync, backfill) rather than just this one — Dana's point, that "same as the existing pattern" had been the justification for three epics running.
  resolution: fixed 2026-07-14 (Story 9.5) — the trophy sync now reads the user's discarded normalized titles (`listDiscardedTitleKeys`) and drops a matching trophy title SILENTLY: neither `updated` nor `unmatched`, no write. Both keyings are covered (the stored title and the trophy-side " Trophies"-stripped key). The locking half is the single-flight guard below.

- source_spec: `spec-9-3-one-off-backfill-recover-the-platinum-dates-psn-knows-vr-3.md`
  summary: Trophy rows written by story 9.2 before migration 0008 carry no `trophy_np_service_name`, so the backfill falls back to `trophy2` for them — a PS4-era title in that state 404s into a per-title skip until the trophy sync is re-run.
  evidence: The live probe measured 94 of 137 titles on `trophy` (PS3/PS4/Vita) and 43 on `trophy2` (PS5), and confirmed the wrong service name answers 404. The skip copy tells the user to re-run the trophy sync, so it is self-healing — but a one-line backfill of the column (or a 404-retry with the other name) would remove the step entirely.
  resolution: discarded (cannot occur in production) 2026-07-14 — Epic 9 retro. The window this describes only exists if a trophy sync ran BETWEEN migration 0007 and 0008. Production has never seen either: Epic 9 is unmerged, and CI applies migrations in order before the deploy, so 0007 and 0008 land together and the first production trophy sync writes `trophy_np_service_name` from the start. The only database that can hold such a row is Luca's local dev D1 (where 9.2 ran before 9.3 existed), and one local trophy-sync re-run clears it. A migration-ordering artifact, not a defect — no code change.

- source_spec: `spec-9-3-one-off-backfill-recover-the-platinum-dates-psn-knows-vr-3.md`
  summary: Two concurrent backfill runs (two tabs) are not locked, and neither is the trophy sync.
  evidence: The COALESCE write makes the duplicate write a no-op, so no data is corrupted — but both loops report the same dates as "filled" and the PSN fan-out is doubled. Same posture as the existing library sync; a single-flight guard would cover all three.
  decision: 2026-07-14 (Epic 9 retro) Homed in Story 9.5 — Luca: "Add guard". One single-flight guard across ALL THREE PSN long-ops (library sync, trophy sync, backfill), not a per-sync patch; a second concurrent run is refused with a human message. Deferred since Epic 4; gates the main merge.
  resolution: fixed 2026-07-14 (Story 9.5) — one per-user lock (a `setting` row, value `<expiry>:<op>:<uuid>`) covers all three PSN long-ops; a second run is refused with a 409 and a human message and makes NO PSN call. The claim is ONE SQL statement (an upsert whose DO UPDATE branch fires only on an expired lock — or on the exact held token, the backfill's cross-request renewal path — with RETURNING naming the winner), because a read-then-write acquire is the very race being closed. Review found the first cut treated the backfill's CURSOR as proof of ownership, which made the refusal bypassable with `?cursor=anything` (it would overwrite a running sync's lock); the capability is now a rotating token the server hands back, and both the forgery and the renewal paths are pinned in `psn-lock.test.ts`. Known ceiling, recorded in the code: the 2-minute TTL is preemption without a fence — a run still alive after it can be taken over (worst case is the pre-9.5 doubled fan-out, not corruption, since every write is idempotent/COALESCE).

### DW-10 extension (Story 9.1c, 2026-07-14): wishlist reachable under NEITHER credential — Story 9.4 dropped to Future

origin: spec-9-1c-final-wishlist-spike-capture-storeretrievewishlist-hash-vr-1.md; investigated live 2026-07-14 via a signed-in browser session (Claude-in-Chrome)

reason: S-1 (DW-10) left the wishlist's persisted-query hash and auth path open; Story 9.1c was to capture the hash and decide Story 9.4's fate. Finding, from observation:

1. **The wishlist read is server-side-rendered.** `__NEXT_DATA__` on `library.playstation.com/wishlist` already carries `storeWishlistSecure` and the real wishlist titles. The browser issues NO client-side `storeRetrieveWishlist` request on load or scroll — Sony's Next.js server runs the persisted query against its own manifest and ships the data pre-rendered. There is no client request to capture (so DW-10's planned DevTools capture cannot exist on the current site).

2. **The bundle's query is not in the client-reachable persisted allowlist.** The gql document was extracted from `wishlist-819ebbe0…js` and hashed with the app's own `parse`/`print` (from its webpack modules) as `sha256(print(addTypename(parse(doc))))`. That recipe was validated EXACT against `getCartItemCount` — a query the app DOES run client-side — reproducing its registered hash `98136bcbc72e0fefccd8ecd6d3b3309225a6889c19df6e54581d86ff1c15d88a` byte-for-byte. Applied to the wishlist doc, every candidate (raw / trimmed / collapsed / print ± __typename ± root) returns HTTP 404 `PersistedQueryNotFound`. Freeform GraphQL stays refused (400).

| Endpoint | NPSSO bearer (client-observable) |
| --- | --- |
| `getCartItemCount` (control, client-executed) | 200 — hash reproduced exactly, registered |
| `storeRetrieveWishlist` (bundle doc, all hash variants) | **404 — PersistedQueryNotFound** |
| `storeRetrieveWishlist` (freeform) | **400 — persisted-only / CSRF** |
| wishlist page data | served via SSR `__NEXT_DATA__`, no client GraphQL call |

status: done 2026-07-14
resolution: Wishlist reachable under NEITHER credential from the app's server-to-server position — the only working path is Sony's server-side persisted manifest, not client-observable and not obtainable by the Worker. Per Story 9.1c's contract and Story 9.4's first AC, **Story 9.4 is removed from Epic 9 and filed to Future.** Epic 9 ships with 9.1b + 9.2 + 9.3. Future revisit: if PSN re-exposes a client-side wishlist fetch, or publishes a REST wishlist endpoint, capture the hash then and restore 9.4.

- source_spec: `spec-fab-menu-trophy-icon-mobile-labels.md`
  summary: The card's platinum badge uses a fixed `data-testid="platinum-trophy"`, so a test doing `getByTestId('platinum-trophy')` in a render with 2+ platinum cards would throw on multiple matches.
  evidence: PRE-EXISTING (the card carried this id before the icon was extracted; behaviour unchanged). No code or test currently does a singular `getByTestId` in a multi-card context — `Card.test.tsx` renders one card — so it is latent, not a live failure. If a future full-app test needs it, key by game id or use `getAllByTestId`.
  resolution: done 2026-07-15 (Epic 11 sweep, revisited on Luca's call) — the testid is now game-scoped (`platinum-trophy-${game.id}`, `web/shelf/Card.tsx`), so a multi-platinum render can never throw on a singular lookup; `Card.test.tsx` matches the prefix.

- source_spec: `spec-9-5-post-retro-hardening-sweep.md`
  summary: An abandoned platinum-backfill loop (tab closed, or the client's 40-chunk brake trips) leaves the single-flight lock held until its 2-minute TTL, so the user's next sync is refused with the busy message.
  evidence: `src/routes/sync.ts` releases the lock only when the loop ENDS (last chunk or a failure); a client that simply stops looping has no release call and no `beforeunload` best-effort. Self-healing within the TTL, and the busy message says so — but a stopped-early run (600+ candidates) makes it deterministic. A `DELETE /api/backfill/platinum-dates/lock` presenting the token, called from the brake and on unmount, would close it.
  resolution: superseded 2026-07-15 (Epic 11 story 11.1) — the platinum backfill (route, client loop, and its lock op) is deleted outright; the abandoned-lock scenario can no longer occur. The surviving `catalog-refresh` op releases in a `finally` and renews per chunk, so it does not inherit the hazard.

- source_spec: `spec-9-5-post-retro-hardening-sweep.md`
  summary: `listDiscardedTitleKeys` is a second full user-scoped join per trophy sync, one row-set away from the `listLibraryForUser` scan that just ran.
  evidence: `src/repositories/games.ts` — both select the same user's `game_tracking ⋈ game`, differing only on the `discarded` flag. One query selecting `discarded` and partitioned in JS would be one D1 binding call instead of two, and binding calls count against the 50-subrequest budget the backfill's chunk size is busy defending. Not a hazard today (the trophy sync's budget has headroom); a cleanup when that file is next touched.
  resolution: superseded 2026-07-15 (Epic 11 story 11.1) — the trophy sync (the only caller) and `listDiscardedTitleKeys` itself are deleted; there is no second query left to merge.


- source_spec: `spec-catalog-detail-over-active-destination.md`
  summary: Typing in the header search while a game detail's pending/error overlay covers a destination writes `?q=` onto the `/game/:id` URL, not the destination behind it — the term is lost on Close.
  evidence: Only the resolved `DetailPanel` calls `useModalTrap`; the pending/404/error `DetailOverlay` in `web/shelf/GameRoute.tsx` does not, so the header `SearchBox` is keyboard-reachable during a slow `GET /api/games/:id`. `SearchBox.setSearchParams` targets the real URL (`/game/:id`), and the background rendered behind reads `background.search`, so the typed term never filters the visible grid and `navigate(-1)` discards it. Transient (pending is ~100-300ms) and low-severity; the proper fix is a design decision about what search-while-detail-open should do (dismiss the detail and filter, or ignore), not a mechanical patch.
  resolution: done 2026-07-15 (Epic 11 sweep, revisited on Luca's call) — no new design decision was needed: the resolved DetailPanel's modal trap already IS the answer, the overlay just never adopted it. `DetailOverlay` (`web/shelf/GameRoute.tsx`) now runs the same `useModalTrap` as every other dialog, so the header SearchBox is unreachable through the pending/404/error states exactly as it is behind the resolved panel — the `?q=`-onto-`/game/:id` write can no longer happen.

- source_spec: `spec-psn-region-setting.md`
  summary: The `PSN_REGION` env seed is persisted verbatim by `getPsnRegion` — no lowercase, no locale-format guard — so a malformed Wrangler var stores a value the new PUT validator would reject.
  evidence: `src/services/settings.ts:74-85` (pre-existing Story 5.1 code, untouched by this spec) persists `env.PSN_REGION?.trim()` on first read. Two write paths to `psn_region` now carry different invariants; catalog rows are keyed by the raw string, so a case-mismatched seed would orphan a snapshot. Harmless today (the var is pinned lowercase `it-it` in wrangler.jsonc) — normalize/validate the seed inside `getPsnRegion` when that file is next touched.
  resolution: done 2026-07-15 (Epic 11 sweep) — `normalizePsnRegion` in `src/services/settings.ts` is now THE shape rule for both write paths: the env seed normalizes through it (a malformed var behaves as unset instead of persisting), and the PUT's zod schema pipes through the same function, so the two invariants can no longer drift.

### DW-11: Genre chip count can exceed the filtered grid count when the store carries duplicate-named products

origin: source_spec spec-7-genre-sweep-client-loop.md (live browser test, 2026-07-15)
location: src/repositories/psplus-catalog.ts (browse query vs genres-with-counts query), web/catalog/Catalog.tsx (chip counts)
reason: The FIGHTING chip showed 13 while the filtered grid said "12 games matching": MORDHAU exists in the it-it store as two product_ids with the same name, both genre-tagged; the vocabulary count counts tag rows, the browse query dedupes by normalized title. Pre-existing 7.2 behavior surfaced by the first live sweep, not caused by the client loop. Cosmetic — the two counts disagree only for duplicate-named store products.
status: done 2026-07-15
resolution: done 2026-07-15 (post-retro deferred sweep) — the facet counts now run the SAME pipeline as a filtered browse: `listCatalogGenreFacets` (services/psplus-browse.ts) feeds each key's tagged rows through the grid's own `collapseEditions`, so a PS4/PS5 edition pair counts as one card by construction. The SQL GROUP BY (`countCatalogGenreKeys`) is deleted — parity by shared code path, not a parallel query kept honest by hand. Pinned by "counts a PS4/PS5 edition pair as ONE card, exactly like the filtered grid" in test/integration/psplus-browse.test.ts.

### DW-12: A discarded (soft-deleted) game keeps a stale ps_plus_extra flag until the next refresh

origin: spec-7-1 review deferral (2026-07-14), ledgered at epic-7 retro 2026-07-15
location: src/services/psplus.ts (flag pass) / game discard path
reason: The flag pass covers tracked games; a game discarded between refreshes keeps whatever flag it had until the next check/cron rewrites it. Harmless single-user (discarded games are hidden), self-heals monthly. Candidate for the Epic 10 snapshot work (10.2 diffs the same table).
status: done 2026-07-15
resolution: done 2026-07-15 (post-retro deferred sweep) — worse than ledgered: the next refresh ALSO skipped tombstones (`listLibraryForUser` filters `discarded = false`), so the flag froze forever, not "until the next refresh" — stale the moment the game was revived. The flag pass now reads `listLibraryForUser(db, userId, { includeDiscarded: true })` and writes through tombstones (the flag describes catalog membership on the shared game row, not user visibility); the check's readout still reports visible games only. Pinned by "updates a DISCARDED game's flag in both directions — without reporting it" in test/integration/psplus.test.ts.

### DW-13: first_seen_at resets when a catalog row is pruned and later re-added

origin: spec-7-1 review deferral (2026-07-14), ledgered at epic-7 retro 2026-07-15
location: src/repositories/psplus-catalog.ts (upsert)
reason: The column means "first seen since the last prune", not "first ever seen" — a game that leaves PS+ and returns looks new. Matters only for Epic 10's "leaving soon"/history features; decide the intended semantics there before building on it.
status: open
decision: 2026-07-15 Homed in Story 10.2 ("Leaving PS+ Extra soon", VR-6), epics.md — carried as an AC: the story must decide and document what `first_seen_at` means for its diff (and fix or rename the column if "since last prune" is not it) before building on it. A semantics decision, not a patch — deciding it now, without 10.2's design in hand, would be guessing. Ledger closes when 10.2 ships.
- source_spec: `_bmad-output/implementation-artifacts/spec-11-2-strip-psn-credential-auth-from-provider-and-settings.md`
  summary: `src/core/sync-reconcile.ts` (planSync) and the psn-link anchor write are production-dead since Epic 11 removed library sync — no production caller feeds planSync, and the anchored `np_title_id` write in games service has no remaining reader; decide whether to delete both or keep the anchor for a future burner-account revival.
  evidence: review finding on the 11.2 diff — `test/integration/games.test.ts` H4 pin now asserts a write nothing consumes; planSync is exercised only by tests; the sanctioned revival route (burner account, sprint-change-proposal-2026-07-15 §6) would want the anchor back.
  resolution: done 2026-07-15 (Epic 11 sweep) — split verdict. planSync: DELETED (`core/sync-reconcile.ts` + test + the `core/index.ts` export); test-only code, git history keeps it for any revival. Anchor: KEPT, because the entry's "no remaining reader" claim was wrong — `findGameByExternalLink('PSN', …)` reads the link at `services/games.ts:237` (applyCatalogOrigin converge, Epic 7 H1) and `:316` (add-by-name dedup), and `applyCatalogOrigin:247` still writes it, so two catalog adds of the same game under diverged titles converge through it with no library sync involved. Live production loop, not a revival stash.
