# Epic 2 Context: Track Your Games

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 2 turns the read-only shelf from Epic 1 into a tracker. From a card, the user changes play status in a single tap; from the flip-to-detail panel, they log Story/Platinum completion milestones behind a confirmation, edit ownership flag and type, correct lifecycle dates, and fix genres. The completion invariant is enforced on every write path and lifecycle dates are auto-recorded write-once. This epic delivers the product's second success metric: logging a status change takes seconds, not a Notion-editing session.

## Stories

- Story 2.1: Change play status from the shelf
- Story 2.2: Log completion milestones (confirm-gated)
- Story 2.3: Flip a card to its detail view
- Story 2.4: Edit ownership and lifecycle dates in detail
- Story 2.5: Edit genres in detail

## Requirements & Constraints

**State model.** Play status (`Not started` · `Up next` · `Playing` · `Paused` · `Dropped`) is the only user-set mutable state, one per game, defaulting to `Not started`. It may be null **only** once a completion milestone exists; logging a milestone auto-clears it to null, and the user may clear it manually. Setting a status back to `Playing` is a replay and leaves completion dates untouched.

**Completion invariant.** Every game always has a play status **or** at least one completion milestone. Any edit that would leave neither must be refused — clearing the last milestone requires setting a play status first.

**Milestones.** `completed_on` and `platinum_on` are dates, not statuses; non-NULL means achieved. They are immutable through normal flows (no sync, status change, or replay ever clears or overwrites them) and logging one that already has a date does nothing — the first achievement stands. Logging either requires a confirmation modal. A logged milestone paints a permanent silver badge on the cover regardless of later play status.

**Effective state.** `play status if set, else Platinum achieved if platinum_on, else Story completed if completed_on`. Shelf ordering, card labels, and filter pills operate on effective state, never raw play status.

**Default shelf.** Only live play statuses are visible; `Story completed`, `Platinum achieved`, and `Dropped` are hidden by default. Marking a game `Dropped` therefore removes it from the default shelf.

**Lifecycle dates.** `wishlisted_on`, `bought_on`, `started_on` (first transition to `Playing`), `completed_on`, `platinum_on` are auto-recorded on transition, never asked for, and **write-once through automatic flows** — the first value stands. `started_on` is written only while no completion milestone exists; replays never write it. All of them remain manually editable in the detail view only; that manual correction is a deliberate override, not an automatic overwrite.

**Ownership.** `owned` means *purchased*, is per-user, and is a flag rather than a status. It is set by sync (digital) or manually in the detail view / card toggle (physical discs the PS API cannot see). Manual flagging defaults ownership type to `physical` and stamps `bought_on` once. Nothing unsets `owned` except the user. Ownership type (`digital` / `physical`) is editable in detail.

**Genres.** Many-to-many; the vocabulary comes exclusively from the external games DB. Adding a genre not yet in the vocabulary auto-creates the genre row. No merge/rename tool in v1.

**Wishlisted games** (= not owned) show a "View on PS Store" link in detail: the product URL when known, a store search-by-title fallback otherwise.

**Nothing external on render.** Covers and store links come from persisted data; no third-party call happens on any read or edit path in this epic.

## Technical Decisions

- **Layering.** `core/` is a pure, I/O-free domain sink (no `fetch`, no D1/Drizzle). `services/` orchestrates. `repositories/` is the sole persistence path (Drizzle over D1) — no raw queries anywhere else. `routes/` are Hono handlers with Zod validation at the boundary; a typed RPC client and shared Zod schemas span SPA↔Worker. `web/` is the React SPA with TanStack Query for server state.
- **One effective-state function.** A single `core/` function computes effective state; ordering, labels, and filters consume it and none recomputes it.
- **One milestone-write reconciliation function.** A single `core/` function owns the "logging a milestone auto-clears play status to null" side-effect. Every surface (shelf popover, detail panel) calls it; none hand-rolls the transition. This is the write-side twin of the effective-state read function — the two surfaces must never disagree.
- **The completion invariant is enforced at the boundary** — the API refuses the edit, not just the UI. Client-side refusal alone is insufficient.
- **Write-once dates are enforced in the write path**, not left to callers: automatic flows write each date once, and `started_on` is guarded by "no completion milestone exists".
- **Schema ownership.** `GAME` holds shared catalog facts (title, normalized title, release date, cover URL, store URL, genres via `GAME_GENRE`, PS+ Extra catalog membership). `GAME_TRACKING` holds per-user mutable state (`play_status`, all milestone/lifecycle dates, `owned`, `ownership_type`) and is keyed **`(user_id, game_id)`** — one tracking row per user per game.
- **User scoping.** Every tracking row carries `user_id` and every tracking query filters by it.
- **Dates** are ISO-8601 `DATE`; DB columns are `snake_case`.
- **Testing.** Vitest; pure `core/` logic is unit-tested with no runtime, Worker+D1 paths via `@cloudflare/vitest-pool-workers`. Lint+format is Biome.

## UX & Interaction Patterns

- **Status pill** (on every card) shows effective state. Tapping it opens a **popover** anchored to the pill holding the 5 play statuses (applied instantly, no confirm — status is freely mutable) plus two milestone rows ("Story completed", "Platinum achieved") which open the **confirm modal** before anything is written.
- **Feedback channels.** A status change or a logged milestone fires a **toast** (~3s, auto-dismiss). Reversible risky actions — marking `Dropped`, un-owning — carry a one-tap **UNDO** in the toast. Milestones need no undo; they are already confirm-gated.
- **Detail panel** is reached by tapping a non-control area of the cover: flip-then-grow, centered ~760px on desktop, full-screen on mobile. It holds a play-status segmented control, milestone rows + dates, lifecycle dates, genres, ownership flag + type, and the store link — reusing the same status/milestone logic as the shelf popover.
- **Confirm modal** uses milestone silver for gravity. Card owned toggle sits top-right and is reversible with no confirm.
- **Accessibility floor (non-negotiable).** The status popover has **menu semantics**: `aria-haspopup` / `aria-expanded` on the pill, arrow-key traversal between rows, Escape closes and returns focus to the pill. The detail panel is a **focus-trapped dialog** returning focus to its originating card on close. Every control is keyboard-operable; icon-only controls carry accessible names + state. Status/milestone changes and toasts announce via a polite live region. Touch targets are ≥44×44 (via padding or an invisible expander — the compact visual size stays). Status is never signaled by color alone: the text pill is the indicator on every surface; milestones also carry a badge shape. `prefers-reduced-motion` replaces flip-then-grow with a fast cross-fade/scale and drops glow pulses.
- **Semantic status colors:** Playing = heat magenta (reserved — never used for anything else), Up next = electric cyan, Paused = steel, Not started = dormant grey, Dropped = dim grey, Completed/Platinum = milestone silver. Dark-only.

## Cross-Story Dependencies

- Story 2.1 establishes the status popover and the status-write path; **2.2 extends the same popover** with milestone rows and the confirm modal, and **2.3's detail panel reuses both** rather than re-implementing them.
- Stories 2.3–2.5 all render inside the detail panel from 2.3, so 2.3 gates them.
- The completion invariant (2.3) and the milestone-write reconciliation function (2.2) are the shared contract that 2.1's status writes and 2.4's date edits must both respect.
- The whole epic builds on Epic 1: the effective-state and title-normalization core functions, the `GAME` / `GAME_TRACKING` schema and repositories, magic-link auth with `user_id` scoping, the design system + app shell, and the read-only shelf with its cards and status pills.
- Epic 3's filters consume the same effective-state function this epic writes through; a status change must update ordering, pill label, and filter matching everywhere from that one function.
