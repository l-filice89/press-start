---
title: 'The read-only shelf'
type: 'feature'
created: '2026-07-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '765e4ac0a9720300dd22c0caef114387e808759f'
final_revision: '25a383ac4002bb20303e3bd0d5182e7c046e7500'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The database is seeded (1.6), the domain core, repositories, auth, and design-system shell all exist (1.1–1.5), but there is still no way to *see* the library — the app shell mounts a static `INSERT GAMES` placeholder where the shelf belongs. This story delivers the read-only face of the product: Luca opens the app and sees the whole library as a cover-forward, backlog-first grid he can scroll and search.

**Approach:** Add two user-scoped read endpoints behind the existing Hono `/api/*` + `requireAuth` seam — a **filtered-shelf** query (default backlog view) and a **dedicated whole-library search** query — each backed by a `services/shelf.ts` orchestration that reads through the `repositories/` seam and bakes a fully-derived card DTO (effective state + derived flags computed in `core/`, genres grouped, Zod-validated). The React SPA renders that DTO as a responsive, keyboard-navigable, progressively-rendered card grid with cover-shaped skeletons and the arcade empty state, plus a live search combobox in the header. Read-only: no flip, no status edits, no writes (Epic 2).

## Boundaries & Constraints

**Always:**
- **Ordering derives from the single `core/` effective-state function (AD-7).** A new pure `core/shelf.ts` consumes `computeEffectiveState` to filter the default view and order it Playing→Paused→Up next→Not started, alphabetical within each group. No consumer re-derives state; there is **never a raw SQL `ORDER BY play_status`** — the sorted set is materialized in the Worker (`services/`) at v1's ~344-game scale, not keyset-paged (AD-7, FR-17/18/19).
- **Default shelf hides non-live states (FR-4/17).** Only games whose effective state is one of the four live play statuses show; `Story completed` / `Platinum achieved` / `Dropped` are hidden from the default view. The library = games with a `game_tracking` row for the signed-in user.
- **Search is a dedicated whole-library query (FR-19, UX-DR16), separate from the filtered-shelf query** — not a client filter over the rendered shelf. It matches every game by title (case-insensitive substring on the display title), **ignoring active filters and hidden states**, and returns the same card DTO.
- **Two seams honored (AD-4/AD-7).** All D1 access goes through `repositories/`; all state derivation goes through `core/`. `services/shelf.ts` is the only new place that touches repositories + core together. Routes stay thin: `requireAuth` + Zod-validate the response (AR-26), scoped to `c.get('userId')` (AD-13).
- **Nothing external on a read/render path (NFR-3, AR-6).** Covers and store links come only from persisted `game.cover_url` / `game.store_url`; the shelf and search paths issue no third-party fetch. A game with no cover renders a graceful cover fallback (no network).
- **Card contract (read-only, UX Card).** Each card shows: cover art (3:4), name (Orbitron, single-line ellipsis, never wraps), effective-state pill, owned indicator, and a top-left flag cluster — PS+ Extra badge (◈, only when `psPlusExtra && !owned`), release-state flag (TBA when no release date / SOON when a future date, hidden once released), and a milestone badge (🏆 platinum else ✓ completed, persisting regardless of play status). Genres render **desktop-only** (hidden on phone via CSS). The `Playing` card carries the reserved magenta bloom.
- **Accessibility floor (UX-DR19/20/25).** The grid is a focusable roving-tabindex grid traversable by arrow keys in reading order; every card keeps the always-on `:focus-visible` outline (never glow alone). The search field has combobox semantics with a listbox popup and a global focus shortcut. Skeletons are `aria-busy`; announcements use the existing live region. Icon-only flag glyphs carry accessible text (no color/emoji-alone signaling).
- **First-load & empty states (UX-DR12/17/18).** While the shelf query is pending, cover-shaped skeletons show (reuse `SkeletonGrid`). An empty library shows the `INSERT GAMES` empty state; a search with no matches shows `NO MATCH`. No dead CTAs — Sync (Epic 4) / Add (Epic 6) actions are not wired here, so their buttons are omitted.
- **PWA / responsive (UX Responsive deltas).** One responsive grid: phone 2-up lean cards with genres hidden and header search bottom-pinned; desktop auto-fill dense grid (~150px min) with header-left search. Uses existing tokens/shell — no new design primitives invented.

**Block If:** (none — resolved judgment calls: (1) **data fetching uses TanStack Query** (`@tanstack/react-query`, the architecture-pinned client) added as a runtime dep, with a single `QueryClientProvider` mounted in `web/main.tsx`; verified installable. (2) **The SPA does not import from `src/`** — `web/` (tsconfig.app, DOM-lib, `include: ["web"]`) and `src/` (tsconfig.worker) are separate TS programs, so the card DTO is fully baked server-side and the client re-validates the response with its own Zod schema; the small shape duplication is deliberate, both sides Zod-validate the boundary. (3) **Search selection is a no-op in Epic 1** — the detail view is Epic 2, so the combobox lists matches and is keyboard-navigable but selecting does not navigate. (4) **The header readout stays the `—` placeholder** — the `PS+ CATALOG AS OF …` date is Epic 5; not fabricated here.)

**Never:**
- Don't build flip-to-detail, status changes, milestone logging, lifecycle-date edits, or any write path (Epic 2) — this shelf is strictly read-only.
- Don't fetch IGDB/PS/any third party on a render/read path; don't re-hit external APIs for covers (NFR-3).
- Don't sort with a raw `ORDER BY play_status` or re-implement effective/derived state outside `core/`; don't compute state in the SQL layer or the React component.
- Don't import `drizzle-orm`/repositories into `core/` (purity guard); don't import from `src/` into `web/`; don't put D1 access outside `repositories/`.
- Don't fabricate the `PS+ CATALOG AS OF` date or a covers/store URL; don't add offline caching beyond the existing PWA registration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default shelf ordering | User tracks games across all four live statuses + a Completed + a Dropped | Only live games returned, ordered Playing→Paused→Up next→Not started, alphabetical within each group; Completed & Dropped absent | No error |
| Effective-state via milestone | Tracking `play_status=null`, `completed_on` set | Effective state `Story completed` → hidden from default shelf | No error |
| Playing + prior completion | Tracking `play_status='Playing'`, `completed_on` set | Shown on shelf (effective `Playing`); card still shows ✓ milestone badge | No error |
| Search whole-library | Query `q` matching a Dropped/Completed/wishlist title | Match returned (ignores hidden states & filters); same DTO shape | No error |
| Search case-insensitive substring | `q="hades"` vs title `HADES™` display / `q=""` | Substring match on display title, case-insensitive; empty/whitespace `q` → empty result set | No error |
| User scoping | Two users each tracking the same game with different status | Each user's shelf/search returns only their own tracking-derived DTO | No error |
| Missing cover | Game with `cover_url=null` | Card renders a non-network cover fallback; no third-party fetch | No error |
| Owned vs wishlist flags | Owned game vs `owned=false` game with `ps_plus_extra=true` | Owned → owned indicator; wishlist+in-catalog → ◈ PS+ Extra badge | No error |
| Release-state flag | `release_date=null` vs a future date vs a past date | TBA / SOON / (no flag) respectively | No error |
| Empty library | User has zero tracking rows | Shelf endpoint returns `[]`; SPA shows `INSERT GAMES` empty state | No error |
| Progressive render | Library larger than one page | First page of cards renders; a sentinel loads further slices; whole sorted set is materialized (not SQL-paged) | No error |
| Keyboard grid | Focus a card, press Arrow/Home/End | Roving focus moves in reading order; focused card is the sole tab stop | No error |
| Unauthenticated read | `GET /api/shelf` with no session | `401 unauthorized` (via `requireAuth`), no data leaked | 401 JSON |

</intent-contract>

## Code Map

- `src/core/shelf.ts` -- NEW pure module: `SHELF_STATE_ORDER` (the four live states), `isDefaultShelfVisible(state)`, `compareShelf(a,b)`/`orderShelf(items)` consuming `computeEffectiveState` — the single ordering/visibility source (AD-7). I/O-free.
- `src/core/shelf.test.ts` -- NEW unit tests (node project): ordering, alpha tiebreak, hidden-state filter, milestone-vs-live.
- `src/core/index.ts` -- EDIT: re-export `./shelf`.
- `src/repositories/games.ts` -- EDIT: add `listLibraryForUser(db, userId)` — user-scoped `game_tracking ⋈ game` returning shared facts + tracking columns (no `ORDER BY play_status`). Export via barrel (already `export *`).
- `src/repositories/genres.ts` -- EDIT: add `listGenresForGames(db, gameIds)` — one `inArray` query returning `{ gameId, name }[]` for bulk grouping (avoids N+1).
- `src/services/shelf.ts` -- NEW: `loadLibrary(db,userId)` (read + group genres + bake DTO via `computeEffectiveState`/`computeDerivedStates`), `getShelf(db,userId)` (filter visible + `orderShelf`), `searchLibrary(db,userId,q)` (whole-library title match, alpha). Returns the `ShelfGame` DTO.
- `src/services/index.ts` -- EDIT: export `./shelf`.
- `src/routes/shelf.ts` -- NEW: `shelfRoute` with `GET /shelf` and `GET /shelf/search?q=`, both `requireAuth`, Zod response schema `shelfGameSchema`/`shelfResponseSchema`; exports the `ShelfGame` type. Mirrors `routes/health.ts`/`auth.ts` style.
- `src/routes/index.ts` -- EDIT: mount `shelfRoute`.
- `test/integration/shelf.test.ts` -- NEW (workers pool): seed user+games+tracking+genres, assert `getShelf` ordering/hidden-state/scoping, `searchLibrary` whole-library match, and the route returns 401 unauthenticated.
- `web/shelf/Shelf.tsx` -- NEW: fetches `/api/shelf` (TanStack Query); pending→`SkeletonGrid`, empty→`EmptyState insert-games`, error→inline message; renders the roving-tabindex card grid with progressive rendering.
- `web/shelf/Card.tsx` -- NEW: pure presentational card (cover+fallback, title, `StatePill`, flag cluster, owned indicator, genres desktop-only, Playing bloom).
- `web/shelf/StatePill.tsx` -- NEW: maps `effectiveState` → label + state class (translucent tint + light/dark ink; never white-on-neon).
- `web/shelf/SearchBox.tsx` -- NEW: combobox querying `/api/shelf/search` (debounced); listbox of matches, keyboard nav, `NO MATCH` on empty result; global focus shortcut ("/").
- `web/shelf/useProgressiveList.ts` -- NEW: pure hook `(items,pageSize)→{visible,hasMore,showMore}`; the shelf wires an `IntersectionObserver` sentinel to `showMore` (falls back to rendering all when `IntersectionObserver` is absent, e.g. jsdom).
- `web/shelf/api.ts` -- NEW: client Zod schema + `ShelfGame` type + fetch helpers (`fetchShelf`, `searchShelf`) with `credentials: 'same-origin'`.
- `web/shelf/{shelf,card,state-pill,search-box}.css` -- NEW: grid + card + pill + combobox styles, tokens-only, responsive (phone 2-up / desktop auto-fill), reduced-motion aware.
- `web/shelf/Card.test.tsx`, `web/shelf/Shelf.test.tsx`, `web/shelf/SearchBox.test.tsx`, `web/shelf/useProgressiveList.test.tsx` -- NEW (jsdom `web` project): card flags/pill/genres/glow; shelf skeleton/empty/grid + keyboard roving (fetch mocked); search combobox typing→matches; progressive `showMore`.
- `web/shell/AppShell.tsx` -- EDIT: mount `<Shelf/>` in `<main>` (replacing the `EmptyState` placeholder); render `<SearchBox/>` into the header's search slot.
- `web/shell/Header.tsx` -- EDIT: accept a `search` slot node (or render `SearchBox`) replacing the disabled placeholder input; readout stays `—`.
- `web/main.tsx` -- EDIT: wrap `<App/>` in a `QueryClientProvider`.
- `web/components/Skeleton.tsx` -- reference: reuse `SkeletonGrid` for the pending state.
- `package.json` -- EDIT: add `@tanstack/react-query` dependency.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/shelf.ts` (+ `shelf.test.ts`, `core/index.ts`) -- pure ordering/visibility over `computeEffectiveState` -- the single ordering source (AD-7), no raw `ORDER BY`
- [x] `src/repositories/games.ts` -- `listLibraryForUser` user-scoped `tracking ⋈ game` (no status ordering) -- library read through the seam (AD-4/AD-13)
- [x] `src/repositories/genres.ts` -- `listGenresForGames` bulk `inArray` -- genre grouping without N+1
- [x] `src/services/shelf.ts` (+ `services/index.ts`) -- `loadLibrary`/`getShelf`/`searchLibrary` baking the `ShelfGame` DTO via `core/` -- the driver-agnostic shelf/search logic
- [x] `src/routes/shelf.ts` (+ `routes/index.ts`) -- `GET /shelf` + `GET /shelf/search`, `requireAuth`, Zod-validated, user-scoped -- thin JSON boundary (AR-26, AD-13)
- [x] `test/integration/shelf.test.ts` -- workers-pool D1: ordering, hidden-state exclusion, whole-library search, user scoping, 401 unauth -- real regression coverage for the read path
- [x] `web/shelf/api.ts` + `web/shelf/useProgressiveList.ts` (+ its test) -- client Zod contract + progressive-render hook -- typed boundary + testable pagination
- [x] `web/shelf/Card.tsx` + `StatePill.tsx` + css (+ `Card.test.tsx`) -- read-only card: cover/fallback, title ellipsis, pill, flag cluster, owned, genres desktop-only, Playing bloom -- the card contract (UX Card)
- [x] `web/shelf/Shelf.tsx` + css (+ `Shelf.test.tsx`) -- data fetch, skeleton/empty/error states, roving-tabindex grid, progressive render -- the shelf surface (FR-8/17/19, UX-DR12/17/19)
- [x] `web/shelf/SearchBox.tsx` + css (+ `SearchBox.test.tsx`) -- whole-library search combobox, listbox matches, NO MATCH, focus shortcut -- FR-19/UX-DR16
- [x] `web/shell/AppShell.tsx` + `web/shell/Header.tsx` -- mount `<Shelf/>` in main, `<SearchBox/>` in the header search slot -- wire the shelf into the shell
- [x] `web/main.tsx` + `package.json` -- add `@tanstack/react-query` + `QueryClientProvider` -- the pinned data-fetch client

**Acceptance Criteria:**
- Given seeded games, when the shelf loads, then a responsive cover-forward grid renders cards with cover art, Orbitron-ellipsis name, effective-state pill, owned indicator, and flag icons (PS+ Extra, release-state, milestone), with genres shown on desktop only (FR-15, FR-8, UX-DR6/DR26)
- Given the default view with no filters, when the shelf renders, then only live-play-status games show (Completed/Platinum/Dropped hidden), ordered Playing→Paused→Up next→Not started, alphabetical within each group, with ordering derived from the single `core/` effective-state function — never a raw `ORDER BY play_status` (FR-17/18, FR-4, AD-7)
- Given a large library, when scrolling, then the shelf renders progressively over the effective-state-sorted set materialized in the Worker/client, not a SQL cursor (FR-19, FR-8, AD-7)
- Given the persistent search bar, when typing a title, then a dedicated whole-library query — separate from the filtered-shelf query — matches every game ignoring active filters and hidden states, and matches are listed (FR-19, UX-DR16)
- Given first load or an empty library, when the shelf renders, then cover-shaped skeletons show while pending and an empty library shows `INSERT GAMES` (no dead Sync/Add CTAs) (UX-DR12/17/18)
- Given a read/render path, when the shelf renders, then covers and store links come only from persisted data with no third-party fetch (NFR-3, AR-6)
- Given the shelf grid, when navigating by keyboard, then it is a focusable roving grid with arrow traversal in reading order and an always-on focus outline (UX-DR19/20)
- Given `GET /api/shelf` without a session, when requested, then it returns 401 and leaks no data; given a session, all rows are scoped to that user (AD-13)
- Given `bun run lint && bun run typecheck && bun run test`, when run, then all pass — new `core/shelf` unit suite, the purity guard over it, the workers-pool shelf integration suite, and the jsdom `web` card/shelf/search/hook suites; Stories 1.1–1.6 remain green

## Spec Change Log

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 3, low 5)
- defer: 2
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` Card cover that 404s/fails to load now falls back to the graceful cover mark via `onError` (was a broken-image glyph) — honors the "no-network cover fallback" card contract (`web/shelf/Card.tsx`).
  - `[medium]` `[patch]` Keyboard grid nav was hard-capped at the first progressive page (48): arrow/End couldn't reach games past it because paging only advanced on scroll (IntersectionObserver). Added `revealThrough` to `useProgressiveList` and effect-driven focus so keyboard moves reveal pages and `End` reaches the true last game — restores the arrow-traversal a11y floor (`web/shelf/Shelf.tsx`, `web/shelf/useProgressiveList.ts`, +2 hook tests).
  - `[medium]` `[patch]` An expired-session 401 was retried 3× by the default query client before the dead-end error. `fetchGames` now carries the HTTP status and the `QueryClient` skips retries on 4xx (`web/shelf/api.ts`, `web/main.tsx`).
  - `[low]` `[patch]` "NO MATCH" was exposed as a selectable `role="option"`; changed to `role="presentation"` so AT doesn't count it as a choosable entry (`web/shelf/SearchBox.tsx`).
  - `[low]` `[patch]` Search listbox never closed on blur/outside click; added `onBlur` close (select is a no-op this epic, so no option steals the blur) (`web/shelf/SearchBox.tsx`).
  - `[low]` `[patch]` Arrow keys with zero matches drove `activeIndex` to an invalid negative value; guarded arrow handlers on empty results (`web/shelf/SearchBox.tsx`).
  - `[low]` `[patch]` `columnCount()` used strict `top` equality, fragile to sub-pixel layout rounding; switched to a `< 1px` tolerance band (`web/shelf/Shelf.tsx`).
  - `[low]` `[patch]` `moveFocus` clamped to `cardRefs.current.length` (stale on shrink); now clamps to the true list length, removing the transient out-of-range focus (`web/shelf/Shelf.tsx`).
- deferred: 401→re-auth redirect (app-wide auth UX); single-row ARIA vs 2-D nav semantics (responsive-grid a11y refinement) — see `deferred-work.md`.
- rejected (8): unvalidated `q` (flows only to a safe in-memory title filter; response already Zod-validated per AR-26); per-keystroke library re-bake (spec-sanctioned at ~344-game v1 scale, debounced + query-cached); duplicated one-line title comparator (no shared abstraction warranted); dead `.shelf__grid` CSS class (harmless); `StatePill` carrying non-shelf states (defensive completeness); diacritic-insensitive search mismatch (negligible for this library); "SOON on a past date" (impossible — `computeDerivedStates` guarantees `released===false ⟹ future/no date`); Enter-on-option form submit (read-only intentional, not inside a form).

## Design Notes

- **Why server-baked DTO + no `web`→`src` import:** `web/` (tsconfig.app, DOM lib, `include:["web"]`) and `src/` (tsconfig.worker) are distinct `tsc -b` programs; importing `src/core` into `web` would drag Worker-typed files into the DOM program. So `services/shelf.ts` computes effective + derived state via `core/` and returns a flat `ShelfGame`; the client only maps `effectiveState`→pill presentation and re-validates with its own Zod schema. One core function still owns state (called server-side); the client never re-derives it.
- **`ShelfGame` DTO shape (baked server-side):** `{ id, title, coverUrl, storeUrl, effectiveState, owned, released, wishlisted, psPlusExtra, hasCompleted, hasPlatinum, releaseDate, genres: string[] }`. `effectiveState` drove the ordering and feeds the pill; `hasCompleted`/`hasPlatinum` are carried separately from `effectiveState` so the milestone badge persists on a live (`Playing`) card.
- **Ordering (pure):** `orderShelf` sorts by `SHELF_STATE_ORDER.indexOf(effectiveState)` then `title.localeCompare`. `getShelf` = `loadLibrary().filter(g => isDefaultShelfVisible(g.effectiveState))` then `orderShelf`. `searchLibrary` = `loadLibrary().filter(title includes q)` then alpha — a separate query path, never a filter over the shelf result.
- **Progressive render, not SQL paging:** `loadLibrary` returns the whole user set (~344 rows); `useProgressiveList` slices it for render and grows on an `IntersectionObserver` sentinel. Where `IntersectionObserver` is absent (jsdom) it renders all, keeping tests deterministic; `showMore` is unit-tested directly.
- **Search combobox (read-only):** `role=combobox` input + `role=listbox` popup of matches (option = game title). Epic 1 has no detail view, so selecting is a no-op; the value is "matches are listed" + keyboard reachable. Global "/" focuses it (ignored while typing in a field).

## Verification

**Commands:**
- `bun install` -- expected: resolves, adds `@tanstack/react-query` (no other new deps)
- `bun run lint` -- expected: Biome clean across `src/`, `web/`, `worker/`, incl. the `core/**` restricted-import override over `core/shelf.ts`
- `bun run typecheck` -- expected: `tsc -b` clean across app/worker/node (no `web`→`src` import; DTO duplicated + Zod-validated both sides)
- `bun run test` -- expected: all pass — `core/shelf` unit suite + purity guard (node project), `test/integration/shelf.test.ts` (workers pool: ordering, hidden-state, search, scoping, 401), and the jsdom `web` suites (Card, Shelf, SearchBox, useProgressiveList); Stories 1.1–1.6 suites remain green

**Manual checks (if no CLI):**
- `bun run dev`, sign in, confirm the seeded library renders as a backlog-first grid (Playing first, magenta bloom), search filters the whole library incl. hidden states, skeletons flash on first load, and keyboard arrows traverse the grid. Covers load only from persisted URLs (no network on render — verify in DevTools Network).

## Auto Run Result

Status: done

**Summary:** Delivered the read-only shelf (Story 1.7) — two user-scoped read endpoints (`GET /api/shelf`, `GET /api/shelf/search`) behind `requireAuth`, a pure `core/shelf.ts` owning ordering/visibility, a `services/shelf.ts` orchestration baking the `ShelfGame` card DTO through the `repositories/`+`core/` seams, and the React SPA rendering a responsive, keyboard-navigable, progressively-rendered card grid with a whole-library search combobox. Dev implementation was completed under bmad-loop; this run resumed at the review stage (the loop hit the hourly limit before it began) without discarding any prior work, then ran the adversarial + edge-case review and hardened the result.

**Files changed (net of the story):**
- `src/core/shelf.ts` (+ test), `src/core/index.ts`, `src/core/types.ts` — pure shelf ordering/visibility over `computeEffectiveState` (single ordering source, no SQL `ORDER BY`).
- `src/repositories/games.ts`, `src/repositories/genres.ts` — user-scoped library read + bulk genre grouping (no N+1).
- `src/services/shelf.ts` (+ `services/index.ts`) — `loadLibrary`/`getShelf`/`searchLibrary` baking the DTO.
- `src/routes/shelf.ts` (+ `routes/index.ts`) — thin `requireAuth`, Zod-validated, user-scoped JSON boundary.
- `test/integration/shelf.test.ts` — workers-pool D1: ordering, hidden-state exclusion, whole-library search, user scoping, 401.
- `web/shelf/*` — `api.ts`, `useProgressiveList.ts`, `Card.tsx`+`StatePill.tsx`, `Shelf.tsx`, `SearchBox.tsx` (+ css + tests).
- `web/shell/AppShell.tsx`, `web/shell/Header.tsx`, `web/main.tsx`, `package.json`/`bun.lock` — mount the shelf/search and add the pinned `@tanstack/react-query` client.

**Review findings breakdown:** 8 patches applied (3 medium, 5 low — cover `onError` fallback, keyboard-nav page reveal + `End`-to-last, 4xx no-retry, NO-MATCH not an option, search close-on-blur, empty-match arrow guard, column-count tolerance, focus clamp); 2 deferred (401→re-auth redirect; single-row-ARIA vs 2-D-nav semantics — both in `deferred-work.md`); 8 rejected as noise/non-issues. No intent_gap, no bad_spec — no spec repair loopback (review_loop_iteration stays 0).

**Verification:** `bun run lint` (Biome) clean, `bun run typecheck` (`tsc -b`) clean, `bun run test` — 259 passed / 24 files (was 257; +2 new `useProgressiveList` reveal tests), Stories 1.1–1.6 suites remain green.

**Follow-up review recommended:** false — the review changes are localized, well-understood, and verified green; not a sweeping or architectural revision.

**Residual risks:** The keyboard-reveal path (`supportsObserver === true`) is unit-covered at the hook level but not exercised end-to-end in jsdom (no `IntersectionObserver`); worth a manual keyboard pass in a real browser. Session-expiry re-auth UX and faithful multi-row grid ARIA are deferred, not solved.
