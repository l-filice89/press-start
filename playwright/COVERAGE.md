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
| 1.7d whole-library search ignoring filters/hidden states | `epic1-shelf.spec.ts` › whole-library search matches games hidden from the shelf (match visibility only — selecting a result is a known open deviation from the Epic 2 retro, not yet a shipped behavior to pin) |
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
| 3.1 search isolation (filters never leak into whole-library search) | `epic3-filter.spec.ts` › whole-library search ignores active shelf filters |
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
| 3.6a every tracking write invalidates `['shelf']` AND `['shelf-search']` | jsdom `StatusPopover.test.tsx` › a status write invalidates the shelf-search query alongside the shelf (pins the invalidation; the refetch-on-invalidate of an active query is react-query's own contract. No e2e: the listbox is read-only and closes on blur — an open-listbox-during-write flow can't be driven deterministically) |
| 3.6b stale toast UNDO cannot overwrite a newer settled write | jsdom `StatusPopover.test.tsx` › toast UNDO after a settled newer write expires and writes nothing (no reliable e2e flow: needs two writes + a live toast raced against the real Worker's response timing — same reason as 3.4e) |
| 3.6c open status-popover menu survives a refetch re-chunk; retry loop removed | jsdom `Shelf.test.tsx` › keeps the status menu open… (menu identity asserted) + › does not resurrect a status menu…; the `epic2-tracking.spec.ts` helper now opens with a plain click (retry loop deleted) — regression signal is that suite flaking again |

## Epic 4

| AC | Coverage |
|----|----------|
| 4.1a all PSN access through `PsnProvider` (persisted query, auth inside the adapter) | skipped — wire-level adapter, no UI flow; pinned in Vitest `psn.test.ts` (persisted query/pagination/headers) + `psn-encapsulation.test.ts` (auth mechanics allowed nowhere else) |
| 4.1b cookie in `SETTING`, editable from a settings surface, read fresh per call | `epic4-settings.spec.ts` › the header gear opens Settings; saving a cookie flips presence without echoing the value (fresh-per-call read pinned in Vitest `psn.test.ts`; secret-seed fallback in `settings.test.ts` integration) |
| 4.1c 401/403 surfaces refresh instructions in the attention banner, no retry | `epic4-settings.spec.ts` › an expired PSN auth state feeds the attention banner…; live wiring closed by story 4.2: › Sync from the FAB with no cookie configured lights the expired-cookie banner (the no-retry half is pinned in Vitest `psn.test.ts`; the PSN-401-during-sync → flag write in `sync.test.ts` integration) |
| 4.2a FAB drawer + Sync runs with a spinner | `epic4-settings.spec.ts` › Sync from the FAB… (drawer open/aria-expanded/one-tap recovery); spinner-while-pending pinned in jsdom `Fab.test.tsx` (the e2e missing-cookie sync resolves too fast to observe a spinner deterministically) |
| 4.2b new games created with defaults; owned flips stamp bought_on | skipped e2e — a happy-path sync needs a live PSN response the e2e Worker cannot stub; pinned in `sync.test.ts` integration (real workerd + D1, stubbed PSN) and `sync-reconcile.test.ts` unit rows |
| 4.2c append-only: never deletes, never un-owns, never touches status/milestones/dates/genres | skipped e2e — same stubbed-PSN constraint; hazard pinned in `sync.test.ts` › flips owned … touches NOTHING else + `sync-reconcile.test.ts` › additive-only plan shape |
| 4.2d claims count as owned, flagged `owned_via=membership`, no bought_on (FR-9 amended 2026-07-11) | skipped e2e — same constraint; hazard pinned in `sync.test.ts` › claims count as owned… + › buying a claimed game upgrades the source… + `sync-reconcile.test.ts`/`ownership.test.ts` unit rows |
| 4.2e matching: links first, PS4/PS5 collapse, conflicts flagged never merged | skipped e2e — same constraint; pinned in `sync-reconcile.test.ts` (link-first, collapse, conflict/ambiguity rows) + `sync.test.ts` › flags a title match carrying a different PSN id |
| 4.2f cover art + store URL persisted at sync, nothing fetched on render | skipped e2e — same constraint; pinned in `sync.test.ts` (PSN facts persisted, NULL-only backfill) |
| 4.3a summary modal after every completed sync (counts + needs-attention) | modal content/variants pinned in jsdom `SyncSummaryModal.test.tsx`; the run→modal handoff in `Fab.test.tsx` (a live completed sync needs a PSN response the e2e Worker cannot stub; the counts themselves are pinned in `sync.test.ts` integration) |
| 4.3b needs-action items seed the persistent attention banner, surviving the modal and reloads | `epic4-settings.spec.ts` › persisted sync needs-attention feeds the amber banner… (fresh-load banner + reload persistence; the sync-run→persist write and self-resolution in `sync.test.ts` integration hazards) |
| 4.3c summary offers a button jumping to the problem | `epic4-settings.spec.ts` › persisted sync needs-attention… ("Find in library" → search seeded + focused); seed mechanics also jsdom-pinned in `SearchBox.test.tsx` and `SyncSummaryModal.test.tsx` |
| ad-hoc FR-9 amendment: claimed games show a PS+ tag on the OWNED chip | `epic4-settings.spec.ts` › a game owned via PS+ claim carries the PS+ tag on its card (purchase negative asserted; chip content also jsdom-pinned in `Card.test.tsx`; the detail panel's acquisition-source line — claim/purchase/silent-NULL — jsdom-pinned in `DetailPanel.test.tsx`, same DTO field the e2e already drives) |
