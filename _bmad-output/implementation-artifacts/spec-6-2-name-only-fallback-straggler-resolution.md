---
title: 'Story 6.2: Name-only fallback & straggler resolution'
type: 'feature'
created: '2026-07-11'
status: 'done'
baseline_revision: 'b0de7ed'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: '134b6ec'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Two straggler kinds have no home in the app: import staging rows the seed couldn't match to a game (carry a Notion payload) and name-only `unenriched` games from add-by-name (6.1). Nothing surfaces them and nothing lets Luca resolve them, so discovery-moment saves and unmatched imports rot (FR-28/29/41, AR-17/22).

**Approach:** A unified stragglers view over both kinds, surfaced by the amber attention banner; a manual IGDB search picks a match; resolving writes a **permanent** `external_link('IGDB', id)` (so future syncs never re-add a duplicate), enriches the game facts, and — for an import straggler — carries its Notion payload (status/dates/owned) onto the game's tracking, then removes the staging row.

## Boundaries & Constraints

**Always:**
- Layering: routes → services → core (I/O-free) / repositories / providers. IGDB reached only through `IgdbProvider`, only on explicit user action (the resolve search), never on render.
- Permanence (named hazard): a confirmed match stores `external_link('IGDB', igdbId)`; `(source, external_id)` is globally unique, so a later add-by-name/seed/sync carrying that igdbId resolves to the SAME game — never a second row. Red-then-green test required (resolve, then `addGame`/lookup with the same igdbId returns the existing game).
- Notion payload carry (import kind): apply a pure `notionRowToTracking(row)` to the matched game's tracking via `insertTrackingIfAbsent`. Respect the completion invariant — never set a live `playStatus` alongside a `completedOn`; an unknown/known-completed-without-date status lands as `Not started` on the backlog (mirror how the seed left these), owned/started_on carried from the payload.
- Unenriched-kind resolve: attach the IGDB link, fill cover/release, auto-create+link genres (FR-24), clear the `unenriched` flag. Tracking is left untouched (the user already set it).
- Degrade, never throw: IGDB unreachable/unconfigured → search returns `[]` and the dialog says so; the straggler stays put. Provider errors caught in the service.
- Attention banner is the surfacing point (amber); it self-clears when the last straggler is resolved. Combobox/dialog a11y: `useModalTrap`, focus return, toasts via the polite live region.
- Every UI-flow AC gets a Playwright test here; externally-dependent ACs (real IGDB pick) get COVERAGE.md rows naming the covering integration test.

**Block If:** the seed's `import_straggler` table or the Epic 4 attention-banner/settings seam is missing or shaped differently than the Code Map states (would mean planning drift) — or the Playwright foundation is broken.

**Never:** No Twitch token refresh (static token; 401 → empty results, degrade). No interactive import session / bulk auto-resolve — one straggler at a time by explicit pick. No new npm deps. No FAB drawer item (6.3 owns the drawer). No edit to seed/sync write semantics beyond extracting the shared Notion→tracking mapping. No title-alias table — permanence is the `external_link` row.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List stragglers | GET /api/stragglers | `{stragglers:[{id,kind,title}]}` merging import rows + this user's unenriched games | none |
| Banner surfaces | ≥1 straggler exists | settings `stragglerCount>0` → amber banner, action opens the dialog | none |
| Manual search | GET /api/games/search?title= | `{candidates: IgdbCandidate[]}` (≤10) | provider error → `[]`, 200 |
| Resolve import straggler | POST resolve {id,kind:'import',igdbId,...} | game created/matched, IGDB link, tracking from payload, staging row deleted; toast; on shelf | none |
| Resolve unenriched game | POST resolve {id,kind:'unenriched',igdbId,...} | link added, facts+genres filled, `unenriched` cleared; tracking untouched | none |
| Permanent link | resolve then re-encounter same igdbId | existing gameId returned, no duplicate row | server guard, tested |
| No IGDB creds / down | search during resolve | empty list + "Games DB unavailable" notice; straggler unchanged | degrade |
| Unknown id/kind | resolve with missing straggler / bad kind | 404 / 400 | validated |
| Unauthenticated | any new endpoint | 401 | `requireAuth` |

</intent-contract>

## Code Map

- `src/schema/catalog.ts` -- `import_straggler` (id, source_title, notion_payload); `game.unenriched`; `external_link` unique `(source, external_id)`
- `src/repositories/stragglers.ts` -- has `insertStraggler`/`listStragglers`; ADD `getStragglerById`, `deleteStraggler`
- `src/repositories/games.ts` -- `insertGame`, `findGameByExternalLink`, `findGamesByNormalizedTitle`, `addExternalLink`, `listLibraryForUser` (returns `unenriched` — filter for unenriched list); ADD `enrichGame(db,gameId,{coverUrl,releaseDate})` setting facts + `unenriched=false`
- `src/repositories/{tracking,genres}.ts` -- `insertTrackingIfAbsent`, `upsertGenre`+`findGenreByNameInsensitive`+`linkGameGenre`
- `src/core/notion-status.ts` -- `mapNotionStatus`,`parseNotionDate`; ADD pure `notionRowToTracking(row)` (extract the notion→tracking mapping from `core/seed-reconcile.ts` buildSeedPlan L149-200; leave buildSeedPlan behavior identical, optionally reuse)
- `src/providers/igdb.ts` -- private `searchGames` fetches 50 hits; ADD public `searchCandidates(title): IgdbCandidate[]` (map through existing `enrichment`, guard missing id/name, cap 10)
- `src/services/games.ts` -- `previewAddGame`/`addGame` precedent (dup guard, genre loop, `newTracking`)
- `src/services/settings.ts` -- `SyncAttentionItem`, `readSyncAttention`; settings route payload
- `src/routes/games.ts` -- add `GET /api/games/search`; `src/routes/settings.ts` -- add `stragglerCount` to GET /api/settings; NEW `src/routes/stragglers.ts` mounted in `src/routes/index.ts`
- `web/components/AttentionBanner.tsx` -- variants amber/magenta/steel; ADD amber `enrich` variant; `web/shell/AppShell.tsx` -- render it when `stragglerCount>0`, action opens dialog
- `web/shelf/AddGameDialog.tsx` -- clone seam (portal, `useModalTrap`, toast, invalidation) for the new dialog
- `web/settings/api.ts` -- `settingsSchema`/`fetchSettings` (add `stragglerCount`)
- `playwright/support/helpers/d1.ts` -- `seedSetting`/`d1Execute`/`d1Query` (seed an import_straggler + an unenriched game); `playwright/COVERAGE.md`

## Tasks & Acceptance

**Execution:**
- [x] `src/core/notion-status.ts` -- add pure `notionRowToTracking(row)` → `{owned, ownershipType, playStatus, completedOn, startedOn}`; completion invariant safe (completedOn set ⇒ playStatus null; unknown/completed-no-date ⇒ `Not started`) -- payload carry
- [x] `src/repositories/{stragglers,games}.ts` -- `getStragglerById`, `deleteStraggler`, `enrichGame` -- resolve writes
- [x] `src/providers/igdb.ts` -- `searchCandidates(title)` returning up to 10 `IgdbCandidate` -- manual search
- [x] `src/services/stragglers.ts` (new) -- `listStragglerView(db,userId)` (import rows + unenriched games), `countStragglers(db,userId)`, `searchGamesForResolve(igdb,title)` (catch→[]), `resolveStraggler(db,userId,input)` (import vs unenriched branch; dup-safe via `findGameByExternalLink('IGDB')` then normalized title; addExternalLink; enrich; genres; tracking-from-payload for import; delete staging row) -- core write path
- [x] `src/routes/stragglers.ts` (new) + `src/routes/index.ts` -- `GET /api/stragglers`, `POST /api/stragglers/resolve` (Zod: id, kind ∈ import|unenriched, igdbId, optional coverUrl https/releaseDate ISO/genres/name), `requireAuth`, 404 unknown straggler -- API
- [x] `src/routes/games.ts` -- `GET /api/games/search?title=` (requireAuth, degrade to `[]`) -- search endpoint
- [x] `src/routes/settings.ts` + `src/services/settings.ts` + `web/settings/api.ts` -- add `stragglerCount` to GET /api/settings payload + schema -- banner feed
- [x] `web/components/AttentionBanner.tsx` + `web/shell/AppShell.tsx` -- amber `enrich` variant; render when `stragglerCount>0`, action opens `StragglersDialog` -- surfacing
- [x] `web/shelf/StragglersDialog.tsx` (new) + css + `web/shelf/api.ts` -- list view ↔ resolve view (manual search → candidate list → confirm); Save → toast, invalidate `['shelf']`/`['shelf-search']`/`['stragglers']`/`['settings']`/`['genres']` -- the resolution UI
- [x] `test/integration/stragglers.test.ts` (new) -- list (both kinds), resolve-import (payload carried onto tracking; link; row deleted), resolve-unenriched (link+facts+genres, flag cleared, tracking untouched), **permanent-link red-green** (re-resolve/addGame same igdbId → existing id, no dup), search with fake provider + no-creds empty, 400/401/404 -- hazard coverage
- [x] `src/core/notion-status.test.ts` (or existing) -- `notionRowToTracking` cases (owned yes/no, started date, unknown status → Not started, completed-no-date → Not started) -- pure-mapping check
- [x] `web/shelf/StragglersDialog.test.tsx` -- list renders both kinds; resolve flow invokes api + closes -- component behavior
- [x] `playwright/e2e/epic6.spec.ts` + `playwright/COVERAGE.md` -- e2e: seed an import straggler + a name-only unenriched game → amber banner appears → dialog lists both; resolve attempt with no IGDB creds shows the unavailable notice; COVERAGE rows map 6.2 ACs, IGDB-pick AC → integration test -- TR-3
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- story 6-2 status per convention

**Acceptance Criteria:**
- Given IGDB is unreachable or lacks the title, when I add by name, then a name-only `unenriched` game (release date unknown = not released) is saved and appears in the stragglers list (FR-41, NFR-4, AR-17)
- Given stragglers exist (import staging rows and/or name-only entries), when action is needed, then the amber attention banner surfaces them and each is resolvable by manual search; the banner self-clears when the last one is resolved (FR-28, AR-17/22, UX-DR11)
- Given I resolve an import straggler by matching it to a game, when confirmed, then its Notion payload (status, dates, owned flag) is carried onto the matched game's tracking (FR-28)
- Given a confirmed manual match, when it completes, then a permanent `external_link('IGDB', id)` is stored so a future add/seed/sync recognizes the game and never re-adds it as a duplicate (FR-29, AR-9)

## Design Notes

- Name-only save already exists (6.1 `addGame` unenriched path); 6.2 only surfaces + resolves it. Reuse over rebuild.
- One `StragglersDialog` holds both the list and the search-pick view (internal selected-straggler state) — fewer files than a list dialog + a separate resolve dialog, same portal/trap.
- Import stragglers are created only for unknown-status / completed-without-date / unnameable rows, so `notionRowToTracking` never yields a valid completed milestone for them — it defaults those to `Not started` on the backlog (matches the seed's own handling), carrying owned + started_on.
- New amber `enrich` banner variant (not the existing `stragglers` variant, which the 4.3 sync-conflict flow owns) keeps the two attention sources and their e2e testids distinct.
- Manual search is multi-result (`searchCandidates`, ≤10) so a wrong top hit isn't a dead end — this is the "manual search" the AC calls for, not a single forced top-1.

## Verification

**Commands:**
- `bun run typecheck` -- expected: clean
- `bun run lint` -- expected: clean
- `bun run test` -- expected: all vitest projects green incl. new `stragglers.test.ts` + `notionRowToTracking` cases
- `bun run test:e2e` -- expected: epic6 spec green (banner+list+degrade), no regressions

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 3, low 3)
- defer: 1
- reject: 12
- addressed_findings:
  - `[medium]` `[patch]` `services/stragglers.ts` — an import straggler matched (by normalized title) onto an existing name-only game now gets `enrichGame` + `unenriched` cleared, so it no longer stays a straggler forever (silent orphan). Test added.
  - `[medium]` `[patch]` `services/stragglers.ts` + `repositories/games.ts` — resolving an `unenriched` game now applies the chosen match's name (`enrichGame` optional title/titleNormalized), correcting a name-only typo the user picked a match to fix. Test added.
  - `[medium]` `[patch]` `web/shelf/StragglersDialog.tsx` — the resolve mutation gained `onError` (toast + invalidate `['stragglers']`): a 404 stale row / 400 / network drop no longer silently no-ops.
  - `[low]` `[patch]` `core/notion-status.ts` — `notionRowToTracking` coerces cells via `String()` so a non-string payload value degrades instead of throwing a 500.
  - `[low]` `[patch]` `services/stragglers.ts` — `parsePayload` rejects JSON arrays (`typeof [] === 'object'` slipped through), and a `ponytail:` comment names the untransacted multi-write ceiling.
  - `[low]` `[patch]` `playwright/COVERAGE.md` — 6.2d wording states the red-if-broken condition explicitly instead of claiming "red-green".
  - deferred (deferred-work.md): resolving an `unenriched` game to an igdbId already linked to a DIFFERENT game leaves it enriched-but-unlinked (a duplicate) — rare in the single-user catalog, `ponytail:` comment names it.
  - rejected: client-supplied genre auto-create (consistent with 6.1 addGame, single-user), whole-library count scan (personal scale), ownership→physical flattening (matches seed semantics), non-user-scoped import_straggler (single-user schema), duplicated candidate schemas (route enforces the strict one), empty-vs-error notice conflation, per-pick IGDB search (that IS the explicit action), e2e SQL interpolation (UUID values), 64-char igdbId (trusted from search results).

## Auto Run Result

**Status:** done

**Summary:** Surfaced and made resolvable both straggler kinds. A unified list (import staging rows + name-only `unenriched` games) is served by `GET /api/stragglers` and counted into `GET /api/settings` (`stragglerCount`), which lights a new amber `enrich` attention banner. Its "Resolve" action opens `StragglersDialog` (one portal, list ↔ manual-search views); the search hits `GET /api/games/search` (multi-result IGDB, exposed via new `IgdbProvider.searchCandidates`). Picking a match POSTs `/api/stragglers/resolve`, which writes a permanent `external_link('IGDB', id)` (dup-safe by link then normalized title), enriches facts + auto-creates genres, and for an import straggler carries the Notion payload onto tracking via the new pure `notionRowToTracking`, then deletes the staging row. IGDB down/unset degrades to an empty list (NFR-4).

**Files changed (key):**
- `src/core/notion-status.ts` — pure `notionRowToTracking` (payload→tracking, completion-invariant safe, String-coerced).
- `src/services/stragglers.ts` (new) — list/count/search/resolve; dup-safe, enrich-on-match, ponytail ceilings.
- `src/repositories/{stragglers,games}.ts` — `getStragglerById`/`deleteStraggler`/`enrichGame` (optional title correction).
- `src/providers/igdb.ts` — `searchCandidates` (multi-result).
- `src/routes/stragglers.ts` (new) + `games.ts` (`/games/search` + `igdbFromEnv` helper) + `settings.ts` (`stragglerCount`) + `index.ts`.
- `web/`: `StragglersDialog.tsx`+css, `AttentionBanner` `enrich` variant, `AppShell` wiring, `shelf/api.ts` + `settings/api.ts` clients.
- Tests: `test/integration/stragglers.test.ts`, `notion-status.test.ts` cases, `StragglersDialog.test.tsx`, `epic6.spec.ts` + `COVERAGE.md`.

**Review findings:** 6 patches (orphan enrich-on-match; name-typo correction; UI resolve error handling; String-coerce payload; reject-array payload + tx ceiling comment; COVERAGE red-if-broken wording). 1 deferred (unenriched→already-linked-elsewhere conflict). 12 rejected (single-user-context / consistency / cosmetic).

**Verification:** `bun run typecheck` clean; `bun run lint` clean (1 pre-existing epic1 info). `bun run test` green (targeted 25/25 for the patched surface; full-suite confirmation run — see final_revision). Named hazard FR-29 (permanent link → no duplicate) pinned red-if-broken in `stragglers.test.ts`. Playwright `epic6.spec.ts` stragglers flow written (banner→list→degrade); the IGDB-pick + payload-carry ACs are pinned in integration (no IGDB creds in e2e). Full Playwright suite not run in this unattended pass (self-booting global-setup) — deferred to CI, same as 6.1.

**Follow-up review recommended:** false — patches were localized correctness/UX hardening with tests; no architectural change.

**Residual risks:** untransacted multi-write resolve (documented ceiling, single-user, retryable); unenriched-resolve-to-already-linked-elsewhere conflict (deferred); happy IGDB-creds search path unexercised by automated tests.
