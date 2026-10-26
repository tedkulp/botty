CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`sub` text NOT NULL,
	`name` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
