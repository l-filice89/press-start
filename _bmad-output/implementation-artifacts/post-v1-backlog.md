# Post-v1.0.0 Backlog

Triaged bugs + improvements spotted after the v1.0.0 launch (2026-07-13). All
four opening items are one theme — **IGDB match quality & correction**. Not an
epic: one quick fix + one small story + a data cleanup. Bugs route straight to
`bmad-quick-dev`; the correction feature gets a mini-spec.

## Ledger

| ID | Type | Item | Root cause (grounded) | Route | Effort |
| --- | --- | --- | --- | --- | --- |
| PV-1 | bug | Wrong cover from a same-named entry; e.g. "Spider-Man 2" gets the 2004 movie-tie-in game's cover | NOT a category issue — the 2004 tie-in is a legit `main_game` (category 0). `pickIgdbMatch` takes the exact-normalized name match, and "Spider-Man 2" *is* the tie-in's exact name, so it wins over "Marvel's Spider-Man 2" | **PV-4 (rematch)** is the fix; optionally improve relevance tie-break (prefer newer/more-popular on exact-name ties) | M |
| PV-2 | bug | Limit results to actual games (drop DLC/bundle/season noise) | The `search` query (`igdb.ts:185`) has **no `category` filter** — DLC/bundle/season/pack/update/mod entries all rank in. Add `where category = (...)` keeping main_game/remake/remaster/expanded/port. NB: does NOT fix PV-1 (tie-ins are main games) | **quick-dev** (keystone for PV-3) | S |
| PV-3 | bug | Relevant game buried / not shown (Persona 3 Reload lost under many "Persona" entries) | Two caps: the query fetches `limit 50` (`igdb.ts:185`, fine) but the UI candidate list is capped at `limit = 10` (`searchCandidates`, `igdb.ts:266`). Category filter (PV-2) removes most of the noise; residual → raise the cap or add "see more" | quick-dev (bundle w/ PV-2), "see more" only if still needed | S |
| PV-4 | feature | "Rematch" an already-added game from the detail page (pick the right candidate) | **Reuses existing machinery**: `searchCandidates` (picker) + `anchorIgdb`/`resolveStraggler` (link + cover/genre overwrite). New bit = *replace* an existing IGDB link (unlink old → anchor new → overwrite enrichment) + a detail-panel entry point | **one story + mini-spec** (UX + endpoint) | M |
| PV-5 | data | Fix currently-wrong covers already in the library | Symptom of PV-1/PV-4. After PV-2 lands, re-run enrichment for the affected rows; anything ambiguous is corrected via PV-4 rematch | one-off cleanup after PV-2 | S |

## Suggested order

1. **PV-2 (+PV-3)** — the category filter is a small, contained, testable fix
   that de-noises results so buried games (Persona 3 Reload) surface. Do first.
2. **PV-4** — the general safety net for wrong same-name matches (Spider-Man 2
   and friends). Reuses the straggler-resolution seam; also resolves PV-1.
   Story-sized, needs a mini-spec (detail-panel UX + relink endpoint).
3. **PV-5** — data cleanup once PV-2 + PV-4 are live.

Epic only if the list grows a coherent larger theme; for now this is fixes + one story.
