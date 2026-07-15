---
title: 'Story 7.3 — Add, or claim, a game from the catalog'
type: 'feature'
created: '2026-07-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** The catalog destination (7.2) renders `＋ Add` and `Claim now` on every card, but neither does anything yet. Discovery dead-ends: you can find a game the subscription covers and have no way to put it on your shelf or claim it on PlayStation.

**Approach:** Wire both actions. `＋ Add` opens **Epic 6's existing add preview** (IGDB-enriched, with the 6.6 "Not the right game?" picker) pre-filled from the catalog row, saves with the existing not-owned default, and navigates to the new game's detail. `Claim now` opens the region's PS Store product page in a new tab. No new add path, no new preview surface.

## Boundaries & Constraints

**Always:**
- **Reuse Epic 6's add preview.** It is already the confirm-before-committing surface (IGDB enrichment + the match picker). There is **no catalog detail page** and no second preview.
- **The add writes the existing not-owned default** — `{owned: false, play_status: 'Not started', wishlisted_on: today}` (`services/games.ts` `newTracking`). Browsing is not claiming. Because the game's PS+ flag is on, it derives as **Wishlisted + Playable-now** — the pre-purchase signal ("I want it; the subscription covers it"), not a contradiction.
- **There is NO `ps_plus` ownership type.** `ownership_type` is `physical|digital` (the *format*); the acquisition *source* is `owned_via: purchase|membership`. A PS+ claim **counts as owned** with `owned_via: 'membership'` — but **only when a sync observes the real entitlement** (FR-9 amended; Story 6.4 owns that path, including un-claim on cancel). The app **cannot see the PS Store tab** and must never infer that a claim succeeded.
- **PSN external-id namespace (AD-20):** `source='PSN'` external ids are `np_title_id` values only. A store `product_id` is a **different source**, `'PSN_PRODUCT'` — never written into the `'PSN'` namespace, or an add-from-catalog of an already-synced game misses on link, matches on title, and (per AD-18's clash rule) creates a mandatory duplicate. `EXTERNAL_LINK_SOURCES` in `src/core/types.ts` currently has only `['PSN','IGDB']` and must gain `'PSN_PRODUCT'`.
- **Genres on the new game come from IGDB enrichment** (AD-26) — never from the catalog's PS facet keys. The two vocabularies never mix.
- **Dedupe (FR-42):** a catalog game already tracked shows `In library` / `Owned` and offers **no Add**. There is no second add.
- **After a successful add, navigate to `/game/:id`** — resolved by the by-id route (AD-25), never the shelf list cache, or the add races the refetch and 404s.
- Card state stays keyed on the remaining action: **not tracked** → `＋ Add` + `Claim now`; **tracked, not owned** → `In library` + **`Claim now` still live** (on the shelf, but not yet claimed on PlayStation); **owned** → `Owned`, no actions.

**Block If:**
- Reusing the add preview would require it to know about catalogs (i.e. it cannot be pre-filled from an arbitrary title/cover/store-url without a catalog-shaped dependency leaking into it).

**Never:**
- **Do not fire PlayStation's authenticated add-to-library mutation.** Investigated and declined in the epic: an undocumented write against the user's real PSN account, with an irreversible side effect on a mistaken tap. `Claim now` is a deep link the user acts on themselves.
- Do not set `owned`, `owned_via`, or `bought_on` because a user clicked `Claim now`. The app cannot observe the outcome.
- Do not auto-add catalog games. Availability is not ownership.
- Do not weaken the discard tombstone (`game_tracking.discarded`): re-adding a discarded game revives that row (`services/games.ts addGame`), it does not duplicate it.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Add an untracked catalog game | Card `＋ Add` | Epic 6's add preview opens pre-filled (title, cover, store URL from the catalog row) with IGDB enrichment; save writes the not-owned default + an `EXTERNAL_LINK('PSN_PRODUCT', product_id)`; app navigates to `/game/:id` | Add failure surfaces; nothing half-written |
| The game is already tracked | Card renders | `In library` (unowned, `Claim now` live) or `Owned` (no actions). **No Add.** | — |
| The game is discarded (tombstoned) | Tracked row with `discarded: true` | Adding **revives** the existing row — never a duplicate | — |
| IGDB is unreachable | Add preview open | The existing name-only fallback (straggler) path applies — the catalog game still lands on the shelf | Straggler, per FR-41 |
| Claim now | Card action | Opens `https://store.playstation.com/{region}/product/{productId}` in a **new tab** (`rel="noopener noreferrer"`); the app writes **nothing** | — |
| Claim now, then the user actually claims | Next library sync | Story 6.4's path sets `owned: true, owned_via: 'membership'` from the **observed entitlement** — the card flips to `Owned` on its own | — |
| An already-synced game added from the catalog | Its PSN `np_title_id` link exists; catalog carries a `product_id` | Matched, **not duplicated** — the product id lives in its own `PSN_PRODUCT` namespace and the title/link dedupe finds the existing game | — |
| Add while the catalog page is stale | Product pruned since render | Add fails cleanly with a "no longer in the catalog" message, or proceeds on the title alone — **never** writes a dangling catalog reference | Surfaced |

</intent-contract>

## Code Map

- `web/catalog/CatalogCard.tsx` -- 7.2's 3-state card; `＋ Add` / `Claim now` are rendered but inert. Wire them.
- `web/catalog/Catalog.tsx` -- the destination; owns the add-dialog mounting + the post-add navigate.
- `web/shelf/AddGameDialog.tsx` -- **Epic 6's add preview** (IGDB enrichment + the 6.6 `IgdbMatchPicker`). Reuse; it already navigates on duplicate (7.2). It must accept a pre-fill (title, cover, store URL, product id) without gaining catalog knowledge.
- `src/services/games.ts` -- `addGame` (the `newTracking` not-owned default; discard revival). The add path to extend with the `PSN_PRODUCT` link.
- `src/core/types.ts` -- `EXTERNAL_LINK_SOURCES = ['PSN','IGDB']` → add `'PSN_PRODUCT'` (AD-20). Check `src/schema/catalog.ts` re-exports.
- `src/repositories/games.ts` -- `addExternalLink`, `findGameByExternalLink`, `findGamesByNormalizedTitle` (the dedupe path).
- `src/repositories/psplus-catalog.ts` -- the catalog row (`store_url`, `product_id`, `cover_url`) that pre-fills the preview.
- `src/routes/games.ts` -- the add endpoint.
- `playwright/e2e/epic7-catalog.spec.ts` -- 7.2's specs; add the add/claim flows here.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/types.ts` (+ schema re-export) -- Add `'PSN_PRODUCT'` to `EXTERNAL_LINK_SOURCES`. -- AD-20: a store product id is not an `np_title_id`; mixing them forces a duplicate.
- [x] `src/services/games.ts` + `src/routes/games.ts` -- Accept an optional catalog origin on add (`productId`, `storeUrl`, `coverUrl`): write the `PSN_PRODUCT` external link, keep the existing not-owned default, keep discard-revival and the FR-42 dedupe. -- Reuse the one add path; do not fork it.
- [x] `web/shelf/AddGameDialog.tsx` -- Accept an optional pre-fill so the catalog can open it with title/cover/store-url/product-id already populated, without the dialog learning what a catalog is. -- The Block If: no catalog-shaped dependency inside the shared preview.
- [x] `web/catalog/CatalogCard.tsx` + `web/catalog/Catalog.tsx` -- Wire `＋ Add` (→ preview → save → `navigate('/game/:id')`) and `Claim now` (→ the region's store URL in a new tab, `rel="noopener noreferrer"`, accessible name says it opens a new tab). The app writes **nothing** on claim. -- EXPERIENCE.md.
- [x] `test/integration/` -- The dedupe/namespace hazards: adding a catalog game whose PSN `np_title_id` is already linked **does not duplicate**; the `product_id` is stored under `PSN_PRODUCT`, never `PSN`; a **discarded** game is revived, not duplicated; the add writes `owned:false` + `wishlisted_on` and **never** `owned_via`. -- HAZARD-TEST RULE.
- [x] `playwright/e2e/epic7-catalog.spec.ts` -- e2e: add from the catalog → preview → save → lands on `/game/:id`, and the card flips to `In library` with `Claim now` still offered; `Claim now` opens the store URL in a new tab (assert the target, do not follow it); an owned game offers neither. -- PLAYWRIGHT-COVERAGE RULE.
- [x] `playwright/COVERAGE.md` -- Rows for anything not e2e-able (the real PSN claim outcome is not observable — say so honestly).

**Acceptance Criteria:**
- Given an untracked catalog game, when I add it, then Epic 6's preview opens pre-filled, saving lands it on my shelf as **not owned** (wishlisted, and Playable-now because the PS+ flag is on), and the app navigates to its editable detail.
- Given a catalog game already in my library, when I look at its card, then it offers no Add — and `Claim now` remains while it is unowned, disappearing only once it is owned.
- Given I click `Claim now`, when the store opens, then the app has written **nothing** — ownership flips only when a later sync observes the real entitlement.
- Given a catalog game whose PSN title is already synced, when I add it from the catalog, then it matches the existing game and does not duplicate it.
- Given a game I previously discarded, when I add it from the catalog, then its tombstoned row is revived rather than duplicated.

## Design Notes

**The two namespaces exist to prevent a mandatory duplicate.** `sync-reconcile` writes `EXTERNAL_LINK('PSN', np_title_id)`. The catalog knows a *store* `product_id`. Both are "PSN ids" in English and neither joins to the other, and the unique index makes them globally distinct. If the catalog add wrote its `product_id` as `source: 'PSN'`, an already-synced game would miss on link, match on normalized title, and AD-18's clash rule ("a normalized-title clash with a *different* external id is two games") would then *require* creating a duplicate. Hence `PSN_PRODUCT`.

**Claim is a deep link, deliberately.** Firing PlayStation's authenticated add-to-library mutation was investigated and declined: an undocumented write against a real account with an irreversible side effect on a mistaken tap. The user claims it themselves; the next sync tells us the truth.

## Verification

**Commands:**
- `bun run lint` -- Biome clean.
- `bun run typecheck` -- `tsc -b` clean.
- `bun run test` -- green, including the new dedupe/namespace hazard tests.
- `bun run test:e2e` -- green (the Epic 6 export spec fails with a pre-existing Windows `EPERM` in Playwright's artifact layer — unrelated).

## Review Triage Log

### 2026-07-14 - Review pass 1 (Blind Hunter + Edge Case Hunter, parallel, no shared context)
- intent_gap: 0
- bad_spec: 0
- patch: 14: (high 4, medium 5, low 5)
- defer: 0
- reject: 5
- addressed_findings:
  - [high] [patch] H1 THE "I OWN THIS GAME" TOGGLE WAS LIVE IN THE CATALOG-OPENED DIALOG. Ticking it wrote owned:true, owned_via 'purchase', bought_on today for a PS+ Extra title - contradicting this story's binding constraint and fabricating a purchase and a purchase date for a game the subscription lends you. Now hidden when opened from a product AND refused server-side (400). Both layers tested, both proven red first.
  - [high] [patch] H2 A PRUNED CATALOG ROW DISABLED THE PSN_PRODUCT LOOKUP - the exact duplicate the namespace exists to prevent. The lookup was gated on the catalog row still existing, so after a prune a re-add with an IGDB-diverged title missed on link AND title, inserted a second game, and the anchor then silently no-op'd, leaving the duplicate with no link and no store URL. Identity now resolves from the product id unconditionally; only the facts need the catalog row.
  - [high] [patch] H3 THE In-library MARKER IGNORED THE LINK IT JUST CREATED. The catalog joined the library by normalized title - but the add dialog re-seeds the title from the IGDB candidate, so a successful add routinely left the card showing +Add forever, every re-add 409ing and bouncing to the detail. The PSN_PRODUCT link was write-only. Now link first, title second. e2e COULD NOT SEE THIS: with no IGDB credentials the preview takes its name-only path and titles match by construction - the suite pinned the degraded path and called it the happy path.
  - [high] [patch] H4 THE ADD THREW AWAY np_title_id. The catalog row carries it; the add stored only the product id, so a later library sync - matching by title - would create a SECOND game row for the same game: the user would own the duplicate and wishlist the original. The npTitleId is now anchored in its own correct namespace (PSN), verified by running the real sync planner over a PSN entry whose title differs.
  - [medium] [patch] M1 the anchor treated "this product already belongs to a DIFFERENT game" as success, silently splitting identity with no signal. Now writes only when unlinked and warns on a clash. The original test could not observe this (write-suppression was already true in the buggy code), so it was strengthened first, then proven red.
  - [medium] [patch] M2 store_url was written on INSERT only, so a game that already existed (seed, name-only add, a sync with no URL) got the link but no store URL - leaving Claim now dead for exactly those games. Now backfilled (NULL-only) on every resolved branch.
  - [medium] [patch] M3 a concurrent double-submit inserted two game rows and threw a UNIQUE violation on the external link - a 500 leaving an orphan duplicate. The anchor is idempotent now and the loser converges on the winner.
  - [medium] [patch] M4/M5 the e2e happy path was the degraded path; the real guarantee moved to an integration test that can see it, and H2's missing pruned-link regression test was added.
  - [low] [patch] L1-L5 product-id shape validation at the trust boundary; Claim now refuses any URL that is not an https store.playstation.com link; the COVERAGE row that asserted an untested invariant corrected; four anchor round-trips collapsed to one; a known-dead cover is no longer pre-filled onto the new game.

## Auto Run Result

Status: done

Implemented: Add reuses Epic 6's preview pre-filled from the catalog row and saves with the not-owned default (wishlisted + Playable-now, never owned), anchoring both the store PSN_PRODUCT id and the catalog np_title_id in their own namespaces; Claim now deep-links the regional PS Store in a new tab and writes nothing. Ownership flips only when a sync observes the real entitlement (Story 6.4).

Review: 14 patched (4 high), 5 rejected. Every high proven RED first.

Verification: lint clean, typecheck clean, 2210 unit tests, 100 Playwright e2e (the 1 red is the pre-existing Windows EPERM in Playwright's artifact layer on the Epic 6 export spec).
