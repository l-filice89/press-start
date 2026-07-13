# Post-v1.0.0 Backlog

Triaged bugs + improvements spotted after the v1.0.0 launch (2026-07-13). One
theme — **IGDB match quality & correction**. Not an epic: quick fixes + one
story + a data cleanup. Closed out except PV-6.

Everything else still to be done lives in `../roadmap.md`.

## Ledger

| ID | Status | Type | Item | Root cause (grounded) | Route | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| PV-1 | closed by PV-4 | bug | Wrong cover from a same-named entry; e.g. "Spider-Man 2" gets the 2004 movie-tie-in game's cover | NOT a category issue — the 2004 tie-in is a legit `main_game` (category 0). `pickIgdbMatch` takes the exact-normalized name match, and "Spider-Man 2" *is* the tie-in's exact name, so it wins over "Marvel's Spider-Man 2" | **PV-4 (rematch)** is the fix; optionally improve relevance tie-break (prefer newer/more-popular on exact-name ties) | M |
| PV-2 | shipped (`spec-pv-2-igdb-category-filter.md`) | bug | Limit results to actual games (drop DLC/bundle/season noise) | The `search` query (`igdb.ts:185`) has **no `category` filter** — DLC/bundle/season/pack/update/mod entries all rank in. Add `where category = (...)` keeping main_game/remake/remaster/expanded/port. NB: does NOT fix PV-1 (tie-ins are main games) | **quick-dev** (keystone for PV-3) | S |
| PV-3 | closed — PV-2's category filter surfaced the buried games; UI cap left at 10 | bug | Relevant game buried / not shown (Persona 3 Reload lost under many "Persona" entries) | Two caps: the query fetches `limit 50` (`igdb.ts:185`, fine) but the UI candidate list is capped at `limit = 10` (`searchCandidates`, `igdb.ts:266`). Category filter (PV-2) removes most of the noise; residual → raise the cap or add "see more" | quick-dev (bundle w/ PV-2), "see more" only if still needed | S |
| PV-4 | shipped (`spec-pv-4-rematch-game.md`) | feature | "Rematch" an already-added game from the detail page (pick the right candidate) | **Reuses existing machinery**: `searchCandidates` (picker) + `anchorIgdb`/`resolveStraggler` (link + cover/genre overwrite). New bit = *replace* an existing IGDB link (unlink old → anchor new → overwrite enrichment) + a detail-panel entry point | **one story + mini-spec** (UX + endpoint) | M |
| PV-5 | done — corrected manually via PV-4 rematch, no cleanup script run | data | Fix currently-wrong covers already in the library | Symptom of PV-1/PV-4. After PV-2 lands, re-run enrichment for the affected rows; anything ambiguous is corrected via PV-4 rematch | one-off cleanup after PV-2 | S |
| PV-6 | open — **Story 6.6** in `epics.md` (ACs written 2026-07-13) | feature | "Not the right game?" picker in the add-game modal — catch a wrong auto-match *before* the row exists, not after | `AddGameDialog` shows whatever `searchCandidate` picked (exact-normalized name, else IGDB's top hit — `igdb.ts`), and the user's only correction path today is save-then-rematch. Same PV-1 failure mode, one step earlier | **one story** — see scope below | M |

## PV-6 scope

Not the same logic as PV-4 rematch: `rematchGame` swaps the IGDB link on an
*existing* row. In the add modal no row exists — picking a candidate only
replaces local draft state. **No new endpoint, no server change.** It reuses the
existing search seam (`searchIgdb` → `GET /games/search` → `searchGamesForResolve`).

This is the *third* IGDB picker, which is the trigger the `RematchDialog`
comment named. Scope is **every picker, not just the new one** — `searchIgdb`
has exactly two consumers today (`RematchDialog.tsx`, `StragglersDialog.tsx`),
and both migrate, so no bespoke picker survives PV-6:

- Extract a shared `<IgdbMatchPicker>` from `RematchDialog`.
- Migrate **`StragglersDialog`'s `ResolveView`** onto it (it and `RematchDialog`
  are deliberate near-duplicates today; leaving stragglers behind means three
  copies again). Its `resolveStraggler` mutation and straggler-kind handling
  stay page-side — only the candidate list/search UI is shared.
- Mount the picker in `AddGameDialog` behind a "Not the right game?" affordance.
- Both dialogs have tests (`RematchDialog.test.tsx`, `StragglersDialog.test.tsx`)
  that drive the picker through its "Use this match" button — they should keep
  passing against the shared component, which is the migration's safety net.

Decisions to carry into the story:

- Picking a new candidate **overwrites the whole draft** and resets the `seeded`
  ref — the user's prior edits were edits to the wrong game.
- The picker owns Escape while stacked (same trap-stacking dance DetailPanel
  already does for rematch), or Escape closes the whole add modal.
- Hide the affordance when preview `available` is false — IGDB down/unset means
  `searchGamesForResolve` returns `[]` and the picker would always be empty.

## What's left

**PV-6** only. The episodic-title regression PV-2's category whitelist
introduced (Hitman seasons, Life is Strange enrich to null) outlived this file —
it's tracked in `deferred-work.md` and carried on the roadmap.
