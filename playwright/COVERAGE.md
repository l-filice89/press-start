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
| 4.1a all PSN access through `PsnProvider` (persisted query, auth inside the adapter) | the credentialed adapter half is REMOVED by Epic 11 story 11.2; the surviving anonymous catalog surface stays pinned in Vitest `psn.test.ts` (persisted query/pagination/headers/no-credential) + `psn-encapsulation.test.ts` (store mechanics allowed nowhere else, deleted machinery allowed nowhere at all) |
| 4.1b PSN credential token in `SETTING`, editable from a settings surface, read fresh per call (9.1b) | REMOVED by Epic 11 story 11.2 — the token setting, its PUT route and the Settings token section are deleted; the absence is pinned by `epic4-settings.spec.ts` › Settings renders NO credential surface + the `src/no-credential-code.test.ts` grep-clean guard |
| 9.1b the token field carries a “Get / refresh token” deep link to the ssocookie endpoint | REMOVED by Epic 11 story 11.2 — the token field (and its deep link) no longer exists |
| 4.1c a denied credential surfaces refresh instructions in the attention banner, no retry | REMOVED by Epic 11 story 11.2 — the expired-credential banner, its setting flag and the provider auth paths are all deleted (the live 401-during-sync wiring went earlier, with 11.1) |
| 4.2a FAB drawer + Sync runs with a spinner | REMOVED by Epic 11 story 11.1 — the credentialed library sync (route, service, FAB item) is severed; the drawer's surviving surface is pinned by › the FAB drawer offers exactly Check PS+ Extra and Export CSV |
| 4.2b new games created with defaults; owned flips stamp bought_on | REMOVED by Epic 11 story 11.1 (`sync.test.ts` deleted with the sync) |
| 4.2c append-only: never deletes, never un-owns, never touches status/milestones/dates/genres | REMOVED by Epic 11 story 11.1 (`sync.test.ts` deleted; `sync-reconcile.ts` + its unit suite followed in the post-epic sweep) |
| 4.2d claims count as owned, flagged `owned_via=membership`, no bought_on (FR-9 amended 2026-07-11) | REMOVED by Epic 11 story 11.1 — existing `owned_via` rows and the 6.4 ownership model are untouched |
| 4.2e matching: links first, PS4/PS5 collapse, conflicts flagged never merged | REMOVED by Epic 11 story 11.1 |
| 4.2f cover art + store URL persisted at sync, nothing fetched on render | REMOVED by Epic 11 story 11.1 |
| 4.3a summary modal after every completed sync (counts + needs-attention) | REMOVED by Epic 11 story 11.1 (`SyncSummaryModal` deleted with its suite) |
| 4.3b needs-action items seed the persistent attention banner, surviving the modal and reloads | REMOVED by Epic 11 story 11.1 — the `syncAttention` banner is gone (its Review action opened the deleted modal and the field never repopulates once sync is gone; story 11.2 cleans up the dead `sync_attention` rows) |
| 4.3c summary offers a button jumping to the problem | REMOVED by Epic 11 story 11.1 |
| ad-hoc FR-9 amendment: claimed games show a PS+ tag on the OWNED chip | `epic6.spec.ts` › Story 6.4 ownership source group (moved from `epic4-settings.spec.ts` by Story 9.5 — one file owns the membership rows) › a game owned via PS+ claim carries the PS+ tag on its card (purchase negative asserted; chip content also jsdom-pinned in `Card.test.tsx`; the detail panel's acquisition-source line — claim/purchase/silent-NULL — jsdom-pinned in `DetailPanel.test.tsx`, same DTO field the e2e already drives) |

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
| Additive PSN sync never re-owns / un-hides a discarded game | REMOVED by Epic 11 story 11.1 — the credentialed sync no longer exists, so nothing can re-own a tombstone; the `discard.test.ts` row went with it |
| Discard on an untracked game 404s (no empty tombstone) | pinned in `discard.test.ts` › 404s a discard on a game the user does not track |

## Epic 9

Story 9.2 (trophy progress). The sync RUN needs a PSN trophy response the e2e
Worker cannot stub (same constraint as 4.2b/5.1b), so the run is pinned at the
integration tier against real workerd + D1 with the CAPTURED wire shape; e2e
drives what the persisted counts do to the UI.

| AC | Coverage |
|----|----------|
| 9.2a counts fetched through `PsnProvider` and persisted; no PSN call on render | REMOVED by Epic 11 story 11.1 — the trophy sync (route + service + `trophies.test.ts`) is severed; the provider's trophy-list rows went with story 11.2 |
| 9.2b % + grade derived in `core/` from the stored counts; no trophy data → NOTHING, never `0%` | REMOVED by Epic 11 story 11.3 — the display (`core/trophy.ts`, the card/detail readouts, `epic9-trophies.spec.ts`) is deleted and migration 0011 drops the columns; the readout's ABSENCE is pinned by `epic2-detail.spec.ts` › detail panel opens from the cover (card-trophy + detail-trophies count 0) |
| 9.2b (detail) Trophies section with the tier breakdown | REMOVED by Epic 11 story 11.3 — same as above |
| 9.2c a trophy sync changes no play status, milestone, or lifecycle date | REMOVED by Epic 11 story 11.1 (`trophies.test.ts` deleted with the sync) |
| 9.2d expired credential or a degenerate 200 → stops, writes NOTHING, existing counts survive | REMOVED by Epic 11 story 11.1 — no trophy sync exists to fail |
| 9.2e the whole run is a BOUNDED number of subrequests (no per-game fan-out) | REMOVED by Epic 11 story 11.1 |
| 9.2 FAB trigger + summary readout | REMOVED by Epic 11 story 11.1 — the FAB item, its mutation, and `TrophySyncModal` (+ suite) are deleted; the surviving drawer surface is pinned by `epic4-settings.spec.ts` › the FAB drawer offers exactly Check PS+ Extra and Export CSV + jsdom `Fab.test.tsx` › offers exactly Check PS+ Extra and Export CSV |

Story 9.3 (one-off platinum-date backfill) — REMOVED WHOLE by Epic 11 story
11.1: the backfill route, service, Settings panel trigger, and every suite of
theirs (`backfill.test.ts`, the `SettingsPanel.test.tsx` loop rows, the
`epic4-settings.spec.ts` trigger test) are deleted. Already-recovered
`platinum_on`/`completed_on` dates are ordinary manual-milestone data and stay.

| AC | Coverage |
|----|----------|
| 9.3a–i + the Settings trigger/loop/summary | REMOVED by Epic 11 story 11.1 (see above) |

Story 9.5 (post-retro hardening sweep). One AC had a real browser flow — the
credential-token paste field, since REMOVED by Epic 11 story 11.2. The rest are
either invisible to a user (a test double, a compile-time type promise) or need
TWO concurrent PSN runs to observe, which the e2e Worker cannot produce: PSN is
unstubbable here (the same constraint 4.2b/5.1b/9.2a record), so a "concurrent"
run would have to make a real PSN call.

| AC | Coverage |
|----|----------|
| 9.5a a second PSN op is refused with a 409 + a human message; no PSN call is made; another user is never blocked | the three credentialed routes are REMOVED by Epic 11 story 11.1 (and story 11.2 trimmed `PsnOp` to `catalog-refresh` alone — the cross-op steal row became moot and was dropped); the lock survives for `catalog-refresh` and stays pinned in `psn-lock.test.ts` › two concurrent claims: exactly ONE wins + › is per USER + › refuses a second PS+ catalog op with a 409 + › a CURSOR is not a capability (genre-sweep); the UI half in jsdom `Fab.test.tsx` › a 409… toasts the SERVER message (the PS+ check path) |
| 9.5b the lock is RELEASED on every exit (success or failure) and expires if a run dies | `psn-lock.test.ts` › the PS+ refresh releases on the way out + › expires: a lock left behind by a crashed run is taken over after its TTL (re-vehicled onto `/api/ps-plus-check` when Epic 11 story 11.1 severed `/api/sync`) + › releases even when the run FAILS — a store 500 must not lock the user out + › a release only ever clears the caller's OWN lock |
| 9.5c a credential-token value carrying a codepoint above U+00FF is refused at SAVE with a 400 | REMOVED by Epic 11 story 11.2 — the token save boundary (route, schema, cookie-octet allowlist) is deleted with the credential surface it guarded |
| 9.5d a DISCARDED game's trophy title is matched and dropped SILENTLY — neither updated nor "unmatched" noise on every run | REMOVED by Epic 11 story 11.1 — the trophy sync (and `trophies.test.ts`) no longer exists |
| 9.5e the seed script's proxy driver implements `batch()`, and a driver that stops satisfying `Db` fails at COMPILE time | no runtime flow — enforced by the type system: `scripts/` is now a `tsc` project (`tsconfig.scripts.json`, referenced from `tsconfig.json`), so `bun run typecheck` is the check. Remove the batch callback from `createHttpDb` and the build fails |
| 9.5f `epic6.spec.ts` 6.4a no longer races the ownership write | `epic6.spec.ts` › owning a PS+ game prompts buy-vs-claim; "Claimed with PS+" writes owned_via=membership (6.4a) — it now awaits the owned toast (the mutation's onSuccess) before reading D1, as its "Purchased" sibling already did |

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

## Epic 7

Story 7.1 (persist the PS+ catalog as browsable data) is **ingest + schema only** —
it ships no UI: the catalog destination that renders this data lands in 7.2. So
every AC gets a coverage row instead of a Playwright test, pinned against real
workerd + local D1 with the store call stubbed from the **captured** payloads
(`test/fixtures/psn/`, probed live 2026-07-14 — every degenerate answer this
endpoint gives is an HTTP 200, and a hand-written stub would have missed all
three).

| AC | Coverage |
|----|----------|
| 7.1a every product stored with its cover + store URL, departed products pruned, and NO `game`/`game_tracking` row created for any of them | no UI flow — ingest only; the catalog destination lands in 7.2. Pinned in `psplus.test.ts` › persists the whole catalog as a snapshot (cover + store URL + ids), and creates no game row for it + › prunes a product that LEFT the catalog and cascades its genre rows away; the record mapping in `psn.test.ts` › maps the CAPTURED product record… (and › a product with no usable image stores null) |
| 7.1b the flag pass reads the STORED TABLE (not a second fetch) and `ps_plus_extra` is correct for every tracked game — owned ones included | no UI flow — ingest only; the catalog destination lands in 7.2. Pinned in `psplus.test.ts` › sets and clears flags in BOTH directions on every tracked game — OWNED ONES INCLUDED (AD-27). The `&& !owned` DISPLAY guards (card badge, filter pill, buy-vs-claim prompt) are unchanged and still pinned by their own jsdom suites |
| 7.1c a semantically-empty-but-syntactically-fine catalog (zero products, or a null grid on a 200) fails CLOSED: the snapshot and every flag survive | no UI flow — ingest only; the catalog destination lands in 7.2. Pinned in `psplus.test.ts` › treats an EMPTY 200 catalog as a provider failure — the snapshot AND every flag survive + › fails closed on a bad region / a bad category id — a 200 is not success + › an empty page at offset > 0 (totalCount 490) terminates the walk WITHOUT tripping the wipe guard (the other half of the same guard); the adapter rows in `psn.test.ts` › throws on the CAPTURED degenerate 200 for … |
| 7.1d the genre sweep sweeps the keys the RESPONSE named (never a hardcoded list), and a region carrying an extra genre loses none of it | no UI flow — ingest only; the catalog destination lands in 7.2. Pinned in `psplus-genres.test.ts` › sweeps the keys the RESPONSE named — and a key with a SLASH round-trips (MUSIC/RHYTHM) + › the CAPTURED facet lists differ by region: en-us carries MUSIC/RHYTHM, de-de does not (20 vs 19 keys); the discovery + the URL-encoded `filterBy` in `psn.test.ts` › DISCOVERS the facet keys from the response + › sends a SLASHED key inside the URL-encoded filterBy variable |
| 7.1e a sweep that fails partway resumes from its cursor without re-walking completed keys, and the membership snapshot was never invalidated | no UI flow — ingest only; the catalog destination lands in 7.2. Pinned in `psplus-genres.test.ts` › CHUNKS on a cursor and resumes after a mid-key failure — the membership snapshot stays intact + › refuses a continuation whose GENERATION has moved on (a refresh landed mid-sweep — AD-28: a stale cursor is refused, never resumed into a re-ordered catalog) |
| 7.1f a second refresh or sweep (including one with a hand-crafted cursor or a stale lock token) is refused with 409, and PlayStation is never called twice concurrently | no UI flow — ingest only; the catalog destination lands in 7.2. Pinned in `psn-lock.test.ts` › refuses a second PS+ catalog op with a 409 — and the STORE sees zero calls + › a CURSOR is not a capability: a genre-sweep continuation cannot steal a running refresh's lock + › a genre-sweep continuation that presents its OWN token renews (and ROTATES) it and proceeds + › the PS+ refresh releases on the way out; the cron half in `psplus-cron.test.ts` › SKIPS (without lighting the banner) when another PSN op holds the lock |

### Story 7.2 — Browse the catalog (a genre-filterable destination)

Every UI-facing AC ships an e2e test here (standing rule 2.5.4). The catalog
rows are seeded straight into the e2e D1 (`seedCatalog`) — the ingest that fills
them is 7.1's and needs a live PlayStation response the e2e Worker cannot
produce; it is pinned at the integration tier.

| AC | Coverage |
|----|----------|
| 7.2a switching destinations with the header toggle changes the URL, swaps the destination, and a live search term does NOT follow across | `epic7-catalog.spec.ts` › the header toggle switches destinations, and a live search term does NOT follow you across; the toggle's a11y (real links + `aria-current`, arrow traversal, SHELF stays current on `/game/:id`) in jsdom `Header.test.tsx` › Header destination toggle — including › a term typed moments before the switch does not land on the next destination, the review's H1 case (a switch INSIDE the 200 ms debounce window), whose probe asserts path **and query** exactly |
| 7.2b the grid is paged (never a 490-card DOM) and ordered A–Z with no ownership or state tier | `epic7-catalog.spec.ts` › the catalog is ordered A–Z with no ownership or state tier (an OWNED game seeded with the LAST title stays last). Paging is a 60-row server page + a `Load more` / sentinel; the ordering function itself is `core/shelf.ts` `compareTitle`, unit-pinned by the shelf-order suite |
| 7.2c genre filter narrows the grid on the PS-store facet KEYS (never IGDB genres) | `epic7-catalog.spec.ts` › the genre filter narrows the grid (PS-store facet keys, OR within the group) — asserts the URL carries `genre=HORROR`, the key, never the rendered label; the label derivation in jsdom `Catalog.test.tsx` › genreLabel |
| 7.2d catalog search narrows the grid; a miss is NO MATCH and there is never an ＋ Add row | `epic7-catalog.spec.ts` › the catalog search narrows the grid — and never offers an ＋ Add row; the shelf-only Add bar also pinned in jsdom `SearchBox.test.tsx` › never shows the ＋ Add bar on the catalog destination |
| 7.2e three card states: not tracked → ＋ Add + Claim now; tracked-unowned → In library + Claim now (still live); owned → Owned, no actions — and never a status pill or owned toggle | `epic7-catalog.spec.ts` › an owned catalog game shows Owned and NO actions; a tracked-unowned one shows In library AND Claim now (also asserts the game-specific accessible names and that `Claim now` opens a new tab) |
| 7.2f a `/game/:id` deep link resolves through the by-id read route on a COLD load; a resolved miss is not-found | `epic7-catalog.spec.ts` › a /game/:id deep link resolves on a COLD load (no `['shelf']` cache exists on a cold tab — this is the test that catches a list-cache lookup) + › an unknown /game/:id is a RESOLVED not-found IN the detail dialog, not a crash + › Close on a COLD deep link lands on the shelf, even after a keystroke (review H3: a `{replace: true}` `?q=` write mints a fresh history key, so Close must not infer "opened from inside" from it). jsdom `Shelf.test.tsx` covers the in-flight and non-404 branches: › an in-flight /game/:id renders loading — never not-found + › a non-404 failure on /game/:id is an alert, not not-found |
| 7.2j an unknown URL is a not-found destination, never the shelf rendered at the wrong address | `epic7-catalog.spec.ts` › an unknown URL is a not-found destination, not the shelf (review M10) |
| 7.2k the browse read is paged deterministically, folds non-ASCII titles, bounds the `genre` param, and counts facets against the snapshot | integration `psplus-browse.test.ts` (review M1/M2/M4/M6/M7): › pages a total order — base-equal titles never duplicate or vanish across the boundary + › finds a non-ASCII title + › refuses an over-long genre list with a 400 + › an EMPTY ?genre= is no filter at all + › counts only tags whose product is still IN the snapshot + › never joins on an EMPTY normalized title + › marks a tracked non-ASCII game In library through the shared normalizer. The torn-snapshot reset (M3) is jsdom `Catalog.test.tsx` › restarts paging when a later page comes from a new generation |
| 7.2g the three CustomEvents are gone — the search box and the add dialog route their intent | `grep -rn "dispatchEvent" web/` returns no cross-tree intent event (only `test-setup.ts`'s `matchMedia` stub). Routed behavior pinned in jsdom `Shelf.test.tsx` › a shelf mounting with ?q= already set starts filtered (mount-race regression), `SearchBox.test.tsx` › writes the settled term to ?q= …, `SyncSummaryModal.test.tsx` › "Find in library" closes the modal and routes to the shelf with the term |
| 7.2h EMPTY CATALOG offers Check PS+ Extra; a FAILED refresh keeps the stale grid under the attention banner — never a blank grid | `epic7-catalog.spec.ts` › catalog empty + stale states › a region with an EMPTY snapshot offers Check PS+ Extra + › a FAILED refresh shows the attention banner AND the stale grid |
| 7.2i NO REGION points into Settings | **NOT e2e-able**: `wrangler.jsonc`'s `env.e2e` sets `PSN_REGION`, and `getPsnRegion` falls back to it *and persists it*, so "no region" is unreachable in the e2e environment by construction (unsetting the var would change the Worker config the story is forbidden to touch). Pinned in jsdom `Catalog.test.tsx` › NO REGION — the catalog is per-region, so it points into Settings, driving the same `region: null` payload the API returns |

### Story 7.3 — Add, or claim, a game from the catalog

| AC | Coverage |
|----|----------|
| 7.3a an untracked catalog game adds through Epic 6's preview (pre-filled), saves as NOT owned, and lands on `/game/:id` | `epic7-catalog.spec.ts` › add from the catalog: the Epic 6 preview opens, Save lands on /game/:id, and the card flips to In library with Claim now still offered. What the save WRITES is asserted on rows, not pixels, in integration `games.test.ts` › add a game FROM THE CATALOG › writes the not-owned default + a PSN_PRODUCT link (never owned_via/bought_on) |
| 7.3b an already-tracked catalog game offers no Add — `Claim now` stays while it is unowned and disappears once owned | `epic7-catalog.spec.ts` › an owned catalog game shows Owned and NO actions; a tracked-unowned one shows In library AND Claim now (7.2's three-state test, unchanged — 7.3 only wires the actions those states already declared) |
| 7.3c `Claim now` deep-links to the regional PS Store product page in a new tab, and the app writes nothing | `epic7-catalog.spec.ts` › Claim now targets the regional PS Store product page in a new tab — and the app writes nothing. The link is asserted (`href` / `target=_blank` / `rel=noopener noreferrer`) and deliberately **never followed**: navigating the suite to `store.playstation.com` would make it depend on Sony's uptime and geo-redirects |
| 7.3d adding a catalog game whose PSN `np_title_id` is already synced matches the existing game — no duplicate; the `product_id` lives in `PSN_PRODUCT`, never `PSN` | **NOT e2e-able**: the hazard is invisible in the UI. Both the correct behavior (one card, one game) and the broken one (a duplicate `game` row from AD-18's clash rule) render as an `In library` card — only the `external_link` rows tell them apart, and there is no UI that shows them. Integration `games.test.ts` › HAZARD AD-20: an already-SYNCED game (PSN np_title_id linked) added from the catalog matches — no duplicate, which asserts on the link rows and the game-row COUNT |
| 7.3e a previously DISCARDED game is revived by the catalog add, never duplicated | **NOT e2e-able** for the same reason: a revived tombstone and a fresh duplicate look identical on the shelf. Integration `games.test.ts` › HAZARD: a DISCARDED game added from the catalog is REVIVED, never duplicated (asserts `discarded = false` on the ORIGINAL row + a single `game` row) |
| 7.3f a product pruned from the catalog between render and Save writes no dangling reference | **NOT e2e-able**: it needs the catalog table to change *between* the card render and the POST — a race the e2e tier can only fake by reaching into D1 mid-test, which tests the fake, not the app. Integration `games.test.ts` › a product PRUNED from the catalog since render adds on the title alone (the game is created; no `PSN_PRODUCT` link and no store URL are written). The *facts* die with the row; the **identity does not** — review H2: gating the `PSN_PRODUCT` link LOOKUP on the row still existing made a re-add of a pruned product with a diverged title insert a second game row (a dangling duplicate, the exact thing the row above claimed not to create). Pinned by `games.test.ts` › HAZARD AD-20: a PRUNED catalog row still resolves the PSN_PRODUCT link — a diverged title does NOT duplicate |
| 7.3h the `In library` / `Owned` marker survives a title the add re-seeded from IGDB | **NOT e2e-able**: e2e has no IGDB creds, so the preview takes its name-only path and the stored title equals the catalog name *by construction* — the divergence the marker has to survive cannot occur there (the e2e spec's header says so). Integration `psplus-browse.test.ts` › marks a game In library through the PSN_PRODUCT LINK when the stored title DIVERGED from the catalog name |
| 7.3i a catalog add is never an owned add (no `owned_via: 'purchase'` on a PS+ title) | jsdom `AddGameDialog.test.tsx` › offers NO owned toggle when opened from a store product, and saves not-owned (the UI layer), plus integration `games.test.ts` › REFUSES owned:true on an add that carries a psnProductId (the server layer — the UI is not a control) |
| 7.3j the catalog `np_title_id` is anchored as an `EXTERNAL_LINK('PSN', …)` so later adds converge instead of duplicating | Integration `games.test.ts` › HAZARD H1: a PSN-linked owned game whose stored title diverges is not duplicated by a catalog add, plus › HAZARD AD-20 (the anchor write side). Epic 11 deleted the library sync (and `planSync` with it, in the post-epic sweep); the anchor stays live because the catalog add itself both writes and reads the link |
| 7.3g a real PS+ claim flips the card to `Owned` | **NOT OBSERVABLE BY THE APP — not testable at any tier, by design.** `Claim now` opens Sony's store in a tab the app cannot see: there is no callback, no postMessage, no response. The app therefore never infers that a claim succeeded (clicking writes *nothing*, pinned by 7.3c). Ownership flips only when a **library sync observes the real entitlement** and sets `owned: true, owned_via: 'membership'` — that path is **Story 6.4's**, tested there, including the un-claim on subscription cancel |
| 7.x after a successful PS+ check the client drives the genre sweep to completion (the "do it now" loop) and the genre chips appear | **NOT e2e-able**: each chunk fans out live PS-store facet queries the e2e Worker cannot stub (same constraint as 4.2b/5.1b). The loop's protocol — first chunk carries only `generation`, every continuation hands back the previous chunk's `cursor` AND `lockToken`, stop on null, hard cap against a never-terminating cursor — is pinned in jsdom `web/catalog/api.test.ts`; the server side of the same contract in integration `psplus-genres` suites (7.1) |

## Epic 11

Story 11.1 (sever the credentialed PSN operations). A pure-removal story: the
three credentialed routes (`POST /api/sync`, `/api/sync/trophies`,
`/api/backfill/platinum-dates`), their services, and every UI entry point are
deleted. The rows above marked "REMOVED by Epic 11 story 11.1" record what went.

| AC | Coverage |
|----|----------|
| 11.1a the FAB drawer offers only "Check PS+ Extra" and "Export CSV" — no sync/trophy control exists | `epic4-settings.spec.ts` › the FAB drawer offers exactly Check PS+ Extra and Export CSV — no credentialed sync control exists (item count pinned at 2, both severed testids at 0); the same surface jsdom-pinned in `Fab.test.tsx` › offers exactly Check PS+ Extra and Export CSV |
| 11.1b the three severed routes answer 404 (hazard: credentialed routes no longer exist) | skipped e2e — no UI path can reach them anymore, which is the point; pinned as an AUTHENTICATED request through the real Worker in integration `severed-routes.test.ts` › POST … answers 404 (all three routes) |
| 11.1c the anonymous PS+ catalog check, monthly cron, and CSV export pass unmodified | their existing suites are untouched and still green: `epic5-psplus.spec.ts`, `epic7-catalog.spec.ts`, `psplus*.test.ts` integration, `export.test.ts`, `epic6.spec.ts` › Export CSV |
| 11.1d zero references to the severed service functions (library sync, trophy sync, platinum backfill) outside git history | no runtime flow — verified by grep over `src`/`web`/`test`/`playwright` (typecheck/lint/vitest/playwright all green) |

Story 11.2 (strip PSN credential auth from the provider and settings). The
provider collapses to its anonymous catalog methods; the token setting, its
PUT route, the Settings token section, the expired-credential banner and the
env plumbing are deleted; migration 0010 clears the dead rows. Rows above
marked "REMOVED by Epic 11 story 11.2" record what went.

| AC | Coverage |
|----|----------|
| 11.2a zero credentialed identifiers in `src/`, `web/`, `test/`, `playwright/` (grep-clean, pinned) | no UI flow — pinned permanently by the Vitest guard `src/no-credential-code.test.ts` (walks all four dirs, one identifier list, fails red on any reappearance) + `psn-encapsulation.test.ts` (deleted wire machinery allowed nowhere) |
| 11.2b the settings page has no token field and no expired-credential banner; region-save feedback still announced via `role="status"` | `epic4-settings.spec.ts` › Settings renders NO credential surface (exact section-heading list + zero token text + zero banner) + › Settings names the PSN region, saves a normalized locale, and ANNOUNCES the save (the relocated live region); jsdom halves in `SettingsPanel.test.tsx` |
| 11.2c migration 0010 deletes the dead setting rows + stale retired-op lock rows, survivors intact | no UI flow — pinned in integration `migration-0010.test.ts` › deletes the dead rows and ONLY the dead rows (seeded dead + survivor rows, two-sided assert) |
| 11.2d catalog cron, PS+ check and genre sweep run unchanged under the `catalog-refresh` lock | their suites are re-pointed and green: `psn-lock.test.ts` (all hazards on `catalog-refresh`), `psplus-cron.test.ts` (foreign-lock skip now a concurrent refresh token), `psplus*.test.ts`, `epic5-psplus.spec.ts`, `epic7-catalog.spec.ts` |
| 11.2e `GET /api/settings` carries no credential fields and the SPA renders settings without error | integration `settings.test.ts` › captures at first login… (exact full-payload assert, credential fields gone); the SPA render is every settings-driven e2e above |

Story 11.3 (remove the trophy display and schema). The trophy readout
(card + detail), `core/trophy.ts`, the DTO/zod chain, the orphaned repository
functions and the 11 `trophy_*` columns are deleted; `epic9-trophies.spec.ts`
went with them. Rows above marked "REMOVED by Epic 11 story 11.3" record what
went.

| AC | Coverage |
|----|----------|
| 11.3a no trophy %/grade/tier readout renders on the card or in detail | `epic2-detail.spec.ts` › detail panel opens from the cover (`card-trophy` and `detail-trophies` both count 0 in the live app); jsdom absence pinned in `Card.test.tsx` and `DetailPanel.test.tsx` |
| 11.3b migration 0011 drops every `trophy_*` column while `platinum_on`/`completed_on`/`owned_via`/`bought_on` survive with values byte-identical | no UI flow — pinned in integration `migration-0011.test.ts` › drops every trophy_* column and ONLY those (PRAGMA + seeded-row two-sided assert) |
| 11.3c the manual platinum/story-completion milestone flow records and displays exactly as before | Epic 2 suites untouched and green: `epic2-tracking.spec.ts` › milestones are confirm-gated + › platinum clears the play status; the platinum badge stays pinned by `Card.test.tsx` › platinum-trophy |

## Epic 10

Story 10.1 (critic & user scores on every game, VR-5). Scores are stored
IGDB facts (four columns on `game`) rendered from the shelf payload; the
refresh is a cron job with no UI trigger.

| AC | Coverage |
|----|----------|
| 10.1a the four score fields ride the SAME `/games` call — no second adapter, no new credentials | no UI flow — pinned at the wire in `src/providers/igdb.test.ts` › requests the four score fields on the SAME games call + captured-payload mapping asserts (`fetchScoresByIds`) |
| 10.1b coverage verified against the real library first, result recorded | no UI flow — live probe artifact `_bmad-output/implementation-artifacts/igdb-score-coverage-2026-07-16.md` (96.9% either-score, gate PASS, OpenCritic not built) |
| 10.1c card and detail show critic + user scores from stored data, sample counts available | `epic10-scores.spec.ts` › a scored game shows rounded critic + user scores on its card + › the detail view shows both scores WITH their sample counts; jsdom halves in `Card.test.tsx` and `DetailPanel.test.tsx` |
| 10.1d a game with no IGDB score renders NO score area — never a zero or placeholder (compaction 2026-07-16: the block is ABSENT, not blank; uniform card height held at the strip level) | `epic10-scores.spec.ts` › an unscored game renders NO score + › a critic-only game shows the critic slot alone + › cards keep a uniform height; jsdom compaction asserts in `Card.test.tsx`; null-slot/absent-section asserts in `DetailPanel.test.tsx` |
| 10.1e scheduled refresh updates stored scores within the free-tier budget (batched by id, one shared cron) | no UI flow — integration `scores.test.ts` (happy path, partial reply, degenerate `[]` keeps scores, stale gate) + provider batch assert (2 ids → ONE subrequest); budget arithmetic in `src/services/scores.ts` |
| 10.1f a failed refresh surfaces on next app open (FR-40 banner), stale scores never silently pass | integration `scores.test.ts` › a provider throw persists the FR-40 failure flag + `settings.test.ts` full-payload assert (`scoresRefreshFailed`); banner render is the same `AttentionBanner` seam pinned by the Epic 5 rows above — no dedicated e2e (no UI path can force a cron failure) |

Story 10.2 ("Leaving PS+ Extra soon", VR-6). Sony publishes no departure
dates, so this shipped as the observable "LEFT PS+" warning — stamped by the
existing flag pass, rendered from the stored `ps_plus_left_on` fact.

| AC | Coverage |
|----|----------|
| 10.2a the previous snapshot is retained long enough to diff (present-before, absent-now = left) | no UI flow — the game-level flag transition IS the diff; pinned in integration `psplus-departure.test.ts` › stamps ps_plus_left_on and clears the flag (two-run) |
| 10.2b a tracked, non-owned departed game carries a warning visually distinct from the PS+ pill | `epic10-left-psplus.spec.ts` › an un-owned departed game shows the amber LEFT PS+ warning (distinct class + amber token); jsdom pins in `Card.test.tsx` incl. the contradictory-row belt (membership wins — the two pills can never co-render) |
| 10.2c the warning never guesses — grounded in observed departure, ships as "left" not "leaving soon" | not test-pinned (honest): no automated check forbids a future predictive path — the only write site is the observed flag transition (the 10.2a pin), the pill copy is "LEFT PS+"/"as of", and the store payload carries no departure-date field to predict from. Re-audit if any ingest change surfaces an end date |
| 10.2d the departed game's PS+ pill clears and it stops counting Playable-now | pre-existing both-directions discipline, still pinned by `psplus.test.ts` flag-pass rows + `derived-state.test.ts`; exclusivity (warning ⇒ no pill) asserted in `Card.test.tsx` |
| 10.2e no warning on owned games | `epic10-left-psplus.spec.ts` › an OWNED departed game shows no warning + `Card.test.tsx` › never warns on an owned game; the FACT still stamps (integration › an OWNED game departing carries the fact) |
| 10.2f DW-13: first_seen_at semantics decided + documented; a returning game never misreads | no UI flow — integration `psplus-departure.test.ts` › DW-13 HAZARD (return NULLs the stamp); decision documented at `src/repositories/psplus-catalog.ts` upsert comment |

Story 10.3 (time to beat — the story, and 100%, VR-8). IGDB's
`/game_time_to_beats` (seconds, by game_id) rides the SAME scheduled pass as
the 10.1 score refresh; HLTB was never built (coverage gate passed at 93.8%).

| AC | Coverage |
|----|----------|
| 10.3a fetched from IGDB by stored id, no fuzzy matching, no new adapter/credentials/cron | no UI flow — provider wire pins in `src/providers/igdb.test.ts` › fetchTimeToBeatByIds (by-game_id body, one subrequest, captured fixture); same-pass persistence in integration `scores.test.ts` |
| 10.3b coverage verified against real titles first, recorded next to the 10.1 finding | no UI flow — `_bmad-output/implementation-artifacts/igdb-ttb-coverage-2026-07-16.md` (93.8% story, gate PASS, HLTB not built) |
| 10.3c both numbers on card + detail, story vs 100% unmistakable, count available (2026-07-16: card facts stacked as three lines — reviews / story / 100%, all visible) | `epic10-scores.spec.ts` › time-to-beat hours show on card and detail (3-line pin); jsdom stacked-lines pin in `Card.test.tsx`, labels in `DetailPanel.test.tsx` |
| 10.3d a missing value is absent — never zero, never the completionist figure standing in | `epic10-scores.spec.ts` › a story-only figure renders alone; jsdom one-value + <1h pins; integration › one-value-only persists null |
| 10.3e refreshed in the same scheduled pass — one cron, one walk | no UI flow — integration `scores.test.ts` › persists story/100%/count in the same refresh (+ degenerate-[]-keeps-hours, TTB-throw-fails-closed, partial-reply-keeps-hours); budget ledger in `src/services/scores.ts` |
| 10.3f a failed refresh surfaces (FR-40) | same banner chain as 10.1f (one flag for the whole pass): integration TTB degenerate/throw rows above + `AppShell.test.tsx` banner pins |

Story 10.5 (scores in the add-game modal, color-graded everywhere, VR-5
follow-on). Candidate scores were ALREADY on the wire (10.1); this story
renders them in the one shared picker and grades every rendered score:
rounded ≤60 red / 61–74 amber / ≥75 green, presentation-only.

| AC | Coverage |
| --- | --- |
| 10.5a add/rematch/straggler candidate rows show critic + user scores from the response — no new fetch, no TTB (review widened: the add PREVIEW pane shows the active candidate's scores too — the decision screen on the primary path) | `epic10-scores.spec.ts` › add-modal candidate rows show graded scores (route-stubbed search, per the 6.6 precedent — e2e carries no IGDB creds; also pins the preview badges after a pick); jsdom row + preview renders in `AddGameDialog.test.tsx`; per-caller pins that rematch/straggler keep using the shared picker in `RematchDialog.test.tsx`/`StragglersDialog.test.tsx` |
| 10.5b every rendered score is color-graded with AA contrast, number always present, sr-only unchanged | `epic10-scores.spec.ts` › scores are color-graded on card AND detail (computed-color asserts — pins the cascade, incl. the detail-panel override hazard); bucket boundaries in `score-grade.test.ts` (60/61/74/75 + round-then-grade); class + sr-only pins in `Card.test.tsx`/`DetailPanel.test.tsx` |
| 10.5c no score → slot absent, never a zero or gray pill | `epic10-scores.spec.ts` › …an unscored candidate has no slot (same test); jsdom absent-slot asserts in `AddGameDialog.test.tsx`; card/detail absence already pinned by 10.1d rows |
