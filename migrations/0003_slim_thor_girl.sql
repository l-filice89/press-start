CREATE TABLE `setting` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Merge any pre-existing case-variant genres ("Action"/"action") into one
-- canonical row (min id per lower(name)) before the NOCASE index forbids them.
INSERT OR IGNORE INTO `game_genre` (`game_id`, `genre_id`)
SELECT gg.`game_id`,
	(SELECT min(g2.`id`) FROM `genre` g2 WHERE lower(g2.`name`) = lower(g.`name`))
FROM `game_genre` gg JOIN `genre` g ON g.`id` = gg.`genre_id`;
--> statement-breakpoint
DELETE FROM `game_genre` WHERE `genre_id` NOT IN (SELECT min(`id`) FROM `genre` GROUP BY lower(`name`));
--> statement-breakpoint
DELETE FROM `genre` WHERE `id` NOT IN (SELECT min(`id`) FROM `genre` GROUP BY lower(`name`));
--> statement-breakpoint
CREATE UNIQUE INDEX `genre_name_nocase_uidx` ON `genre` (lower("name"));