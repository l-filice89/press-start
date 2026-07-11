---
title: 'Story 6.1: Add a game by name (the wishlist moment)'
type: 'feature'
created: '2026-07-11'
status: 'done'
baseline_revision: '27959c7f2562f66a9566016934d2d4a76a0c4192'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: '8009d9b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** A game spotted in the wild cannot be captured: the persistent search bar only searches the library, picking a result is a no-op, and there is no create-game endpoint. The discovery moment is lost (FR-41/42/43, Flow 1).

**Approach:** Wire search-result pick to open the detail view; when search has no library match, show a `＋ Add "<name>"` row that opens a preview dialog pre-filled from IGDB (via the existing `IgdbProvider`, now given Worker secrets and a candidate-search method); Save hits a new `POST /api/games` that creates game + IGDB external link + user tracking (default wishlisted) and auto-creates genres.

## Boundaries & Constraints

**Always:**
- Layering: routes → services → core/repositories/providers. IGDB called only from explicit user action (the preview fetch), never on render.
- Duplicate safety (named hazard): saving must never create a second `game` for an already-tracked title — server guards by IGDB external link then `normalizeTitle` candidate key; on duplicate return the existing game id, client opens its detail view instead. Red-then-green test required.
- Defaults on save: not owned → `wishlisted_on = todayForUser`, `playStatus 'Not started'`; "Add as owned" → owned, `ownedVia 'purchase'`, `boughtOn` today (mirror sync's `newTracking`).
- IGDB failure or missing secrets degrades gracefully: preview opens with typed title only, save still works, game flagged `unenriched`, no external link (this is the seam story 6.2 builds on — do not build the stragglers list here).
- Search bar stays the sole Add entry point; combobox aria semantics preserved; `＋ Add` row is a real `role=option` and announced via existing polite live region.
- Every UI-flow AC gets a Playwright test in this story; non-UI/externally-dependent ACs get COVERAGE.md rows naming the covering integration test.

**Block If:** IGDB terms forbid server-side proxying of search for this use (they don't per known API docs) — or the existing Playwright foundation is broken.

**Never:** No Twitch token auto-refresh (static `IGDB_ACCESS_TOKEN` secret; 401 → degrade to unenriched path — record as ponytail ceiling). No Add item in the FAB drawer. No edits to seed-import/sync behavior. No new npm dependencies. No stragglers list UI (6.2).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pick existing match | click search result option | detail panel opens for that game; no create | none |
| No match, add enriched | `＋ Add` → preview → Save (IGDB hit) | game + IGDB link + tracking(wishlisted) + genre rows; toast; on shelf | none |
| Add as owned | preview owned toggle on → Save | tracking owned=true, boughtOn today, CTA read "Add as owned" | none |
| IGDB down / no creds / no IGDB result | `＋ Add` → preview | fields hold typed title only, notice shown; Save creates `unenriched` game, no link | provider error caught in service, never thrown to client |
| Duplicate save race | POST body matching existing game (link or normalized title) | 409 + existing gameId; client opens detail, no new row | server guard, tested |
| Blank/whitespace title | POST title '' | 400 | Zod min(1) after trim |
| Unauthenticated | any new endpoint | 401 | `requireAuth` |

</intent-contract>

## Code Map

- `src/providers/igdb.ts` -- existing adapter; add candidate-search method (top IGDB result: id, name, coverUrl, releaseDate, genres) reusing its throttle/fetch/auth machinery
- `src/services/settings.ts` -- `todayForUser(db,userId)` for date stamps
- `src/services/sync.ts` L149-183 -- create-game precedent (`insertGame`+`addExternalLink`+`insertTrackingIfAbsent`)
- `src/services/seed-import.ts` L153-160 -- genre auto-create loop (`upsertGenre`+`linkGameGenre`)
- `src/repositories/{games,tracking,genres}.ts` -- all needed writes exist; no new migration
- `src/routes/tracking.ts` + `src/routes/auth.ts` -- route pattern, `requireAuth`, Zod validate, sentinel→status mapping
- `src/routes/index.ts` -- mount new route
- `web/shelf/SearchBox.tsx` -- combobox; `SEED_SEARCH_EVENT` window-event precedent for cross-tree signalling
- `web/shelf/Shelf.tsx` ~L211 -- `openGameId` state in ShelfGrid; add window-event listener to open detail by id
- `web/shelf/DetailPanel.tsx`, `web/components/{useModalTrap,ConfirmDialog,Toast}.tsx` -- dialog + toast primitives to clone
- `web/shelf/useTrackingMutations.ts`, `web/shelf/api.ts`, `web/query-client.ts` -- mutation/invalidation/toast seam (`['shelf']`, `['shelf-search']`, `['genres']`)
- `wrangler.jsonc`, `worker-configuration.d.ts`, `.dev.vars`/`.env.example` -- IGDB_CLIENT_ID/IGDB_ACCESS_TOKEN as Worker secrets (optional at runtime)
- `playwright/` -- fixtures in `support/merged-fixtures.ts`; COVERAGE.md keyed by epic AC

## Tasks & Acceptance

**Execution:**
- [x] `src/providers/igdb.ts` -- add `searchCandidate(title)` (or similar) returning top IGDB match `{igdbId, name, coverUrl, releaseDate, genres[]} | null`; prefer exact-normalized match (`pickIgdbMatch`) else first result -- preview pre-fill
- [x] `src/services/games.ts` (new) -- `previewGame(provider,title)` (catches provider errors → null + unavailable flag) and `addGame(db,userId,input)` with duplicate guard (external link, then normalized title), insertGame(unenriched when no igdbId), optional `addExternalLink('IGDB')`, `insertTrackingIfAbsent` defaults per Boundaries, genre auto-create loop -- core write path
- [x] `src/routes/games.ts` (new) + `src/routes/index.ts` -- `GET /api/games/preview?title=`, `POST /api/games` (Zod: trimmed non-empty title ≤ 200, optional igdbId/coverUrl/releaseDate/genres[]/owned), `requireAuth`, 409 duplicate → `{gameId}` -- API surface
- [x] `wrangler.jsonc` comment + `.dev.vars.example`/`.env.example` + Env typing -- IGDB secrets available to Worker, absence tolerated -- config
- [x] `web/shelf/SearchBox.tsx` -- result options clickable → dispatch open-detail window event; zero-match state renders `＋ Add "<name>"` as first `role=option` (keyboard + click); announce via live region -- entry point
- [x] `web/shelf/Shelf.tsx` -- ShelfGrid listens for open-detail event, sets `openGameId` (game already in `['shelf']` cache after invalidation) -- programmatic detail open
- [x] `web/shelf/AddGameDialog.tsx` (new) -- portal dialog via `useModalTrap`; fetch preview on open; editable title/release date/genres, cover shown; owned toggle drives CTA label "Add to wishlist"/"Add as owned"; Save mutation → toast, invalidate shelf/search/genres, open detail of new game; duplicate 409 → open existing detail -- the wishlist moment
- [x] `test/integration/games.test.ts` (new) -- route tests with fake IgdbProvider: happy add (wishlisted defaults, genre rows created), add-as-owned, unenriched fallback, **duplicate-guard red-green (link + normalized-title)**, 400/401 -- hazard coverage
- [x] `web/shelf/SearchBox.test.tsx` -- extend: option click dispatches event; Add row appears only when no matches -- component behavior
- [x] `playwright/e2e/epic6.spec.ts` (new) + `playwright/COVERAGE.md` -- e2e: pick existing match opens detail; add-by-name (no IGDB creds in e2e → unenriched path) saves, toasts, appears on shelf; COVERAGE rows map epic ACs, IGDB-prefill AC → covered by integration test (no external calls in e2e) -- TR-3
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- story 6-1 status updates per convention

**Acceptance Criteria:**
- Given a library match in search results, when I click/Enter it, then its detail view opens and no game is created (FR-42, AR-9)
- Given no library match, when results render, then the top row is `＋ Add "<name>"` and activating it opens the preview pre-filled from IGDB, all fields editable, nothing persisted before Save (FR-41, UX-DR16/18)
- Given the preview, when I save with owned off/on, then CTA reads "Add to wishlist"/"Add as owned" and tracking lands with the matching defaults (FR-41, FR-43)
- Given IGDB genres unknown to the vocabulary, when saved, then genre rows are auto-created and linked (FR-24)
- Given a successful add, when it completes, then a toast confirms and the game appears on the shelf without reload (FR-41)

## Design Notes

- Cross-tree detail-open uses the existing `SEED_SEARCH_EVENT` window-event pattern — smallest channel that reaches ShelfGrid without a router or context refactor.
- e2e env carries no IGDB secrets, so Playwright exercises the unenriched path; the enrichment prefill is proven by integration tests with a fake provider (same seam seed-import already uses).
- Preview endpoint exists (rather than client→IGDB) because creds are server secrets and CORS/rate caps apply.

## Verification

**Commands:**
- `bun run lint` -- expected: clean
- `bun run typecheck` -- expected: clean (if script exists; else `bunx tsc --noEmit`)
- `bun run test` -- expected: all vitest projects green incl. new `test/integration/games.test.ts`
- `bun run test:e2e` (or playwright script per `playwright/README.md`) -- expected: epic6 spec green, no regressions

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 3, low 2)
- defer: 2
- reject: 12
- addressed_findings:
  - `[medium]` `[patch]` `igdb.ts` `searchCandidate` guarded a hit missing `id` OR `name` (was `id`-only) — a nameless IGDB hit made `previewResponseSchema.parse` throw a 500 instead of degrading name-only (NFR-4).
  - `[medium]` `[patch]` `AddGameDialog` now treats a thrown preview fetch (`isError`) as `unavailable`, so a network/5xx preview shows the "Games DB unavailable" notice instead of a bare, unexplained form.
  - `[medium]` `[patch]` `AddGameDialog` Save is disabled and short-circuits while `previewPending`, so a fast click can no longer POST name-only and silently drop an in-flight IGDB match.
  - `[low]` `[patch]` `games.ts` `addBodySchema.releaseDate` refined to reject impossible calendar dates (`2020-13-45`) the `^\d{4}-\d{2}-\d{2}$` regex let through at the trust boundary.
  - `[low]` `[patch]` `services/games.ts` — named the read-then-write duplicate-guard concurrency ceiling with a `ponytail:` comment (single-user + client in-flight guard hold it; advisory lock / partial unique index is the upgrade path).
- deferred (see deferred-work.md): arbitrary `candidates[0]` anchoring when multiple untracked catalog rows share a normalized title; search-pick detail-open assumes the `['shelf']` payload is the whole library.

## Auto Run Result

**Status:** done

**Summary:** Wired the persistent search bar as the sole Add entry point. Picking a library match opens its detail view (window-event → FilteredShelf, whole-library payload); no library match renders a `＋ Add "<name>"` option that opens `AddGameDialog`, pre-filled from IGDB via a new `GET /api/games/preview`, everything editable. Save hits `POST /api/games` (duplicate-guard: external-link then normalized-title candidate key), creating game + IGDB link + tracking (wishlisted or owned-as-purchase defaults) and auto-creating genre rows. IGDB unreachable/unconfigured degrades to a name-only `unenriched` save (NFR-4 seam for 6.2).

**Files changed (key):**
- `src/providers/igdb.ts` — extracted `searchGames`; added `IgdbCandidate`/`IgdbSearch` + `searchCandidate` (exact-normalized match else top hit; guards missing id/name).
- `src/services/games.ts` — `previewAddGame` (error → degrade) + `addGame` (duplicate-safe create, FR-43 defaults, genre auto-create).
- `src/routes/games.ts` — `GET /api/games/preview`, `POST /api/games`; Zod in/out, requireAuth, 409+gameId on duplicate, calendar-date validation.
- `web/shelf/{AddGameDialog,open-detail}.tsx/.ts`, `SearchBox.tsx`, `Shelf.tsx`, `api.ts`, CSS — dialog, search-pick → detail/add, mutation+invalidation+toast.
- Tests: `src/providers/igdb.test.ts`, `test/integration/games.test.ts`, `web/shelf/SearchBox.test.tsx`, `playwright/e2e/epic6.spec.ts`, `playwright/COVERAGE.md`.
- Config: `.dev.vars.example`, `vitest.config.ts` (IGDB secrets optional/empty).

**Review findings:** 5 patches applied (nameless-IGDB-hit → degrade not 500; preview fetch-error notice; Save blocked while preview pending; calendar-date rejection at trust boundary; concurrency-ceiling `ponytail:` comment). 2 deferred (arbitrary multi-candidate anchoring; search-pick assumes whole-library shelf payload) → deferred-work.md. 12 rejected (single-user-context rate-limit/stacked-panel noise, server-built https cover, idempotent genre link, cosmetic).

**Verification:** `bun run typecheck` clean; `bun run lint` clean (1 pre-existing info in epic1 spec, not ours); `bun run test` 1071 passing across 48 files (incl. new games/igdb/SearchBox tests; the one patch-induced 500→400 regression fixed and re-verified green). Playwright epic6 spec written (name-only path in creds-less e2e; IGDB-prefill pinned in Vitest per COVERAGE.md) — full e2e suite not run in this unattended pass (self-booting global-setup; deferred to CI).

**Follow-up review recommended:** false — patches were localized, low/medium-consequence hardening on an already-complete implementation.

**Residual risks:** Concurrent same-title add race (documented ceiling, single-user); happy IGDB-creds preview route path unexercised by automated tests (needs live creds or provider injection).
