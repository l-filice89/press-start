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

- source_spec: `_bmad-output/implementation-artifacts/spec-dw-3-central-401-reauth-redirect.md`
  summary: An auth-state transition swaps the authenticated shell for `<Login />` with no focus management and no live-region announcement, so a keyboard or screen-reader user is silently dropped at the document start.
  evidence: `web/App.tsx`'s session gate re-renders a different subtree when `session` becomes `null` (on a 401 re-auth redirect, and equally on an explicit sign-out — so this predates the 401 work). React unmounts the focused element and focus falls back to `document.body`; nothing moves focus into the Login form or announces the change. Both entry points into `<Login />` share the gate, so a single focus/announcement fix at the gate covers them.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-change-play-status-from-the-shelf.md`
  summary: Marking a game `Dropped` unmounts its card on the shelf refetch, dropping keyboard focus to `document.body` — including focus needed to reach the toast's UNDO.
  evidence: `StatusPopover.select()` calls `close()`, which refocuses the pill; the mutation then invalidates `['shelf']`, the server filters the Dropped game out (FR-4), and React unmounts the card that owns the pill. Same defect class as DW-4 (shelf-grid focus on re-chunk) and the auth-gate focus item — a deliberate focus-restoration strategy for cards leaving the shelf, not an inline patch.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-change-play-status-from-the-shelf.md`
  summary: The `Dropped` toast offers no UNDO when the game's previous play status was null (status cleared by a completion milestone).
  evidence: `StatusPopover.select()` gates the undo on `next === 'Dropped' && previous`, and `previous` is `game.playStatus`, which is null for any game whose status was auto-cleared by a milestone (FR-2). Restoring that state means writing `play_status = null`, which Story 2.1's route deliberately cannot express (it accepts only the five play statuses; clearing goes through the FR-3/AD-12 invariant guard in Story 2.2/2.3). Unreachable on the default shelf today — milestone games are hidden (FR-17) — but reachable as soon as Epic 3's state-reveal pills or Story 2.3's detail panel render those cards. Fix alongside the milestone write path.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-change-play-status-from-the-shelf.md`
  summary: Lifecycle dates are stamped from the Worker's UTC clock, so an evening status change west of Greenwich records tomorrow's date, permanently.
  evidence: `src/routes/tracking.ts` computes `today` as `new Date().toISOString().slice(0, 10)`. `started_on` is write-once through automatic flows and explicitly unreconstructable (FR-44/FR-45, AD-11), so a wrong value never self-corrects. No PRD, architecture, or UX document picks a timezone policy, and the same choice binds `completed_on`/`platinum_on` (Story 2.2) and `bought_on` (Story 2.4) — an app-wide decision (store the user's zone in `SETTING`? stamp client-side?) rather than a per-route patch.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-log-completion-milestones-confirm-gated.md`
  summary: Milestone dates (`completed_on`/`platinum_on`) are stamped from the Worker's UTC clock — same undecided timezone policy as the 2.1 deferral, but now the wrong date is user-visible (shown on the achieved milestone row) and immutable (FR-6).
  evidence: `src/routes/tracking.ts` computes `today` as `new Date().toISOString().slice(0, 10)` on the milestone POST, mirroring the play-status PATCH. The 2.1 deferral already names this an app-wide policy decision binding Stories 2.2 and 2.4; 2.2 raises its stakes because the achieved row displays the stamped date and write-once means it never self-corrects. Resolve once, app-wide (user timezone in `SETTING`, or client-supplied date), not per route.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-flip-a-card-to-its-detail-view.md`
  summary: Three hand-rolled focus traps (ConfirmDialog, DetailPanel, and their shared technique) each duplicate ~20 lines and key off a `querySelectorAll('button…, a[href]')` selector that will silently miss the `<input>`/`<select>` controls Stories 2.4/2.5 add to the detail panel.
  evidence: `web/components/ConfirmDialog.tsx` and `web/shelf/DetailPanel.tsx` both implement first/last-focusable Tab cycling with near-identical code but already-drifted selectors (`button` vs `button:not([tabindex="-1"]), a[href]`). When date/ownership/genre editing lands in the panel (2.4/2.5), form controls become focusable but invisible to the trap boundary — Tab can escape the modal at the new controls. Consolidate into one trap helper (or adopt native `<dialog>.showModal()`) before 2.4 adds inputs.
