CREATE TABLE `external_link` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_link_source_external_id_uidx` ON `external_link` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `external_link_game_id_idx` ON `external_link` (`game_id`);--> statement-breakpoint
CREATE TABLE `game` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`title_normalized` text NOT NULL,
	`release_date` text,
	`cover_url` text,
	`store_url` text,
	`ps_plus_extra` integer DEFAULT false NOT NULL,
	`unenriched` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `game_title_normalized_idx` ON `game` (`title_normalized`);--> statement-breakpoint
CREATE TABLE `game_genre` (
	`game_id` text NOT NULL,
	`genre_id` text NOT NULL,
	PRIMARY KEY(`game_id`, `genre_id`),
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genre`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `game_tracking` (
	`user_id` text NOT NULL,
	`game_id` text NOT NULL,
	`play_status` text,
	`completed_on` text,
	`platinum_on` text,
	`started_on` text,
	`bought_on` text,
	`wishlisted_on` text,
	`owned` integer DEFAULT false NOT NULL,
	`ownership_type` text,
	PRIMARY KEY(`user_id`, `game_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_tracking_game_id_idx` ON `game_tracking` (`game_id`);--> statement-breakpoint
CREATE TABLE `genre` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `genre_name_unique` ON `genre` (`name`);--> statement-breakpoint
CREATE TABLE `import_straggler` (
	`id` text PRIMARY KEY NOT NULL,
	`source_title` text NOT NULL,
	`notion_payload` text
);
