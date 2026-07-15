---
title: 'Story 7.2 — Browse the catalog (a genre-filterable destination)'
type: 'feature'
created: '2026-07-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/DESIGN.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Story 7.1 stores the whole ~490-game PS+ Extra catalog, but nothing can see it. The app also has exactly one screen and moves cross-tree intent through three `window` CustomEvents (`OPEN_DETAIL`, `SEED_SEARCH`, `SHELF_SEARCH`) — the recurring Epic 6 mount-race bug source. Adding a second destination on top of that bus would inherit the failure mode.

**Approach:** Adopt react-router (library mode) so destinations and cross-tree intent travel through the URL, delete all three CustomEvents, and add the `/catalog` destination: a header `SHELF | CATALOG` toggle, an A–Z virtualized grid over the stored snapshot, a PS-store genre filter, a catalog-scoped search, and a three-cause empty state.

## Boundaries & Constraints

**Always:**
- **The router owns navigation** (AD-25): `/` shelf, `/catalog`, `/game/:id` detail, `?q=` the search term. `navigate()` / `useSearchParams` replace the event bus. `/game/:id` resolves through a **by-id read route**, never an id lookup in the `['shelf']` list cache — otherwise 7.3's add-then-navigate races the refetch and 404s. A pending fetch is a **loading state**; only a resolved 404 is "not found".
- **`?q=` belongs to the active destination** and is **cleared on switch**. One header search box, but it searches what you are looking at. The `＋ Add "<name>"` row is **shelf-only** — you cannot conjure a game into Sony's catalog by typing it.
- **Catalog cards are not shelf cards** (AD-24): no status pill, no owned toggle, no flip, no magenta bloom. Three states keyed on the remaining action: **not tracked** → `＋ Add` + `Claim now`; **tracked, not owned** → `In library` (cyan) **+ `Claim now` still live**; **owned** → `Owned` (silver), **no actions**.
- **Catalog ordering is A–Z by title** — `localeCompare` with `sensitivity: 'base'`, the same title tiebreaker the shelf ends on. **No state tier, no ownership tier.** Do **not** reuse `compareShelf` (`core/shelf.ts`): it leads with state and ownership and would open a discovery surface on the games already discovered. Reuse its *title comparison*, not the comparator.
- **Genres are the PS-store facet vocabulary** (AD-26) read from `ps_plus_catalog_genre` — never the shelf's IGDB `genre`/`game_genre`. The two vocabularies never mix.
- Nothing external on render (AD-6): the grid reads repositories only.
- Keep the existing `psPlusExtra && !owned` display guards on the shelf side. This story does not touch ownership or derived state.

**Block If:**
- Adopting react-router forces a change to the Worker's asset serving or the `/api/*` `run_worker_first` carve-out in `wrangler.jsonc` (it should not — SPA fallback is already configured).

**Never:**
- No new `window` CustomEvent for cross-tree state — that is an architecture violation, not a judgment call (AD-25). The three existing ones are **deleted**, not left in place beside the router.
- No catalog detail page. The card's `＋ Add` opens the existing add preview; there is no read-only catalog surface in front of it.
- Do not render the whole snapshot at once — ~490 cards is a phone-hostile DOM. Page or virtualize.
- Do not add state/ownership/flag filters to the catalog. Those describe tracked games.
- Do not weaken or delete the existing shelf tests to make the router refactor pass. If a suite asserted a CustomEvent, it must now assert the routed behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Open the catalog | Snapshot populated, region set | `/catalog` renders the A–Z grid, paged/virtualized; header toggle shows CATALOG active | None |
| No region set | `psn_region` unset | `NO REGION` empty state + a button into Settings | Never a blank grid |
| Region set, never refreshed | Snapshot empty | `EMPTY CATALOG` + a "Check PS+ Extra" action that runs the refresh | Never a blank grid |
| Last refresh failed | `psplus_refresh_failed` set | The existing attention-banner posture, **plus** the stale grid if a snapshot exists — a stale catalog beats no catalog, as long as it says so | Banner |
| Filter by genre | One or more facet keys selected | Grid narrows to catalog games carrying those keys (OR within the group) | None |
| Search the catalog | `?q=hal` on `/catalog` | Grid narrows by case-insensitive substring on the title, debounced; **no `＋ Add` row** | `NO MATCH` on zero hits |
| Switch destination with a live term | `?q=hal` on `/`, click CATALOG | The term is **cleared**; the catalog opens unfiltered | None |
| Card of a tracked, unowned game | In snapshot + in library, `owned: false` | `In library` marker **and** `Claim now` | None |
| Card of an owned game | In snapshot + `owned: true` | `Owned` marker, **no actions** | None |
| Deep link to a detail | `/game/:id` pasted into a fresh tab | The detail resolves via the by-id route; a pending fetch shows loading, a resolved miss shows not-found | 404 only when resolved |
| Deep link to a stale id | `/game/<deleted>` | Resolved 404 → not-found state, not a crash | Not-found |

</intent-contract>

## Code Map

- `web/App.tsx` -- session gate; mounts `<AppShell>`. The router provider goes here (inside the authenticated branch — the Login screen is not routed).
- `web/shell/AppShell.tsx` -- the single frame: header + `<SearchBox>` + `<main><Shelf/></main>` + FAB + modals. `<main>` becomes the route outlet; the shell's chrome (banner, toast host, FAB, modals) stays shared across destinations.
- `web/shell/Header.tsx` + `header.css` -- gains the `SHELF | CATALOG` segmented control (a `tablist`: `aria-selected`, arrow-key traversal, solid active fill — never glow alone).
- `web/shelf/open-detail.ts` -- **DELETE.** `OPEN_DETAIL_EVENT` → `navigate('/game/:id')`.
- `web/shelf/SearchBox.tsx` -- dispatches `SEED_SEARCH_EVENT` + `SHELF_SEARCH_EVENT`; both **deleted**. The box reads/writes `?q=` for the **active destination** and clears it on switch. Its `＋ Add` row stays shelf-only.
- `web/shelf/Shelf.tsx` -- consumes the events today (`web/shelf/Shelf.tsx` listeners) and holds the detail-open state + the `['shelf']` list cache the detail currently reads from. Rework to routed detail.
- `web/shelf/Card.tsx`, `web/shelf/filters.ts`, `web/shelf/FilterRow.tsx` -- shelf card + filter chrome to reuse *visually*. `filters.ts:97` and `Shelf.tsx:214` keep their `psPlusExtra && !owned` guards.
- `web/shelf/Shelf.test.tsx`, `SearchBox.test.tsx`, `web/shell/SyncSummaryModal.test.tsx` -- assert the CustomEvents today; they must be rewritten to assert routed behavior, not deleted.
- `src/repositories/psplus-catalog.ts` -- 7.1's snapshot repo (`listCatalogProductIds`, snapshot reads). Add the browse query: page + genre filter + title search, **A–Z**, joined against the user's tracking so each row carries `inLibrary` / `owned` / `gameId`.
- `src/routes/psplus.ts` -- 7.1's refresh + genre-sweep chunk endpoints. Add the catalog **read** endpoints (list + facet keys).
- `src/routes/games.ts` (or wherever the shelf read routes live) -- add `GET /api/games/:id` for the routed detail if one does not already exist.
- `src/services/psplus-genres.ts` -- the sweep's persisted state (frozen key list) is the source for the filter's available genres.
- `package.json` -- add `react-router` (8.2.x, library mode; ESM-only; peer React ≥19.2.7 — met). Import from `react-router` / `react-router/dom`; `react-router-dom` does not exist in v8.
- `wrangler.jsonc` -- **already** sets `assets.not_found_handling: "single-page-application"` + `run_worker_first: ["/api/*"]`. Deep links survive reload; do not touch the carve-out.
- `playwright/` -- every UI-facing AC here ships an e2e test (standing rule). `playwright/COVERAGE.md` for the rest.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- Add `react-router` 8.2.x. -- AD-25; not yet a dependency.
- [x] `web/App.tsx` + `web/shell/AppShell.tsx` -- Mount the router inside the authenticated branch; `<main>` becomes the outlet for `/` and `/catalog`; the shell chrome (header, banner, toast, FAB, modals) stays shared. -- The shell is the frame; only the destination swaps.
- [x] `web/shell/Header.tsx` + `header.css` -- The `SHELF | CATALOG` segmented control as a proper `tablist` (arrow keys, `aria-selected`, solid active fill, ≥44px hit area). Desktop: inline beside the wordmark. Phone: full-width row under it. -- EXPERIENCE.md IA + Accessibility Floor.
- [x] `web/shelf/open-detail.ts` (**delete**) + `web/shelf/SearchBox.tsx` + `web/shelf/Shelf.tsx` -- Delete all three CustomEvents; route the detail (`navigate('/game/:id')`) and lift the search term to `?q=`, scoped per destination and cleared on switch. -- AD-25, Epic 6 retro item 2. **This is the mount-race fix, not a refactor for its own sake.**
- [x] `src/routes/games.ts` -- `GET /api/games/:id` (user-scoped) so `/game/:id` resolves by id, never from the shelf list cache. -- AD-25; without it 7.3's add-then-navigate 404s on a race.
- [x] `src/repositories/psplus-catalog.ts` + `src/routes/psplus.ts` -- The browse read: `GET /api/ps-plus-catalog?genre=&q=&cursor=` returning an A–Z page joined against tracking (`inLibrary`, `owned`, `gameId`), plus `GET /api/ps-plus-catalog/genres` returning the region's facet keys with counts. Order by title, case-insensitively. -- AD-6 (repositories only); AD-26 (facet vocabulary).
- [x] `web/catalog/` -- **new.** `CatalogGrid` (paged/virtualized, A–Z), `CatalogCard` (three states, no pill/toggle/flip), `CatalogFilters` (genre multiselect, reusing the filter-pill chrome), and the three-cause empty state (`NO REGION` / `EMPTY CATALOG` / stale-with-banner). Cards carry accessible names that include the game ("Add Crow Country to library"), and `Claim now` says it opens a new tab. -- EXPERIENCE.md + DESIGN.md.
- [x] `web/shelf/Shelf.test.tsx`, `SearchBox.test.tsx`, `web/shell/SyncSummaryModal.test.tsx` -- Rewrite the event assertions as routed-behavior assertions. **Do not delete coverage to make the refactor green.** -- The suites are the regression net for the very bug class this story closes.
- [x] `playwright/` + `playwright/COVERAGE.md` -- e2e for every UI-facing AC: switch destinations; the term clears on switch; genre filter narrows; catalog search narrows; an owned game shows `Owned` and no actions; a tracked-unowned game shows `In library` + `Claim now`; a deep-linked `/game/:id` resolves on a cold load; the three empty states. -- PLAYWRIGHT-COVERAGE RULE (2.5.4): every UI AC ships a test in the same story.

**Acceptance Criteria:**
- Given the shelf and the catalog, when I switch with the header toggle, then the URL changes, the destination swaps, and a live search term does not follow me across.
- Given ~490 catalog games, when the destination opens, then the grid is paged/virtualized (never a 490-card DOM) and ordered A–Z with no ownership or state tier.
- Given a catalog game I already track, when it renders, then it shows `In library` + `Claim now` while unowned, and `Owned` with no actions once owned — and never a status pill.
- Given the three CustomEvents are gone, when the search box or a card opens a detail, then it happens through the router, and no `window.dispatchEvent` of a cross-tree intent remains in `web/`.
- Given a `/game/:id` deep link in a cold tab, when it loads, then the detail resolves through the by-id route with a loading state while pending — and 404s only on a resolved miss.
- Given no region, an empty snapshot, or a failed refresh, when I open the catalog, then I get the matching empty state with its action — never a blank grid.

## Design Notes

**The event deletion is the point.** `OPEN_DETAIL` / `SEED_SEARCH` / `SHELF_SEARCH` are fire-and-forget `window` events: if the listener is not mounted yet, the intent is swallowed — the Epic 6 mount-race. Routing makes the intent *state*, not a message, so a late-mounting listener reads the URL instead of missing the event. Leaving even one event in place beside the router keeps the bug class alive.

**Search scoping is where the old bug would sneak back.** One header box feeding two destinations is "two live surfaces from one input" all over again — through the URL this time. The box writes only the **active** route's `?q=`, and switching destinations clears it.

**Genre facet keys are locale-independent enum keys** (`ROLE_PLAYING_GAMES`), not display strings. Render a localized label; never store or filter on the label.

## Verification

**Commands:**
- `bun run lint` -- Biome clean.
- `bun run typecheck` -- `tsc -b` clean.
- `bun run test` -- all Vitest projects green, including the rewritten shelf suites.
- `bun run test:e2e` (or the project's Playwright script — check `package.json`) -- the new catalog + routing e2e specs green.
- `grep -rn "dispatchEvent\|addEventListener('shelf:" web/` -- expected: no cross-tree intent events remain (`useModalTrap`'s local key handling is fine).

## Review Triage Log

### 2026-07-14 — Review pass 1 (Blind Hunter + Edge Case Hunter, parallel, no shared context)
- intent_gap: 0
- bad_spec: 0
- patch: 21: (high 4, medium 10, low 7)
- defer: 0
- reject: 4
- addressed_findings:
  - `[high]` `[patch]` **H1 THE STORY'S CENTRAL GUARANTEE WAS BROKEN AND ITS TEST COULD NOT SEE IT.** Typing a term and switching destinations within the 200ms debounce left the timer alive across the route change, writing the stale SHELF term into `/catalog?q=` — the "a live `?q=` does not follow you across destinations" promise failing exactly when a human switches: right after typing. Its jsdom guard rendered only `location.pathname`, so it was structurally incapable of observing a query string, and its substring assertion would have accepted `/catalog?q=blood`. Both fixed; the probe now renders `pathname + search` and was proven RED against the unfixed debounce.
  - `[high]` `[patch]` **H2** the URL to input sync ate characters: typing a trailing space then pausing let the debounce write the trimmed term back into the field and delete the space under the caret.
  - `[high]` `[patch]` **H3** Close on a detail could navigate the user OUT OF THE APP: "came from inside" was inferred from `location.key === 'default'`, but the search box writes `?q=` with `{replace:true}`, which mints a new key — so a cold deep link plus one keystroke turned Close into `navigate(-1)` back to the mail client. Openers now pass explicit navigation state.
  - `[high]` `[patch]` **H4** a pending or 404 detail rendered as loose content UNDER a live shelf grid, and the 404 said "No games match the current filters" — for a game id, with no filters involved. All three states now render as the overlay dialog with honest copy.
  - `[medium]` `[patch]` **M1** paging could duplicate and drop rows: `compareTitle` uses `sensitivity: base`, so base-equal titles (NieR/NIER) compare EQUAL — not a total order — and the SQL read had no ORDER BY. Now tiebroken on the primary key.
  - `[medium]` `[patch]` **M2** catalog search could not find non-ASCII titles: SQLite `lower()` is ASCII-only, so Pokémon / Ōkami were unfindable while the shelf's client-side search folded properly. Now matches the folded `title_normalized`.
  - `[medium]` `[patch]` **M3** offset paging tore when the snapshot moved; pages now carry the generation and restart cleanly.
  - `[medium]` `[patch]` **M4** `?genre=` was unbounded at a trust boundary (1000 params became a 1000-bind-variable statement, a 500 not a 400); an empty `?genre=` matched nothing.
  - `[medium]` `[patch]` **M5** every filtered page re-read the whole table just to take `.length` for a total.
  - `[medium]` `[patch]` **M6** facet counts included tags whose product had been pruned, so the chip promised more games than the filter rendered.
  - `[medium]` `[patch]` **M7** the in-library join keyed on a title normalizing to empty would mark an unrelated product as In library and link the wrong game.
  - `[medium]` `[patch]` **M8** every genre click unmounted the filter row and dropped keyboard focus to body.
  - `[medium]` `[patch]` **M9** a deep-linked genre with a failed genres query was a dead end: filtered grid, no chip, no clear control.
  - `[medium]` `[patch]` **M10** no not-found route — every typo silently rendered the shelf at that URL with SHELF selected.
  - `[low]` `[patch]` **L1-L7** the toggle became real Links (ctrl/middle-click work); "Find in library" focuses on every jump, not just the first (a regression from the deleted event, whose focus assertion the rewritten test had dropped); genre toggles stop pushing history; the catalog announces its result count; main id no longer claims to be the shelf on /catalog; **the e2e in-library join was seeded with a FAKE normalizer** (toLowerCase on both sides, agreeing by construction) — now seeded through the real normalizeTitle with a unit test pinning ingest-normalization to library-normalization; the deep-link test now covers the in-flight and error branches it was named for.

## Auto Run Result

Status: done

**Implemented:** react-router 8.2 (library mode), the three cross-tree CustomEvents deleted, a SHELF/CATALOG header toggle, the /catalog destination (A-Z paged grid, PS-store genre filter, catalog-scoped search, 3-state cards, 3-cause empty state), and a routed /game/:id detail backed by a new by-id read route.

**Review:** 21 findings patched (4 high), 4 rejected. Six proven RED before the fix.

**Verification:** lint clean, typecheck clean, 2196 unit tests, 98 Playwright e2e (the one red is a pre-existing Windows EPERM inside Playwright's artifact layer on the Epic 6 export test), and no cross-tree intent events remain in web/.
