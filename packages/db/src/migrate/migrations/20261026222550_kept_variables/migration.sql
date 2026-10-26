CREATE TABLE `kept_variable` (
	`space_id` text NOT NULL,
	`project_id` text NOT NULL,
	`flow_name` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `kept_variable_pk` PRIMARY KEY(`project_id`, `flow_name`, `name`),
	CONSTRAINT `fk_kept_variable_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`)
);
--> statement-breakpoint
CREATE INDEX `kept_variable_spaceId_idx` ON `kept_variable` (`space_id`);