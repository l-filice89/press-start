# Epic 2.5 Context: Playwright Foundation — Trust Every Click

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Close the verification gap named in the Epic 2 retro: all UI testing so far runs in jsdom, which cannot exercise popover anchoring, portal layering, breakpoints, hit areas, or focus traps. This epic stands up a Playwright e2e tier that drives the real app in a real browser (real Worker + local D1, magic-link auth via a console-captured link, zero real emails), backfills one e2e test per Epic 1+2 acceptance criterion that has a UI flow, and wires a standing rule into the dev automation so every future UI-facing AC ships with a Playwright test. Must complete before Epic 3.

## Stories

- Story 2.5.1: Playwright framework & auth smoke test
- Story 2.5.2: Backfill Epic 1 e2e flows
- Story 2.5.3: Backfill Epic 2 e2e flows
- Story 2.5.4: Standing rule — every UI AC ships with a Playwright test

## Requirements & Constraints

- The e2e tier runs the real stack: real Worker + local D1, real browser — not jsdom, not mocks of the app.
- Auth in tests: sign in via the magic link captured from the console email provider's output. No test run ever sends a real email.
- Test data: a seeded local D1 fixture, deterministic and resettable between runs.
- One documented command runs the suite from a fresh clone; the same `package.json` script is used locally and in CI.
- CI gate: the Playwright suite runs on every push/PR as a required check alongside the existing Biome / `tsc` / Vitest gates.
- Backfill scope: every Epic 1+2 AC with a matching UI user flow gets a test. ACs with no UI flow (build/CI/schema/seed-script) or unreachable today (e.g. flows needing Epic 3 reveal pills) are listed as skipped with a one-line reason in a coverage note — never silently dropped.
- Real-layout coverage: at least one phone + desktop viewport pair exercises responsive deltas and hit areas.
- Standing rule: a persistent fact in `_bmad/custom/bmad-dev-auto.toml` (same mechanism as the existing hazard-test rule) stating every AC with a matching UI flow ships with a Playwright test; it must load and bind the dev agent on the next `bmad-dev-auto` session.

## Technical Decisions

- Platform: one Cloudflare Worker (workerd) serving the React SPA via Static Assets and the Hono JSON API, backed by D1 (SQLite). Playwright must start/target this real local stack.
- Existing test tiers stay: Vitest + `@cloudflare/vitest-pool-workers` for Worker+D1, pure-core unit tests without runtime. Playwright is an additional tier, not a replacement.
- Auth is better-auth magic link; every tracking query is user-scoped, so tests must run as a signed-in user — hence the console-link auth path is the foundation for the whole suite.
- CI/CD is trunk-based: quality gates on every push/PR, migrations then deploy on merge to `main`. The Playwright gate joins the push/PR stage.
- Tooling pins already in force: TypeScript throughout, Biome v2 for lint+format, Drizzle for schema/migrations (seed fixture should reuse the shared Drizzle schema). Local D1 file is never committed.

## UX & Interaction Patterns

Behaviors the backfill tests must pin (these are the jsdom blind spots):

- Dialog surfaces (status popover, milestone confirm modal, detail panel): focus trap, Escape closes, focus returns to the originating control; popover flips above/below to stay on-screen.
- Status popover: 5 play statuses change instantly (no confirm); the 2 milestone rows are confirm-gated; milestone badge persists on the card.
- Reversible risky actions (mark Dropped, un-own) surface an UNDO toast (~3s auto-dismiss).
- Card flip → detail panel: centered ~760px on desktop, full-screen on mobile; lifecycle dates editable only here; completion invariant refusals happen at this edit boundary.
- Shelf: default visible set hides Completed/Platinum/Dropped; ordering Playing → Paused → Up next → Not started, alpha within; infinite scroll; whole-library search; skeleton loader and empty states (`NO MATCH`, `INSERT GAMES`).
- Keyboard: focusable shelf grid with arrow traversal in reading order; always-on distinct focus outline; login gate before any shelf content.
- Responsive deltas per viewport: phone (2-up cards, compact header, full-screen detail) vs desktop (dense grid, full header); touch targets ≥ 44×44 regardless of visual size.

## Cross-Story Dependencies

- 2.5.1 (framework + console-link auth + seeded fixture + CI gate) blocks 2.5.2 and 2.5.3 — every backfill test rides its auth and fixture path.
- 2.5.2 covers Epic 1 stories 1.3 (auth), 1.5 (shell), 1.7 (shelf); 2.5.3 covers Epic 2 stories 2.1–2.5.
- 2.5.4 binds all future epics via `bmad-dev-auto`; the whole epic gates the start of Epic 3.
- Some Epic 2 ACs need Epic 3 reveal pills to be reachable — skip with reason now; Epic 3 picks them up under the standing rule.
