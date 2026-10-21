CREATE TABLE `organization` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text,
	`personal` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_member_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	CONSTRAINT `fk_invitation_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_invitation_inviter_id_user_id_fk` FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_uidx` ON `organization` (`slug`);--> statement-breakpoint
ALTER TABLE `session` ADD `active_organization_id` text;--> statement-breakpoint
ALTER TABLE `device` ADD `owner_id` text;--> statement-breakpoint
-- The Person of this computer: the earliest account, else a new one that
-- Night Shift signs in for you. Its name is filled in when Night Shift starts.
INSERT INTO `user` (`id`, `name`, `email`, `email_verified`) SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), '', 'local@nightshift.invalid', 0 WHERE NOT EXISTS (SELECT 1 FROM `user`);--> statement-breakpoint
UPDATE `device` SET `owner_id` = (SELECT `id` FROM `user` ORDER BY `created_at`, `id` LIMIT 1) WHERE `self` = 1;--> statement-breakpoint
-- Every Person gets a personal Space, with them as its owner. Sessions
-- start in it.
INSERT INTO `organization` (`id`, `name`, `slug`, `created_at`, `personal`) SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), 'Personal', 'personal-' || `id`, cast(unixepoch('subsecond') * 1000 as integer), 1 FROM `user`;--> statement-breakpoint
INSERT INTO `member` (`id`, `organization_id`, `user_id`, `role`, `created_at`) SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), `organization`.`id`, `user`.`id`, 'owner', cast(unixepoch('subsecond') * 1000 as integer) FROM `user` JOIN `organization` ON `organization`.`slug` = 'personal-' || `user`.`id`;--> statement-breakpoint
UPDATE `session` SET `active_organization_id` = (SELECT `id` FROM `organization` WHERE `slug` = 'personal-' || `session`.`user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- Every row so far is in the personal Space of this computer's Person.
CREATE TABLE `__new_project` (
	`id` text PRIMARY KEY,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`remote` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`removed_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_project`(`id`, `space_id`, `name`, `remote`, `created_at`, `removed_at`) SELECT `id`, (SELECT `organization`.`id` FROM `organization` JOIN `device` ON `organization`.`slug` = 'personal-' || `device`.`owner_id` WHERE `device`.`self` = 1), `name`, `remote`, `created_at`, `removed_at` FROM `project`;--> statement-breakpoint
DROP TABLE `project`;--> statement-breakpoint
ALTER TABLE `__new_project` RENAME TO `project`;--> statement-breakpoint
CREATE UNIQUE INDEX `project_remote_idx` ON `project` (`remote`);--> statement-breakpoint
CREATE INDEX `project_spaceId_idx` ON `project` (`space_id`);--> statement-breakpoint
CREATE TABLE `__new_clone` (
	`id` text PRIMARY KEY,
	`space_id` text NOT NULL,
	`project_id` text NOT NULL,
	`device_id` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_clone_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`),
	CONSTRAINT `fk_clone_device_id_device_id_fk` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_clone`(`id`, `space_id`, `project_id`, `device_id`, `path`, `created_at`) SELECT `id`, (SELECT `organization`.`id` FROM `organization` JOIN `device` ON `organization`.`slug` = 'personal-' || `device`.`owner_id` WHERE `device`.`self` = 1), `project_id`, `device_id`, `path`, `created_at` FROM `clone`;--> statement-breakpoint
DROP TABLE `clone`;--> statement-breakpoint
ALTER TABLE `__new_clone` RENAME TO `clone`;--> statement-breakpoint
CREATE UNIQUE INDEX `clone_deviceId_path_idx` ON `clone` (`device_id`,`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `clone_projectId_deviceId_idx` ON `clone` (`project_id`,`device_id`);--> statement-breakpoint
CREATE TABLE `__new_run` (
	`id` text PRIMARY KEY,
	`space_id` text NOT NULL,
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
INSERT INTO `__new_run`(`id`, `space_id`, `project_id`, `flow_name`, `flow`, `body_flows`, `title`, `worktree_path`, `branch`, `base_ref`, `walker_id`, `created_at`) SELECT `id`, (SELECT `organization`.`id` FROM `organization` JOIN `device` ON `organization`.`slug` = 'personal-' || `device`.`owner_id` WHERE `device`.`self` = 1), `project_id`, `flow_name`, `flow`, `body_flows`, `title`, `worktree_path`, `branch`, `base_ref`, `walker_id`, `created_at` FROM `run`;--> statement-breakpoint
DROP TABLE `run`;--> statement-breakpoint
ALTER TABLE `__new_run` RENAME TO `run`;--> statement-breakpoint
CREATE INDEX `run_projectId_idx` ON `run` (`project_id`);--> statement-breakpoint
CREATE INDEX `run_spaceId_idx` ON `run` (`space_id`);--> statement-breakpoint
CREATE TABLE `__new_step` (
	`id` text PRIMARY KEY,
	`space_id` text NOT NULL,
	`run_id` text NOT NULL,
	`node_id` text NOT NULL,
	`node_type` text NOT NULL,
	`visit` integer NOT NULL,
	`transcript_path` text NOT NULL,
	`device_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_step_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_step`(`id`, `space_id`, `run_id`, `node_id`, `node_type`, `visit`, `transcript_path`, `device_id`, `created_at`) SELECT `id`, (SELECT `organization`.`id` FROM `organization` JOIN `device` ON `organization`.`slug` = 'personal-' || `device`.`owner_id` WHERE `device`.`self` = 1), `run_id`, `node_id`, `node_type`, `visit`, `transcript_path`, `device_id`, `created_at` FROM `step`;--> statement-breakpoint
DROP TABLE `step`;--> statement-breakpoint
ALTER TABLE `__new_step` RENAME TO `step`;--> statement-breakpoint
CREATE INDEX `step_runId_idx` ON `step` (`run_id`);--> statement-breakpoint
CREATE TABLE `__new_agent_session` (
	`id` text PRIMARY KEY,
	`space_id` text NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`harness_session_id` text,
	`prompt` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_agent_session_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`),
	CONSTRAINT `fk_agent_session_step_id_step_id_fk` FOREIGN KEY (`step_id`) REFERENCES `step`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_agent_session`(`id`, `space_id`, `run_id`, `step_id`, `harness_session_id`, `prompt`, `created_at`) SELECT `id`, (SELECT `organization`.`id` FROM `organization` JOIN `device` ON `organization`.`slug` = 'personal-' || `device`.`owner_id` WHERE `device`.`self` = 1), `run_id`, `step_id`, `harness_session_id`, `prompt`, `created_at` FROM `agent_session`;--> statement-breakpoint
DROP TABLE `agent_session`;--> statement-breakpoint
ALTER TABLE `__new_agent_session` RENAME TO `agent_session`;--> statement-breakpoint
CREATE INDEX `agent_session_runId_idx` ON `agent_session` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_session_stepId_idx` ON `agent_session` (`step_id`);--> statement-breakpoint
-- The local seq and its counter stay as they were.
CREATE TABLE `__new_event` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`space_id` text NOT NULL,
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
INSERT INTO `__new_event`(`seq`, `space_id`, `run_id`, `step_id`, `session_id`, `type`, `payload`, `created_at`, `walker_id`, `walker_seq`) SELECT `seq`, (SELECT `organization`.`id` FROM `organization` JOIN `device` ON `organization`.`slug` = 'personal-' || `device`.`owner_id` WHERE `device`.`self` = 1), `run_id`, `step_id`, `session_id`, `type`, `payload`, `created_at`, `walker_id`, `walker_seq` FROM `event`;--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` = '__new_event';--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT '__new_event', `seq` FROM `sqlite_sequence` WHERE `name` = 'event';--> statement-breakpoint
DROP TABLE `event`;--> statement-breakpoint
ALTER TABLE `__new_event` RENAME TO `event`;--> statement-breakpoint
CREATE INDEX `event_runId_idx` ON `event` (`run_id`);--> statement-breakpoint
CREATE INDEX `event_spaceId_idx` ON `event` (`space_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_walkerId_walkerSeq_idx` ON `event` (`walker_id`,`walker_seq`);--> statement-breakpoint
PRAGMA foreign_keys=ON;