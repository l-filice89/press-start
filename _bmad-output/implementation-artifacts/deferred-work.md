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

- source_spec: `_bmad-output/implementation-artifacts/spec-dw-shelf-grid-aria-row-regrouping.md`
  summary: Shelf resize that changes the auto-fill column count remounts the focused card (row `div`s keyed by index; a card moves to a different parent when re-chunked), dropping browser focus.
  evidence: React reconciles keyed children per parent — moving a `game.id`-keyed `Card` from one index-keyed `role="row"` div to another forces unmount+remount, so a card holding keyboard focus loses it and its `cardRefs` entry resets during a viewport resize crossing a column boundary. Roving-tabindex/reading-order invariants still hold, but active keyboard focus is lost mid-resize. Inherent to the mandated `display:contents` row grouping; not trivially fixable without restructuring the ARIA grouping.
  decision: 2026-07-10 Assigned to Story 3.4 (Focus & interaction hardening) — deferred-work triage sweep; Epic 3 filter churn promotes this from corner case to daily path.

- source_spec: `_bmad-output/implementation-artifacts/spec-dw-3-central-401-reauth-redirect.md`
  summary: An auth-state transition swaps the authenticated shell for `<Login />` with no focus management and no live-region announcement, so a keyboard or screen-reader user is silently dropped at the document start.
  evidence: `web/App.tsx`'s session gate re-renders a different subtree when `session` becomes `null` (on a 401 re-auth redirect, and equally on an explicit sign-out — so this predates the 401 work). React unmounts the focused element and focus falls back to `document.body`; nothing moves focus into the Login form or announces the change. Both entry points into `<Login />` share the gate, so a single focus/announcement fix at the gate covers them.
  decision: 2026-07-10 Assigned to Story 3.4 (Focus & interaction hardening) — deferred-work triage sweep.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-change-play-status-from-the-shelf.md`
  summary: Marking a game `Dropped` unmounts its card on the shelf refetch, dropping keyboard focus to `document.body` — including focus needed to reach the toast's UNDO.
  evidence: `StatusPopover.select()` calls `close()`, which refocuses the pill; the mutation then invalidates `['shelf']`, the server filters the Dropped game out (FR-4), and React unmounts the card that owns the pill. Same defect class as DW-4 (shelf-grid focus on re-chunk) and the auth-gate focus item — a deliberate focus-restoration strategy for cards leaving the shelf, not an inline patch.
  decision: 2026-07-10 Assigned to Story 3.4 (Focus & interaction hardening) — deferred-work triage sweep.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-change-play-status-from-the-shelf.md`
  summary: The `Dropped` toast offers no UNDO when the game's previous play status was null (status cleared by a completion milestone).
  evidence: `StatusPopover.select()` gates the undo on `next === 'Dropped' && previous`, and `previous` is `game.playStatus`, which is null for any game whose status was auto-cleared by a milestone (FR-2). Restoring that state means writing `play_status = null`, which Story 2.1's route deliberately cannot express (it accepts only the five play statuses; clearing goes through the FR-3/AD-12 invariant guard in Story 2.2/2.3). Unreachable on the default shelf today — milestone games are hidden (FR-17) — but reachable as soon as Epic 3's state-reveal pills or Story 2.3's detail panel render those cards. Fix alongside the milestone write path.
  decision: 2026-07-10 Assigned to Story 3.2 as an AC (reveal pills make it reachable) — deferred-work triage sweep; cross-referenced in epics.md.

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
  decision: 2026-07-10 Assigned to Story 3.4 (Focus & interaction hardening) — deferred-work triage sweep.

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
  decision: 2026-07-10 Assigned to Story 3.4 (Focus & interaction hardening) — deferred-work triage sweep; includes converting the epic2-detail.spec.ts workaround assertions back to direct ones.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-4-standing-rule-every-ui-ac-ships-with-a-playwright-test.md`
  summary: The ORCHESTRATION CONSTRAINT fact ("NEVER delegate work to subagents") contradicts bmad-dev-auto's SKILL.md, which makes synchronous review subagents mandatory; sessions must reconcile the two ad hoc.
  evidence: Surfaced during Epic 2.5 runs — the constraint targets bmad-loop's background-detection gap (retired on Windows), but its wording forbids all subagents. Reword to forbid only background/detached delegation, keeping synchronous subagents legal.
  resolution: done 2026-07-10 (triage sweep) — fact reworded in `_bmad/custom/bmad-dev-auto.toml`: forbids only background/detached delegation and explicitly blesses same-turn synchronous subagents (TaskOutput block:true), matching SKILL.md's mandatory review subagents.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-filter-the-shelf-by-state-and-genre.md`
  summary: Epic 2 e2e specs flake under full-suite parallel load when their seeded card sits past the progressive fold (scrollIntoViewIfNeeded waits on an unrendered locator) or a popover-open races; observed on epic2-detail.spec.ts:127 (2.3c) and epic2-tracking.spec.ts:165 (2.1b), both green in isolation and on re-run.
  evidence: Full-suite run 2026-07-10 failed exactly these two while 34 passed; immediate isolated re-run and a second full-suite run passed 36/36. Failure snapshot shows the seeded 'Store Link' card absent from the rendered (unpaged) grid — same fold-position hazard epic1-shelf.spec.ts mitigates with loadAllPages/wishlist pads.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-flag-pills-and-state-reveal-pills.md`
  summary: Tracking mutations invalidate only ['shelf'], never ['shelf-search'] — a detail panel opened from a search result renders from a payload that goes stale after any write (fields shown stale; becameHidden transition check reads a stale before-state in that path).
  evidence: web/shelf/useTrackingMutations.ts onSuccess handlers invalidate queryKey ['shelf'] only; SearchBox owns ['shelf-search', q]. Pre-existing seam (all Story 2.x writes had it), surfaced by the 3.2 review's look at becameHidden.
