CREATE TABLE `answer_cost` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`space_id` text NOT NULL,
	`project_id` text,
	`person_id` text NOT NULL,
	`agent` text NOT NULL,
	`entry` text,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost_usd` real,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `answer_cost_space_at_idx` ON `answer_cost` (`space_id`,`at`);