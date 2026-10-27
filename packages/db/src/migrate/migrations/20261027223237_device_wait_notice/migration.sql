ALTER TABLE `notification_delivery` ADD `title` text;--> statement-breakpoint
ALTER TABLE `notification_delivery` ADD `body` text;--> statement-breakpoint
ALTER TABLE `notification_settings` ADD `device_wait` integer DEFAULT true NOT NULL;