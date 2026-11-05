CREATE TABLE `space_secret` (
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`set_at` integer NOT NULL,
	`set_by` text,
	CONSTRAINT `space_secret_pk` PRIMARY KEY(`space_id`, `name`)
);
