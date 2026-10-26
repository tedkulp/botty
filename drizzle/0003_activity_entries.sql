CREATE TABLE `activity_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module_id` text NOT NULL,
	`guild_id` text,
	`channel_id` text,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`link` text,
	`actor_sub` text,
	`actor_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_entries_module_created_idx` ON `activity_entries` (`module_id`,`created_at`);