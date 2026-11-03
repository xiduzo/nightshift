CREATE TABLE `personal_secret` (
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`set_at` integer NOT NULL,
	`set_by` text,
	CONSTRAINT `personal_secret_pk` PRIMARY KEY(`owner_id`, `name`)
);
