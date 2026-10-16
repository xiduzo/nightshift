CREATE TABLE `daemon_lease` (
	`id` integer PRIMARY KEY,
	`owner` text,
	`host` text NOT NULL,
	`pid` integer NOT NULL,
	`epoch` integer NOT NULL,
	`acquired_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL
);
