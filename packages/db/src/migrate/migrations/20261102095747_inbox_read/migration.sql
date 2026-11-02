ALTER TABLE `notification_delivery` ADD `read_at` integer;--> statement-breakpoint
CREATE INDEX `notification_delivery_createdAt_idx` ON `notification_delivery` (`created_at`);