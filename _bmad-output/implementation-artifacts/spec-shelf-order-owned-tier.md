---
title: 'Shelf ordering: owned before wishlisted within each state group'
type: 'feature'
created: '2026-07-09'
status: 'done'
route: 'one-shot'
---

# Shelf ordering: owned before wishlisted within each state group

## Intent

**Problem:** Default shelf sorted state → alphabetical (FR-18 as written), mixing owned (ready-to-start) games with wishlisted ones inside every group.

**Approach:** Add an ownership tier to the single `core/` comparator: state priority → owned before wishlisted → alphabetical. FR-18 and its downstream artifacts (epics, UX, spec-1-7) amended in place — Luca's product decision 2026-07-09. Tier is ownership, deliberately not `playableNow` (owned pre-orders sort first; un-owned PS+-catalog games sink). Library search stays plain alphabetical (FR-19).

## Suggested Review Order

1. [src/core/shelf.ts](../../src/core/shelf.ts) — the comparator's new tier + honest rationale comment.
2. [src/core/shelf.test.ts](../../src/core/shelf.test.ts) — tier tested in top and non-top groups, state-beats-ownership, equality + antisymmetry.
3. [src/services/shelf.ts](../../src/services/shelf.ts) — getShelf doc; searchLibrary explicitly opts out of the tiers.
4. [prd.md FR-18](../planning-artifacts/prds/prd-ps-game-catalog-2026-07-05/prd.md) / [epics.md](../planning-artifacts/epics.md) / [EXPERIENCE.md](../planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md) / [spec-1-7](spec-1-7-the-read-only-shelf.md) — FR-18 amendments (dated).
5. [deferred-work.md](deferred-work.md) — open question: does the tier apply to Epic 3 filtered views?
