CREATE TABLE `run_lease` (
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`run_id` text NOT NULL,
	`run_title` text NOT NULL,
	`walker_id` text NOT NULL,
	`taken_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`ttl_ms` integer NOT NULL,
	CONSTRAINT `run_lease_pk` PRIMARY KEY(`space_id`, `name`)
);
--> statement-breakpoint
CREATE INDEX `run_lease_runId_idx` ON `run_lease` (`run_id`);