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
