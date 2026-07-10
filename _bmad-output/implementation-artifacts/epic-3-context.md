# Epic 3 Context: Filter & Focus the Backlog

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let Luca narrow the shelf with State/Genre multiselect dropdowns, Flag pills, and hidden-state reveal pills — OR within a group, AND across groups — read back by a live plain-English summary sentence. Filtering the backlog must beat what Notion's saved views offered (product success metric #4). The epic also bundles a focus/interaction hardening sweep, because filters and reveal pills churn the visible set constantly, turning previously-deferred focus/race corner cases into daily paths.

## Stories

- Story 3.1: Filter the shelf by State and Genre
- Story 3.2: Flag pills and state-reveal pills
- Story 3.3: Live filter summary, empty state & responsive filters
- Story 3.4: Focus & interaction hardening (deferred-work sweep)

## Requirements & Constraints

**Filter semantics**
- OR within a group, AND across groups. Groups: State (multiselect dropdown of the four live statuses: Not started / Up next / Playing / Paused), State-reveals (individual pills for Story completed / Platinum achieved / Dropped that OR into the visible set), Genre (multiselect dropdown of the vocabulary), Flags (`Owned` / `Wishlisted` / `Released` / `Playable now` — each pill is its own AND group).
- State-group selection rule: nothing selected → default visible set (live play statuses only; Completed/Platinum/Dropped hidden). The moment anything in the state group is selected, the shelf shows exactly the selected states.
- Reveal pills extend the state group: toggling one ORs that hidden state into whatever is currently visible. `Dropped` games are reachable only via their reveal pill.
- Active pills/entries are visually highlighted (toggle-on / glow).

**Ordering — FR-18 amendment (2026-07-09, applies here).** The owned-before-wishlisted ownership tier applies to ALL shelf views, filtered and reveal-pill views included — not just the default view. Every visible set orders: state priority (Playing → Paused → Up next → Not started, plus revealed states) → owned before wishlisted → alphabetical by name. The tier is ownership, deliberately not playable-now (owned pre-orders sort first; un-owned PS+-catalog games sink). Library search results stay plain alphabetical.

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
- **Standing test rule (binds this epic):** every AC with a matching UI user flow ships with a Playwright e2e test (real Worker + D1, magic-link auth via console-captured link). CI gate: Biome + tsc + Vitest (workers pool) + Playwright, all via the shared package.json scripts.
- Story 3.4 hardening targets (each tied to a deferred-work ledger entry): focus survives grid re-chunking on viewport resize; login-screen swap moves focus into the form and announces it; a card unmounting after a write lands focus on a deliberate target with toast UNDO still keyboard-reachable; an open detail panel survives shelf refetch re-chunking (open-panel game id hoisted to Shelf level); toast UNDO respects the same ref-backed in-flight mutation guard as every other entry point.

## UX & Interaction Patterns

- **Filter row (desktop):** State dropdown, Genre dropdown, Flag solid toggle pills, State-reveal dashed pills. Shape encodes behavior: solid = narrows (AND), dashed = reveals a hidden state.
- **Live summary sentence:** plain-English readback of the active filter with literal "or"/"and" words; OR-connectors in glow-cyan, AND-connectors in heat-magenta — color redundant to the words (no color-alone signaling).
- **Phone:** filters collapse to a single Filters button + active-count badge opening a grouped, logic-labeled bottom sheet with a "Show N games" action. Desktop shows the full row inline with the summary sentence.
- **Empty state:** no filter match → `NO MATCH` + "Clear filters" action.
- **Accessibility floor:** pills/toggles are buttons with accessible names + state; ≥44×44 hit areas decoupled from visual size; distinct always-on focus outline (never glow-intensity alone); status/filter changes announce via the polite live region; WCAG AA contrast (active solid pills = dark ink on neon, never white-on-neon); reduced-motion drops glow pulses.
- Dark-only design token system already exists from Epic 1 (palette, Orbitron/Rajdhani/Inter/JetBrains Mono, spacing, radii) — reuse tokens and existing primitives (toast, live region, empty states).

## Cross-Story Dependencies

- **Epic 2.5 (Playwright foundation) must be complete before Epic 3** — it is; the standing e2e rule applies to every story here.
- 3.1 establishes the filter model (groups, OR/AND, state-selection rule); 3.2 extends the same state group with reveal pills and adds flag groups; 3.3 narrates whatever 3.1/3.2 built — build in order.
- 3.2's UNDO/panel ACs close two deferred-work items from Epic 2 (null-status UNDO; platinum-only auto-hide false-close) that reveal pills make reachable for the first time.
- 3.4 depends on the churn 3.1–3.3 introduce; its ACs cross-reference `_bmad-output/implementation-artifacts/deferred-work.md` entries and convert epic2-detail e2e workaround assertions back to direct ones.
- **Verify/demo note:** no seed-imported game is ever `Dropped` (Notion mapping produces only live statuses or null), so the `Dropped` reveal pill shows an empty set until a game is dropped via Story 2.1 — expected, not a defect; seed a manual fixture if needed.
