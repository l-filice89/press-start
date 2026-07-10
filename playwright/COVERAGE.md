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
| 1.5h prefers-reduced-motion | skipped — flip/glow surfaces land in Epic 2; revisit in 2.5.3 |
| 1.5i always-on focus outline | `epic1-shelf.spec.ts` › keyboard-focused card shows a focus outline (keyboard modality; mouse-focus outline behavior not separately pinned) |
| 1.7a card content (cover/title/pill/owned/flags; genres desktop-only) | `epic1-shelf.spec.ts` › shelf renders card content (title/state/OWNED/cover-fallback/PS+ flag; release + milestone flags jsdom-pinned in `Card.test.tsx`); genres delta in `epic1-responsive.spec.ts` |
| 1.7b default visible set + ordering (state → owned → alpha) | `epic1-shelf.spec.ts` › default shelf hides finished states and orders by state → owned → alpha |
| 1.7c progressive render / infinite scroll | `epic1-shelf.spec.ts` › infinite scroll reveals the next page (first fold = PAGE_SIZE + one growth event; full-set exhaustion exercised by loadAllPages in the ordering test) |
| 1.7d whole-library search ignoring filters/hidden states | `epic1-shelf.spec.ts` › whole-library search matches games hidden from the shelf (match visibility only — selecting a result is a known open deviation from the Epic 2 retro, not yet a shipped behavior to pin) |
| 1.7e skeleton first load + INSERT GAMES empty state | `epic1-shelf.spec.ts` › first load shows skeletons; › empty library shows INSERT GAMES |
| 1.7f covers from persisted data, no third-party fetch on render | skipped — architecture NFR, unverified in e2e (no fixture seeds a cover_url; networkErrorMonitor only catches 4xx/5xx, not successful third-party fetches) |
| 1.7g focusable grid with arrow traversal in reading order | `epic1-shelf.spec.ts` › shelf grid supports arrow traversal in reading order |

## Epic 2

Pending story 2.5.3.
