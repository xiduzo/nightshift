-- One Device row is this computer: a random id that never changes. Night
-- Shift fills in its name (the host name) and platform when it starts.
CREATE TABLE `device` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`home_host` text,
	`last_seen_at` integer,
	`self` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_self_idx` ON `device` (`self`) WHERE "device"."self" = 1;--> statement-breakpoint
INSERT INTO `device` (`id`, `name`, `platform`, `self`) VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), '', '', 1);--> statement-breakpoint
CREATE TABLE `clone` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`device_id` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_clone_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`),
	CONSTRAINT `fk_clone_device_id_device_id_fk` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`)
);
--> statement-breakpoint
-- Every project's folder becomes its Clone on this computer. The remote is
-- read from git when Night Shift starts: SQL cannot run git.
INSERT INTO `clone` (`id`, `project_id`, `device_id`, `path`, `created_at`) SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), `id`, (SELECT `id` FROM `device` WHERE `self` = 1), `repo_path`, `created_at` FROM `project`;--> statement-breakpoint
CREATE UNIQUE INDEX `clone_deviceId_path_idx` ON `clone` (`device_id`,`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `clone_projectId_deviceId_idx` ON `clone` (`project_id`,`device_id`);--> statement-breakpoint
ALTER TABLE `step` ADD `device_id` text;--> statement-breakpoint
UPDATE `step` SET `device_id` = (SELECT `id` FROM `device` WHERE `self` = 1);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_project` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`remote` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`removed_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_project`(`id`, `name`, `created_at`, `removed_at`) SELECT `id`, `name`, `created_at`, `removed_at` FROM `project`;--> statement-breakpoint
DROP TABLE `project`;--> statement-breakpoint
ALTER TABLE `__new_project` RENAME TO `project`;--> statement-breakpoint
CREATE UNIQUE INDEX `project_remote_idx` ON `project` (`remote`);--> statement-breakpoint
-- Every run so far was walked by this computer.
CREATE TABLE `__new_run` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`flow_name` text,
	`flow` text NOT NULL,
	`body_flows` text DEFAULT '{}' NOT NULL,
	`title` text NOT NULL,
	`worktree_path` text NOT NULL,
	`branch` text NOT NULL,
	`base_ref` text NOT NULL,
	`walker_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_run_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_run`(`id`, `project_id`, `flow_name`, `flow`, `body_flows`, `title`, `worktree_path`, `branch`, `base_ref`, `walker_id`, `created_at`) SELECT `id`, `project_id`, `flow_name`, `flow`, `body_flows`, `title`, `worktree_path`, `branch`, `base_ref`, (SELECT `id` FROM `device` WHERE `self` = 1), `created_at` FROM `run`;--> statement-breakpoint
DROP TABLE `run`;--> statement-breakpoint
ALTER TABLE `__new_run` RENAME TO `run`;--> statement-breakpoint
CREATE INDEX `run_projectId_idx` ON `run` (`project_id`);--> statement-breakpoint
-- Every event so far was written by this computer, in seq order: its
-- walker_seq is its seq. The local seq and its counter stay as they were.
CREATE TABLE `__new_event` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` text,
	`step_id` text,
	`session_id` text,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`walker_id` text NOT NULL,
	`walker_seq` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_event`(`seq`, `run_id`, `step_id`, `session_id`, `type`, `payload`, `created_at`, `walker_id`, `walker_seq`) SELECT `seq`, `run_id`, `step_id`, `session_id`, `type`, `payload`, `created_at`, (SELECT `id` FROM `device` WHERE `self` = 1), `seq` FROM `event`;--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` = '__new_event';--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT '__new_event', `seq` FROM `sqlite_sequence` WHERE `name` = 'event';--> statement-breakpoint
DROP TABLE `event`;--> statement-breakpoint
ALTER TABLE `__new_event` RENAME TO `event`;--> statement-breakpoint
CREATE INDEX `event_runId_idx` ON `event` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_walkerId_walkerSeq_idx` ON `event` (`walker_id`,`walker_seq`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
