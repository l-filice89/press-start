# Epic 9 Context: The PSN Record — Trophies (and maybe Wishlist)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 4 filled the library from PlayStation; this epic brings across the *record*. Each game gains trophy progress — completion percentage and a PSNProfiles-style letter grade — so "did I ever finish that?" gets a number instead of only a status pill. A one-off backfill recovers the platinum dates PSN already knows for games platinumed before the app existed, so milestone history isn't blank. The epic opens with a spike that answers a single question — what does the `pdccws_p` session cookie actually authorize — and that answer decides whether PS Store wishlist sync ships here or slips to Future. Everything here enriches a working app: it adds no new state model and changes no existing sync behaviour.

## Stories

- Story 9.1: Spike S-1 — what does `pdccws_p` authorize?
- Story 9.2: Trophy progress on every game
- Story 9.3: One-off backfill — recover platinum dates from PSN
- Story 9.4: Sync the PS Store wishlist (conditional on 9.1)

## Requirements & Constraints

- **Free-tier hosting is a hard constraint.** A trophy lookup per game across a ~175-game library will not fit one invocation's external-subrequest budget; bulk fan-out must chunk or run out-of-band.
- **Nothing external on render.** Trophy counts, grades, and store links are served from persisted data. Third-party APIs are hit only at sync, import, refresh, or add time.
- **Failures surface, never silently retry.** An expired PSN cookie shows refresh instructions and stops the run; no silent retry and no partial write presented as complete. Every sync ends with a visible summary naming what was added, what was skipped, and anything needing attention.
- **Append-only to user data.** Sync may create games and add facts; it never deletes a game, never unsets ownership, and never touches play status, milestones, or dates — with Story 9.3 as the single, deliberate, documented exception.
- **Lifecycle and milestone dates are write-once through automatic flows.** The first recorded value stands; the backfill only ever fills nulls, which is also what makes it safe to re-run.
- **Wishlist means "not owned."** There is no stored wishlisted flag and no separate wishlist list; wishlist state is derived. A wishlist entry matching an owned game changes nothing.
- Spike output is an **endpoint × auth-path table** (wishlist endpoint, purchased-game-list, trophy endpoints; under cookie and under NPSSO bearer), recorded in the deferred-work ledger. Its "done" is that written table plus an explicit sequencing decision — no production code need survive it. It also closes the long-open PSN-auth question in the PRD and the spine's deferred entry.

## Technical Decisions

- **All PSN I/O goes through the `PsnProvider` port.** The auth mechanism (today the `pdccws_p` cookie) lives entirely inside that adapter; an NPSSO swap, if the spike recommends one, changes only that adapter and nothing else. Account region is a provider input.
- **The domain core is I/O-free.** Completion percentage and the letter grade are pure functions computed from stored trophy counts. Grade bands are documented in exactly one place.
- **Derived values are never stored as a second source of truth.** Persist the raw trophy counts (earned/total by tier); derive percentage and grade. Distinguish this from *fetched facts* — trophy counts themselves are facts from a third party and must be persisted, not refetched on render.
- **Attribute ownership.** Trophy progress is per-user state, not shared catalog identity: it belongs with the per-user tracking row, alongside play status and dates — not on the shared game record (which holds title, release date, cover, store URL, genres, catalog membership).
- **Persistence only through the repository layer** (Drizzle over D1); no raw queries from services, routes, or core.
- **Matching order for any incoming PSN entity** is stored external-ID links first, then normalized title, via the single shared normalization function. A game may carry multiple external links per source (the PS4/PS5 collapse). A title match whose external id resolves to a *different* game is flagged in the sync summary's needs-attention list, never silently merged.
- **Heavy bulk work runs out-of-band or chunked** — never as a blocking request. Both the trophy sync fan-out and the backfill fall under this.
- The backfill's "no `completed_on` → set it to the platinum date" rule is a **backfill-only heuristic**, recorded as such. It is explicitly not the rule for ongoing sync: the trophy sync never writes milestones.

## UX & Interaction Patterns

- A game with trophy data shows its completion % and grade on the card and in the detail view; a game with no trophy data shows **nothing** — never a fake 0%.
- Silver is the earned-milestone metal (Completed ✓ / Platinum 🏆). Milestone badges persist on the card regardless of play status; do not recolor a milestone to match a status.
- Triggered operations run inline with progress, then resolve into a summary modal. Anything in that summary needing action also seeds the persistent attention banner, so it survives dismissal.
- Trophy sync is user-triggered by a button, alongside the existing library sync.

## Cross-Story Dependencies

- **Story 9.1 gates Story 9.4.** If the wishlist endpoint is reachable over the session cookie, 9.4 stays in this epic. If it needs NPSSO, the auth swap becomes its prerequisite and 9.4 is dropped to Future while 9.2/9.3 proceed alone. If trophies *also* need NPSSO, the swap is promoted out of Deferred and gates the whole epic.
- **Story 9.3 depends on Story 9.2** — the backfill reads the trophy data (earned Platinum + earned date) that 9.2 fetches and persists.
- **The epic depends on Epic 4** (PS library sync) for the populated library and the existing `PsnProvider` plumbing it extends. 9.3 is the lowest-value story to cut; 9.4 may not exist at all.
