CREATE TABLE `host_space` (
	`space_id` text PRIMARY KEY,
	`host_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`personal` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_command` (
	`id` text PRIMARY KEY,
	`space_id` text NOT NULL,
	`run_id` text NOT NULL,
	`walker_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`done_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `sync_cursor` (
	`host_id` text NOT NULL,
	`space_id` text NOT NULL,
	`walker_id` text NOT NULL,
	`walker_seq` integer NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `sync_cursor_pk` PRIMARY KEY(`host_id`, `space_id`, `walker_id`)
);
--> statement-breakpoint
CREATE INDEX `run_command_walkerId_idx` ON `run_command` (`walker_id`);--> statement-breakpoint
CREATE INDEX `run_command_runId_idx` ON `run_command` (`run_id`);