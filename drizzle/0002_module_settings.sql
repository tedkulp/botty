CREATE TABLE `module_settings` (
	`module_id` text NOT NULL,
	`scope` text NOT NULL,
	`channel_id` text DEFAULT '' NOT NULL,
	`guild_id` text,
	`config` text DEFAULT '{}' NOT NULL,
	`enabled` integer,
	`updated_by_sub` text,
	`updated_by_name` text,
	`updated_at` integer,
	PRIMARY KEY(`module_id`, `scope`, `channel_id`)
);
