CREATE TABLE `lg_checkpoint` (
	`thread_id` text NOT NULL,
	`checkpoint_ns` text DEFAULT '' NOT NULL,
	`checkpoint_id` text NOT NULL,
	`parent_checkpoint_id` text,
	`type` text,
	`checkpoint` blob,
	`metadata` blob,
	CONSTRAINT `lg_checkpoint_pk` PRIMARY KEY(`thread_id`, `checkpoint_ns`, `checkpoint_id`)
);
--> statement-breakpoint
CREATE TABLE `lg_write` (
	`thread_id` text NOT NULL,
	`checkpoint_ns` text DEFAULT '' NOT NULL,
	`checkpoint_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_path` text DEFAULT '' NOT NULL,
	`idx` integer NOT NULL,
	`channel` text NOT NULL,
	`type` text,
	`value` blob,
	CONSTRAINT `lg_write_pk` PRIMARY KEY(`thread_id`, `checkpoint_ns`, `checkpoint_id`, `task_id`, `idx`)
);
