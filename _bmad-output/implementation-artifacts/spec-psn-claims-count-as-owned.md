---
title: 'Ad-hoc: PS+ claims count as owned, flagged by acquisition source (FR-9 amended)'
type: 'feature'
created: '2026-07-11'
status: 'done'
baseline_revision: '78cb960'
review_loop_iteration: 0
followup_review_recommended: false
warnings: []
---

## Intent

**Problem:** Sync (4.2) skipped PS+ membership claims per FR-9 ("availability is not ownership") — but a claimed game IS playable, and hiding it contradicts what the shelf is for. Product decision (Luca, 2026-07-11): claims count as owned; a flag differentiates them from purchases so a future subscription-cancel flow can un-own claims without touching bought games. Seed follows the same logic (it already imported claims as owned — now it stamps the source too).

## What changed

- **Migration 0004:** `game_tracking.owned_via TEXT` (`purchase` | `membership`, NULL = legacy).
- **`core/ownership.ts`:** `applyOwnershipChange` gains `via` (default `purchase`). Membership owns never stamp `bought_on` (the slot belongs to a real purchase); un-own clears `owned_via`; purchase-over-claim upgrades the source and stamps `bought_on` write-once. One write-side owner preserved (AR-13).
- **`core/sync-reconcile.ts`:** claims are planned like purchases, marked `viaMembership` per group (a purchase anywhere in a PS4/PS5 group outranks its claims). `skippedMembership` replaced by `skippedWebApps` — WEBMAF web-app entitlements (IGN etc.) are now excluded from sync too (seed parity; 4.2 gap — they'd have synced as games).
- **`services/sync.ts`:** creates/flips carry the source; claim rows get `owned_via='membership'`, no `bought_on`; new `upgraded` result bucket for claim→purchase transitions.
- **`services/seed-import.ts`:** seed stamps `owned_via` from its claim marker — prod seed will land correctly.
- **UI:** summary modal tags claimed titles with `PS+`; "Purchased (was a PS+ claim)" group for upgrades; "membership entries skipped" line removed.
- **Docs amended:** PRD addendum (dated reversal + rationale), project-context.md, epic-4-context.md, COVERAGE.md 4.2d.

## Hazard tests

- claims flip owned WITHOUT `bought_on`, `owned_via='membership'`, user play-state byte-identical (`sync.test.ts`)
- purchase upgrade flips the source + stamps `bought_on` — cancel flow must spare purchases (`sync.test.ts`, `ownership.test.ts`)
- claims ALWAYS carry `viaMembership` through the plan (`sync-reconcile.test.ts`)
- WEBMAF entitlements skipped (`sync-reconcile.test.ts`)

## Verification

`bun run typecheck` / `lint` clean; `bun run test` 1030/1030; `bun run test:e2e` 53/53.

## Residual

- Subscription-cancel un-own flow not built — `owned_via` enables it (deferred-work entry).
- Legacy dev-DB rows have `owned_via = NULL` (pre-flag); prod seed stamps correctly. A backfill for dev is not worth writing.
