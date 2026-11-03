CREATE TABLE `project_secret` (
	`space_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`set_at` integer NOT NULL,
	`set_by` text,
	CONSTRAINT `project_secret_pk` PRIMARY KEY(`project_id`, `name`)
);
