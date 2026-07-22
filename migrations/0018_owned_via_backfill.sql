-- Story 8.5 (B6): backfill legacy `owned_via = NULL` on OWNED rows.
--
-- RESOLUTION: proof where it holds, policy-consistency where it doesn't.
-- (1) SYNC-path rows: AD-10's sync boundary excluded membership entries
--     wholesale pre-FR-9 ("never set Owned") — proven purchases.
-- (2) SEED rows from the 2026-07-08→11 window (review, H1: commit 558afe7
--     made the seed import claims as Owned three days before `owned_via`
--     existed) and pre-FR-9 MANUAL owns (the detail toggle shipped 07-09):
--     NOT provable — they get `purchase` for CONSISTENCY with the live
--     defaults (`core/ownership.ts` via='purchase'; a re-seed today stamps
--     the same). A claim mislabeled here won't be un-owned by a future
--     cancel-PS+ flow; the manual detail view remains the correction path.
-- Applies to tombstones too (discarded=1): a revive restores the row as-is,
-- so leaving NULL there would resurrect the ambiguity.
-- Un-owned rows keep NULL: `owned_via` is meaningless without `owned`.
-- No other column is touched (AR-10).
UPDATE `game_tracking` SET `owned_via` = 'purchase'
WHERE `owned` = 1 AND `owned_via` IS NULL;
--> statement-breakpoint
-- The recorded choice (the AC's "the choice is recorded"):
INSERT OR REPLACE INTO `meta` (`key`, `value`) VALUES (
  'owned_via_backfill',
  '2026-07-17: legacy owned rows with NULL owned_via set to purchase. Sync-path rows: proven by AD-10 (pre-FR-9 sync never set Owned on membership entries). Seed-window (2026-07-08..11) and manual pre-FR-9 owns: purchase by consistency with the live defaults, not proof — a mislabeled claim is corrected by hand in the detail view. Tombstones included; un-owned rows keep NULL.'
);
