CREATE TABLE `usage_install` (
	`id` integer PRIMARY KEY,
	`install_id` text NOT NULL,
	`hmac_key` text NOT NULL,
	`active_on` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`at` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_sent` (
	`id` integer PRIMARY KEY,
	`body` text NOT NULL,
	`sent_at` integer NOT NULL
);
