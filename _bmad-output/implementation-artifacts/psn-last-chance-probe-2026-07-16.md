# Probe: PS+ "Last Chance to Play" category (Story 10.4) — 2026-07-16

**Question:** does the public `categoryGridRetrieve` endpoint expose a "Last Chance to Play" category for the configured region (`it-it`), and what is its id?

**Result: GATE FAIL — the category id is not discoverable on the anonymous web surface, in any region probed.** The grid ENDPOINT itself answers anonymously for every category id we threw at it (see below), so the fetch mechanics 10.4 assumes are sound — what's missing is the id.

## What was probed (all anonymous, no credential)

1. **Store hub pages, SSR + client-rendered DOM** (`it-it` and `en-us`/`en-gb`): `/pages/subscriptions`, `/pages/plus`, `/pages/browse`, `/pages/deals`, `/pages/latest`, the PS+ catalog category page (`3a7006fe-…`), full `__NEXT_DATA__` keyword scan (`chance`, `occasione`, `leaving`) and rendered-text scan after scroll-through. The subscriptions hub, signed out, carries ONLY partner strands (Ubisoft+ Classics, GTA+, EA Play) — no PS+ Game Catalog collections at all. No hit.
2. **Every categoryId/title strand found** on those pages, resolved and grid-probed live: `defeaa4c…` = "PS5 Pro optimized" (55), `4dfd67ab…` = "Free To Play" (237), `038b4df3…` = "PS+ monthly games", plus five others — none is last-chance.
3. **Known category enumerations in public API wrappers** (mrt1m/playstation-store-api — the repo the codebase's catalog id was pinned from — whagency/go-playstation-store, Lucky-ESA/ioBroker.playstation): PS4/PS5/PS_PLUS/SALES/VR/FREE/NEW/OFFERS/CONCEPTS. No last-chance entry.
4. **Web search, PlayStation Blog (July 2026 catalog post, 2026-07-15), psprices/psdeals collections**: the blog post has no "Last chance" section and no store category link; psprices mirrors no leaving-soon collection; no uuid circulates anywhere indexable. A PlayStation LifeStyle piece (2025-04-23) documents the store section going MISSING from the web store.
5. **Strand-fetch ops** (`metGetCategoryStrands`, `metGetCategoryGrids`, hashes from public wrappers) answer anonymously but FETCH by id — they cannot enumerate a hub's children. The op that could (console/PS App hub layout) rides the credentialed mobile API — off-limits (EXTERNAL-RISK posture, Epic 11).

## Conclusion

"Last Chance to Play" today appears to be surfaced only in the console/PS App UI (and possibly only to signed-in PS+ members on web). The epic's premise — "same public endpoint, different category id" — is HALF confirmed: the endpoint would serve the grid anonymously if we had the id, but the id itself is not anonymously discoverable.

## Decision needed (Luca)

- **(a) Supply the category id manually** — open the "Last Chance to Play" section on the console or PS App, use Share/copy-link to get the `store.playstation.com/…/category/<uuid>` URL, and hand the uuid over. Then `bun scripts/probe-psn-last-chance.ts --id <uuid>` verifies the grid + captures the fixture, and the story unblocks with the EXTERNAL-RISK posture fully unchanged (the recurring fetch stays anonymous). One open question to verify then: whether the id is region-independent like the catalog id, and whether it rots monthly (re-probe after the next refresh window before trusting it in the cron).
- **(b) Drop 10.4 / accept the shipped 10.2 stamp** as the only departure signal.
- **(c) Any signed-in surface is NOT proposed** — it would put account identity back on the wire (Epic 11).

`scripts/probe-psn-last-chance.ts` (committed with this artifact) re-runs the whole discovery + verification; `--id <uuid>` skips discovery and verifies a supplied id.
