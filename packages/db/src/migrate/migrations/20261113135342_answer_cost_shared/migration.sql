-- SQLite adds a NOT NULL column only with a default. Each row kept before gets a key of its own.
ALTER TABLE `answer_cost` ADD `key` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `answer_cost` SET `key` = lower(hex(randomblob(16))) WHERE `key` = '';--> statement-breakpoint
ALTER TABLE `answer_cost` ADD `device_id` text;--> statement-breakpoint
ALTER TABLE `answer_cost` ADD `host_seq` integer;--> statement-breakpoint
ALTER TABLE `answer_cost` ADD `sent_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `answer_cost_key_idx` ON `answer_cost` (`key`);