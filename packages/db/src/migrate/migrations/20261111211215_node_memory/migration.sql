CREATE TABLE `node_memory` (
	`space_id` text NOT NULL,
	`project_id` text NOT NULL,
	`root_flow` text NOT NULL,
	`node_path` text NOT NULL,
	`scope` text NOT NULL,
	`item_key` text NOT NULL,
	`hash` text,
	`value` text,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `node_memory_pk` PRIMARY KEY(`project_id`, `root_flow`, `node_path`, `scope`, `item_key`),
	CONSTRAINT `fk_node_memory_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`)
);
--> statement-breakpoint
CREATE INDEX `node_memory_spaceId_idx` ON `node_memory` (`space_id`);--> statement-breakpoint
CREATE INDEX `node_memory_node_idx` ON `node_memory` (`project_id`,`root_flow`,`node_path`,`updated_at`);