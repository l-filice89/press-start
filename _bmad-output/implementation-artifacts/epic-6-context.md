# Epic 6 Context: Add at the Moment of Discovery + Chores

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let Luca capture a game the instant he discovers it — type a name, pick an IGDB result, review pre-filled data, save — in the seconds the discovery moment lasts, with a name-only fallback so the wishlist moment never depends on a third party being reachable. The epic also resolves leftover import stragglers by manual search, exports the full library to CSV as a user-held backup, manages settings, and reconciles ownership provenance (purchased vs PS+-claimed). This is where the `IgdbProvider` adapter is built.

## Stories

- Story 6.1: Add a game by name (the wishlist moment)
- Story 6.2: Name-only fallback & straggler resolution
- Story 6.3: Chores — CSV export & settings
- Story 6.4: Ownership source — purchased vs claimed, and un-claim on cancel
- Story 6.5: Free-text shelf search
- Story 6.6: One picker for every IGDB match (PV-6)

## Requirements & Constraints

- Add-by-name searches the games DB, but must first check the existing library: a match opens that game's detail view rather than creating a duplicate. Deduplication rides the shared title-normalizer match key (normalized-exact-match), the same rule used across add/revive paths.
- Nothing commits until Save. The preview is fully editable. Save defaults to not-owned (= wishlisted, stamps `wishlisted_on`), status `Not started`. New genres on save auto-create their genre rows.
- Every third-party call routes through a provider adapter; `IgdbProvider` is the seam here. When IGDB is unreachable or lacks the title, the user can still save a name-only entry — a real game row flagged `unenriched`, release date unknown (treated as not released) — which lands in the stragglers list for later enrichment.
- A straggler is a defined needs-attention record of two kinds: import staging rows carrying a Notion payload, and name-only add entries. Resolving an import straggler by manual search carries its Notion payload (status, dates, owned flag) onto the matched game. A confirmed manual match stores a permanent external-ID/alias link so future syncs recognize the game and never re-add it as a duplicate.
- Failures must surface, never silently retry. Anything needing action seeds the persistent attention banner; the banner self-clears when the condition resolves.
- CSV export streams the full library (games, statuses, milestones, lifecycle dates, genres, ownership) from D1 as a download. It is the user-held second copy behind D1 Time Travel.
- Ownership provenance (Story 6.4): a manual owned-toggle on a game that carries the PS+ Extra pill must ask "Did you buy this, or claim it with PS+?" and write `owned_via = 'purchase'` or `'membership'`. A non-PS+ game defaults silently to `purchase` (only a PS+ game is ambiguous). The detail panel states the source plainly ("Owned · via PS+" vs "Owned · purchased"). A settings action "I cancelled PS+" un-owns every `membership` row (purchases untouched, count named in a confirm first); any of those games still in the Extra catalog re-shows its PS+ pill. Un-own reverses ownership only — never deletes tracking, milestones, or dates. This is distinct from PS+ Extra *catalog availability*: a catalog game never claimed stays un-owned.
- Free-text shelf search (Story 6.5): typing in the search bar filters the *visible shelf* live by title substring (normalized, case/diacritic-insensitive) — distinct from 6.1's add-a-new-game suggestions. No match shows an empty state that still offers the `＋ Add "<name>"` row; clearing the input restores the full shelf.
- Correctable auto-match (Story 6.6): the add preview's IGDB auto-match must be correctable *before* the row exists. A "Not the right game?" affordance opens the candidate picker inline; picking a candidate overwrites the whole draft (cover, genres, release date) and resets the seeded-draft guard — prior edits were edits to the wrong game. When the preview reports the provider unavailable (search returns no candidates because IGDB is down/unset), the affordance is hidden rather than opening an always-empty picker. Every IGDB candidate picker in the app must end up being the same shared component — no bespoke copy survives this story.

## Technical Decisions

- Domain `core/` is I/O-free; the title-normalizer is a single shared pure function producing the match key (strips glyphs/edition suffixes, drops leading articles, folds case/whitespace, collapses PS4/PS5). Reuse it for both library-match dedup and straggler resolution.
- All DB access goes through `repositories/` (Drizzle); no raw D1 in services/routes/core. All third-party access through `providers/` adapters only, and only at ingest/add time — never on a render/read path.
- Zod validates every SPA↔Worker boundary; Hono typed-RPC client + TanStack Query on the read side.
- `owned_via` is an existing `game_tracking` column (introduced by Epic 4's FR-9 amendment); 6.4 adds the manual-set prompt and the cancel-PS+ reversal flow around it — no new migration for the flag itself.
- 6.6 is UI consolidation only: no new endpoint, no server change, no schema change. It reuses the existing IGDB candidate-search seam end to end. Unlike rematch (which swaps the provider link on an existing row) the add-modal picker only replaces local draft state — no row exists yet. Mutation logic (straggler resolve, rematch, straggler-kind handling) stays page-side; only the candidate list/search UI is shared.
- The existing rematch and stragglers dialog test suites drive the picker through its confirm button and must keep passing unchanged through the extraction — they are the migration's safety net. The new add-modal correction path gets Playwright coverage per the standing end-to-end rule.

## UX & Interaction Patterns

- Search bar: persistent, combobox semantics (`role=combobox`, `aria-controls`/`aria-activedescendant`); results dropdown lists library matches plus the `＋ Add "<name>"` row; it is never a dead end.
- Add preview CTA names the outcome: "Add to wishlist" / "Add as owned".
- FAB upward drawer holds the chores (Export CSV, Settings, About/Help). Its shell is shared with Epic 4's Sync/PS+ items — whichever epic ships first stands up the shell; the other adds its items, need-scoped. If Epic 6 lands first, Story 6.3 creates the shell. No "Add" lives in the drawer (add is the search bar).
- Attention banner: full-width under-header, shown only when action is needed, amber for stragglers, persistent until the condition clears.
- Empty states: no filter/search match → offer the add path; empty library → `INSERT GAMES` with Sync / Add actions.
- Stacked modals (6.6): the candidate picker opens *inside* the add modal. Escape closes the picker first and leaves the add modal open — the same focus-trap stacking the detail panel already performs for rematch.

## Cross-Story Dependencies

- 6.1 and 6.2 depend only on Epic 1's search bar and shelf; they are the epic's value core.
- 6.3's FAB drawer shell is shared with Epic 4 (see above).
- 6.4's cancel-PS+ control lives on the Story 6.3 settings surface, and its provenance rules build on Epic 4's `owned_via` and Epic 5's PS+ Extra catalog membership. It is explicitly *not* the same as Extra-catalog availability.
- 6.5 pairs with the normalized-exact-match disambiguation rule shared across the add/revive paths; today the search box is suggestion-only and the visible shelf never sees the input.
- 6.6 builds on 6.1's add preview (the draft it corrects) and on 6.2's straggler-resolution picker (one of the two existing pickers it absorbs, alongside rematch). It should land after 6.1/6.2 exist, and it touches all three IGDB-picker surfaces at once.
