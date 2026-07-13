# E2E coverage note

One row per Epic acceptance criterion (TR-2): the Playwright test that pins
it, or `skipped` with the reason. Epic 2 rows land with story 2.5.3.

## Epic 1

| AC | Coverage |
|----|----------|
| 1.1 dev command / health endpoint | `smoke.spec.ts` › API is healthy (framework smoke); otherwise skipped — build/CI AC, no UI flow |
| 1.1 CI gates, package scripts, CD migrations, layering, secrets | skipped — build/CI/scaffold ACs, no UI flow |
| 1.2 effective-state, derived flags, normalizer, invariants (pure core) | skipped — pure functions, Vitest-covered, no UI flow |
| 1.3a cold unauthenticated load shows login, never the shelf | `auth-journey.spec.ts` › signs in via the console-captured magic link (login-gate assertions) |
| 1.3b email → magic link → session → shelf | `auth-journey.spec.ts` › signs in via the console-captured magic link |
| 1.3c reads/writes scoped by user_id | skipped — server-side scoping, no distinct UI flow (Vitest worker-pool covered) |
| 1.3d auth tables only, no roles/tenancy | skipped — schema AC, no UI flow |
| 1.4 schema/repository ACs (all) | skipped — schema/architecture ACs, no UI flow |
| 1.5a design tokens | skipped — static CSS, no behavioral flow |
| 1.5b wordmark shell | `smoke.spec.ts` › the shelf loads for the authenticated user (wordmark only; tagline renders on the login screen, exercised by `auth-journey.spec.ts`) |
| 1.5c PWA install | skipped — install prompt not automatable; manifest/service-worker smoke checks possible but out of this story's scope |
| 1.5c responsive phone/desktop deltas | `epic1-responsive.spec.ts` › genres show on desktop and hide on phone; › phone grid renders 2-up |
| 1.5d skeleton primitive feeds real load | `epic1-shelf.spec.ts` › first load shows skeletons |
| 1.5d attention banner / toast primitives | skipped — unfed placeholders in Epic 1; exercised by Epic 2 flows (story 2.5.3) |
| 1.5e elevation/glow visuals | skipped — visual-only, class-presence pinned in jsdom `Card.test.tsx` |
| 1.5f WCAG AA contrast | skipped — static token analysis, not a browser flow |
| 1.5g ≥44×44 hit areas | `epic1-responsive.spec.ts` › owned toggle hit area is at least 44x44 in both viewports |
| 1.5h prefers-reduced-motion | `epic2-detail.spec.ts` › reduced motion swaps the flip entry for a cross-fade (closed by story 2.5.3) |
| 1.5i always-on focus outline | `epic1-shelf.spec.ts` › keyboard-focused card shows a focus outline (keyboard modality; mouse-focus outline behavior not separately pinned) |
| 1.7a card content (cover/title/pill/owned/flags; genres desktop-only) | `epic1-shelf.spec.ts` › shelf renders card content (title/state/OWNED/cover-fallback/PS+ flag; release + milestone flags jsdom-pinned in `Card.test.tsx`); genres delta in `epic1-responsive.spec.ts` |
| 1.7b default visible set + ordering (state → owned → alpha) | `epic1-shelf.spec.ts` › default shelf hides finished states and orders by state → owned → alpha |
| 1.7c progressive render / infinite scroll | `epic1-shelf.spec.ts` › infinite scroll reveals the next page (first fold = PAGE_SIZE + one growth event; full-set exhaustion exercised by loadAllPages in the ordering test) |
| 1.7d whole-library search ignoring filters/hidden states | `epic1-shelf.spec.ts` › whole-library search matches games hidden from the shelf, NO MATCH otherwise — REDESIGNED 2026-07-12: with no filter a bare search reaches the whole library (hidden included) and surfaces the game IN THE GRID (scope rule) with a `search-scope` caption stating the reach; gibberish → NO MATCH. Opening a searched game is now a card click (`epic6.spec.ts` › searching an existing game … the card opens detail) |
| 1.7e skeleton first load + INSERT GAMES empty state | `epic1-shelf.spec.ts` › first load shows skeletons; › empty library shows INSERT GAMES |
| 1.7f covers from persisted data, no third-party fetch on render | skipped — architecture NFR, unverified in e2e (no fixture seeds a cover_url; networkErrorMonitor only catches 4xx/5xx, not successful third-party fetches) |
| 1.7g focusable grid with arrow traversal in reading order | `epic1-shelf.spec.ts` › shelf grid supports arrow traversal in reading order |

## Epic 2

| AC | Coverage |
|----|----------|
| 2.1a pill → five-status popover, instant apply + toast | `epic2-tracking.spec.ts` › status pill opens a five-status menu; popover anchoring › popover flips above the pill at the viewport bottom |
| 2.1b first →Playing stamps started_on once | `epic2-tracking.spec.ts` › first move to Playing stamps started_on (observed via detail panel; write-once re-stamp guard is server-side, Vitest-pinned) |
| 2.1c Dropped → UNDO toast, card leaves default shelf | `epic2-tracking.spec.ts` › Dropped shows an UNDO toast… (re-inspecting the hidden card itself needs Epic 3 reveal pills — verified via Undo restore instead) |
| 2.1d status change updates state/order/pill everywhere | `epic2-tracking.spec.ts` › …selection applies instantly (card aria-label AND shelf tier reordering asserted after refetch) |
| 2.1e popover menu ARIA + Escape returns focus to pill | `epic2-tracking.spec.ts` › status menu closes on Escape and returns focus to the pill |
| 2.2a milestone rows confirm-gated | `epic2-tracking.spec.ts` › milestones are confirm-gated (Cancel writes nothing; confirm-dialog focus lands on Cancel, Tab trapped, Escape returns focus) |
| 2.2b confirm writes date; platinum auto-clears status | `epic2-tracking.spec.ts` › milestones are confirm-gated (story-complete keeps live status); › platinum clears the play status and the card leaves the shelf |
| 2.2c already-dated milestone re-log refused | `epic2-tracking.spec.ts` › an achieved milestone re-log is refused with an already-logged toast |
| 2.2d permanent badge regardless of later status | `epic2-tracking.spec.ts` › milestones… (badge asserted on the live card AND after a later Playing→Paused status change; persistence across a hidden state can't be re-inspected until Epic 3 reveal pills) |
| 2.3a cover tap → panel ~760px desktop / full-screen mobile | `epic2-detail.spec.ts` › detail panel opens from the cover: ~760px centered on desktop, full-screen on phone |
| 2.3b panel reuses status/milestone/date/genre/ownership controls | exercised across `epic2-detail.spec.ts` (dates, ownership, genres) and `epic2-tracking.spec.ts` (status via popover — same mutation hooks) |
| 2.3c wishlisted game links to PS Store | `epic2-detail.spec.ts` › wishlisted game links to the PS Store; owned game does not |
| 2.3d edit leaving neither status nor milestone refused (409) | skipped — the only triggering state (milestone-only game) is hidden from the shelf and the panel closes when a write hides its card; unreachable until Epic 3 reveal pills (jsdom pins the toast wiring) |
| 2.3e focus-trapped dialog, focus returns to card | `epic2-detail.spec.ts` › detail panel traps focus; Escape closes and returns focus; › backdrop click dismisses |
| 2.4a own/un-own with bought_on stamp + UNDO | `epic2-detail.spec.ts` › ownership: un-own offers UNDO and restores (bought_on stamp is server-side, Vitest-pinned) |
| 2.4b ownership type digital/physical | `epic2-detail.spec.ts` › ownership: …type switches physical/digital |
| 2.4c lifecycle date manual edit | `epic2-detail.spec.ts` › lifecycle date commits on blur and survives reopen |
| 2.4d automatic flows never overwrite recorded dates | skipped — server write-once invariant with no distinct UI flow; Vitest worker-pool covered |
| 2.5a genre add/remove updates set | `epic2-detail.spec.ts` › genres: novel name auto-creates, chip removes |
| 2.5b unknown genre auto-created | `epic2-detail.spec.ts` › genres: novel name auto-creates… |
| 2.5c no merge/rename tool | `epic2-detail.spec.ts` › genres: … no merge/rename UI |

Epic 1's deferred 1.5h (prefers-reduced-motion) is closed by
`epic2-detail.spec.ts` › reduced motion swaps the flip entry for a cross-fade.

## Epic 3

| AC | Coverage |
|----|----------|
| 3.1a State multiselect of live statuses; Genre multiselect of vocabulary | `epic3-filter.spec.ts` › state filter shows exactly the selected states…; › genre filter ORs within the group… (e2e asserts seeded genres appear as menu rows; the full four-status list and full-vocabulary listing are pinned in jsdom `FilterRow.test.tsx`) |
| 3.1b OR within a group, AND across groups | `epic3-filter.spec.ts` › genre filter ORs within the group and ANDs against the state group |
| 3.1c nothing selected → default set; any selection → exactly those states | `epic3-filter.spec.ts` › state filter shows exactly the selected states, highlights, and restores the default set |
| 3.1d active filter entry visually highlighted | `epic3-filter.spec.ts` › state filter… (data-active trigger + aria-checked row asserted) |
| 3.1 FR-18 ordering holds in filtered views | `epic3-filter.spec.ts` › a filtered view keeps state → owned → alpha ordering |
| 3.1 search scope rule (SUPERSEDES the old "search ignores filters" isolation, redesign 2026-07-12) | `epic3-filter.spec.ts` › search scope rule: a bare search reaches the whole library; an active filter narrows within it (both directions; jsdom-pinned in `Shelf.test.tsx` › scope rule: no filter reveals a hidden game by name; an active filter suppresses it) |
| 3.2a Flag pills Owned/Wishlisted/Released/Playable now, each its own AND group | `epic3-reveal.spec.ts` › flag pills are their own AND groups (Wishlisted + State AND asserted; all four pills' pressed state pinned in jsdom `FilterRow.test.tsx`) |
| 3.2b reveal pill shows its hidden state (semantics amended by 3.5 — exclusive view) | superseded by 3.5a — `epic3-reveal.spec.ts` › a reveal pill is an exclusive view (all three pills pinned in jsdom + `filters.test.ts`) |
| 3.2c solid pills narrow, dashed pills reveal | `epic3-reveal.spec.ts` › a reveal pill… / › flag pills… (modifier classes asserted; the dashed border itself is static CSS) |
| 3.2d active pill glows/highlights | `epic3-reveal.spec.ts` › a reveal pill… (aria-pressed + data-active asserted; glow itself is static CSS) |
| 3.2e UNDO restores auto-cleared (null) status through the invariant write path | `epic3-reveal.spec.ts` › UNDO after dropping a revealed milestone-only card restores the null status |
| 3.2f panel on already-hidden game survives a no-visibility-change milestone write | transition logic pinned in jsdom `DetailPanel.test.tsx` (stays open, hidden→hidden); `epic3-reveal.spec.ts` › milestone write on a revealed hidden game… drives the flow e2e with reopen-based asserts — a direct stays-open assert is unreliable until Story 3.4 hoists panel state (epic2-detail NOTE convention) and 3.4 converts it |
| 3.3a live summary sentence with literal or/and words, tinted connectors | `epic3-summary.spec.ts` › desktop shows the inline row with a live summary… (words + both connector tint classes asserted; exact colors are static CSS) |
| 3.3b NO MATCH empty state with Clear filters | `epic3-summary.spec.ts` › NO MATCH offers Clear filters and it restores the default set |
| 3.3c phone Filters button + badge → grouped bottom sheet with Show N games; desktop full row inline | `epic3-summary.spec.ts` › phone: Filters button + badge opens the grouped sheet…; desktop delta asserted in the summary test |
| 3.4a focus survives resize re-chunk | `epic3-focus.spec.ts` › keyboard focus survives a viewport resize that re-chunks the ARIA rows (restoration path also jsdom-pinned in `Shelf.test.tsx`) |
| 3.4b login swap focuses the form + announces | `epic3-focus.spec.ts` › signing out moves focus into the login form and announces the swap (fresh-session isolation; 401 path shares the same gate — jsdom `Login.test.tsx` pins the mount effect) |
| 3.4c focus lands deliberately when a card leaves the shelf; UNDO Tab-reachable | `epic3-focus.spec.ts` › focus lands on a neighbor after Dropped removes the focused card |
| 3.4d open panel survives refetch re-chunk | direct stays-open asserts converted across `epic2-detail.spec.ts` (dates/ownership/genres) and `epic3-reveal.spec.ts`; jsdom `Shelf.test.tsx` pins the hoist |
| 3.4e toast UNDO respects the in-flight guard | jsdom `StatusPopover.test.tsx` › toast UNDO during a pending write toasts Still saving (no reliable e2e flow: needs a write held in flight, which the real Worker answers too fast to pin) |
| 3.5a reveal pill = exclusive view; State group replaced, selections clear | `epic3-reveal.spec.ts` › a reveal pill is an exclusive view: only the hidden state(s) show, states clear (mutual exclusion asserted in BOTH directions; exclusive predicate + handler clears pinned in jsdom `filters.test.ts`/`FilterRow.test.tsx`/`Shelf.test.tsx`) |
| 3.5b multiple reveal pills OR among themselves | `epic3-reveal.spec.ts` › a reveal pill is an exclusive view… (Completed + Dropped both visible; pinned in `filters.test.ts`) |
| 3.5c Genre/Flags still AND with an active reveal view | `epic3-reveal.spec.ts` › flag selections AND with an exclusive reveal view (genre×reveal AND pinned in jsdom `filters.test.ts` — same predicate path as flags) |
| 3.5d summary states the reveal view literally, no live-status enumeration | `epic3-summary.spec.ts` › an exclusive reveal view is stated literally in the summary |
| 3.5e empty reveal/filter view: focus lands on Clear filters or the heading, never `<body>` | `epic3-focus.spec.ts` › focus hands off to Clear filters when the last visible card leaves the shelf (headline fallback + reverse grid-return handoff pinned in jsdom `Shelf.test.tsx` — no e2e flow renders an actionless empty state without emptying the shared parallel DB) |
| 3.5f one shared focus-trap for ConfirmDialog/DetailPanel/FilterSheet | refactor with no new user flow — existing trap tests (jsdom `ConfirmDialog`/`DetailPanel`/`FilterRow` suites + `epic2-detail.spec.ts` trap/Escape tests) pin the unchanged behavior over `useModalTrap` |
| 3.5g loadAllPages fold-position fix in the two flaky epic2 asserts | `epic2-detail.spec.ts` › backdrop click dismisses…; `epic2-tracking.spec.ts` › Dropped shows an UNDO toast… (fix is in the tests themselves) |
| 3.6a every tracking write invalidates `['shelf']` (the single query the grid + its client-side search/filter render from) | superseded by the 2026-07-12 search redesign: the separate `['shelf-search']` query + `/api/shelf/search` endpoint were removed (search is a client-side filter of the shelf payload), so a write only needs to invalidate `['shelf']`. `invalidateShelfQueries` (useTrackingMutations) does exactly that; refetch-on-invalidate is react-query's own contract |
| 3.6b stale toast UNDO cannot overwrite a newer settled write | jsdom `StatusPopover.test.tsx` › toast UNDO after a settled newer write expires and writes nothing (no reliable e2e flow: needs two writes + a live toast raced against the real Worker's response timing — same reason as 3.4e) |
| 3.6c open status-popover menu survives a refetch re-chunk; retry loop removed | jsdom `Shelf.test.tsx` › keeps the status menu open… (menu identity asserted) + › does not resurrect a status menu…; the `epic2-tracking.spec.ts` helper now opens with a plain click (retry loop deleted) — regression signal is that suite flaking again |

## Epic 4

| AC | Coverage |
|----|----------|
| 4.1a all PSN access through `PsnProvider` (persisted query, auth inside the adapter) | skipped — wire-level adapter, no UI flow; pinned in Vitest `psn.test.ts` (persisted query/pagination/headers) + `psn-encapsulation.test.ts` (auth mechanics allowed nowhere else) |
| 4.1b NPSSO token in `SETTING`, editable from a settings surface, read fresh per call (9.1b) | `epic4-settings.spec.ts` › the header gear opens Settings; saving a token flips presence without echoing the value (fresh-per-call read pinned in Vitest `psn.test.ts`; secret-seed fallback in `settings.test.ts` integration) |
| 9.1b the token field carries a “Get / refresh token” deep link to the ssocookie endpoint | `epic4-settings.spec.ts` › the token field carries the "Get / refresh token" deep link, opening Sony in a new tab (href/target/rel; the same attributes pinned in jsdom `SettingsPanel.test.tsx`) |
| 4.1c a denied credential (401/403, a code-less authorize redirect, a refused token exchange, or HTTP 200 + `errors[]`) surfaces refresh instructions in the attention banner, no retry | `epic4-settings.spec.ts` › an expired PSN auth state feeds the attention banner…; live wiring closed by story 4.2: › Sync from the FAB with no token configured lights the expired-token banner (the one-attempt/fail-closed rows are pinned in Vitest `psn.test.ts`; the PSN-401-during-sync → flag write in `sync.test.ts` integration) |
| 4.2a FAB drawer + Sync runs with a spinner | `epic4-settings.spec.ts` › Sync from the FAB… (drawer open/aria-expanded/one-tap recovery); spinner-while-pending pinned in jsdom `Fab.test.tsx` (the e2e missing-token sync resolves too fast to observe a spinner deterministically) |
| 4.2b new games created with defaults; owned flips stamp bought_on | skipped e2e — a happy-path sync needs a live PSN response the e2e Worker cannot stub; pinned in `sync.test.ts` integration (real workerd + D1, stubbed PSN) and `sync-reconcile.test.ts` unit rows |
| 4.2c append-only: never deletes, never un-owns, never touches status/milestones/dates/genres | skipped e2e — same stubbed-PSN constraint; hazard pinned in `sync.test.ts` › flips owned … touches NOTHING else + `sync-reconcile.test.ts` › additive-only plan shape |
| 4.2d claims count as owned, flagged `owned_via=membership`, no bought_on (FR-9 amended 2026-07-11) | skipped e2e — same constraint; hazard pinned in `sync.test.ts` › claims count as owned… + › buying a claimed game upgrades the source… + `sync-reconcile.test.ts`/`ownership.test.ts` unit rows |
| 4.2e matching: links first, PS4/PS5 collapse, conflicts flagged never merged | skipped e2e — same constraint; pinned in `sync-reconcile.test.ts` (link-first, collapse, conflict/ambiguity rows) + `sync.test.ts` › flags a title match carrying a different PSN id |
| 4.2f cover art + store URL persisted at sync, nothing fetched on render | skipped e2e — same constraint; pinned in `sync.test.ts` (PSN facts persisted, NULL-only backfill) |
| 4.3a summary modal after every completed sync (counts + needs-attention) | modal content/variants pinned in jsdom `SyncSummaryModal.test.tsx`; the run→modal handoff in `Fab.test.tsx` (a live completed sync needs a PSN response the e2e Worker cannot stub; the counts themselves are pinned in `sync.test.ts` integration) |
| 4.3b needs-action items seed the persistent attention banner, surviving the modal and reloads | `epic4-settings.spec.ts` › persisted sync needs-attention feeds the amber banner… (fresh-load banner + reload persistence; the sync-run→persist write and self-resolution in `sync.test.ts` integration hazards) |
| 4.3c summary offers a button jumping to the problem | `epic4-settings.spec.ts` › persisted sync needs-attention… ("Find in library" → search seeded + focused); seed mechanics also jsdom-pinned in `SearchBox.test.tsx` and `SyncSummaryModal.test.tsx` |
| ad-hoc FR-9 amendment: claimed games show a PS+ tag on the OWNED chip | `epic4-settings.spec.ts` › a game owned via PS+ claim carries the PS+ tag on its card (purchase negative asserted; chip content also jsdom-pinned in `Card.test.tsx`; the detail panel's acquisition-source line — claim/purchase/silent-NULL — jsdom-pinned in `DetailPanel.test.tsx`, same DTO field the e2e already drives) |

## Epic 5

| AC | Coverage |
|----|----------|
| 5.1a region persisted in `SETTING` (config-seeded) and read by the check | skipped e2e — no UI flow (config seed + server read); pinned in `psplus.test.ts` integration › seeds the region setting from config on first run |
| 5.1b FAB "Check PS+ Extra" runs the check with a spinner | drawer item + spinner + result handoff pinned in jsdom `Fab.test.tsx` (a live check needs a store-catalog response the e2e Worker cannot stub — same constraint as 4.2b) |
| 5.1c flags set/cleared on tracked non-owned games only, both directions; never auto-added | skipped e2e — same stubbed-PSN constraint; hazards pinned in `psplus.test.ts` integration (set, clear, owned untouched, no auto-add, normalization match, failed fetch writes nothing) |
| 5.1d owned games ignore/hide the PS+ flag | `epic5-psplus.spec.ts` › a flagged non-owned released game is Playable now; owned games hide the flag… |
| 5.1e stored membership lights Playable now (card flag + filter pill) for released games | `epic5-psplus.spec.ts` › … (released in-catalog visible under the pill, unreleased excluded) |
| 5.1f summary modal reports the flag changes | modal content pinned in jsdom `PsPlusCheckModal.test.tsx`; run→modal handoff in `Fab.test.tsx` (live-run constraint as 5.1b) |
| 5.2a monthly Cron Trigger fires the same region-scoped check statelessly | skipped e2e — a Cron Trigger cannot be fired from a Playwright run; pinned in `psplus-cron.test.ts` integration › runs the check via worker.scheduled (real workerd scheduled handler + local D1, catalog stubbed) |
| 5.2b cron and button read the same stored region (no divergence) | skipped e2e — same unstubbable-cron constraint; pinned in `psplus-cron.test.ts` › sends the stored region as the store locale (button parity in `psplus.test.ts`) |
| 5.2c a failed scheduled refresh surfaces a notice in the attention banner | `epic5-psplus.spec.ts` › a failed monthly refresh surfaces the failed-refresh attention banner (seeded `psplus_refresh_failed` flag → steel banner); flag mechanics (set on failure, clear on any success) in `psplus-cron.test.ts` + `settings.test.ts` |
| 5.3a successful refresh persists a timestamp shown as "PS+ CATALOG AS OF {date}" | `epic5-psplus.spec.ts` › the header shows "PS+ CATALOG AS OF {date}" after a refresh (seeded `psplus_refreshed_at` → readout); stamp-on-success + GET exposure in `psplus.test.ts` + `settings.test.ts`; readout render in jsdom `Header.test.tsx` |
| 5.3b readout is full on desktop, compact on mobile | CSS-only `@media (max-width:600px)` swap of `.app-header__readout-full`/`-compact` (no JS branch — the viewport visibility toggle itself is not asserted); both spans are populated with the date, asserted in `Header.test.tsx`, and the full-form text is present in the `epic5-psplus.spec.ts` readout test |
## Epic 6

The e2e env carries no IGDB creds (`.dev.vars.e2e`), so Playwright drives the
name-only path; the IGDB-prefill half is pinned in Vitest (`igdb.test.ts` wire
rows, `games.test.ts` integration).

Search redesign (2026-07-12): the suggestion dropdown is gone. The search input
(`role=searchbox`) live-filters the shelf grid — the ONE result surface — and a
pinned `＋ Add "<term>"` bar under it (`search-add-option`) is the sole Add entry
point, present for ANY non-empty term (the "FF fix": Add stays reachable even
when library games match). A `search-scope` caption states the reach: whole
library (no filter) vs within your filters (filter active) — the scope rule.

| AC | Coverage |
|----|----------|
| 6.1a library match → detail view, no duplicate created; + FF fix (Add present despite matches) | `epic6.spec.ts` › searching an existing game narrows the shelf, still offers ＋ Add (FF fix), and the card opens detail — no duplicate (asserts the pinned Add bar is visible WHILE a library game matches, then the card click opens detail and the DB still holds one row) |
| 6.1b no match → `＋ Add` row → preview prefilled, all editable, nothing persisted before Save | `epic6.spec.ts` › add-by-name … (Add row, editable title, name-only notice, pre-Save DB count = 0); IGDB prefill pinned in `games.test.ts` › preview/enriched-add integration (no external calls in e2e) |
| 6.1c save owned off/on → CTA "Add to wishlist"/"Add as owned" + matching defaults | `epic6.spec.ts` › add-by-name … (CTA follows the owned toggle; wishlist defaults asserted in D1); owned-as-purchase defaults pinned in `games.test.ts` › add-as-owned |
| 6.1d unknown IGDB genres auto-created + linked on save | pinned in `games.test.ts` › genre auto-create (e2e runs the name-only path with no IGDB genres — unreachable there) |
| 6.1e successful add → toast + game on the shelf without reload | `epic6.spec.ts` › add-by-name … (toast + gridcell appear post-Save) |
| 6.2a name-only unenriched save appears in the stragglers list | `epic6.spec.ts` › stragglers … (a seeded name-only game shows in the dialog); the save itself is 6.1b, and the list merge is pinned in `stragglers.test.ts` › lists both kinds |
| 6.2b stragglers surface via the amber banner + resolvable by manual search; self-clears | `epic6.spec.ts` › stragglers … (amber `enrich` banner → dialog lists both kinds → resolve attempt degrades without creds); self-clear + count in `stragglers.test.ts` (resolve removes the row, count drops) |
| 6.2c resolving an import straggler carries its Notion payload (status/dates/owned) onto the game | pinned in `stragglers.test.ts` › resolves an import straggler (owned/status/started_on asserted on tracking) — e2e can't pick an IGDB match (no creds); `notionRowToTracking` cases in `notion-status.test.ts` |
| 6.2d a confirmed match writes a permanent IGDB link so future adds/syncs never re-add a duplicate | pinned in `stragglers.test.ts` › resolves an import straggler … — after resolve, add-by-name with the same igdbId returns the SAME existing game (409); the assertion fails (201, a second row) if the permanent link weren't written, so it is red-if-broken. Server-side identity, no distinct UI flow |
| 6.3a Export CSV → full library downloads from D1 | `epic6.spec.ts` › Export CSV: the FAB item downloads … (download event + filename); the CSV content (columns/quoting/ownership/genres) pinned in `export.test.ts` + `csv.test.ts` toCsv round-trip |
| 6.3b FAB handedness moves the button and persists | `epic6.spec.ts` › Settings: FAB handedness moves the button and persists across a reload (`fab--left` applied + survives reload); persistence pinned server-side in `settings.test.ts` › FAB handedness |
| 6.3c Settings offers sign out and About/Help | `epic6.spec.ts` › Settings: sign out and About/Help are available (About/Help visible; sign-out returns to the login gate); the sign-out wiring also jsdom-pinned in `SettingsPanel.test.tsx` |
| 6.4a PS+ own prompts buy-vs-claim; choice writes owned_via=purchase/membership | `epic6.spec.ts` › owning a PS+ game prompts buy-vs-claim; "Claimed with PS+" writes owned_via=membership; › …via "Purchased" writes owned_via=purchase and stamps bought_on; the gate + dialog also jsdom-pinned in `Card.test.tsx` (opens prompt, each choice sends its via, Cancel writes nothing) + `OwnershipSourceDialog.test.tsx`; server via-thread in `tracking.test.ts` |
| 6.4b non-PS+ own is silent, writes owned_via=purchase | `epic6.spec.ts` › owning a non-PS+ game is silent — no prompt, owned_via=purchase; default-to-purchase also pinned in `tracking.test.ts` › defaults owned_via=purchase when no source is sent |
| 6.4c detail source reads "Owned · via PS+" (claim) / "Owned · purchased" (else) | `epic6.spec.ts` › detail panel states the source…; provenance copy also jsdom-pinned in `DetailPanel.test.tsx` |
| 6.4c detail "I bought this" upgrades a PS+ claim to purchase (bought_on stamped); own/un-own are separate labelled commands | `epic6.spec.ts` › detail "I bought this" upgrades a PS+ claim to a purchase…; upgrade CTA + "Mark as owned"/"Mark as not owned" commands jsdom-pinned in `DetailPanel.test.tsx` |
| 6.4d cancel PS+ un-owns claims only (purchases/milestones/dates/status intact), pill re-shows, count named | `epic6.spec.ts` › Settings "I cancelled PS+" un-owns claimed rows and re-shows their PS+ pill; the named-invariant hazard (purchases + milestones/dates/status untouched, count named first, psPlusExtra re-set true, 0-claim no-op) pinned in `settings.test.ts` › cancel PS+ un-owns claims only… + › cancel PS+ with no claims is an inert no-op; the confirm-count flow also jsdom-pinned in `SettingsPanel.test.tsx` |
| 6.5a free-text search narrows the visible shelf by normalized (case/diacritic-insensitive) title substring; the grid is the sole result surface | `epic6.spec.ts` › shelf search narrows the visible grid by normalized title substring (accented title + plain-ASCII needle proves the fold; baseline card drops); the `matchesTitleQuery` named invariant (case/diacritic/whitespace/empty) pinned in `filters.test.ts`, live-narrowing in jsdom `Shelf.test.tsx` |
| 6.5b no shelf match → NO MATCH empty state; `＋ Add "<term>"` reachable via the pinned bar (NOT duplicated in the empty state) | `epic6.spec.ts` › a shelf search matching nothing shows NO MATCH and still offers ＋ Add (empty state carries no buttons; the pinned `search-add-option` bar opens the preview dialog); jsdom `Shelf.test.tsx` › a search matching nothing shows NO MATCH; the Add path is NOT duplicated in the empty state |
| 6.5c clearing the input restores the full visible shelf | `epic6.spec.ts` › clearing the shelf search restores the full visible shelf (baseline card returns); jsdom `Shelf.test.tsx` › narrows the visible shelf live… then restores on clear |
| 6.6a wrong auto-match corrected in the add modal: the picker overwrites the whole draft (cover/genres/date) + resets the `seeded` ref; Save persists the PICKED igdbId | `epic6.spec.ts` › add: "Not the right game?" picks a different match, overwrites the draft, and saves the picked igdbId (preview + search route-stubbed — the e2e env has no IGDB creds; the D1 assertion reads `external_link.external_id`, so a draft-only overwrite that dropped the picked id would be red); the draft-overwrite + igdbId hazard also jsdom-pinned in `AddGameDialog.test.tsx` › picking a candidate overwrites the WHOLE draft and saves its igdbId |
| 6.6b preview `available: false` → the affordance is hidden, never an always-empty picker | jsdom `AddGameDialog.test.tsx` › hides the affordance when the games DB is unavailable + › offers the affordance when the DB is up but auto-matched nothing (the e2e env is permanently credential-less, so its add tests already run this branch — `available: false` is the default there, and no picker affordance is reachable) |
| 6.6c Escape closes the stacked picker first; the add modal and its draft survive | `epic6.spec.ts` › add: "Not the right game?" … (Escape mid-test hides the picker, the dialog stays visible, then the pick proceeds); jsdom `AddGameDialog.test.tsx` › Escape closes the picker only — the add modal and its draft survive |
| 6.6d `RematchDialog` + `StragglersDialog` migrate onto the shared `<IgdbMatchPicker>`; no bespoke picker survives | no new UI flow of its own — for the two MIGRATED dialogs the safety net is `RematchDialog.test.tsx` + `StragglersDialog.test.tsx` passing UNEDITED, plus the existing e2e rows (6.2 stragglers, PV-4 rematch) still driving both pickers end to end. NB the add-modal consumer is NOT behaviour-identical to them (it stacks the picker, restores focus to its affordance, and overwrites a local draft instead of mutating) — those divergences are covered by the 6.6a–c rows, not by this one |
| Search redesign — scope rule (whole-library incl hidden with no filter; respects the filter otherwise), stated in a `search-scope` caption | `epic3-filter.spec.ts` › search scope rule … (both directions) + `epic1-shelf.spec.ts` › whole-library search … (hidden game surfaces in the grid); jsdom hazard `Shelf.test.tsx` › scope rule: no filter reveals a hidden game by name; an active filter suppresses it |
| Search redesign — Add always reachable (FF fix), single result surface (no dropdown) | `epic6.spec.ts` › searching an existing game … still offers ＋ Add (FF fix) …; jsdom `SearchBox.test.tsx` › pins an ＋ Add bar for ANY non-empty term …, › is a plain searchbox — no combobox/listbox surface |

### Discard (soft-delete tombstone, re-add revive)

Follow-up feature `spec-discard-with-readd-revive.md` (supersedes the 2026-07-10
"no discard" decision). A discarded game leaves every library surface, sync
can't re-own it, and re-adding the name revives it — no browse-list.

| AC | Coverage |
|----|----------|
| Discard from the detail panel closes it, drops the card, UNDO restores | `epic6.spec.ts` › discard: "Remove from library" … (panel hidden, card gone, Undo brings it back); flag write + shelf-hide + undo also pinned in `discard.test.ts` › hides a discarded game … |
| Re-adding a discarded game's name revives it (no duplicate row) | `epic6.spec.ts` › discard: re-adding a discarded game by name revives it (toast + detail opens + single game row); server revive path pinned in `discard.test.ts` › revives a discarded game when its name is re-added |
| Discard a name-only mistake from the stragglers dialog (unenriched only) | `epic6.spec.ts` › discard: the stragglers dialog discards … (Discard on the row → tombstone set); list/search drop pinned in `discard.test.ts` › drops a discarded name-only game … |
| Ignore an import straggler from the dialog (confirm-gated hard delete of the Notion staging row; import rows only) | `epic6.spec.ts` › stragglers: Ignore an import row is confirm-gated and hard-deletes the staging row (Cancel writes nothing, Confirm drops the row + deletes the D1 row); the endpoint/hard-delete + 404-on-stale pinned in `stragglers.test.ts` › ignores an import straggler; the Ignore-vs-Discard split + confirm gate jsdom-pinned in `StragglersDialog.test.tsx` |
| Additive PSN sync never re-owns / un-hides a discarded game | pinned in `discard.test.ts` › does NOT let additive PSN sync re-own a discarded game (owned stays false, discarded stays true after sync) — server-side, no UI flow |
| Discard on an untracked game 404s (no empty tombstone) | pinned in `discard.test.ts` › 404s a discard on a game the user does not track |

## Epic 9

Story 9.2 (trophy progress). The sync RUN needs a PSN trophy response the e2e
Worker cannot stub (same constraint as 4.2b/5.1b), so the run is pinned at the
integration tier against real workerd + D1 with the CAPTURED wire shape; e2e
drives what the persisted counts do to the UI.

| AC | Coverage |
|----|----------|
| 9.2a counts fetched through `PsnProvider` and persisted; no PSN call on render | skipped e2e — unstubbable PSN; pinned in `psn.test.ts` › fetchTrophyTitles (captured payload, pagination, bearer reuse) + `trophies.test.ts` integration › persists the counts by NAME…; the adapter seam itself in `psn-encapsulation.test.ts` (the trophy host is allowed only in the provider) |
| 9.2b % + grade derived in `core/` from the stored counts; no trophy data → NOTHING, never `0%` | `epic9-trophies.spec.ts` › a game with trophy counts shows % · grade on its card; one without shows NOTHING (a real 0-earned game asserted as `0% · D`, distinct from no data); the bands/percent/floor rows in `trophy.test.ts`, the card/detail render in jsdom `Card.test.tsx` + `DetailPanel.test.tsx` |
| 9.2b (detail) Trophies section with the tier breakdown | `epic9-trophies.spec.ts` › the detail panel carries a Trophies section with the tier breakdown, and omits it without data |
| 9.2c a trophy sync changes no play status, milestone, or lifecycle date | skipped e2e — same unstubbable-PSN constraint; the hazard is pinned in `trophies.test.ts` › persists the counts by NAME … and touches NOTHING else (every non-trophy column snapshotted across a run) |
| 9.2d expired NPSSO or a degenerate 200 → stops, writes NOTHING, existing counts survive | `epic4-settings.spec.ts` › Sync trophies from the FAB with no token configured lights the expired-token banner (Story 9.2) — it lives in THAT file, not `epic9-trophies.spec.ts`, because it mutates the same per-user `psn_auth` key as every test there and that file is serial for exactly this reason (a parallel worker's cleanup wipes the flag mid-assert); the fail-closed writes in `trophies.test.ts` › a DEGENERATE 200 (error body) writes NOTHING… + › an empty trophyTitles while totalItemCount > 0 … + › a trophy-host 401 persists psn_auth=expired…; the provider rows in `psn.test.ts` |
| 9.2e the whole run is a BOUNDED number of subrequests (no per-game fan-out): 4 `fetch` (2 exchange legs + 2 trophy pages) plus ceil(matched/50) batched D1 calls — D1 binding calls count against the Workers limit too, so the writes are chunk-batched, never one UPDATE per title | the fetch half pinned in `psn.test.ts` › paginates on nextOffset and exchanges the NPSSO ONCE; the write half in `trophies.test.ts` (unit) › batches the writes: the D1 call count is bounded, not linear in matched titles; no UI flow |
| 9.2 FAB trigger + summary readout | jsdom `Fab.test.tsx` › runs the trophy sync with a spinner, hands the result over, and repaints the shelf + › a trophy sync rejected for an expired token toasts…; the readout content in `TrophySyncModal.test.tsx` (unmatched reported, ambiguous named as needs-attention) |

## Epic 8

Only Story 8.1 (B1a, Google sign-in) is implemented — it sits outside the rest of
the epic's ordering and is single-tenant-safe. The OAuth round-trip itself is
not browser-drivable here (no credentials, no consent screen); the gate is
pinned in `test/integration/auth.test.ts` against real workerd + D1.

| AC | Coverage |
|----|----------|
| 8.1a Google is added ALONGSIDE magic link — both paths work, neither replaces the other | `auth-journey.spec.ts` › the login gate offers Google alongside the magic link (both CTAs on the same gate) + › signs in via the console-captured magic link (the magic-link journey still green end to end); the provider is only registered when both Google creds are set, pinned by `auth.test.ts` (the e2e/dev envs have none and magic link keeps working) |
| 8.1b a non-allowlisted OAuth callback is still rejected by `isAllowedEmail` — no user/account row | `auth.test.ts` › Google OAuth allowlist gate › rejects a non-allowlisted Google account — no user row, no account row + › admits the allowlisted Google account + › fails closed when the allowlist is unset + › strands a session whose user is no longer allowlisted. NOT e2e: driving it needs Google's consent screen and live credentials, which the e2e env has by design neither of; the tests hit `internalAdapter.createOAuthUser`, the exact seam better-auth's callback runs the gate through |
| 8.1c a rejected OAuth sign-in is stated plainly, not swallowed into a blank screen | jsdom `Login.test.tsx` › states the allowlist rejection rather than bouncing silently (`/?error=ACCESS_DENIED` → alert, param consumed) + › surfaces a failed OAuth start instead of a dead button — the redirect that produces the param is the server-side branch pinned in 8.1b; no e2e can produce it without Google |
| 8.1d the Google button and the magic-link form both render, on the existing token system | `auth-journey.spec.ts` › the login gate offers Google alongside the magic link; jsdom `Login.test.tsx` › offers both sign-in paths, and the Google button starts the OAuth flow (asserts `signIn.social` is called with the google provider) |
| 8.1e the Google client secret lives in a Worker secret, never in the repo | no runtime flow — enforced by config: the pair lives in `.dev.vars` / `wrangler secret put` (documented in `.dev.vars.example`), and `wrangler.jsonc` carries only a comment naming them. `grep -rn "GOOGLE_CLIENT" wrangler.jsonc` returns comments only |
