CREATE TABLE `notification_delivery` (
	`person_id` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`space_id` text NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text,
	`status` text NOT NULL,
	`due_at` integer,
	`sent_to` text DEFAULT '[]' NOT NULL,
	`held_for` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`sent_at` integer,
	`withdrawn_at` integer,
	CONSTRAINT `notification_delivery_pk` PRIMARY KEY(`person_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `notification_settings` (
	`person_id` text PRIMARY KEY,
	`gate_opened` integer DEFAULT true NOT NULL,
	`run_finished` integer DEFAULT true NOT NULL,
	`run_failed` integer DEFAULT true NOT NULL,
	`quiet_start` text,
	`quiet_end` text,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`screens` text DEFAULT '{}' NOT NULL,
	`hold_minutes` integer DEFAULT 3 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_target` (
	`id` text PRIMARY KEY,
	`person_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`platform` text DEFAULT '' NOT NULL,
	`endpoint` text NOT NULL,
	`keys` text,
	`session_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE INDEX `notification_delivery_key_idx` ON `notification_delivery` (`key`);--> statement-breakpoint
CREATE INDEX `notification_delivery_status_idx` ON `notification_delivery` (`status`);--> statement-breakpoint
CREATE INDEX `push_target_personId_idx` ON `push_target` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `push_target_personId_endpoint_idx` ON `push_target` (`person_id`,`endpoint`);