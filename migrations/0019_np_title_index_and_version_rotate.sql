CREATE INDEX `ps_plus_catalog_np_title_id_idx` ON `ps_plus_catalog` (`np_title_id`);
--> statement-breakpoint
-- Migration 0018 rewrote shelf-rendered bytes (`owned_via`) without rotating
-- any library version, so a cached ETag could 304 the pre-backfill body for
-- weeks (8.5 follow-up review). Rotate every user's version once; the value
-- only needs to differ from the old UUID, not be unique per user.
UPDATE `setting` SET `value` = lower(hex(randomblob(16)))
WHERE `key` = 'library_version';
