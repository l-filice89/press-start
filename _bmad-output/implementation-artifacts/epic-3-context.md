# Epic 3 Context: Filter & Focus the Backlog

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let Luca narrow the shelf with State/Genre multiselect dropdowns, Flag pills, and hidden-state reveal pills — OR within a group, AND across groups — read back by a live plain-English summary sentence. Filtering the backlog must beat what Notion's saved views offered (product success metric #4). The epic was reopened after its retro: reveal pills change from additive to an **exclusive view** (Story 3.5), and the client write paths harden against stale reads/intent before sync becomes a write source (Story 3.6). It also bundles a focus/interaction hardening sweep (3.4), because filters and reveal pills churn the visible set constantly, turning previously-deferred focus/race corner cases into daily paths.

## Stories

- Story 3.1: Filter the shelf by State and Genre
- Story 3.2: Flag pills and state-reveal pills
- Story 3.3: Live filter summary, empty state & responsive filters
- Story 3.4: Focus & interaction hardening (deferred-work sweep)
- Story 3.5: Reveal-pill exclusive mode
- Story 3.6: Write-path hardening (pre-sync)

## Requirements & Constraints

**Filter semantics (as amended 2026-07-10 — exclusive reveals)**
- OR within a group, AND across groups. Groups: State (multiselect dropdown of the four live statuses: Not started / Up next / Playing / Paused), State-reveals (**own group**: individual pills for Story completed / Platinum achieved / Dropped), Genre (multiselect dropdown of the vocabulary), Flags (`Owned` / `Wishlisted` / `Released` / `Playable now` — each pill is its own AND group).
- Selection rules: nothing selected in State or Reveals → default visible set (live play statuses only; Completed/Platinum/Dropped hidden). A State-dropdown selection shows **exactly** the selected live states.
- **Reveal pills are exclusive, not additive.** Selecting any reveal pill shows **only** games in the selected hidden state(s) — it replaces the State group entirely (state selections clear). Multiple reveal pills OR among themselves (Completed + Platinum = either). Genre and Flag selections still AND with an active reveal view. State dropdown and reveal pills are mutually exclusive; activating one clears the other. `Dropped` games are reachable only via their reveal pill. (Superseded semantics — revealed games ORed into the default set — pushed them behind the default order + infinite scroll; do not implement.)
- Active pills/entries are visually highlighted (toggle-on / glow).

**Ordering.** The ownership tier applies to ALL shelf views, filtered and reveal views included: state priority (Playing → Paused → Up next → Not started) → owned before wishlisted → alphabetical by name. Library search results stay plain alphabetical.

**Search vs filters.** The whole-library search is a separate query path and always ignores active filters and hidden states — filters must never leak into it.

**Milestone/status invariants filters make reachable**
- UNDO on marking a revealed card `Dropped` must restore a previously auto-cleared (null) status through the milestone-invariant write path — every game must always keep a play status or at least one milestone.
- A detail panel open on an already-hidden game (reached via reveal pill or search): a milestone write that doesn't change visibility must not auto-close the panel — auto-close fires only on visible→hidden transitions.

**Failures surface, never silently** (project-wide bar): no-match filter states show explicit empty-state UI, never a blank shelf.

## Technical Decisions

- **Effective state is the filter input.** Filtering, ordering, and labels all consume the single `core/` effective-state function (play status if set, else Platinum, else Story completed) — no surface recomputes it and no raw `play_status` queries.
- **Derived flags are computed, never persisted.** Released (real date ≤ today; TBA/missing = false), Wishlisted (= not owned), Playable now ((owned OR in PS+ Extra) AND released) come from pure `core/` functions.
- **Layering:** filter logic that is pure state computation belongs in I/O-free `core/`; data access goes through `repositories/` only; nothing external is fetched on any render/read path.
- **Scale decision:** at ~344-game single-user scale the sorted/filtered set is materialized in the Worker/client (progressive rendering), not keyset-paged in SQL.
- **Every user-scoped query filters by `user_id`.**
- **Standing test rule (binds this epic):** every AC with a matching UI user flow ships with a Playwright e2e test (real Worker + D1, magic-link auth via console-captured link). CI gate: Biome + tsc + Vitest (workers pool) + Playwright.
- Story 3.4 hardening targets (each tied to a deferred-work ledger entry): focus survives grid re-chunking on viewport resize; login-screen swap moves focus into the form and announces it; a card unmounting after a write lands focus on a deliberate target with toast UNDO still keyboard-reachable; an open detail panel survives shelf refetch re-chunking (open-panel game id hoisted to Shelf level); toast UNDO respects the same ref-backed in-flight mutation guard as every other entry point.
- Story 3.5 bundles (beyond the semantics change): one extracted focus-trap shared by ConfirmDialog / DetailPanel / FilterSheet; a deliberate focus target when ShelfGrid unmounts to the empty state (never `<body>`); e2e suites rewritten for the exclusive-reveal contract plus the loadAllPages fold-position fix in the two flaky epic-2 specs.
- Story 3.6 write-path guarantees (must land before sync becomes a write source): every tracking write invalidates both `['shelf']` and `['shelf-search']` query keys; a stale toast UNDO can never overwrite a newer settled write on the same game (latest-write token or dismiss stale toasts); an open status-popover menu survives refetch re-chunking (open-state hoisted like the 3.4 detail-panel fix), removing the e2e `openStatusMenu` retry loop in the same change.

## UX & Interaction Patterns

- **Filter row (desktop):** State dropdown, Genre dropdown, Flag solid toggle pills, State-reveal dashed/dotted pills. Shape encodes behavior: solid = narrows (AND), dashed = shows a hidden state.
- **Live summary sentence:** plain-English readback of the active filter with literal "or"/"and" words; OR-connectors in glow-cyan, AND-connectors in heat-magenta — color redundant to the words (no color-alone signaling). An active exclusive reveal view is stated literally ("Showing Completed games.") — no live-status enumeration alongside it.
- **Phone:** filters collapse to a single Filters button + active-count badge opening a grouped, logic-labeled bottom sheet with a "Show N games" action. Desktop shows the full row inline with the summary sentence.
- **Empty state:** no filter match → `NO MATCH` + "Clear filters" action; on the transition, focus lands on a deliberate target (Clear filters or the empty-state heading).
- **Accessibility floor:** pills/toggles are buttons with accessible names + state; ≥44×44 hit areas decoupled from visual size; distinct always-on focus outline (never glow-intensity alone); status/filter changes announce via the polite live region; WCAG AA contrast (active solid pills = dark ink on neon, never white-on-neon); reduced-motion drops glow pulses.
- Dark-only design token system already exists from Epic 1 (palette, Orbitron/Rajdhani/Inter/JetBrains Mono, spacing, radii) — reuse tokens and existing primitives (toast, live region, empty states, focus trap once extracted).

## Cross-Story Dependencies

- 3.1–3.4 are implemented (epic reopened for 3.5/3.6). 3.5 **changes** the reveal contract 3.2 shipped and the summary wording 3.3 shipped — their e2e specs are rewritten under 3.5, not patched.
- 3.5's exclusive semantics required the FR amendments already applied to the planning docs (2026-07-10); build against the amended semantics only.
- 3.6 must land before Story 4.2 introduces sync as a new write source; its popover fix reuses the open-state-hoisting pattern established by 3.4's detail-panel fix.
- 3.4/3.5/3.6 ACs cross-reference `_bmad-output/implementation-artifacts/deferred-work.md` entries by name — close the ledger entries with the work.
- **Verify/demo note:** no seed-imported game is ever `Dropped` (Notion mapping produces only live statuses or null), so the `Dropped` reveal pill shows an empty set until a game is dropped via Story 2.1 — expected, not a defect; seed a manual fixture if needed.
