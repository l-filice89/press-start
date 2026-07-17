CREATE TABLE `ps_plus_departure` (
	`region` text NOT NULL,
	`tier` text DEFAULT 'extra' NOT NULL,
	`product_id` text NOT NULL,
	`np_title_id` text,
	`title_normalized` text NOT NULL,
	`left_on` text,
	`leaving_on` text,
	`psn_concept_id` text,
	PRIMARY KEY(`region`, `tier`, `product_id`)
);
--> statement-breakpoint
CREATE INDEX `ps_plus_departure_title_idx` ON `ps_plus_departure` (`title_normalized`);--> statement-breakpoint
CREATE INDEX `ps_plus_departure_np_title_idx` ON `ps_plus_departure` (`np_title_id`);--> statement-breakpoint
-- Story 8.3 backfill (0003 INSERT…SELECT precedent): carry the sweep-owned
-- facts (leaving date, concept cache) into the ledger before the columns drop.
-- Region/tier/product come from the catalog row itself (title join — the same
-- key the sweep used to write these). Legacy ps_plus_left_on values are
-- dropped by recorded ruling (spec-8-3): zero readers, and departed games have
-- no catalog row to key on. Deploy-window blip accepted per the 0011 note.
INSERT OR IGNORE INTO `ps_plus_departure` (`region`, `tier`, `product_id`, `np_title_id`, `title_normalized`, `left_on`, `leaving_on`, `psn_concept_id`)
SELECT c.`region`, c.`tier`, c.`product_id`, c.`np_title_id`, c.`title_normalized`, NULL, g.`ps_plus_leaving_on`, g.`psn_concept_id`
FROM `game` g
JOIN `ps_plus_catalog` c ON c.`title_normalized` = g.`title_normalized` AND g.`title_normalized` != ''
WHERE g.`ps_plus_leaving_on` IS NOT NULL OR g.`psn_concept_id` IS NOT NULL;
-- Collision note: two games sharing a normalized title joined to one product
-- let INSERT OR IGNORE keep an arbitrary winner — accepted (single-user data,
-- ~40 dated rows, next sweep chunk overwrites within days). Games whose stored
-- key predates a normalizeTitle change join nothing and lose their date the
-- same way (self-heals via the sweep).
--> statement-breakpoint
ALTER TABLE `game` DROP COLUMN `ps_plus_extra`;--> statement-breakpoint
ALTER TABLE `game` DROP COLUMN `ps_plus_left_on`;--> statement-breakpoint
ALTER TABLE `game` DROP COLUMN `ps_plus_leaving_on`;--> statement-breakpoint
ALTER TABLE `game` DROP COLUMN `psn_concept_id`;