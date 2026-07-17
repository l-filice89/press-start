---
title: 'Story 8.5: Backfill legacy owned_via rows (B6)'
type: 'chore'
created: '2026-07-17'
status: 'done'
baseline_revision: '3f14cf9'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** `game_tracking` rows written before the FR-9 amendment (2026-07-11) carry `owned_via = NULL` on owned rows — the acquisition source is ambiguous on exactly the oldest data.

**Approach:** Migration 0018, resolution by construction: pre-FR-9, AD-10's ingest boundary EXCLUDED membership-sourced PS entries wholesale ("never create a game, never set Owned"), so every legacy `owned = 1, owned_via IS NULL` row is provably `purchase` — no PSN call needed (and none is possible post-Epic 11). The ruling and its reasoning are recorded in the migration itself and in a `meta` row (`owned_via_backfill`), satisfying the AC's "the choice is recorded". Un-owned rows keep NULL (`owned_via` is meaningless without `owned`).

## Boundaries & Constraints

**Always:**
- One UPDATE: `SET owned_via = 'purchase' WHERE owned = 1 AND owned_via IS NULL`. Zero other columns touched (AR-10: no status/milestones/dates).
- The decision record: a `meta` row keyed `owned_via_backfill` naming the rule and date; the migration carries the AD-10 reasoning as comments.
- Hazard test (HAZARD-TEST rule): seed a legacy-shape row (+ an un-owned NULL row + a membership row), apply, assert exactly the owned-NULL row flips to `purchase`, the others untouched, and user-entered fields byte-identical.

**Block If:** any code path still WRITES `owned_via = NULL` on an owned row (the backfill would rot immediately) — verify before shipping.

**Never:** no schema change, no service/UI code, no touching un-owned rows.

</intent-contract>

## Code Map

- `migrations/0018_*.sql` -- the UPDATE + meta record.
- `src/services/tracking.ts` / `games.ts` / `seed-import.ts` -- verify (read-only) that no current writer produces owned-with-NULL-via.
- `test/integration/repositories.test.ts` (or a small new file) -- the hazard test.

## Tasks & Acceptance

**Execution:**
- [x] Verify no live writer produces `owned = 1, owned_via = NULL`.
- [x] Migration 0018 (UPDATE + meta row + reasoning comments).
- [x] Hazard test.

**Acceptance Criteria:**
- Given a pre-FR-9 owned row, when 0018 runs, then it reads `purchase` and nothing else about it changed.
- Given un-owned or membership rows, when 0018 runs, then they are untouched.
- Given the decision, when anyone asks later, then `meta.owned_via_backfill` + the migration text answer it.

## Spec Change Log

## Review Triage Log

### 2026-07-17 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 2, medium 3, low 3)
- defer: 0
- reject: 1
- addressed_findings:
  - `[high]` `[patch]` **"Provably a purchase" had a git-history counterexample**: commit 558afe7 (2026-07-08) made the SEED import claims as Owned three days before `owned_via` existed — AD-10's proof covers only the sync path. Migration + meta record rescoped honestly: sync rows proven; seed-window and pre-FR-9 manual owns get `purchase` by consistency with the live defaults, with the detail view named as the correction path for a mislabeled claim.
  - `[high]` `[patch]` **The hazard test failed standalone** (freeloaded on a sibling describe's migrations) AND exercised a hand-copied UPDATE, not the migration file. Rewritten as `migration-0018.test.ts` on the migration-0010 slice pattern: DB to 0017, seed legacy shapes, apply THE file, assert.
  - `[medium]` `[patch]` Full-row byte-identical assertion (whole-table snapshot diff, AR-10 honored literally); tombstone (`discarded=1`) legacy row seeded and pinned as backfilled; `0018_snapshot.json` staged (was untracked — the next `db:generate` would have forked the chain).
  - `[low]` `[patch]` Journal `when` set to a real timestamp; meta assertion strengthened beyond `toContain('purchase')`; migration comment carries the tombstone ruling.
  - Rejected (1): `INSERT OR REPLACE` on the fresh meta key (deliberate; the key is new and re-runs are journal-gated).

## Verification

**Commands:**
- `bunx vitest run test/integration` -- green (migration applies in the pool).
- `bunx tsc -b` / `bunx biome check` -- clean.

## Auto Run Result

Status: done

**Implemented:** migration 0018 — `owned_via = 'purchase'` on `owned = 1 AND owned_via IS NULL` (tombstones included), one UPDATE, zero other columns (AR-10). The choice is recorded twice: reasoning in the migration text, ruling in `meta.owned_via_backfill` — scoped honestly after review (sync rows proven via AD-10; seed-window 07-08→11 and pre-FR-9 manual owns are policy-consistency, correctable by hand). No live writer produces the legacy shape (verified across ownership core, seed, add paths).

**Review:** 2 lenses, 14 raw findings → 8 patched (2 high: the false universal proof, the standalone-failing hand-copy test), 1 rejected. `followup_review_recommended: false` — the highs were both in the artifact's own truthing, fixed by rescoping and the slice-pattern test; the shipped UPDATE itself was verified safe/idempotent by both reviewers.

**Verification:** `migration-0018.test.ts` (slice pattern, standalone-safe, byte-identical snapshot diff) + full integration 290 green; `tsc`/`biome` clean.

**Residual risks:** a claim seeded in the 3-day window or manually owned pre-FR-9 now reads `purchase` — if PS+ is ever cancelled and a pill looks wrong, the detail view corrects it (recorded in the meta ruling).
