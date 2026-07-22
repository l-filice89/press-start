CREATE TABLE `ps_plus_region_state` (
	`region` text NOT NULL,
	`tier` text DEFAULT 'extra' NOT NULL,
	`last_success` text,
	`last_attempt` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`cycle_complete` integer DEFAULT false NOT NULL,
	`last_user_activity` text,
	`window` text,
	`sweep_state` text,
	`leaving_state` text,
	`lock` text,
	PRIMARY KEY(`region`, `tier`)
);
--> statement-breakpoint
-- Story 8.4: carry the single-tenant freshness + sweep state onto the region
-- ledger before their setting keys go unread (region = each user's own
-- psn_region row; the ledger PK collapses duplicates via OR IGNORE).
-- MAX() per region (review, M7): with several users on one region the winner
-- must be deterministic, and the freshest stamp is the honest one. Sweep-state
-- JSONs carry their own region field; a mis-homed one is refused by the
-- sweeps' `state.region !== region` guards and simply re-arms — contained.
INSERT OR IGNORE INTO `ps_plus_region_state` (`region`, `tier`, `last_success`, `sweep_state`, `leaving_state`)
SELECT r.`value`, 'extra',
  MAX((SELECT s1.`value` FROM `setting` s1 WHERE s1.`user_id` = r.`user_id` AND s1.`key` = 'psplus_refreshed_at')),
  MAX((SELECT s2.`value` FROM `setting` s2 WHERE s2.`user_id` = r.`user_id` AND s2.`key` = 'psplus_sweep_state')),
  MAX((SELECT s3.`value` FROM `setting` s3 WHERE s3.`user_id` = r.`user_id` AND s3.`key` = 'psplus_leaving_state'))
FROM `setting` r WHERE r.`key` = 'psn_region'
GROUP BY r.`value`;
--> statement-breakpoint
DELETE FROM `setting` WHERE `key` IN ('psplus_refresh_failed', 'psplus_refreshed_at', 'psplus_sweep_state', 'psplus_leaving_state');
