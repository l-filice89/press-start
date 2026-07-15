-- Epic 11 story 11.3: the trophy display is deleted and nothing can ever
-- repopulate these columns (11.1/11.2 severed the sync) — drop all 11.
-- `platinum_on`/`completed_on`/`owned_via`/`bought_on` are untouched.
-- Deploy-window note: CI applies migrations BEFORE the Worker deploy, so the
-- still-running old Worker (whose shelf SELECT names these columns) 500s on
-- shelf reads until the new deploy lands. Accepted: single-user app, the
-- window is one CI step, and the destructive-migration approval gate means a
-- human is watching this apply.
-- Recovery note: SQLite has no DROP COLUMN IF EXISTS, so a run that dies
-- mid-file leaves the table half-stripped and a blind re-apply fails on the
-- first already-dropped column. If that happens, delete the already-executed
-- statements from a COPY of this file and apply the remainder manually.
ALTER TABLE `game_tracking` DROP COLUMN `trophy_np_comm_id`;--> statement-breakpoint
ALTER TABLE `game_tracking` DROP COLUMN `trophy_np_service_name`;--> statement-breakpoint
ALTER TABLE `game_tracking` DROP COLUMN `trophy_earned_bronze`;--> statement-breakpoint
ALTER TABLE `game_tracking` DROP COLUMN `trophy_earned_silver`;--> statement-breakpoint
ALTER TABLE `game_tracking` DROP COLUMN `trophy_earned_gold`;--> statement-breakpoint
ALTER TABLE `game_tracking` DROP COLUMN `trophy_earned_platinum`;--> statement-breakpoint
ALTER TABLE `game_tracking` DROP COLUMN `trophy_defined_bronze`;--> statement-breakpoint
ALTER TABLE `game_tracking` DROP COLUMN `trophy_defined_silver`;--> statement-breakpoint
ALTER TABLE `game_tracking` DROP COLUMN `trophy_defined_gold`;--> statement-breakpoint
ALTER TABLE `game_tracking` DROP COLUMN `trophy_defined_platinum`;--> statement-breakpoint
ALTER TABLE `game_tracking` DROP COLUMN `trophy_synced_at`;