CREATE TABLE `cli_tool` (
	`name` text PRIMARY KEY,
	`description` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
-- The GitHub tools were built in. A daemon that has projects keeps gh, so its flows still start.
INSERT INTO `cli_tool` (`name`, `description`) SELECT 'gh', 'GitHub: issues and pull requests' WHERE EXISTS (SELECT 1 FROM `project`);
