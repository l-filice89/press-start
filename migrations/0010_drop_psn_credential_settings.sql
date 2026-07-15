-- Epic 11 story 11.2: the PSN credential surface is deleted. Its setting rows
-- are unreachable by any code but still hold a real credential token (and the
-- sync-era attention list) at rest in a deployed D1 — drop them, plus any
-- stale psn_op_lock row minted by a retired op. Nothing else in `setting` is
-- touched: psn_region, timezone, fab_handedness, the psplus_* keys, and a live
-- catalog-refresh lock all survive.
DELETE FROM `setting` WHERE `key` IN ('psn_npsso', 'psn_auth', 'sync_attention');--> statement-breakpoint
DELETE FROM `setting` WHERE `key` = 'psn_op_lock' AND (
	`value` LIKE '%:library-sync:%'
	OR `value` LIKE '%:trophy-sync:%'
	OR `value` LIKE '%:platinum-backfill:%'
);
