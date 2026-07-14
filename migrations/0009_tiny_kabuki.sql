CREATE TABLE `ps_plus_catalog` (
	`region` text NOT NULL,
	`tier` text DEFAULT 'extra' NOT NULL,
	`product_id` text NOT NULL,
	`np_title_id` text,
	`name` text NOT NULL,
	`title_normalized` text NOT NULL,
	`cover_url` text,
	`platforms` text,
	`store_classification` text,
	`store_url` text,
	`generation` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`region`, `tier`, `product_id`)
);
--> statement-breakpoint
CREATE INDEX `ps_plus_catalog_title_normalized_idx` ON `ps_plus_catalog` (`title_normalized`);--> statement-breakpoint
CREATE TABLE `ps_plus_catalog_genre` (
	`region` text NOT NULL,
	`tier` text DEFAULT 'extra' NOT NULL,
	`product_id` text NOT NULL,
	`genre_key` text NOT NULL,
	PRIMARY KEY(`region`, `tier`, `product_id`, `genre_key`),
	FOREIGN KEY (`region`,`tier`,`product_id`) REFERENCES `ps_plus_catalog`(`region`,`tier`,`product_id`) ON UPDATE no action ON DELETE cascade
);
